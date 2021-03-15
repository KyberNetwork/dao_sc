// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.7.6;

import {IPriceOracle} from '../../../interfaces/liquidation/IPriceOracle.sol';
import {PermissionAdmin} from '@kyber.network/utils-sc/contracts/PermissionAdmin.sol';
import {Utils} from '@kyber.network/utils-sc/contracts/Utils.sol';
import {SafeMath} from '@openzeppelin/contracts/math/SafeMath.sol';

// Refer to https://github.com/smartcontractkit/chainlink/blob/develop/evm-contracts/src/v0.6/interfaces/AggregatorV3Interface.sol
interface IChainLinkAggregatorProxy {
  function decimals() external view returns (uint8);
  function latestRoundData()
    external
    view
    returns (
      uint80 roundId,
      int256 answer, // rate in PRECISION of 10^18
      uint256 startedAt,
      uint256 updatedAt,
      uint80 answeredInRound
    );
}

/**
* @dev Contract to fetch conversion rate from src to dest token using ChainLink oracle
*  If either token is not supported, conversion rate will be zero
*  For each pair (src, dest) tokens, check rates using both eth and usd as quote
*     then return the average
*  Conversion Rate is returned with units of PRECISION or 10^18, e.g if rate is 0.001,
*     the function will return 0.001 * 10^18
*  From Utils, MAX_DECIMALS is 18, and PRECISION is 10^18
*/
contract ChainLinkPriceOracle is IPriceOracle, PermissionAdmin, Utils {
  using SafeMath for uint256;

  struct AggregatorProxyData {
    address quoteEthProxy;
    uint8 quoteEthProxyDecimals;
    address quoteUsdProxy;
    uint8 quoteUsdProxyDecimals;
  }

  mapping (address => AggregatorProxyData) internal _tokenData;

  constructor(address admin) PermissionAdmin(admin) {}

  /**
  * @dev Update list of aggregator proxies for tokens
  *   Need to check the data carefully, Aggregator contract doesn't have function to
  *     get the supported token or base, so can not do any safe check here
  */
  function updateAggregatorProxyData(
    address[] calldata tokens,
    address[] calldata quoteEthProxies,
    address[] calldata quoteUsdProxies
  ) external onlyAdmin {

    require(
      tokens.length == quoteEthProxies.length &&
      tokens.length == quoteUsdProxies.length,
      'invalid length data'
    );

    uint8 quoteEthProxyDecimals;
    uint8 quoteUsdProxyDecimals;

    for(uint256 i = 0; i < tokens.length; i++) {
      quoteEthProxyDecimals = quoteEthProxies[i] == address(0) ? 0 :
        IChainLinkAggregatorProxy(quoteEthProxies[i]).decimals();
      quoteUsdProxyDecimals = quoteUsdProxies[i] == address(0) ? 0 :
        IChainLinkAggregatorProxy(quoteUsdProxies[i]).decimals();

      _tokenData[tokens[i]] = AggregatorProxyData({
        quoteEthProxy: quoteEthProxies[i],
        quoteUsdProxy: quoteUsdProxies[i],
        quoteEthProxyDecimals: quoteEthProxyDecimals,
        quoteUsdProxyDecimals: quoteUsdProxyDecimals
      });
    }
  }
  /**
  *  @dev Get conversion rate from src to dest token given amount
  *   For chainlink, amount is not needed
  *   Fetch rates using both eth and usd as quote, then take the average
  */
  function conversionRate(
    address src,
    address dest,
    uint256 /* amount */
  )
    external override view returns(uint256 rate)
  {
    if (dest == address(ETH_TOKEN_ADDRESS)) {
      return getRateOverEth(src);
    }

    if (src == address(ETH_TOKEN_ADDRESS)) {
      rate = getRateOverEth(dest);
      if (rate > 0) rate = PRECISION.mul(PRECISION).div(rate);
      return rate;
    }

    uint256 srcRate;
    uint256 destRate;

    uint256 rateQuoteEth;
    uint256 rateQuoteUsd;

    // get rate from eth quote
    srcRate = getRateOverEth(src);
    if (srcRate > 0) {
      destRate = getRateOverEth(dest);
      if (destRate > 0) {
        rateQuoteEth = PRECISION.mul(srcRate).div(destRate);
      }
    }

    // get rate from usd quote
    srcRate = getRateOverUsd(src);
    if (srcRate > 0) {
      destRate = getRateOverUsd(dest);
      if (destRate > 0) {
        // update new rate if it is higher
        rateQuoteUsd = PRECISION.mul(srcRate).div(destRate);
      }
    }

    if (rateQuoteEth == 0) {
      rate = rateQuoteUsd;
    } else if (rateQuoteUsd == 0) {
      rate = rateQuoteEth;
    } else {
      // average rate over eth and usd
      rate = rateQuoteEth.add(rateQuoteUsd).div(2);
    }
  }

  function getTokenAggregatorProxyData(address token)
    external view returns (
      address quoteEthProxy,
      address quoteUsdProxy
    )
  {
    (quoteEthProxy, quoteUsdProxy) = (_tokenData[token].quoteEthProxy, _tokenData[token].quoteUsdProxy);
  }

  /**
  *   @dev Get token rate over eth with units of PRECISION
  */
  function getRateOverEth(address token) public view returns (uint256 rate) {
    int256 answer;
    IChainLinkAggregatorProxy proxy = IChainLinkAggregatorProxy(_tokenData[token].quoteEthProxy);
    if (proxy != IChainLinkAggregatorProxy(0)) {
      (, answer, , ,) = proxy.latestRoundData();
    }
    if (answer < 0) return 0; // safe check in case ChainLink returns invalid data
    rate = uint256(answer);
    uint256 decimals = uint256(_tokenData[token].quoteEthProxyDecimals);
    rate = (decimals < MAX_DECIMALS) ? rate.mul(10 ** (MAX_DECIMALS - decimals)) :
      rate.div(10 ** (decimals - MAX_DECIMALS));
  }

  /**
  *   @dev Get token rate over usd with units of PRECISION
  */
  function getRateOverUsd(address token) public view returns (uint256 rate) {
    int256 answer;
    IChainLinkAggregatorProxy proxy = IChainLinkAggregatorProxy(_tokenData[token].quoteUsdProxy);
    if (proxy != IChainLinkAggregatorProxy(0)) {
      (, answer, , ,) = proxy.latestRoundData();
    }
    if (answer < 0) return 0; // safe check in case ChainLink returns invalid data
    rate = uint256(answer);
    uint256 decimals = uint256(_tokenData[token].quoteUsdProxyDecimals);
    rate = (decimals < MAX_DECIMALS) ? rate.mul(10 ** (MAX_DECIMALS - decimals)) :
      rate.div(10 ** (decimals - MAX_DECIMALS));
  }
}

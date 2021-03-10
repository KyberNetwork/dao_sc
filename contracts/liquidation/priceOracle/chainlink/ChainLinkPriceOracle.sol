// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.7.6;

import {IPriceOracle} from '../../../interfaces/IPriceOracle.sol';
import {PermissionAdmin} from '@kyber.network/utils-sc/contracts/PermissionAdmin.sol';
import {Utils} from '@kyber.network/utils-sc/contracts/Utils.sol';
import {SafeMath} from '@openzeppelin/contracts/math/SafeMath.sol';

interface IChainLinkAggregatorProxy {
  function decimals() external view returns (uint8);
  function latestRoundData()
    external
    view
    returns (
      uint80 roundId,
      int256 answer, // rate in precision of 10^18
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
*/
contract ChainLinkPriceOracle is IPriceOracle, PermissionAdmin, Utils {
  using SafeMath for uint256;

  struct AggregatorProxyData {
    address quoteEth;
    address quoteUsd;
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
    address[] calldata quoteEthAddresses,
    address[] calldata quoteUsdAddresses
  ) external onlyAdmin {

    require(
      tokens.length == quoteEthAddresses.length &&
      tokens.length == quoteUsdAddresses.length,
      'invalid length data'
    );

    for(uint256 i = 0; i < tokens.length; i++) {
      _tokenData[tokens[i]] = AggregatorProxyData({
        quoteEth: quoteEthAddresses[i],
        quoteUsd: quoteUsdAddresses[i]
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
      address quoteEth,
      address quoteUsd
    )
  {
    (quoteEth, quoteUsd) = (_tokenData[token].quoteEth, _tokenData[token].quoteUsd);
  }

  function getRateOverEth(address token) public view returns (uint256 rate) {
    int answer;
    IChainLinkAggregatorProxy proxy = IChainLinkAggregatorProxy(_tokenData[token].quoteEth);
    if (proxy != IChainLinkAggregatorProxy(0)) {
      (, answer, , ,) = proxy.latestRoundData();
    }
    if (answer < 0) return 0;
    rate = uint256(answer);
  }

  function getRateOverUsd(address token) public view returns (uint256 rate) {
    int answer;
    IChainLinkAggregatorProxy proxy = IChainLinkAggregatorProxy(_tokenData[token].quoteUsd);
    if (proxy != IChainLinkAggregatorProxy(0)) {
      (, answer, , ,) = proxy.latestRoundData();
    }
    if (answer < 0) return 0;
    rate = uint256(answer);
  }
}

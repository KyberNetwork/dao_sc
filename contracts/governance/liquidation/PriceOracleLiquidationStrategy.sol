// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.7.6;


import {LiquidationStrategy} from "./LiquidationStrategy.sol";
import {IPriceOracle} from "../../interfaces/IPriceOracle.sol";
import {IERC20Ext} from "@kyber.network/utils-sc/contracts/IERC20Ext.sol";


/// Liquidation strategy that uses Price Oracle to liquidate tokens
/// Liquidator will receive a premimum for every transaction that they liquidate tokens in the fee pool
contract PriceOracleLiquidationStrategy is LiquidationStrategy {

  IPriceOracle public priceOracle;
  uint256 public premiumBps;

  event PriceOracleSet(address priceOracle);
  event PremiumBpsSet(uint256 premiumBps);
  event PriceOracleLiquidated(
    address indexed liquidator,
    IERC20Ext indexed src,
    uint256 amount,
    IERC20Ext indexed dest,
    uint256 destAmount,
    bytes data
  );

  constructor (
    address _admin,
    address _feePool,
    address payable _treasuryPool,
    uint128 _startTime,
    uint64 _repeatedPeriod,
    uint64 _duration,
    address _priceOracle,
    uint256 _premiumBps,
    address[] memory _whitelistedTokens
  )
    LiquidationStrategy(
      _admin,
      _feePool,
      _treasuryPool,
      _startTime,
      _repeatedPeriod,
      _duration,
      _whitelistedTokens
    )
  {
    _setPriceOracle(_priceOracle);
    _setPremium(_premiumBps);
  }

  /**
  * @dev Call to liquidate amount of source token to dest token, using price oracle as safe check
  * @param source source token to liquidate
  * @param amount amount of source token to liquidate
  * @param dest dest token to be received
  * @param txData data for callback
  * @return destAmount amount of dest token to be received
  */
  function liquidate(
    IERC20Ext source,
    uint256 amount,
    IERC20Ext dest,
    bytes calldata txData
  )
    external returns (uint256 destAmount)
  {
    IERC20Ext[] memory sources = new IERC20Ext[](1);
    sources[0] = source;
    uint256[] memory amounts = new uint256[](1);
    amounts[0] = amount;

    if (source == dest && whitelistedTokens[address(source)]) {
      // forward token from fee pool to treasury pool
      feePool.withdrawFunds(sources, amounts, treasuryPool);
      emit PriceOracleLiquidated(msg.sender, source, amount, dest, amount, txData);
      return amount;
    }
    uint256 conversionRate = priceOracle.conversionRate(address(source), address(dest), amount);
    uint256 minReturn = calcDestAmount(source, dest, amount, conversionRate);
    // giving them some premium
    minReturn = minReturn * (BPS - premiumBps) / BPS;
    require(minReturn > 0, 'min return is 0');

    destAmount = super.liquidate(sources, amounts, msg.sender, dest, minReturn, txData);
    emit PriceOracleLiquidated(msg.sender, source, amount, dest, destAmount, txData);
  }

  function _setPriceOracle(address _priceOracle) internal {
    require(_priceOracle != address(0), 'invalid price oracle');
    priceOracle = IPriceOracle(_priceOracle);
    emit PriceOracleSet(_priceOracle);
  }

  function _setPremium(uint256 _premiumBps) internal {
    require(_premiumBps < BPS, 'invalid premium bps');
    premiumBps = _premiumBps;
    emit PremiumBpsSet(_premiumBps);
  }
}

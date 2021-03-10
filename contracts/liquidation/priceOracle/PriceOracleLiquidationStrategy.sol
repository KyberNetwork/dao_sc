// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.7.6;


import {LiquidationStrategy} from '../LiquidationStrategy.sol';
import {IPriceOracle} from '../../interfaces/IPriceOracle.sol';
import {IPool} from '../../interfaces/IPool.sol';
import {IPriceOracleLiquidationStrategy} from '../../interfaces/IPriceOracleLiquidationStrategy.sol';
import {IERC20Ext} from '@kyber.network/utils-sc/contracts/IERC20Ext.sol';
import {SafeMath} from '@openzeppelin/contracts/math/SafeMath.sol';


/// Liquidation strategy that uses Price Oracle to liquidate tokens
/// Liquidator will receive a premimum for every transaction that they liquidate tokens in the fee pool
contract PriceOracleLiquidationStrategy is LiquidationStrategy, IPriceOracleLiquidationStrategy {

  using SafeMath for uint256;
  IPriceOracle internal _priceOracle;
  uint256 internal _defaultPremiumBps;
  mapping (address => uint256) internal _groupPremiumBps;

  event PriceOracleSet(address indexed priceOracle);
  event DefaultPremiumBpsSet(uint256 indexed premiumBps);
  event GroupdPremiumBpsSet(address indexed liquidator, uint256 indexed premiumBps);
  event PriceOracleLiquidated(
    address indexed liquidator,
    IERC20Ext indexed src,
    uint256 amount,
    IERC20Ext indexed dest,
    uint256 destAmount,
    bytes data
  );

  constructor (
    address admin,
    address feePool,
    address payable treasuryPool,
    uint128 startTime,
    uint64 repeatedPeriod,
    uint64 duration,
    address oracle,
    uint256 premiumBps,
    address[] memory whitelistedTokens
  )
    LiquidationStrategy(
      admin,
      feePool,
      treasuryPool,
      startTime,
      repeatedPeriod,
      duration,
      whitelistedTokens
    )
  {
    _setPriceOracle(oracle);
    _setDefaultPremium(premiumBps);
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
    external override returns (uint256 destAmount)
  {
    IERC20Ext[] memory sources = new IERC20Ext[](1);
    sources[0] = source;
    uint256[] memory amounts = new uint256[](1);
    amounts[0] = amount;

    if (source == dest && isWhitelistedToken(address(source))) {
      // forward token from fee pool to treasury pool
      IPool(feePool()).withdrawFunds(sources, amounts, payable(treasuryPool()));
      emit PriceOracleLiquidated(msg.sender, source, amount, dest, amount, txData);
      return amount;
    }
    uint256 conversionRate = _priceOracle.conversionRate(address(source), address(dest), amount);
    uint256 minReturn = calcDestAmount(source, dest, amount, conversionRate);
    // giving them some premium
    minReturn = _applyPremiumBps(msg.sender, minReturn);
    require(minReturn > 0, 'min return is 0');

    destAmount = super.liquidate(sources, amounts, msg.sender, dest, minReturn, txData);

    emit PriceOracleLiquidated(msg.sender, source, amount, dest, destAmount, txData);
  }

  function setGroupPremiumBps(address[] calldata liquidators, uint256[] calldata premiumBps)
    external onlyAdmin
  {
    require(liquidators.length == premiumBps.length, 'invalid length');
    for(uint256 i = 0; i < liquidators.length; i++) {
      _setGroupPremiumBps(liquidators[i], premiumBps[i]);
    }
  }

  function priceOracle() external override view returns (address) {
    return address(_priceOracle);
  }

  function defaultPremiumBps() external override view returns (uint256) {
    return _defaultPremiumBps;
  }

  function premiumBpsOf(address liquidator) public override view returns (uint256) {
    uint256 premiumBps = _groupPremiumBps[liquidator];
    return premiumBps == 0 ? _defaultPremiumBps : premiumBps;
  }

  function _setPriceOracle(address _oracle) internal {
    require(_oracle != address(0), 'invalid price oracle');
    _priceOracle = IPriceOracle(_oracle);
    emit PriceOracleSet(_oracle);
  }

  function _setDefaultPremium(uint256 _premiumBps) internal {
    require(_premiumBps < BPS, 'invalid premium bps');
    _defaultPremiumBps = _premiumBps;
    emit DefaultPremiumBpsSet(_premiumBps);
  }

  function _setGroupPremiumBps(address _liquidator, uint256 _premiumBps) internal {
    require(_premiumBps < BPS, 'invalid premium bps');
    _groupPremiumBps[_liquidator] = _premiumBps;
    emit GroupdPremiumBpsSet(_liquidator, _premiumBps);
  }

  function _applyPremiumBps(address _liquidator, uint256 _value)
    internal view returns (uint256)
  {
    uint256 premiumBps = premiumBpsOf(_liquidator);
    return _value.mul(BPS.sub(premiumBps)).div(BPS);
  }
}

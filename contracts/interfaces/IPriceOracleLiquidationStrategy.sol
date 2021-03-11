// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.7.6;

import {IERC20Ext} from '@kyber.network/utils-sc/contracts/IERC20Ext.sol';
import {ILiquidationStrategy} from './ILiquidationStrategy.sol';


interface IPriceOracleLiquidationStrategy is ILiquidationStrategy {
  function liquidate(
    IERC20Ext source,
    uint256 amount,
    IERC20Ext dest,
    bytes calldata txData
  )
    external returns (uint256 destAmount);

  function getExpectedReturnAmount(
    IERC20Ext source,
    IERC20Ext dest,
    uint256 srcAmount,
    address liquidator
  )
    external view returns (uint256 destAmount);
  function priceOracle() external view returns (address);
  function defaultPremiumBps() external view returns (uint256);
  function premiumBpsOf(address liquidator) external view returns (uint256);
}

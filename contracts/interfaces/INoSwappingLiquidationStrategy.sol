// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.7.6;

import {IERC20Ext} from '@kyber.network/utils-sc/contracts/IERC20Ext.sol';


interface INoSwappingLiquidationStrategy {
  event FeePoolSet(address indexed feePool);
  event TreasuryPoolSet(address indexed treasuryPool);
  event Liquidated(address sender, IERC20Ext[] sources, uint256[] amounts);

  function updateFeePool(address pool) external;
  function updateTreasuryPool(address payable pool) external;
  function liquidate(IERC20Ext[] calldata sources, uint256[] calldata amounts) external;
  function isPaused() external view returns (bool);
  function feePool() external view returns (address);
  function treasuryPool() external view returns (address);
}

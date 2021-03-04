// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.7.6;


import {IERC20Ext} from '@kyber.network/utils-sc/contracts/IERC20Ext.sol';


interface ILiquidationStrategy {
  function updateWhitelistedTokens(address[] calldata tokens, bool isAdd)
    external;
  function isLiquidationEnabledAt(uint256 timestamp) external view returns (bool);
  function isLiquidationEnabled() external view returns (bool);
}

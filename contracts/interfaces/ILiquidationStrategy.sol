// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.7.6;


import {IERC20Ext} from "@kyber.network/utils-sc/contracts/IERC20Ext.sol";


interface ILiquidationStrategy {
  function liquidate(
    IERC20Ext[] calldata sources,
    uint256[] calldata amounts,
    address payable recipient,
    IERC20Ext dest,
    uint256 minReturn,
    bytes calldata txData
  ) external returns (uint256 destAmount);
  function updateWhitelistedTokens(address[] calldata tokens, bool isAdd)
    external;
  function isLiquidationEnabledAt(uint256 timestamp) external view returns (bool);
  function isLiquidationEnabled() external view returns (bool);
}

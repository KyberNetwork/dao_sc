// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.7.6;


import {IERC20Ext} from "@kyber.network/utils-sc/contracts/IERC20Ext.sol";

interface ITreasuryPool {
  function authorizeStrategies(address[] calldata _strategies) external;
  function unauthorizeStrategies(address[] calldata _strategies) external;
  function replaceStrategy(address oldStrategy, address _strategies) external;
  function withdrawFunds(
    IERC20Ext[] calldata _tokens,
    uint256[] calldata _amounts,
    address payable _recipient
  ) external;
  function isAuthorizedStrategy(address _strategy) external view returns (bool);
  function getAuthorizedStrategies() external view returns (address[] memory);
}

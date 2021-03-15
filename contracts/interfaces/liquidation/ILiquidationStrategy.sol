// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.7.6;

import {IERC20Ext} from '@kyber.network/utils-sc/contracts/IERC20Ext.sol';


interface ILiquidationStrategy {
  function updateTreasuryPool(address pool) external;
  function updateRewardPool(address payable pool) external;
  function updateWhitelistedTokens(address[] calldata tokens, bool isAdd)
    external;
  function updateWhitelistedLiquidators(address[] calldata liquidators, bool isAdd) external;
  function enableWhitelistedLiquidators() external;
  function disableWhitelistedLiquidators() external;

  function isLiquidationEnabledAt(uint256 timestamp) external view returns (bool);
  function isLiquidationEnabled() external view returns (bool);
  function getLiquidationSchedule()
    external view
    returns(
      uint128 startTime,
      uint64 repeatedPeriod,
      uint64 duration
    );

  function isWhitelistedToken(address token)
    external view returns (bool);
  function getWhitelistedTokensLength() external view returns (uint256);
  function getWhitelistedTokenAt(uint256 index) external view returns (address);
  function getAllWhitelistedTokens()
    external view returns (address[] memory tokens);

  function isWhitelistLiquidatorEnabled()
    external view returns (bool);
  function isWhitelistedLiquidator(address liquidator)
    external view returns (bool);
  function getWhitelistedLiquidatorsLength() external view returns (uint256);
  function getWhitelistedLiquidatorAt(uint256 index) external view returns (address);
  function getAllWhitelistedLiquidators()
    external view returns (address[] memory liquidators);
  function treasuryPool() external view returns (address);
  function rewardPool() external view returns (address);
}

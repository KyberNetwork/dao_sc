// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.7.6;
pragma abicoder v2;

import {KyberFairLaunchV3} from '../../liquidityMining/KyberFairLaunchV3.sol';

contract MockFairLaunchV3 is KyberFairLaunchV3 {
  uint32 internal blockTime;

  constructor(
    address _admin,
    address[] memory _rewardTokens
  ) KyberFairLaunchV3(_admin, _rewardTokens) {}

  function setBlockTime(uint32 blockTime_) external {
    blockTime = blockTime_;
  }

  function _getBlockTime() internal override view returns (uint32) {
    return blockTime;
  }
}

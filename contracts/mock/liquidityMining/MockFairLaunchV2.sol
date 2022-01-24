// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.7.6;
pragma abicoder v2;

import {KyberFairLaunchV2} from '../../liquidityMining/KyberFairLaunchV2.sol';
import {IKyberRewardLockerV2} from '../../interfaces/liquidityMining/IKyberRewardLockerV2.sol';

contract MockFairLaunchV2 is KyberFairLaunchV2 {
  uint32 internal blockTime;

  constructor(
    address _admin,
    address[] memory _rewardTokens,
    IKyberRewardLockerV2 _rewardLocker
  ) KyberFairLaunchV2(_admin, _rewardTokens, _rewardLocker) {}

  function setBlockTime(uint32 blockTime_) external {
    blockTime = blockTime_;
  }

  function _getBlockTime() internal override view returns (uint32) {
    return blockTime;
  }
}

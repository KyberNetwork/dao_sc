// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.7.6;
pragma abicoder v2;

import {KyberRewardLockerV2} from '../../liquidityMining/KyberRewardLockerV2.sol';

contract MockRewardLockerV2 is KyberRewardLockerV2 {
  uint32 internal blockTime;

  constructor(address _admin) KyberRewardLockerV2(_admin) {}

  function setBlockTime(uint32 blockTime_) external {
    blockTime = blockTime_;
  }

  function _getBlockTime() internal override view returns (uint32) {
    return blockTime;
  }
}

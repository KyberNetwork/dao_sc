// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.7.6;
pragma abicoder v2;

import {KyberRewardLocker} from '../../liquidityMining/KyberRewardLocker.sol';

contract MockRewardLocker is KyberRewardLocker {
  uint256 internal blockNumber;

  constructor(address _admin) KyberRewardLocker(_admin) {}

  function setBlockNumber(uint256 blockNumber_) external {
    blockNumber = blockNumber_;
  }

  function _blockNumber() internal override view returns (uint256) {
    return blockNumber;
  }
}

// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.7.6;
pragma abicoder v2;

import {KyberRewardLocker} from '../../liquidityMining/KyberRewardLocker.sol';

contract MockRewardLocker is KyberRewardLocker {
  uint256 internal timestamp;

  constructor(address _admin) KyberRewardLocker(_admin) {}

  function setTimestamp(uint256 _timestamp) external {
    timestamp = _timestamp;
  }

  function _blockTimestamp() internal override view returns (uint256) {
    return timestamp;
  }
}

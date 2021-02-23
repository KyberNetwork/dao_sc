// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import '../governance/KyberStaking.sol';

contract MockKyberStaking is KyberStaking {
  constructor(
    address _admin,
    IERC20 _kncToken,
    uint256 _epochPeriod,
    uint256 _startTime
  ) KyberStaking(_admin, _kncToken, _epochPeriod, _startTime) {}

  function setLatestStake(address staker, uint256 amount) public {
    stakerLatestData[staker].stake = amount;
  }

  function setLatestDelegatedStake(address staker, uint256 amount) public {
    stakerLatestData[staker].delegatedStake = amount;
  }

  function setEpochStake(
    address staker,
    uint256 epoch,
    uint256 amount
  ) public {
    stakerPerEpochData[epoch][staker].stake = amount;
  }

  function setEpochDelegatedStake(
    address staker,
    uint256 epoch,
    uint256 amount
  ) public {
    stakerPerEpochData[epoch][staker].delegatedStake = amount;
  }

  function getHasInitedValue(address staker, uint256 epoch) public view returns (bool) {
    return hasInited[epoch][staker];
  }

  function getStakesValue(address staker, uint256 epoch) public view returns (uint256) {
    return stakerPerEpochData[epoch][staker].stake;
  }

  function getDelegatedStakesValue(address staker, uint256 epoch) public view returns (uint256) {
    return stakerPerEpochData[epoch][staker].delegatedStake;
  }

  function getRepresentativeValue(address staker, uint256 epoch) public view returns (address) {
    return stakerPerEpochData[epoch][staker].representative;
  }
}

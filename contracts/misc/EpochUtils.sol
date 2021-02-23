// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import '@openzeppelin/contracts/math/SafeMath.sol';

import '../interfaces/IEpochUtils.sol';

contract EpochUtils is IEpochUtils {
  using SafeMath for uint256;

  uint256 public override epochPeriodInSeconds;
  uint256 public override firstEpochStartTime;

  function getCurrentEpochNumber() public override view returns (uint256) {
    return getEpochNumber(block.timestamp);
  }

  function getEpochNumber(uint256 currentTime) public override view returns (uint256) {
    if (currentTime < firstEpochStartTime || epochPeriodInSeconds == 0) {
      return 0;
    }
    // ((currentTime - firstEpochStartTime) / epochPeriodInSeconds) + 1;
    return ((currentTime.sub(firstEpochStartTime)).div(epochPeriodInSeconds)).add(1);
  }
}

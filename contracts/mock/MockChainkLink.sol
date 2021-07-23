// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;


contract MockChainkLink {

  uint8 public decimals;
  int256 public _answer;
  uint256 public updatedAt;

  constructor(uint8 _decimals) {
    decimals = _decimals;
  }

  function setAnswerData(int256 _data, uint256 _updatedAt) external {
    _answer = _data;
    updatedAt = _updatedAt;
  }

  function latestRoundData()
    external
    view
    returns (
      uint80,
      int256, // rate in PRECISION of 10^18
      uint256,
      uint256,
      uint80
    )
  {
    return (0, _answer, 0, updatedAt, 0);
  }
}

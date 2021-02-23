// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

interface IWithdrawHandler {
  function handleWithdrawal(address staker, uint256 reduceAmount) external;
}

contract MockWithdrawHandler is IWithdrawHandler {
  mapping(address => uint256) public values;

  bool public isRevert = false;

  function setRevert(bool _isRevert) external {
    isRevert = _isRevert;
  }

  function handleWithdrawal(address staker, uint256 reduceAmount) external override {
    require(!isRevert, 'revert');

    values[staker] += reduceAmount;
  }
}

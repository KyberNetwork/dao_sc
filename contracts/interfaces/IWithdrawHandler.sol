// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.7.6;
pragma abicoder v2;

interface IWithdrawHandler {
  function handleWithdrawal(address staker, uint256 reduceAmount) external;
}

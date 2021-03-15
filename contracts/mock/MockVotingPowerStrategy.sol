// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.7.6;
pragma abicoder v2;

import {IVotingPowerStrategy} from '../interfaces/governance/IVotingPowerStrategy.sol';
import {IKyberGovernance} from '../interfaces/governance/IKyberGovernance.sol';


contract MockVotingPowerStrategy is IVotingPowerStrategy {

  mapping(address => uint256) public votingPowers;
  uint256 public maxVotingPower;
  bool public isProposalCreationRevert = false;
  bool public isProposalCancellationRevert = false;
  bool public isHandleVoteRevert = false;

  constructor() {}

  function setVotingPower(address user, uint256 amount) external {
    votingPowers[user] = amount;
  }

  function setMaxVotingPower(uint256 amount) external {
    maxVotingPower = amount;
  }

  function setRevertStates(
    bool _isProposalCreationRevert,
    bool _isProposalCancellationRevert,
    bool _isVoteRevert
  ) external {
    isProposalCreationRevert = _isProposalCreationRevert;
    isProposalCancellationRevert = _isProposalCancellationRevert;
    isHandleVoteRevert = _isVoteRevert;
  }

  function handleProposalCreation(
    uint256 proposalId,
    uint256 startTime,
    uint256 endTime
  ) external override {
    proposalId;
    startTime;
    endTime;
    if (isProposalCreationRevert) { revert(); }
    isProposalCreationRevert = false; // silence the warning
  }

  function handleProposalCancellation(uint256 proposalId) external override {
    proposalId;
    if (isProposalCancellationRevert) { revert(); }
    isProposalCancellationRevert = false; // silence the warning
  }

  /// @param choice: unused param for future use
  /// call to init data if needed, and return voter's voting power
  function handleVote(
    address voter,
    uint256 proposalId,
    uint256 choice
  ) external override returns(uint256 votingPower) {
    voter;
    proposalId;
    choice;
    if (isHandleVoteRevert) { revert(); }
    isHandleVoteRevert = false; // silence the warning
    votingPower = votingPowers[voter];
  }

  function handleWithdrawal(address staker, uint256 reduceAmount) external override {
    staker;
    reduceAmount;
    isProposalCancellationRevert = true; // silence the warning
  }

  function callbackWithdrawal(
    IKyberGovernance governance,
    address user,
    uint256 newVotingPower,
    uint256[] calldata proposalIds
  ) external {
    governance.handleVotingPowerChanged(user, newVotingPower, proposalIds);
  }

  /// call to get voter's voting power given timestamp, should use for reading purpose
  /// when submitVote, should call handleVote instead
  function getVotingPower(
    address voter,
    uint256 timestamp
  ) external view override returns(uint256 votingPower) {
    voter;
    timestamp;
    votingPower = votingPowers[voter];
  }

  /// pass creator in case we want to validate if creator has enough quorum to create proposal
  function validateProposalCreation(
    uint256 startTime,
    uint256 endTime
  ) external view override returns (bool) {
    startTime;
    endTime;
    return isProposalCreationRevert;
  }

  function getMaxVotingPower() external view override returns (uint256) {
    return maxVotingPower;
  }
}

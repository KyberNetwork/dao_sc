// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

import {IExecutorWithTimelock} from '../interfaces/governance/IExecutorWithTimelock.sol';
import {IVotingPowerStrategy} from '../interfaces/governance/IVotingPowerStrategy.sol';
import {IKyberGovernance} from '../interfaces/governance/IKyberGovernance.sol';

contract MockSimpleKyberGovernance {
  /* 
  only fields of interest are
    uint256 id
    ProposalType proposalType
    uint256[] voteCounts
    uint256 totalVotes
    uint256 maxVotingPower
  */
  struct ProposalWithoutVote {
    uint256 id;
    IKyberGovernance.ProposalType proposalType;
    address creator;
    IExecutorWithTimelock executor;
    IVotingPowerStrategy strategy;
    address[] targets;
    uint256[] values;
    string[] signatures;
    bytes[] calldatas;
    bool[] withDelegatecalls;
    string[] options;
    uint256[] voteCounts;
    uint256 totalVotes;
    uint256 maxVotingPower;
    uint256 startTime;
    uint256 endTime;
    uint256 executionTime;
    string link;
    bool executed;
    bool canceled;
  }

  uint256 public proposalsCount;
  mapping(uint256 => ProposalWithoutVote) private _proposals;

  function createProposal(bool isBinary) external {
    uint256 proposalId = proposalsCount;
    proposalsCount++;

    ProposalWithoutVote storage newProposalData = _proposals[proposalId];
    newProposalData.id = proposalId;
    newProposalData.proposalType = isBinary ?
      IKyberGovernance.ProposalType.Binary :
      IKyberGovernance.ProposalType.Generic;
  }

  function setProposalType(uint256 proposalId, bool isBinary) external {
    ProposalWithoutVote storage proposalData = _proposals[proposalId];
    proposalData.proposalType = isBinary ?
      IKyberGovernance.ProposalType.Binary :
      IKyberGovernance.ProposalType.Generic;
  }

  function setVoteData(
    uint256 proposalId,
    uint256[] calldata voteCounts,
    uint256 totalVotes,
    uint256 maxVotingPower
  ) external {
    ProposalWithoutVote storage proposalData = _proposals[proposalId];
    if (proposalData.proposalType == IKyberGovernance.ProposalType.Binary)
      require(voteCounts.length == 2, 'bad vote counts');
    
    proposalData.voteCounts = voteCounts;
    proposalData.totalVotes = totalVotes;
    proposalData.maxVotingPower = maxVotingPower;
  }

  function setVoteCount(
    uint256 proposalId,
    uint256 index,
    uint256 newVoteCount
  ) external {
    ProposalWithoutVote storage proposalData = _proposals[proposalId];
    proposalData.voteCounts[index] = newVoteCount;
  }

  function setVoteCounts(
    uint256 proposalId,
    uint256[] calldata voteCounts
  ) external {
    ProposalWithoutVote storage proposalData = _proposals[proposalId];
    proposalData.voteCounts = voteCounts;
  }

  function setTotalVotes(
    uint256 proposalId,
    uint256 totalVotes
  ) external {
    ProposalWithoutVote storage proposalData = _proposals[proposalId];
    proposalData.totalVotes = totalVotes;
  }

  function setMaxVotingPower(
    uint256 proposalId,
    uint256 maxVotingPower
  ) external {
    ProposalWithoutVote storage proposalData = _proposals[proposalId];
    proposalData.maxVotingPower = maxVotingPower;
  }

  function getProposalById(uint256 proposalId)
    external
    view
    returns (ProposalWithoutVote memory)
  {
    return _proposals[proposalId];
  }

  function getSimpleProposalData(uint256 proposalId)
    external
    view
    returns
    (
    IKyberGovernance.ProposalType proposalType,
    uint256[] memory voteCounts,
    uint256 totalVotes,
    uint256 maxVotingPower
    )
  {
    ProposalWithoutVote storage proposalData = _proposals[proposalId];
    proposalType = proposalData.proposalType;
    voteCounts = proposalData.voteCounts;
    totalVotes = proposalData.totalVotes;
    maxVotingPower = proposalData.maxVotingPower;
  }
}

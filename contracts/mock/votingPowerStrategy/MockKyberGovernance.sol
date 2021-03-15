// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.7.6;
pragma abicoder v2;

import {IKyberGovernance} from '../../interfaces/governance/IKyberGovernance.sol';
import {IVotingPowerStrategy} from '../../interfaces/governance/IVotingPowerStrategy.sol';

/**
 * @dev mock governance contract to test
 */
contract MockKyberGovernance {
  mapping(uint256 => uint256) public proposalStartTime;
  IVotingPowerStrategy public votingPowerStrategy;

  event VotingPowerChanged(address staker, uint256 newVotingPower, uint256[] proposalIds);

  function setVotingPowerStrategy(IVotingPowerStrategy _votingPowerStrategy) external {
    votingPowerStrategy = _votingPowerStrategy;
  }

  function createProposal(
    uint256 proposalId,
    uint256 startTime,
    uint256 endTime
  ) external {
    proposalStartTime[proposalId] = startTime;
    votingPowerStrategy.handleProposalCreation(proposalId, startTime, endTime);
  }

  function cancelProposal(uint256 proposalId) external {
    votingPowerStrategy.handleProposalCancellation(proposalId);
  }

  function handleVotingPowerChanged(
    address staker,
    uint256 newVotingPower,
    uint256[] calldata proposalIds
  ) external {
    emit VotingPowerChanged(staker, newVotingPower, proposalIds);
  }

  function getProposalById(uint256 proposalId)
    external
    view
    returns (IKyberGovernance.ProposalWithoutVote memory proposal)
  {
    proposal.startTime = proposalStartTime[proposalId];
  }
}

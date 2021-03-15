// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.7.6;
pragma abicoder v2;


import {IProposalValidator} from '../interfaces/governance/IProposalValidator.sol';
import {IKyberGovernance} from '../interfaces/governance/IKyberGovernance.sol';
import {IVotingPowerStrategy} from '../interfaces/governance/IVotingPowerStrategy.sol';

contract MockProposalValidator is IProposalValidator {

  bool public isCreationAllowed = true;
  bool public isCancellationAllowed = true;
  bool public isProposalPassed = true;
  bool public isPassedMinQuorum = true;
  bool public isPassedDifferentialCheck = true;

  uint256 public immutable override MIN_VOTING_DURATION;
  uint256 public immutable override MAX_VOTING_OPTIONS;
  uint256 public immutable override VOTE_DIFFERENTIAL;
  uint256 public immutable override MINIMUM_QUORUM;

  constructor() {
    MIN_VOTING_DURATION = 0;
    MAX_VOTING_OPTIONS = 0;
    VOTE_DIFFERENTIAL = 0;
    MINIMUM_QUORUM = 0;
  }

  function setData(
    bool _isCreationAllowed,
    bool _isCancellationAllowed,
    bool _isProposalPassed
  ) external {
    isCreationAllowed = _isCreationAllowed;
    isCancellationAllowed = _isCancellationAllowed;
    isProposalPassed = _isProposalPassed;
  }

  /**
   * @dev Called to validate a binary proposal
   * @param strategy votingPowerStrategy contract to calculate voting power
   * @param creator address of the creator
   * @param startTime timestamp when vote starts
   * @param endTime timestamp when vote ends
   * @param daoOperator address of daoOperator
   * @return boolean, true if can be created
   **/
  function validateBinaryProposalCreation(
    IVotingPowerStrategy strategy,
    address creator,
    uint256 startTime,
    uint256 endTime,
    address daoOperator
  )
    external view override returns (bool)
  {
    strategy;
    creator;
    startTime;
    endTime;
    daoOperator;
    return isCreationAllowed;
  }

  /**
   * @dev Called to validate a generic proposal
   * @param strategy votingPowerStrategy contract to calculate voting power
   * @param creator address of the creator
   * @param startTime timestamp when vote starts
   * @param endTime timestamp when vote ends
   * @param options list of proposal vote options
   * @param daoOperator address of daoOperator
   * @return boolean, true if can be created
   **/
  function validateGenericProposalCreation(
    IVotingPowerStrategy strategy,
    address creator,
    uint256 startTime,
    uint256 endTime,
    string[] calldata options,
    address daoOperator
  )
    external view override returns (bool)
  {
    strategy;
    creator;
    startTime;
    endTime;
    options;
    daoOperator;
    return isCreationAllowed;
  }

  /**
   * @dev Called to validate the cancellation of a proposal
   * @param governance governance contract to fetch proposals from
   * @param proposalId Id of the generic proposal
   * @param user entity initiating the cancellation
   * @return boolean, true if can be cancelled
   **/
  function validateProposalCancellation(
    IKyberGovernance governance,
    uint256 proposalId,
    address user
  )
    external view override returns (bool)
  {
    governance;
    proposalId;
    user;
    return isCancellationAllowed;
  }

  /**
   * @dev Returns whether a binary proposal passed or not
   * @param governance governance contract to fetch proposals from
   * @param proposalId Id of the proposal to set
   * @return true if proposal passed
   **/
  function isBinaryProposalPassed(
    IKyberGovernance governance,
    uint256 proposalId
  )
    external view override returns (bool)
  {
    governance;
    proposalId;
    return isProposalPassed;
  }

  /**
   * @dev Check whether a proposal has reached quorum
   * @param governance governance contract to fetch proposals from
   * @param proposalId Id of the proposal to verify
   * @return voting power needed for a proposal to pass
   **/
  function isQuorumValid(
    IKyberGovernance governance,
    uint256 proposalId
  )
    external view override returns (bool)
  {
    governance;
    proposalId;
    return isPassedMinQuorum;
  }

  /**
   * @dev Check whether a proposal has enough extra FOR-votes than AGAINST-votes
   * @param governance governance contract to fetch proposals from
   * @param proposalId Id of the proposal to verify
   * @return true if enough For-Votes
   **/
  function isVoteDifferentialValid(
    IKyberGovernance governance,
    uint256 proposalId
  )
    external view override returns (bool)
  {
    governance;
    proposalId;
    return isPassedDifferentialCheck;
  }
}

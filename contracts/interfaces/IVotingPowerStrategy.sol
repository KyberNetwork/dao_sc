// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.7.6;
pragma abicoder v2;

interface IVotingPowerStrategy {
  /**
   * @dev call by governance when create a proposal
   */
  function handleProposalCreation(
    uint256 proposalId,
    uint256 startTime,
    uint256 endTime
  ) external;

  /**
   * @dev call by governance when cancel a proposal
   */
  function handleProposalCancellation(uint256 proposalId) external;

  /**
   * @dev call by governance when submitting a vote
   * @param choice: unused param for future use
   * @return votingPower of voter
   */
  function handleVote(
    address voter,
    uint256 proposalId,
    uint256 choice
  ) external returns (uint256 votingPower);

  /**
   * @dev handle the case when user withdraw from kyberStaking
   */
  function handleWithdraw(address user, uint256 reduceAmount) external;

  /**
   * @dev get voter's voting power given timestamp
   * @dev for reading purposes and validating voting power for creating/canceling proposal in the furture
   * @dev when submitVote, should call 'handleVote' instead
   */
  function getVotingPower(address voter, uint256 timestamp)
    external
    view
    returns (uint256 votingPower);

  /**
   * @dev validate that startTime and endTime are suitable for calculating voting power
   * @dev with current version, startTime and endTime must be in the sameEpcoh
   */
  function validateProposalCreation(uint256 startTime, uint256 endTime)
    external
    view
    returns (bool);

  /**
   * @dev getMaxVotingPower at current time
   */
  function getMaxVotingPower() external view returns (uint256);
}

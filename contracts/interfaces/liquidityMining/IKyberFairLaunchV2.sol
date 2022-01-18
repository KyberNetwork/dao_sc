// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.7.6;
pragma abicoder v2;

interface IKyberFairLaunchV2 {
  /**
   * @dev Add a new lp to the pool. Can only be called by the admin.
   * @param _stakeToken: token to be staked to the pool
   * @param _startTime: time where the reward starts
   * @param _endTime: time where the reward ends
   * @param _vestingDuration: time vesting for token
   * @param _rewardPerSeconds: amount of reward token per second for the pool
   * @param _tokenName: name of the generated token
   * @param _tokenSymbol: symbol of the generated token
   */
  function addPool(
    address _stakeToken,
    uint32 _startTime,
    uint32 _endTime,
    uint32 _vestingDuration,
    uint256[] calldata _rewardPerSeconds,
    string memory _tokenName,
    string memory _tokenSymbol
  ) external;

  /**
   * @dev Renew a pool to start another liquidity mining program
   * @param _pid: id of the pool to renew, must be pool that has not started or already ended
   * @param _startTime: time where the reward starts
   * @param _endTime: time where the reward ends
   * @param _vestingDuration: time vesting for token
   * @param _rewardPerSeconds: amount of reward token per second for the pool
   *   0 if we want to stop the pool from accumulating rewards
   */
  function renewPool(
    uint256 _pid,
    uint32 _startTime,
    uint32 _endTime,
    uint32 _vestingDuration,
    uint256[] calldata _rewardPerSeconds
  ) external;

  /**
   * @dev Update a pool, allow to change end time, reward per second
   * @param _pid: pool id to be renew
   * @param _endTime: time where the reward ends
   * @param _vestingDuration: time vesting for token
   * @param _rewardPerSeconds: amount of reward token per second for the pool
   *   0 if we want to stop the pool from accumulating rewards
   */
  function updatePool(
    uint256 _pid,
    uint32 _endTime,
    uint32 _vestingDuration,
    uint256[] calldata _rewardPerSeconds
  ) external;

  /**
   * @dev deposit to tokens to accumulate rewards
   * @param _pid: id of the pool
   * @param _amount: amount of stakeToken to be deposited
   * @param _shouldHarvest: whether to harvest the reward or not
   */
  function deposit(
    uint256 _pid,
    uint256 _amount,
    bool _shouldHarvest
  ) external;

  /**
   * @dev withdraw token (of the sender) from pool, also harvest reward
   * @param _pid: id of the pool
   * @param _amount: amount of stakeToken to withdraw
   */
  function withdraw(uint256 _pid, uint256 _amount) external;

  /**
   * @dev withdraw all tokens (of the sender) from pool, also harvest reward
   * @param _pid: id of the pool
   */
  function withdrawAll(uint256 _pid) external;

  /**
   * @dev emergency withdrawal function to allow withdraw all deposited token (of the sender)
   *   without harvesting the reward
   * @param _pid: id of the pool
   */
  function emergencyWithdraw(uint256 _pid) external;

  /**
   * @dev harvest reward from pool for the sender
   * @param _pid: id of the pool
   */
  function harvest(uint256 _pid) external;

  /**
   * @dev harvest rewards from multiple pools for the sender
   */
  function harvestMultiplePools(uint256[] calldata _pids) external;

  /**
   * @dev update reward for one pool
   */
  function updatePoolRewards(uint256 _pid) external;

  /**
   * @dev return the total of pools that have been added
   */
  function poolLength() external view returns (uint256);

  /**
   * @dev return full details of a pool
   */
  function getPoolInfo(uint256 _pid)
    external
    view
    returns (
      uint256 totalStake,
      address stakeToken,
      address generatedToken,
      uint32 startTime,
      uint32 endTime,
      uint32 lastRewardSecond,
      uint32 vestingDuration,
      uint256[] memory rewardPerSeconds,
      uint256[] memory accRewardPerShares
    );

  /**
   * @dev get user's info
   */
  function getUserInfo(uint256 _pid, address _account)
    external
    view
    returns (
      uint256 amount,
      uint256[] memory unclaimedRewards,
      uint256[] memory lastRewardPerShares
    );

  /**
   * @dev return list reward tokens
   */
  function getRewardTokens() external view returns (address[] memory);

  /**
   * @dev get pending reward of a user from a pool, mostly for front-end
   * @param _pid: id of the pool
   * @param _user: user to check for pending rewards
   */
  function pendingRewards(uint256 _pid, address _user)
    external
    view
    returns (uint256[] memory rewards);
}

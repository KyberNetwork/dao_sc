// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.7.6;
pragma abicoder v2;

import {ReentrancyGuard} from '@openzeppelin/contracts/utils/ReentrancyGuard.sol';
import {SafeMath} from '@openzeppelin/contracts/math/SafeMath.sol';
import {SafeERC20} from '@openzeppelin/contracts/token/ERC20/SafeERC20.sol';
import {IERC20Ext} from '@kyber.network/utils-sc/contracts/IERC20Ext.sol';
import {PermissionAdmin} from '@kyber.network/utils-sc/contracts/PermissionAdmin.sol';
import {IKyberFairLaunchV2} from '../interfaces/liquidityMining/IKyberFairLaunchV2.sol';
import {IKyberRewardLockerV2} from '../interfaces/liquidityMining/IKyberRewardLockerV2.sol';
import {GeneratedToken} from './GeneratedToken.sol';

/// FairLaunch contract for Kyber DMM Liquidity Mining program
/// Create a new token for each pool
/// Allow stakers to stake LP tokens and receive reward tokens
/// Allow extend or renew a pool to continue/restart the LM program
/// When harvesting, rewards will be transferred to a RewardLocker
/// Support multiple reward tokens, reward tokens must be distinct and immutable
contract KyberFairLaunchV2 is IKyberFairLaunchV2, PermissionAdmin, ReentrancyGuard {
  using SafeMath for uint256;
  using SafeERC20 for IERC20Ext;

  struct UserRewardData {
    uint256 unclaimedReward;
    uint256 lastRewardPerShare;
  }
  // Info of each user.
  struct UserInfo {
    uint256 amount; // How many Staking tokens the user has provided.
    mapping(uint256 => UserRewardData) userRewardData;
    //
    // Basically, any point in time, the amount of reward token
    // entitled to a user but is pending to be distributed is:
    //
    //   pending reward = user.unclaimAmount + (user.amount * (pool.accRewardPerShare - user.lastRewardPerShare)
    //
    // Whenever a user deposits or withdraws Staking tokens to a pool. Here's what happens:
    //   1. The pool's `accRewardPerShare` (and `lastRewardTime`) gets updated.
    //   2. User receives the pending reward sent to his/her address.
    //   3. User's `lastRewardPerShare` gets updated.
    //   4. User's `amount` gets updated.
  }

  struct PoolRewardData {
    uint256 rewardPerSecond;
    uint256 accRewardPerShare;
  }

  // Info of each pool
  // poolRewardData: reward data for each reward token
  //      rewardPerSecond: amount of reward token per second
  //      accRewardPerShare: accumulated reward per share of token
  // totalStake: total amount of stakeToken has been staked
  // stakeToken: token to stake, should be the DMM-LP token
  // generatedToken: token that has been deployed for this pool
  // startTime: the time that the reward starts
  // endTime: the time that the reward ends
  // lastRewardTime: last time that rewards distribution occurs
  // vestingDuration: time vesting for token
  struct PoolInfo {
    uint256 totalStake;
    address stakeToken;
    GeneratedToken generatedToken;
    uint32 startTime;
    uint32 endTime;
    uint32 lastRewardTime;
    uint32 vestingDuration;
    mapping(uint256 => PoolRewardData) poolRewardData;
  }

  // check if a pool exists for a stakeToken
  mapping(address => bool) public poolExists;
  // list reward tokens, use 0x0 for native token, shouldn't be too many reward tokens
  // don't validate values or length by trusting the deployer
  address[] public rewardTokens;
  uint256[] public multipliers;
  // contract for locking reward
  IKyberRewardLockerV2 public immutable rewardLocker;

  // Info of each pool.
  uint256 public override poolLength;

  uint256 internal constant PRECISION = 1e12;

  mapping(uint256 => PoolInfo) internal poolInfo;
  // Info of each user that stakes Staking tokens.
  mapping(uint256 => mapping(address => UserInfo)) internal userInfo;

  event AddNewPool(
    address indexed stakeToken,
    address indexed generatedToken,
    uint32 startTime,
    uint32 endTime,
    uint32 vestingDuration
  );
  event RenewPool(
    uint256 indexed pid,
    uint32 indexed startTime,
    uint32 indexed endTime,
    uint32 vestingDuration
  );
  event UpdatePool(uint256 indexed pid, uint32 indexed endTime, uint32 indexed vestingDuration);
  event Deposit(
    address indexed user,
    uint256 indexed pid,
    uint256 indexed timestamp,
    uint256 amount
  );
  event Withdraw(
    address indexed user,
    uint256 indexed pid,
    uint256 indexed timestamp,
    uint256 amount
  );
  event Harvest(
    address indexed user,
    uint256 indexed pid,
    address indexed rewardToken,
    uint256 lockedAmount,
    uint256 timestamp
  );
  event EmergencyWithdraw(
    address indexed user,
    uint256 indexed pid,
    uint256 indexed timestamp,
    uint256 amount
  );

  constructor(
    address _admin,
    address[] memory _rewardTokens,
    IKyberRewardLockerV2 _rewardLocker
  ) PermissionAdmin(_admin) {
    rewardTokens = _rewardTokens;
    rewardLocker = _rewardLocker;
    // approve allowance to reward locker
    multipliers = new uint256[](_rewardTokens.length);
    for (uint256 i = 0; i < _rewardTokens.length; i++) {
      if (_rewardTokens[i] != address(0)) {
        uint8 dToken = IERC20Ext(_rewardTokens[i]).decimals();
        multipliers[i] = dToken >= 18 ? 1 : 10**(18 - dToken);
        IERC20Ext(_rewardTokens[i]).safeApprove(address(_rewardLocker), type(uint256).max);
      } else {
        multipliers[i] = 1;
      }
    }
  }

  receive() external payable {}

  /**
   * @dev Allow admin to withdraw only reward tokens
   */
  function adminWithdraw(uint256 rewardTokenIndex, uint256 amount) external onlyAdmin {
    IERC20Ext rewardToken = IERC20Ext(rewardTokens[rewardTokenIndex]);
    if (rewardToken == IERC20Ext(0)) {
      (bool success, ) = msg.sender.call{value: amount}('');
      require(success, 'transfer reward token failed');
    } else {
      rewardToken.safeTransfer(msg.sender, amount);
    }
  }

  /**
   * @dev Add a new lp to the pool. Can only be called by the admin.
   * @param _stakeToken: token to be staked to the pool
   * @param _startTime: time where the reward starts
   * @param _endTime: time where the reward ends
   * @param _vestingDuration: time vesting for token
   * @param _totalRewards: amount of total reward token for the pool for each reward token
   * @param _tokenName: name of the generated token
   * @param _tokenSymbol: symbol of the generated token
   */
  function addPool(
    address _stakeToken,
    uint32 _startTime,
    uint32 _endTime,
    uint32 _vestingDuration,
    uint256[] calldata _totalRewards,
    string memory _tokenName,
    string memory _tokenSymbol
  ) external override onlyAdmin {
    require(!poolExists[_stakeToken], 'add: duplicated pool');
    require(_stakeToken != address(0), 'add: invalid stake token');
    require(rewardTokens.length == _totalRewards.length, 'add: invalid length');

    require(_startTime > _getBlockTime() && _endTime > _startTime, 'add: invalid times');

    GeneratedToken _generatedToken;
    if (bytes(_tokenName).length != 0 && bytes(_tokenSymbol).length != 0) {
      _generatedToken = new GeneratedToken(_tokenName, _tokenSymbol);
      poolInfo[poolLength].generatedToken = _generatedToken;
    }

    poolInfo[poolLength].stakeToken = _stakeToken;
    poolInfo[poolLength].startTime = _startTime;
    poolInfo[poolLength].endTime = _endTime;
    poolInfo[poolLength].lastRewardTime = _startTime;
    poolInfo[poolLength].vestingDuration = _vestingDuration;

    for (uint256 i = 0; i < _totalRewards.length; i++) {
      uint256 _rewardPerSecond = _totalRewards[i].mul(multipliers[i]).div(_endTime - _startTime);
      require(_rewardPerSecond != 0, 'reward too small');

      poolInfo[poolLength].poolRewardData[i] = PoolRewardData({
        rewardPerSecond: _rewardPerSecond,
        accRewardPerShare: 0
      });
    }

    poolLength++;
    poolExists[_stakeToken] = true;

    emit AddNewPool(_stakeToken, address(_generatedToken), _startTime, _endTime, _vestingDuration);
  }

  /**
   * @dev Renew a pool to start another liquidity mining program
   * @param _pid: id of the pool to renew, must be pool that has not started or already ended
   * @param _startTime: time where the reward starts
   * @param _endTime: time where the reward ends
   * @param _vestingDuration: time vesting for token
   * @param _totalRewards: amount of total reward token for the pool for each reward token
   *   0 if we want to stop the pool from accumulating rewards
   */
  function renewPool(
    uint256 _pid,
    uint32 _startTime,
    uint32 _endTime,
    uint32 _vestingDuration,
    uint256[] calldata _totalRewards
  ) external override onlyAdmin {
    updatePoolRewards(_pid);

    PoolInfo storage pool = poolInfo[_pid];
    // check if pool has not started or already ended
    require(
      pool.startTime > _getBlockTime() || pool.endTime < _getBlockTime(),
      'renew: invalid pool state to renew'
    );
    // checking data of new pool
    require(rewardTokens.length == _totalRewards.length, 'renew: invalid length');
    require(_startTime > _getBlockTime() && _endTime > _startTime, 'renew: invalid times');

    pool.startTime = _startTime;
    pool.endTime = _endTime;
    pool.lastRewardTime = _startTime;
    pool.vestingDuration = _vestingDuration;

    for (uint256 i = 0; i < _totalRewards.length; i++) {
      uint256 _rewardPerSecond = _totalRewards[i].mul(multipliers[i]).div(_endTime - _startTime);
      require(_rewardPerSecond != 0, 'reward too small');
      pool.poolRewardData[i].rewardPerSecond = _rewardPerSecond;
    }

    emit RenewPool(_pid, _startTime, _endTime, _vestingDuration);
  }

  /**
   * @dev Update a pool, allow to change end time, reward per second
   * @param _pid: pool id to be renew
   * @param _endTime: time where the reward ends
   * @param _vestingDuration: time vesting for token
   * @param _totalRewards: amount of total reward token for the pool for each reward token
   *   0 if we want to stop the pool from accumulating rewards
   */
  function updatePool(
    uint256 _pid,
    uint32 _endTime,
    uint32 _vestingDuration,
    uint256[] calldata _totalRewards
  ) external override onlyAdmin {
    updatePoolRewards(_pid);

    PoolInfo storage pool = poolInfo[_pid];

    // should call renew pool if the pool has ended
    require(pool.endTime > _getBlockTime(), 'update: pool already ended');
    require(rewardTokens.length == _totalRewards.length, 'update: invalid length');
    require(_endTime > _getBlockTime() && _endTime > pool.startTime, 'update: invalid end time');

    pool.endTime = _endTime;
    pool.vestingDuration = _vestingDuration;
    for (uint256 i = 0; i < _totalRewards.length; i++) {
      uint256 _rewardPerSecond = _totalRewards[i].mul(multipliers[i]).div(
        _endTime - pool.startTime
      );
      require(_rewardPerSecond != 0, 'reward too small');
      pool.poolRewardData[i].rewardPerSecond = _rewardPerSecond;
    }

    emit UpdatePool(_pid, _endTime, _vestingDuration);
  }

  /**
   * @dev Deposit tokens to accumulate rewards
   * @param _pid: id of the pool
   * @param _amount: amount of stakeToken to be deposited
   * @param _shouldHarvest: whether to harvest the reward or not
   */
  function deposit(
    uint256 _pid,
    uint256 _amount,
    bool _shouldHarvest
  ) external override nonReentrant {
    // update pool rewards, user's rewards
    updatePoolRewards(_pid);
    _updateUserReward(msg.sender, _pid, _shouldHarvest);

    PoolInfo storage pool = poolInfo[_pid];
    UserInfo storage user = userInfo[_pid][msg.sender];

    // collect stakeToken
    IERC20Ext(pool.stakeToken).safeTransferFrom(msg.sender, address(this), _amount);
    // mint new token for users
    GeneratedToken token = pool.generatedToken;
    if (token != GeneratedToken(0)) {
      token.mint(msg.sender, _amount);
    }

    // update user staked amount, and total staked amount for the pool
    user.amount = user.amount.add(_amount);
    pool.totalStake = pool.totalStake.add(_amount);

    emit Deposit(msg.sender, _pid, _getBlockTime(), _amount);
  }

  /**
   * @dev Withdraw token (of the sender) from pool, also harvest rewards
   * @param _pid: id of the pool
   * @param _amount: amount of stakeToken to withdraw
   */
  function withdraw(uint256 _pid, uint256 _amount) external override nonReentrant {
    _withdraw(_pid, _amount);
  }

  /**
   * @dev Withdraw all tokens (of the sender) from pool, also harvest reward
   * @param _pid: id of the pool
   */
  function withdrawAll(uint256 _pid) external override nonReentrant {
    _withdraw(_pid, userInfo[_pid][msg.sender].amount);
  }

  /**
   * @notice EMERGENCY USAGE ONLY, USER'S REWARDS WILL BE RESET
   * @dev Emergency withdrawal function to allow withdraw all deposited tokens (of the sender)
   *   and reset all rewards
   * @param _pid: id of the pool
   */
  function emergencyWithdraw(uint256 _pid) external override nonReentrant {
    PoolInfo storage pool = poolInfo[_pid];
    UserInfo storage user = userInfo[_pid][msg.sender];
    uint256 amount = user.amount;

    user.amount = 0;
    for (uint256 i = 0; i < rewardTokens.length; i++) {
      UserRewardData storage rewardData = user.userRewardData[i];
      rewardData.lastRewardPerShare = 0;
      rewardData.unclaimedReward = 0;
    }

    pool.totalStake = pool.totalStake.sub(amount);

    if (amount > 0) {
      GeneratedToken token = pool.generatedToken;
      if (token != GeneratedToken(0)) {
        token.burn(msg.sender, amount);
      }
      IERC20Ext(pool.stakeToken).safeTransfer(msg.sender, amount);
    }

    emit EmergencyWithdraw(msg.sender, _pid, _getBlockTime(), amount);
  }

  /**
   * @dev Harvest rewards from multiple pools for the sender
   *   combine rewards from all pools and only transfer once to save gas
   */
  function harvestMultiplePools(uint256[] calldata _pids) external override {
    require(_pids.length > 0, 'harvest: empty pool ids');

    if (!_isSameVestingDuration(_pids)) {
      //harvest one by one if pools not have same vesting duration
      for (uint256 i = 0; i < _pids.length; i++) {
        harvest(_pids[i]);
      }
      return;
    }
    address[] memory rTokens = rewardTokens;
    uint256[] memory totalRewards = new uint256[](rTokens.length);
    address account = msg.sender;
    uint256 pid;

    for (uint256 i = 0; i < _pids.length; i++) {
      pid = _pids[i];
      updatePoolRewards(pid);
      // update user reward without harvesting
      _updateUserReward(account, pid, false);

      for (uint256 j = 0; j < rTokens.length; j++) {
        uint256 reward = userInfo[pid][account].userRewardData[j].unclaimedReward;
        if (reward > 0) {
          totalRewards[j] = totalRewards[j].add(reward);
          userInfo[pid][account].userRewardData[j].unclaimedReward = 0;
          emit Harvest(account, pid, rTokens[j], reward.div(multipliers[j]), _getBlockTime());
        }
      }
    }

    uint32 duration = poolInfo[_pids[0]].vestingDuration; // use same duration
    for (uint256 i = 0; i < totalRewards.length; i++) {
      if (totalRewards[i] > 0) {
        _lockReward(IERC20Ext(rTokens[i]), account, totalRewards[i].div(multipliers[i]), duration);
      }
    }
  }

  /**
   * @dev Get pending rewards of a user from a pool, mostly for front-end
   * @param _pid: id of the pool
   * @param _user: user to check for pending rewards
   */
  function pendingRewards(uint256 _pid, address _user)
    external
    override
    view
    returns (uint256[] memory rewards)
  {
    uint256 rTokensLength = rewardTokens.length;
    rewards = new uint256[](rTokensLength);
    PoolInfo storage pool = poolInfo[_pid];
    UserInfo storage user = userInfo[_pid][_user];
    uint256 _totalStake = pool.totalStake;
    uint256 _poolLastRewardTime = pool.lastRewardTime;
    uint32 lastAccountedTime = _lastAccountedRewardTime(_pid);
    for (uint256 i = 0; i < rTokensLength; i++) {
      uint256 _accRewardPerShare = pool.poolRewardData[i].accRewardPerShare;
      if (lastAccountedTime > _poolLastRewardTime && _totalStake != 0) {
        uint256 reward = (lastAccountedTime - _poolLastRewardTime).mul(
          pool.poolRewardData[i].rewardPerSecond
        );
        _accRewardPerShare = _accRewardPerShare.add(reward.mul(PRECISION) / _totalStake);
      }

      rewards[i] =
        user.amount.mul(_accRewardPerShare.sub(user.userRewardData[i].lastRewardPerShare)) /
        PRECISION;
      rewards[i] = rewards[i].add(user.userRewardData[i].unclaimedReward);
    }
  }

  /**
   * @dev Return list reward tokens
   */
  function getRewardTokens() external override view returns (address[] memory) {
    return rewardTokens;
  }

  /**
   * @dev Return full details of a pool
   */
  function getPoolInfo(uint256 _pid)
    external
    override
    view
    returns (
      uint256 totalStake,
      address stakeToken,
      address generatedToken,
      uint32 startTime,
      uint32 endTime,
      uint32 lastRewardTime,
      uint32 vestingDuration,
      uint256[] memory rewardPerSeconds,
      uint256[] memory rewardMultipliers,
      uint256[] memory accRewardPerShares
    )
  {
    PoolInfo storage pool = poolInfo[_pid];
    totalStake = pool.totalStake;
    stakeToken = pool.stakeToken;
    generatedToken = address(pool.generatedToken);
    startTime = pool.startTime;
    endTime = pool.endTime;
    lastRewardTime = pool.lastRewardTime;
    vestingDuration = pool.vestingDuration;
    rewardPerSeconds = new uint256[](rewardTokens.length);
    rewardMultipliers = new uint256[](multipliers.length);
    accRewardPerShares = new uint256[](rewardTokens.length);
    for (uint256 i = 0; i < rewardTokens.length; i++) {
      rewardPerSeconds[i] = pool.poolRewardData[i].rewardPerSecond;
      rewardMultipliers[i] = multipliers[i];
      accRewardPerShares[i] = pool.poolRewardData[i].accRewardPerShare;
    }
  }

  /**
   * @dev Return user's info including deposited amount and reward data
   */
  function getUserInfo(uint256 _pid, address _account)
    external
    override
    view
    returns (
      uint256 amount,
      uint256[] memory unclaimedRewards,
      uint256[] memory lastRewardPerShares
    )
  {
    UserInfo storage user = userInfo[_pid][_account];
    amount = user.amount;
    unclaimedRewards = new uint256[](rewardTokens.length);
    lastRewardPerShares = new uint256[](rewardTokens.length);
    for (uint256 i = 0; i < rewardTokens.length; i++) {
      unclaimedRewards[i] = user.userRewardData[i].unclaimedReward;
      lastRewardPerShares[i] = user.userRewardData[i].lastRewardPerShare;
    }
  }

  /**
   * @dev Harvest rewards from a pool for the sender
   * @param _pid: id of the pool
   */
  function harvest(uint256 _pid) public override {
    updatePoolRewards(_pid);
    _updateUserReward(msg.sender, _pid, true);
  }

  /**
   * @dev Update rewards for one pool
   */
  function updatePoolRewards(uint256 _pid) public override {
    require(_pid < poolLength, 'invalid pool id');
    PoolInfo storage pool = poolInfo[_pid];
    uint32 lastAccountedTime = _lastAccountedRewardTime(_pid);
    if (lastAccountedTime <= pool.lastRewardTime) return;
    uint256 _totalStake = pool.totalStake;
    if (_totalStake == 0) {
      pool.lastRewardTime = lastAccountedTime;
      return;
    }
    uint256 secondsPassed = lastAccountedTime - pool.lastRewardTime;
    for (uint256 i = 0; i < rewardTokens.length; i++) {
      PoolRewardData storage rewardData = pool.poolRewardData[i];
      uint256 reward = secondsPassed.mul(rewardData.rewardPerSecond);
      rewardData.accRewardPerShare = rewardData.accRewardPerShare.add(
        reward.mul(PRECISION) / _totalStake
      );
    }
    pool.lastRewardTime = lastAccountedTime;
  }

  /**
   * @dev Withdraw _amount of stakeToken from pool _pid, also harvest reward for the sender
   */
  function _withdraw(uint256 _pid, uint256 _amount) internal {
    PoolInfo storage pool = poolInfo[_pid];
    UserInfo storage user = userInfo[_pid][msg.sender];
    require(user.amount >= _amount, 'withdraw: insufficient amount');

    // update pool reward and harvest
    updatePoolRewards(_pid);
    _updateUserReward(msg.sender, _pid, true);

    user.amount = user.amount.sub(_amount);
    pool.totalStake = pool.totalStake.sub(_amount);

    GeneratedToken token = pool.generatedToken;
    if (token != GeneratedToken(0)) {
      token.burn(msg.sender, _amount);
    }
    IERC20Ext(pool.stakeToken).safeTransfer(msg.sender, _amount);

    emit Withdraw(msg.sender, _pid, _getBlockTime(), _amount);
  }

  /**
   * @dev Update reward of _to address from pool _pid, harvest if needed
   */
  function _updateUserReward(
    address _to,
    uint256 _pid,
    bool shouldHarvest
  ) internal {
    uint256 userAmount = userInfo[_pid][_to].amount;
    uint256 rTokensLength = rewardTokens.length;

    if (userAmount == 0) {
      // update user last reward per share to the latest pool reward per share
      // by right if user.amount is 0, user.unclaimedReward should be 0 as well,
      // except when user uses emergencyWithdraw function
      for (uint256 i = 0; i < rTokensLength; i++) {
        userInfo[_pid][_to].userRewardData[i].lastRewardPerShare = poolInfo[_pid].poolRewardData[i]
          .accRewardPerShare;
      }
      return;
    }
    for (uint256 i = 0; i < rTokensLength; i++) {
      uint256 lastAccRewardPerShare = poolInfo[_pid].poolRewardData[i].accRewardPerShare;
      UserRewardData storage rewardData = userInfo[_pid][_to].userRewardData[i];
      // user's unclaim reward + user's amount * (pool's accRewardPerShare - user's lastRewardPerShare) / precision
      uint256 _pending = userAmount.mul(lastAccRewardPerShare.sub(rewardData.lastRewardPerShare)) /
        PRECISION;
      _pending = _pending.add(rewardData.unclaimedReward);
      rewardData.unclaimedReward = shouldHarvest ? 0 : _pending;
      // update user last reward per share to the latest pool reward per share
      rewardData.lastRewardPerShare = lastAccRewardPerShare;

      if (shouldHarvest && _pending > 0) {
        uint256 _lockAmount = _pending.div(multipliers[i]);
        _lockReward(IERC20Ext(rewardTokens[i]), _to, _lockAmount, poolInfo[_pid].vestingDuration);
        emit Harvest(_to, _pid, rewardTokens[i], _lockAmount, _getBlockTime());
      }
    }
  }

  /**
   * @dev Call locker contract to lock rewards
   */
  function _lockReward(
    IERC20Ext token,
    address _account,
    uint256 _amount,
    uint32 _vestingDuration
  ) internal {
    uint256 value = token == IERC20Ext(0) ? _amount : 0;
    rewardLocker.lock{value: value}(token, _account, _amount, _vestingDuration);
  }

  /**
   * @dev Returns last accounted reward time, either the current time number or the endTime of the pool
   */
  function _lastAccountedRewardTime(uint256 _pid) internal view returns (uint32 _value) {
    _value = poolInfo[_pid].endTime;
    if (_value > _getBlockTime()) _value = _getBlockTime();
  }

  function _getBlockTime() internal virtual view returns (uint32) {
    return uint32(block.timestamp);
  }

  function _isSameVestingDuration(uint256[] calldata _pids) private view returns (bool) {
    uint256 val = poolInfo[_pids[0]].vestingDuration;
    for (uint256 i = 1; i < _pids.length; i++) {
      if (poolInfo[_pids[i]].vestingDuration != val) return false;
    }
    return true;
  }
}

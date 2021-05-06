// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.7.6;
pragma abicoder v2;

import {ReentrancyGuard} from '@openzeppelin/contracts/utils/ReentrancyGuard.sol';
import {SafeMath} from '@openzeppelin/contracts/math/SafeMath.sol';
import {SafeERC20} from '@openzeppelin/contracts/token/ERC20/SafeERC20.sol';
import {IERC20Ext} from '@kyber.network/utils-sc/contracts/IERC20Ext.sol';
import {PermissionAdmin} from '@kyber.network/utils-sc/contracts/PermissionAdmin.sol';
import {IKyberFairLaunch} from '../interfaces/liquidityMining/IKyberFairLaunch.sol';
import {IKyberRewardLocker} from '../interfaces/liquidityMining/IKyberRewardLocker.sol';


/// FairLaunch contract for Kyber DMM Liquidity Mining program
/// Allow stakers to stake LP tokens and receive reward token
/// Part of the reward will be locked and vested
/// Allow extend or renew a pool to continue/restart the LM program
contract KyberFairLaunch is IKyberFairLaunch, PermissionAdmin, ReentrancyGuard {
  using SafeMath for uint256;
  using SafeERC20 for IERC20Ext;

  uint256 public constant BPS = 10000;
  uint256 public constant PRECISION = 1e12;

  // Info of each user.
  struct UserInfo {
    uint256 amount;             // How many Staking tokens the user has provided.
    uint256 lastRewardPerShare; // Last recorded reward per share

    //
    // We do some fancy math here. Basically, any point in time, the amount of reward token
    // entitled to a user but is pending to be distributed is:
    //
    //   pending reward = (user.amount * (pool.accRewardPerShare - user.lastRewardPerShare)
    //
    // Whenever a user deposits or withdraws Staking tokens to a pool. Here's what happens:
    //   1. The pool's `accRewardPerShare` (and `lastRewardBlock`) gets updated.
    //   2. User receives the pending reward sent to his/her address.
    //   3. User's `lastRewardPerShare` gets updated.
    //   4. User's `amount` gets updated.
  }

  // Info of each pool
  // rewardPerBlock: amount of reward token per block
  // accRewardPerShare: accumulated reward per share of token
  // totalStake: total amount of stakeToken has been staked
  // stakeToken: token to stake, should be an ERC20 token
  // startBlock: the block that the reward starts
  // endBlock: the block that the reward ends
  // rewardLockBps: lock percent (in bps) of reward that will be locked in the locker
  // lastRewardBlock: last block number that rewards distribution occurs
  struct PoolInfo {
    uint128 rewardPerBlock;
    uint128 accRewardPerShare;
    uint256 totalStake;
    address stakeToken;
    uint32  startBlock;
    uint32  endBlock;
    uint32  rewardLockBps;
    uint32  lastRewardBlock;
  }

  // index of pool for a stakeToken, need to deduct by 1 since we use 0 for none exist
  mapping(address => uint256) private latestTokenPoolId;
  // contract for locking reward
  IKyberRewardLocker public immutable rewardLocker;
  // reward token
  IERC20Ext public immutable rewardToken;

  // Info of each pool.
  uint256 public override poolLength;
  mapping (uint256 => PoolInfo) public poolInfo;
  // Info of each user that stakes Staking tokens.
  mapping(uint256 => mapping(address => UserInfo)) public userInfo;

  event AddNewPool(
    address indexed stakeToken,
    uint32 indexed startBlock,
    uint32 indexed endBlock,
    uint32 rewardLockBps,
    uint256 rewardPerBlock
  );
  event UpdatePool(
    uint256 indexed pid,
    uint32 indexed endBlock,
    uint32 rewardLockBps,
    uint256 rewardPerBlock
  );
  event Deposit(
    address indexed user,
    uint256 indexed pid,
    uint256 indexed blockNumber,
    uint256 amount
  );
  event Migrated(
    address indexed user,
    uint256 indexed pid0,
    uint256 indexed pid1,
    uint256 blockNumber,
    uint256 amount
  );
  event Withdraw(
    address indexed user,
    uint256 indexed pid,
    uint256 indexed blockNumber,
    uint256 amount
  );
  event Harvest(
    address indexed user,
    uint256 indexed pid,
    uint256 indexed blockNumber,
    uint256 amount,
    uint256 lockedAmount
  );
  event EmergencyWithdraw(
    address indexed user,
    uint256 indexed pid,
    uint256 indexed blockNumber,
    uint256 amount
  );

  constructor(
    address _admin,
    IERC20Ext _rewardToken,
    IKyberRewardLocker _rewardLocker
  ) PermissionAdmin(_admin) {
    rewardToken = _rewardToken;
    rewardLocker = _rewardLocker;

    _rewardToken.safeApprove(address(_rewardLocker), type(uint256).max);
  }

  /**
  *  @dev allow admin to withdraw only reward token
  */
  function adminWithdraw(uint256 amount) external onlyAdmin {
    rewardToken.safeTransfer(msg.sender, amount);
  }

  /**
  * @dev Add a new lp to the pool. Can only be called by the admin.
  * @param _stakeToken: token to be staked to the pool
  * @param _startBlock: block where the reward starts
  * @param _endBlock: block where the reward ends
  * @param _rewardLockBps: percentage (in bps) of reward to be locked
  * @param _rewardPerBlock: amount of reward token per block for the pool
  */
  function addPool(
    address _stakeToken,
    uint32 _startBlock,
    uint32 _endBlock,
    uint32 _rewardLockBps,
    uint128 _rewardPerBlock
  ) external override onlyAdmin {
    require(!isDuplicatedPool(_stakeToken), 'add: duplicated pool');

    require(
      _startBlock > block.number && _endBlock > _startBlock, 'add: invalid blocks'
    );
    require(_rewardLockBps <= BPS, 'add: invalid lock bps');
    require(_rewardPerBlock > 0, 'add: invalid reward per block');

    poolInfo[poolLength] = PoolInfo({
      stakeToken: _stakeToken,
      startBlock: _startBlock,
      endBlock: _endBlock,
      lastRewardBlock: _startBlock,
      rewardLockBps: _rewardLockBps,
      rewardPerBlock: _rewardPerBlock,
      accRewardPerShare: 0,
      totalStake: 0
    });

    poolLength++;

    // use 0 for not exist
    latestTokenPoolId[_stakeToken] = poolLength;

    emit AddNewPool(
      _stakeToken,
      _startBlock,
      _endBlock,
      _rewardLockBps,
      _rewardPerBlock
    );
  }

  /**
  * @dev Update a pool, allow to change end block, reward per block and lock bps
  * @param _pid: pool id to be renew
  * @param _endBlock: block where the reward ends
  * @param _rewardLockBps: percentage (in bps) of reward to be locked
  * @param _rewardPerBlock: amount of reward token per block for the pool
  */
  function updatePool(
    uint256 _pid,
    uint32 _endBlock,
    uint32 _rewardLockBps,
    uint128 _rewardPerBlock
  ) external override onlyAdmin {
    require(_pid < poolLength, 'update: invalid pool id');
    updatePoolRewards(_pid);

    PoolInfo storage pool = poolInfo[_pid];

    require(_endBlock > block.number && _endBlock > pool.startBlock, 'update: invalid end block');
    require(_rewardLockBps <= BPS, 'update: invalid lock bps');
    require(_rewardPerBlock > 0, 'update: invalid reward per block');

    (
      pool.endBlock,
      pool.rewardLockBps,
      pool.rewardPerBlock
    ) = (
      _endBlock,
      _rewardLockBps,
      _rewardPerBlock
    );

    emit UpdatePool(_pid, _endBlock, _rewardLockBps, _rewardPerBlock);
  }

  // TODO: deposit with permit

  /**
  * @dev deposit to tokens to accumulate rewards
  * @param _pid: id of the pool
  * @param _amount: amount of stakeToken to be deposited
  */
  function deposit(uint256 _pid, uint256 _amount) external override nonReentrant {
    require(_pid < poolLength, 'deposit: invalid pool id');
    PoolInfo storage pool = poolInfo[_pid];
    UserInfo storage user = userInfo[_pid][msg.sender];

    // update pool rewards and harvest if needed
    updatePoolRewards(_pid);
    _harvest(msg.sender, _pid);

    // collect stakeToken
    IERC20Ext(pool.stakeToken).safeTransferFrom(msg.sender, address(this), _amount);

    // update user staked amount, and total staked amount for the pool
    user.amount = user.amount.add(_amount);
    pool.totalStake = pool.totalStake.add(_amount);

    emit Deposit(msg.sender, _pid, block.number, _amount);
  }

  /**
  * @dev migrate deposited stake from a pool to another with the same stakeToken
  */
  function migrateStake(uint256 _pid0, uint256 _pid1) external override {
    require(_pid0 != _pid1, 'migrate: duplicated pool');
    require(_pid0 < poolLength && _pid1 < poolLength, 'migrate: invalid pool ids');

    PoolInfo storage poolP0 = poolInfo[_pid0];
    PoolInfo storage poolP1 = poolInfo[_pid1];

    require(poolP0.stakeToken == poolP1.stakeToken, 'migrate: only same stake token');

    harvest(_pid0);
    harvest(_pid1);

    UserInfo storage userP0 = userInfo[_pid0][msg.sender];
    UserInfo storage userP1 = userInfo[_pid1][msg.sender];

    uint256 _amount = userP0.amount;

    userP0.amount = 0;
    poolP0.totalStake = poolP0.totalStake.sub(_amount);

    userP1.amount = userP1.amount.add(_amount);
    poolP1.totalStake = poolP1.totalStake.add(_amount);

    emit Migrated(msg.sender, _pid0, _pid1, block.number, _amount);
  }

  /**
  * @dev withdraw token (of the sender) from pool, also harvest reward
  * @param _pid: id of the pool
  * @param _amount: amount of stakeToken to withdraw
  */
  function withdraw(uint256 _pid, uint256 _amount) external override nonReentrant {
    _withdraw(_pid, _amount);
  }

  /**
  * @dev withdraw all tokens (of the sender) from pool, also harvest reward
  * @param _pid: id of the pool
  */
  function withdrawAll(uint256 _pid) external override nonReentrant {
    _withdraw(_pid, userInfo[_pid][msg.sender].amount);
  }

  /**
  * @dev emergency withdrawal function to allow withdraw all deposited token (of the sender)
  *   without harvesting the reward
  * @param _pid: id of the pool
  */
  function emergencyWithdraw(uint256 _pid) external override nonReentrant {
    PoolInfo storage pool = poolInfo[_pid];
    UserInfo storage user = userInfo[_pid][msg.sender];
    uint256 amount = user.amount;

    user.amount = 0;
    user.lastRewardPerShare = 0;
    pool.totalStake = pool.totalStake.sub(amount);

    if (amount > 0) {
      IERC20Ext(pool.stakeToken).safeTransfer(msg.sender, user.amount);
    }
    emit EmergencyWithdraw(msg.sender, _pid, block.number, user.amount);
  }

  /**
  * @dev harvest rewards from all pools for the sender
  */
  function harvestAll() external override {
    uint256 length = poolLength;
    for(uint256 i = 0; i < length; i++) {
      harvest(i);
    }
  }

  /**
  * @dev get pending reward of a user from a pool, mostly for front-end
  * @param _pid: id of the pool
  * @param _user: user to check for pending rewards
  */
  function pendingReward(uint256 _pid, address _user) external override view returns (uint256) {
    PoolInfo storage pool = poolInfo[_pid];
    UserInfo storage user = userInfo[_pid][_user];
    uint256 _accRewardPerShare = pool.accRewardPerShare;
    uint256 _totalStake = pool.totalStake;
    uint32 lastAccountedBlock = _lastAccountedRewardBlock(_pid);
    if (lastAccountedBlock > pool.lastRewardBlock && _totalStake != 0) {
      uint256 reward = uint256(lastAccountedBlock - pool.lastRewardBlock).mul(pool.rewardPerBlock);
      _accRewardPerShare = _accRewardPerShare.add(reward.mul(PRECISION).div(_totalStake));
    }
    return user.amount.mul(_accRewardPerShare.sub(user.lastRewardPerShare)).div(PRECISION);
  }

  /**
  * @dev return latest pool id for a stakeToken
  * if there is no pool id, return max value
  */
  function getLatestPoolId(address _stakeToken) external view returns (uint256) {
    // if latestTokenPoolId[_stakeToken] is 0 (no pool found),
    // return a max value which is also uint256(-1)
    return latestTokenPoolId[_stakeToken] - 1;
  }

  /**
  * @dev update pool reward for all pools
  */
  function massUpdatePools() public {
    uint256 length = poolLength;
    for (uint256 pid = 0; pid < length; ++pid) {
      updatePoolRewards(pid);
    }
  }

  /**
  * @dev harvest reward from pool for the sender
  * @param _pid: id of the pool
  */
  function harvest(uint256 _pid) public override {
    require(_pid < poolLength, 'harvest: invalid pool id');
    updatePoolRewards(_pid);
    _harvest(msg.sender, _pid);
  }

  /**
  * @dev update reward for one pool
  */
  function updatePoolRewards(uint256 _pid) public override {
    PoolInfo storage pool = poolInfo[_pid];
    uint32 lastAccountedBlock = _lastAccountedRewardBlock(_pid);
    if (lastAccountedBlock <= pool.lastRewardBlock) return;
    uint256 _totalStake = pool.totalStake;
    if (_totalStake == 0) {
      pool.lastRewardBlock = _safeUint32(block.number);
      return;
    }
    uint256 reward = uint256(lastAccountedBlock - pool.lastRewardBlock).mul(uint256(pool.rewardPerBlock));
    pool.accRewardPerShare = _safeUint128(
      uint256(pool.accRewardPerShare).add(reward.mul(PRECISION).div(_totalStake))
    );
    pool.lastRewardBlock = lastAccountedBlock;
  }

  /**
  * @dev check if a pool of _stakeToken exists and not ended yet, only called when adding a new pool
  * @param _stakeToken: token to check for exisiting pool
  */
  function isDuplicatedPool(address _stakeToken) public view returns (bool) {
    uint256 _pid = latestTokenPoolId[_stakeToken];
    // not exist
    if (_pid == 0) return false;
    _pid -= 1;
    // if already ended -> consider as not duplicated
    // if the pool has not been started, use updatePool function to update pool info
    return (poolInfo[_pid].endBlock >= block.number);
  }

  /**
  * @dev withdraw _amount of stakeToken from pool _pid, also harvest reward for the sender
  */
  function _withdraw(uint256 _pid, uint256 _amount) internal {
    require(_pid < poolLength, 'withdraw: invalid pool id');

    PoolInfo storage pool = poolInfo[_pid];
    UserInfo storage user = userInfo[_pid][msg.sender];
    require(user.amount >= _amount, 'withdraw: insufficient amount');

    // update pool reward and harvest
    updatePoolRewards(_pid);
    _harvest(msg.sender, _pid);

    user.amount = user.amount.sub(_amount);
    pool.totalStake = pool.totalStake.sub(_amount);

    if (pool.stakeToken != address(0)) {
      IERC20Ext(pool.stakeToken).safeTransfer(msg.sender, _amount);
    }

    emit Withdraw(msg.sender, _pid, block.number, user.amount);
  }

  /**
  * @dev harvest reward of _to address from pool _pid
  */
  function _harvest(address _to, uint256 _pid) internal {
    PoolInfo storage pool = poolInfo[_pid];
    UserInfo storage user = userInfo[_pid][_to];
    uint256 _accRewardPerShare = pool.accRewardPerShare;
    if (user.amount == 0) {
      // update user last reward per share to the latest pool reward per share
      user.lastRewardPerShare = _accRewardPerShare;
      return;
    }
    // user's amount * (pool's accRewardPerShare - user's lastRewardPerShare) / precision
    uint256 _pending = user.amount.mul(_accRewardPerShare.sub(user.lastRewardPerShare)).div(PRECISION);

    uint256 _lockedAmount = _pending.mul(pool.rewardLockBps).div(BPS);
    uint256 _claimableAmount = _pending.sub(_lockedAmount);

    rewardToken.safeTransfer(_to, _claimableAmount);
    rewardLocker.lock(rewardToken, _to, _lockedAmount);

    // update user last reward per share to the latest pool reward per share
    user.lastRewardPerShare = _accRewardPerShare;

    emit Harvest(_to, _pid, block.number, _claimableAmount, _lockedAmount);
  }

  /**
  * @dev returns last accounted reward block, either the current block number of the endBlock of the pool
  */
  function _lastAccountedRewardBlock(uint256 _pid) internal view returns (uint32 _value) {
    _value = poolInfo[_pid].endBlock;
    if (_value > block.number) _value = _safeUint32(block.number);
  }

  function _safeUint32(uint256 value) internal pure returns (uint32) {
    require(value < 2**32, 'overflow uint32');
    return uint32(value);
  }

  function _safeUint128(uint256 value) internal pure returns (uint128) {
    require(value < 2**128, 'overflow uint32');
    return uint128(value);
  }
}

// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.7.6;
pragma abicoder v2;

import {ReentrancyGuard} from '@openzeppelin/contracts/utils/ReentrancyGuard.sol';
import {SafeMath} from '@openzeppelin/contracts/math/SafeMath.sol';
import {SafeERC20} from '@openzeppelin/contracts/token/ERC20/SafeERC20.sol';
import {SafeCast} from '@openzeppelin/contracts/utils/SafeCast.sol';
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
  using SafeCast for uint256;
  using SafeERC20 for IERC20Ext;

  uint256 public constant BPS = 10000;
  uint256 public constant PRECISION = 1e12;

  struct UserRewardData {
    uint128 unclaimedReward;
    uint128 lastRewardPerShare;
  }
  // Info of each user.
  struct UserInfo {
    uint256 amount; // How many Staking tokens the user has provided.
    mapping (address => UserRewardData) userRewardData;

    //
    // Basically, any point in time, the amount of reward token
    // entitled to a user but is pending to be distributed is:
    //
    //   pending reward = user.unclaimAmount + (user.amount * (pool.accRewardPerShare - user.lastRewardPerShare)
    //
    // Whenever a user deposits or withdraws Staking tokens to a pool. Here's what happens:
    //   1. The pool's `accRewardPerShare` (and `lastRewardBlock`) gets updated.
    //   2. User receives the pending reward sent to his/her address.
    //   3. User's `lastRewardPerShare` gets updated.
    //   4. User's `amount` gets updated.
  }

  struct PoolRewardData {
    uint128 rewardPerBlock;
    uint128 accRewardPerShare;
  }
  // Info of each pool
  // poolRewardData: reward data for each reward token
  //      rewardPerBlock: amount of reward token per block
  //      accRewardPerShare: accumulated reward per share of token
  // totalStake: total amount of stakeToken has been staked
  // stakeToken: token to stake, should be an ERC20 token
  // startBlock: the block that the reward starts
  // endBlock: the block that the reward ends
  // lastRewardBlock: last block number that rewards distribution occurs
  struct PoolInfo {
    uint256 totalStake;
    address stakeToken;
    uint32 startBlock;
    uint32 endBlock;
    uint32 lastRewardBlock;
    mapping (address => PoolRewardData) poolRewardData;
  }

  // check if a pool exists for a stakeToken
  mapping(address => bool) public poolExists;
  // contract for locking reward
  IKyberRewardLocker public immutable rewardLocker;
  // list reward tokens, use 0x0 for native token, shouldn't be too many reward tokens
  // don't validate values or length by trusting the deployer
  address[] public rewardTokens;

  // Info of each pool.
  uint256 public override poolLength;
  mapping(uint256 => PoolInfo) public poolInfo;
  // Info of each user that stakes Staking tokens.
  mapping(uint256 => mapping(address => UserInfo)) public userInfo;

  event AddNewPool(
    address indexed stakeToken,
    uint32 indexed startBlock,
    uint32 indexed endBlock,
    uint128[] rewardPerBlocks
  );
  event RenewPool(
    uint256 indexed pid,
    uint32 indexed startBlock,
    uint32 indexed endBlock,
    uint128[] rewardPerBlocks
  );
  event UpdatePool(
    uint256 indexed pid,
    uint32 indexed endBlock,
    uint128[] rewardPerBlocks
  );
  event Deposit(
    address indexed user,
    uint256 indexed pid,
    uint256 indexed blockNumber,
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
    address indexed rewardToken,
    uint256 lockedAmount,
    uint256 blockNumber
  );
  event EmergencyWithdraw(
    address indexed user,
    uint256 indexed pid,
    uint256 indexed blockNumber,
    uint256 amount
  );

  constructor(
    address _admin,
    address[] memory _rewardTokens,
    IKyberRewardLocker _rewardLocker
  ) PermissionAdmin(_admin) {
    rewardTokens = _rewardTokens;
    rewardLocker = _rewardLocker;

    // approve allowance to reward locker
    for(uint256 i = 0; i < _rewardTokens.length; i++) {
      if (_rewardTokens[i] != address(0)) {
        IERC20Ext(_rewardTokens[i]).safeApprove(address(_rewardLocker), type(uint256).max);
      }
    }
  }

  receive() external payable {}

  /**
   * @dev allow admin to withdraw only reward token
   */
  function adminWithdraw(uint256 rewardTokenIndex, uint256 amount) external onlyAdmin {
    IERC20Ext rewardToken = IERC20Ext(rewardTokens[rewardTokenIndex]);
    if (rewardToken == IERC20Ext(0)) {
      (bool success, ) = msg.sender.call{ value: amount }('');
      require(success, 'transfer reward token failed');
    } else {
      rewardToken.safeTransfer(msg.sender, amount);
    }
  }

  /**
   * @dev Add a new lp to the pool. Can only be called by the admin.
   * @param _stakeToken: token to be staked to the pool
   * @param _startBlock: block where the reward starts
   * @param _endBlock: block where the reward ends
   * @param _rewardPerBlocks: amount of reward token per block for the pool for each reward token
   */
  function addPool(
    address _stakeToken,
    uint32 _startBlock,
    uint32 _endBlock,
    uint128[] calldata _rewardPerBlocks
  ) external override onlyAdmin {
    require(!poolExists[_stakeToken], 'add: duplicated pool');
    require(_stakeToken != address(0), 'add: invalid stake token');
    require(rewardTokens.length == _rewardPerBlocks.length, 'add: invalid length');

    require(_startBlock > block.number && _endBlock > _startBlock, 'add: invalid blocks');

    poolInfo[poolLength].stakeToken = _stakeToken;
    poolInfo[poolLength].startBlock = _startBlock;
    poolInfo[poolLength].endBlock = _endBlock;
    poolInfo[poolLength].lastRewardBlock = _startBlock;

    for(uint256 i = 0; i < _rewardPerBlocks.length; i++) {
      poolInfo[poolLength].poolRewardData[rewardTokens[i]] = PoolRewardData({
        rewardPerBlock: _rewardPerBlocks[i],
        accRewardPerShare: 0
      });
    }

    poolLength++;

    poolExists[_stakeToken] = true;

    emit AddNewPool(_stakeToken, _startBlock, _endBlock, _rewardPerBlocks);
  }

  /**
   * @dev Renew a pool to start another liquidity mining program
   * @param _pid: id of the pool to renew, must be pool that has not started or already ended
   * @param _startBlock: block where the reward starts
   * @param _endBlock: block where the reward ends
   * @param _rewardPerBlocks: amount of reward token per block for the pool
   */
  function renewPool(
    uint256 _pid,
    uint32 _startBlock,
    uint32 _endBlock,
    uint128[] calldata _rewardPerBlocks
  ) external override onlyAdmin {
    updatePoolRewards(_pid);

    PoolInfo storage pool = poolInfo[_pid];
    // check if pool has not started or already ended
    require(
      pool.startBlock > block.number || pool.endBlock < block.number,
      'renew: invalid pool state to renew'
    );
    // checking data of new pool
    require(rewardTokens.length == _rewardPerBlocks.length, 'renew: invalid length');
    require(_startBlock > block.number && _endBlock > _startBlock, 'renew: invalid blocks');

    pool.startBlock = _startBlock;
    pool.endBlock = _endBlock;
    pool.lastRewardBlock = _startBlock;

    for(uint256 i = 0; i < _rewardPerBlocks.length; i++) {
      pool.poolRewardData[rewardTokens[i]].rewardPerBlock = _rewardPerBlocks[i];
    }

    emit RenewPool(_pid, _startBlock, _endBlock, _rewardPerBlocks);
  }

  /**
   * @dev Update a pool, allow to change end block, reward per block
   * @param _pid: pool id to be renew
   * @param _endBlock: block where the reward ends
   * @param _rewardPerBlocks: amount of reward token per block for the pool,
   *   0 if we want to stop the pool from accumulating rewards
   */
  function updatePool(
    uint256 _pid,
    uint32 _endBlock,
    uint128[] calldata _rewardPerBlocks
  ) external override onlyAdmin {
    updatePoolRewards(_pid);

    PoolInfo storage pool = poolInfo[_pid];

    // should call renew pool if the pool has ended
    require(pool.endBlock > block.number, 'update: pool already ended');
    require(rewardTokens.length == _rewardPerBlocks.length, 'renew: invalid length');
    require(_endBlock > block.number && _endBlock > pool.startBlock, 'update: invalid end block');

    pool.endBlock = _endBlock;
    for(uint256 i = 0; i < _rewardPerBlocks.length; i++) {
      pool.poolRewardData[rewardTokens[i]].rewardPerBlock = _rewardPerBlocks[i];
    }

    emit UpdatePool(_pid, _endBlock, _rewardPerBlocks);
  }

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
  ) external override nonReentrant {
    // update pool rewards, user's rewards
    updatePoolRewards(_pid);
    _updateUserReward(msg.sender, _pid, _shouldHarvest);

    PoolInfo storage pool = poolInfo[_pid];
    UserInfo storage user = userInfo[_pid][msg.sender];

    // collect stakeToken
    IERC20Ext(pool.stakeToken).safeTransferFrom(msg.sender, address(this), _amount);

    // update user staked amount, and total staked amount for the pool
    user.amount = user.amount.add(_amount);
    pool.totalStake = pool.totalStake.add(_amount);

    emit Deposit(msg.sender, _pid, block.number, _amount);
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
   * @notice EMERGENCY USAGE ONLY, USER'S REWARD WILL BE RESET
   * @dev emergency withdrawal function to allow withdraw all deposited token (of the sender)
   *   without harvesting the reward
   * @param _pid: id of the pool
   */
  function emergencyWithdraw(uint256 _pid) external override nonReentrant {
    PoolInfo storage pool = poolInfo[_pid];
    UserInfo storage user = userInfo[_pid][msg.sender];
    uint256 amount = user.amount;

    user.amount = 0;
    for(uint256 i = 0; i < rewardTokens.length; i++) {
      UserRewardData storage rewardData = user.userRewardData[rewardTokens[i]];
      rewardData.lastRewardPerShare = 0;
      rewardData.unclaimedReward = 0;
    }

    pool.totalStake = pool.totalStake.sub(amount);

    if (amount > 0) {
      IERC20Ext(pool.stakeToken).safeTransfer(msg.sender, amount);
    }

    emit EmergencyWithdraw(msg.sender, _pid, block.number, amount);
  }

  /**
   * @dev harvest rewards from multiple pools for the sender
   *   combine rewards from all pools and only transfer once to save gas
   */
  function harvestMultiplePools(uint256[] calldata _pids) external override {
    address[] memory rTokens = rewardTokens;
    uint256[] memory totalRewards = new uint256[](rTokens.length);
    address account = msg.sender;
    uint256 pid;

    for (uint256 i = 0; i < _pids.length; i++) {
      pid = _pids[i];
      updatePoolRewards(pid);
      // update user reward without harvesting
      _updateUserReward(account, pid, false);

      for(uint256 j = 0; j < rTokens.length; j++) {
        uint256 reward = userInfo[pid][account].userRewardData[rTokens[j]].unclaimedReward;
        if (reward > 0) {
          totalRewards[j] = totalRewards[j].add(reward);
          userInfo[pid][account].userRewardData[rTokens[j]].unclaimedReward = 0;
          emit Harvest(account, pid, rTokens[j], reward, block.number);
        }
      }
    }

    for(uint256 i = 0; i < totalRewards.length; i++) {
      if (totalRewards[i] > 0) {
        _lockReward(IERC20Ext(rTokens[i]), account, totalRewards[i]);
      }
    }
  }

  /**
   * @dev get pending reward of a user from a pool, mostly for front-end
   * @param _pid: id of the pool
   * @param _user: user to check for pending rewards
   */
  function pendingReward(uint256 _pid, address _user)
    external
    override
    view
    returns (uint256[] memory rewards)
  {
    address[] memory rTokens = rewardTokens;
    rewards = new uint256[](rTokens.length);
    PoolInfo storage pool = poolInfo[_pid];
    UserInfo storage user = userInfo[_pid][_user];
    uint256 _totalStake = pool.totalStake;
    uint256 _poolLastRewardBlock = pool.lastRewardBlock;
    for(uint256 i = 0; i < rTokens.length; i++) {
      uint256 _accRewardPerShare = pool.poolRewardData[rTokens[i]].accRewardPerShare;
      uint32 lastAccountedBlock = _lastAccountedRewardBlock(_pid);
      if (lastAccountedBlock > _poolLastRewardBlock && _totalStake != 0) {
        uint256 reward = uint256(lastAccountedBlock - _poolLastRewardBlock)
          .mul(pool.poolRewardData[rTokens[i]].rewardPerBlock);
        _accRewardPerShare = _accRewardPerShare.add(reward.mul(PRECISION) / _totalStake);
      }

      rewards[i] = user.amount.mul(
        _accRewardPerShare.sub(user.userRewardData[rTokens[i]].lastRewardPerShare)
        ) / PRECISION;
      rewards[i] = rewards[i].add(user.userRewardData[rTokens[i]].unclaimedReward);
    }
  }

  /**
  * @dev return list reward tokens
  */
  function getRewardTokens() external override view returns (address[] memory) {
    return rewardTokens;
  }

  /**
   * @dev harvest reward from pool for the sender
   * @param _pid: id of the pool
   */
  function harvest(uint256 _pid) public override {
    updatePoolRewards(_pid);
    _updateUserReward(msg.sender, _pid, true);
  }

  /**
   * @dev update reward for one pool
   */
  function updatePoolRewards(uint256 _pid) public override {
    require(_pid < poolLength, 'invalid pool id');
    PoolInfo storage pool = poolInfo[_pid];
    uint32 lastAccountedBlock = _lastAccountedRewardBlock(_pid);
    if (lastAccountedBlock <= pool.lastRewardBlock) return;
    uint256 _totalStake = pool.totalStake;
    if (_totalStake == 0) {
      pool.lastRewardBlock = lastAccountedBlock;
      return;
    }
    uint256 numberBlocks = uint256(lastAccountedBlock - pool.lastRewardBlock);
    for(uint256 i = 0; i < rewardTokens.length; i++) {
      PoolRewardData storage rewardData = pool.poolRewardData[rewardTokens[i]];
      uint256 reward = numberBlocks.mul(uint256(rewardData.rewardPerBlock));
      rewardData.accRewardPerShare = uint256(rewardData.accRewardPerShare)
        .add(reward.mul(PRECISION) / _totalStake)
        .toUint128();
    }
    pool.lastRewardBlock = lastAccountedBlock;
  }

  /**
   * @dev withdraw _amount of stakeToken from pool _pid, also harvest reward for the sender
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

    IERC20Ext(pool.stakeToken).safeTransfer(msg.sender, _amount);

    emit Withdraw(msg.sender, _pid, block.number, user.amount);
  }

  /**
   * @dev update reward of _to address from pool _pid, harvest if needed
   */
  function _updateUserReward(
    address _to,
    uint256 _pid,
    bool shouldHarvest
  ) internal {
    uint256 userAmount = userInfo[_pid][_to].amount;
    address[] memory rTokens = rewardTokens;

    if (userAmount == 0) {
      // update user last reward per share to the latest pool reward per share
      // by right if user.amount is 0, user.unclaimedReward should be 0 as well,
      // except when user uses emergencyWithdraw function
      for(uint256 i = 0; i < rTokens.length; i++) {
        userInfo[_pid][_to].userRewardData[rTokens[i]].lastRewardPerShare =
          poolInfo[_pid].poolRewardData[rTokens[i]].accRewardPerShare;
      }
      return;
    }

    for(uint256 i = 0; i < rTokens.length; i++) {
      uint128 lastAccRewardPerShare = poolInfo[_pid].poolRewardData[rTokens[i]].accRewardPerShare;
      UserRewardData storage rewardData = userInfo[_pid][_to].userRewardData[rTokens[i]];
      // user's unclaim reward + user's amount * (pool's accRewardPerShare - user's lastRewardPerShare) / precision
      uint256 _pending = userAmount.mul(
        uint256(lastAccRewardPerShare).sub(rewardData.lastRewardPerShare)
      ) / PRECISION;
      _pending = _pending.add(rewardData.unclaimedReward);

      if (shouldHarvest) {
        rewardData.unclaimedReward = 0;
        if (_pending > 0) {
          _lockReward(IERC20Ext(rTokens[i]), _to, _pending);
          emit Harvest(_to, _pid, rTokens[i], _pending, block.number);
        }
      } else {
        rewardData.unclaimedReward = _pending.toUint128();
      }

      // update user last reward per share to the latest pool reward per share
      rewardData.lastRewardPerShare = lastAccRewardPerShare;
    }
  }

  /**
   * @dev returns last accounted reward block, either the current block number or the endBlock of the pool
   */
  function _lastAccountedRewardBlock(uint256 _pid) internal view returns (uint32 _value) {
    _value = poolInfo[_pid].endBlock;
    if (_value > block.number) _value = block.number.toUint32();
  }

  function _lockReward(IERC20Ext token, address _account, uint256 _amount) internal {
    if (token == IERC20Ext(0)) {
      // native token
      rewardLocker.lock{ value: _amount }(token, _account, _amount);
    } else {
      rewardLocker.lock(token, _account, _amount);
    }
  }
}

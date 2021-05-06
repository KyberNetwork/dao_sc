// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.7.6;
pragma abicoder v2;

import {ReentrancyGuard} from '@openzeppelin/contracts/utils/ReentrancyGuard.sol';
import {SafeMath} from '@openzeppelin/contracts/math/SafeMath.sol';
import {SafeERC20} from '@openzeppelin/contracts/token/ERC20/SafeERC20.sol';
import {IERC20Ext} from '@kyber.network/utils-sc/contracts/IERC20Ext.sol';
import {IKyberRewardLocker} from '../interfaces/liquidityMining/IKyberRewardLocker.sol';
import {Math} from '../misc/Math.sol';
import {PermissionAdmin} from '@kyber.network/utils-sc/contracts/PermissionAdmin.sol';

contract LiquidityRewarder is PermissionAdmin, ReentrancyGuard {
  using SafeMath for uint256;
  using SafeERC20 for IERC20Ext;

  /* ========== STATE VARIABLES ========== */

  struct RewardInfo {
    address rewardsDistributor;
    uint256 rewardsDuration;
    uint256 rewardsStartTimestamp;
    uint256 rewardsEndTimestamp;
    uint256 lastUpdateTime;
    uint256 rewardRate;
    uint256 rewardPerTokenStored;
    mapping(address => uint256) userRewardPerTokenPaid;
    mapping(address => uint256) rewards;
  }

  struct StakeTokenInfo {
    mapping(IERC20Ext => RewardInfo) rewardTokenInfo;
    uint256 totalSupply;
    mapping(address => uint256) balances;
    IERC20Ext[] rewardTokens;
  }

  uint256 public constant BPS = 10000;
  mapping(IERC20Ext => StakeTokenInfo) public rewards;
  // contract for locking reward
  address public immutable rewardLocker;
  uint256 public lockBps;

  /* ========== EVENTS ========== */

  event RewardAdded(IERC20Ext indexed stakeToken, IERC20Ext indexed rewardToken, uint256 reward);
  event Staked(IERC20Ext indexed stakeToken, address indexed user, uint256 amount);
  event Withdrawn(IERC20Ext indexed stakeToken, address indexed user, uint256 amount);
  event RewardPaid(IERC20Ext indexed rewardToken, address indexed user, uint256 reward);
  event RewardsDurationUpdated(
    IERC20Ext indexed stakeToken,
    IERC20Ext indexed rewardToken,
    uint256 newDuration
  );
  event Recovered(IERC20Ext token, uint256 amount);
  event LockBpsUpdated(uint256 newLockBps);

  constructor(address _admin, address _rewardLocker) PermissionAdmin(_admin) {
    rewardLocker = _rewardLocker;
  }

  /* ========== MODIFIERS ========== */

  modifier updateReward(IERC20Ext stakeToken, address account) {
    StakeTokenInfo storage stakeTokenInfo = rewards[stakeToken];
    for (uint256 i; i < stakeTokenInfo.rewardTokens.length; i++) {
      IERC20Ext rewardToken = stakeTokenInfo.rewardTokens[i];
      RewardInfo storage rewardTokenInfo = stakeTokenInfo.rewardTokenInfo[rewardToken];
      rewardTokenInfo.rewardPerTokenStored = _rewardPerToken(
        rewardTokenInfo,
        stakeTokenInfo.totalSupply
      );
      rewardTokenInfo.lastUpdateTime = _lastTimeRewardApplicable(
        rewardTokenInfo.rewardsEndTimestamp
      );
      if (account != address(0)) {
        rewardTokenInfo.rewards[account] = earned(account, stakeToken, rewardToken);
        rewardTokenInfo.userRewardPerTokenPaid[account] = rewardTokenInfo.rewardPerTokenStored;
      }
    }
    _;
  }

  /* ========== VIEWS ========== */

  function totalSupply(IERC20Ext stakeToken) external view returns (uint256) {
    return rewards[stakeToken].totalSupply;
  }

  function balanceOf(IERC20Ext stakeToken, address account) external view returns (uint256) {
    return rewards[stakeToken].balances[account];
  }

  function getRewardTokensOfStakeToken(IERC20Ext stakeToken)
    external
    view
    returns (IERC20Ext[] memory)
  {
    return rewards[stakeToken].rewardTokens;
  }

  function lastTimeRewardApplicable(IERC20Ext stakeToken, IERC20Ext rewardToken)
    external
    view
    returns (uint256)
  {
    return
      _lastTimeRewardApplicable(
        rewards[stakeToken].rewardTokenInfo[rewardToken].rewardsEndTimestamp
      );
  }

  function rewardPerToken(IERC20Ext stakeToken, IERC20Ext rewardToken)
    public
    view
    returns (uint256)
  {
    return
      _rewardPerToken(
        rewards[stakeToken].rewardTokenInfo[rewardToken],
        rewards[stakeToken].totalSupply
      );
  }

  function earned(
    address account,
    IERC20Ext stakeToken,
    IERC20Ext rewardToken
  ) public view returns (uint256) {
    RewardInfo storage rewardTokenInfo = rewards[stakeToken].rewardTokenInfo[rewardToken];
    return
      rewards[stakeToken].balances[account]
        .mul(
        _rewardPerToken(rewardTokenInfo, rewards[stakeToken].totalSupply).sub(
          rewardTokenInfo.userRewardPerTokenPaid[account]
        )
      )
        .div(1e18)
        .add(rewardTokenInfo.rewards[account]);
  }

  function getRewardForDuration(IERC20Ext stakeToken, IERC20Ext rewardToken)
    external
    view
    returns (uint256)
  {
    RewardInfo storage rewardTokenInfo = rewards[stakeToken].rewardTokenInfo[rewardToken];
    return rewardTokenInfo.rewardRate.mul(rewardTokenInfo.rewardsDuration);
  }

  /* ========== MUTATIVE FUNCTIONS ========== */

  function stake(IERC20Ext stakeToken, uint256 amount)
    external
    nonReentrant
    updateReward(stakeToken, msg.sender)
  {
    require(amount > 0, 'cannot stake 0');
    rewards[stakeToken].totalSupply = rewards[stakeToken].totalSupply.add(amount);
    rewards[stakeToken].balances[msg.sender] = rewards[stakeToken].balances[msg.sender].add(
      amount
    );
    stakeToken.safeTransferFrom(msg.sender, address(this), amount);
    emit Staked(stakeToken, msg.sender, amount);
  }

  function withdraw(IERC20Ext stakeToken, uint256 amount)
    public
    nonReentrant
    updateReward(stakeToken, msg.sender)
  {
    require(amount > 0, 'cannot withdraw 0');
    rewards[stakeToken].totalSupply = rewards[stakeToken].totalSupply.sub(amount);
    rewards[stakeToken].balances[msg.sender] = rewards[stakeToken].balances[msg.sender].sub(
      amount
    );
    stakeToken.safeTransfer(msg.sender, amount);
    emit Withdrawn(stakeToken, msg.sender, amount);
  }

  function getReward(IERC20Ext stakeToken)
    public
    nonReentrant
    updateReward(stakeToken, msg.sender)
  {
    StakeTokenInfo storage stakeTokenInfo = rewards[stakeToken];
    for (uint256 i; i < stakeTokenInfo.rewardTokens.length; i++) {
      IERC20Ext rewardToken = stakeTokenInfo.rewardTokens[i];
      RewardInfo storage rewardTokenInfo = stakeTokenInfo.rewardTokenInfo[rewardToken];
      uint256 reward = rewardTokenInfo.rewards[msg.sender];
      if (reward > 0) {
        rewardTokenInfo.rewards[msg.sender] = 0;
        // calculate lock amount and send to locking contract
        uint256 lockedReward = reward.mul(lockBps).div(BPS);
        reward = reward.sub(lockedReward);
        IKyberRewardLocker(rewardLocker).lock(rewardToken, msg.sender, lockedReward);
        // remainder sent to user
        rewardToken.safeTransfer(msg.sender, reward);
        emit RewardPaid(rewardToken, msg.sender, reward);
      }
    }
  }

  function exit(IERC20Ext stakeToken) external {
    withdraw(stakeToken, rewards[stakeToken].balances[msg.sender]);
    getReward(stakeToken);
  }

  /* ========== RESTRICTED FUNCTIONS ========== */

  function addRewardPool(
    IERC20Ext _stakeToken,
    IERC20Ext _rewardToken,
    address _rewardsDistributor,
    uint64 _rewardsDuration
  ) public onlyAdmin {
    RewardInfo storage rewardTokenInfo = rewards[_stakeToken].rewardTokenInfo[_rewardToken];
    require(rewardTokenInfo.rewardsDuration == 0, 'existing reward token info');
    rewardTokenInfo.rewardsDistributor = _rewardsDistributor;
    rewardTokenInfo.rewardsDuration = _rewardsDuration;
    rewards[_stakeToken].rewardTokens.push(_rewardToken);
  }

  function setRewardsDistributor(
    IERC20Ext _stakeToken,
    IERC20Ext _rewardToken,
    address _rewardsDistributor
  ) external onlyAdmin {
    rewards[_stakeToken].rewardTokenInfo[_rewardToken].rewardsDistributor = _rewardsDistributor;
  }

  function setLockBps(uint256 _lockBps) external onlyAdmin {
    require(_lockBps <= BPS, 'bad lock bps');
    lockBps = _lockBps;
    emit LockBpsUpdated(lockBps);
  }

  function notifyRewardAmount(
    IERC20Ext stakeToken,
    IERC20Ext rewardToken,
    uint256 reward
  ) external updateReward(stakeToken, address(0)) {
    StakeTokenInfo storage stakeTokenInfo = rewards[stakeToken];
    RewardInfo storage rewardTokenInfo = stakeTokenInfo.rewardTokenInfo[rewardToken];
    require(rewardTokenInfo.rewardsDistributor == msg.sender, 'not reward distributor');
    // TODO: check if we assume rewards have been sent prior to calling this function
    // rewardToken.safeTransferFrom(msg.sender, address(this), reward);

    if (block.timestamp >= rewardTokenInfo.rewardsEndTimestamp) {
      rewardTokenInfo.rewardRate = reward.div(rewardTokenInfo.rewardsDuration);
    } else {
      uint256 remaining = rewardTokenInfo.rewardsEndTimestamp.sub(block.timestamp);
      uint256 leftover = remaining.mul(rewardTokenInfo.rewardRate);
      rewardTokenInfo.rewardRate = reward.add(leftover).div(rewardTokenInfo.rewardsDuration);
    }

    rewardTokenInfo.lastUpdateTime = block.timestamp;
    rewardTokenInfo.rewardsEndTimestamp = block.timestamp.add(rewardTokenInfo.rewardsDuration);

    // finally, given reward locker token approval if none was given
    if (rewardToken.allowance(address(this), rewardLocker) == 0) {
      rewardToken.safeApprove(rewardLocker, type(uint256).max);
    }

    emit RewardAdded(stakeToken, rewardToken, reward);
  }

  // Added to support recovering LP Rewards from other systems such as BAL to be distributed to holders
  // Issue: unless we keep a global record of reward tokens, difficult to block withdrawal of reward tokens
  function recoverERC20(IERC20Ext tokenAddress, uint256 tokenAmount) external onlyAdmin {
    require(rewards[tokenAddress].totalSupply == 0, 'cannot withdraw staking token');
    tokenAddress.safeTransfer(admin, tokenAmount);
    emit Recovered(tokenAddress, tokenAmount);
  }

  function setRewardsDuration(
    IERC20Ext stakeToken,
    IERC20Ext rewardToken,
    uint256 _rewardsDuration
  ) external {
    RewardInfo storage rewardTokenInfo = rewards[stakeToken].rewardTokenInfo[rewardToken];
    require(block.timestamp > rewardTokenInfo.rewardsEndTimestamp, 'reward period still active');
    require(rewardTokenInfo.rewardsDistributor == msg.sender, 'not reward distributor');
    require(_rewardsDuration > 0, 'reward duration must be non-zero');
    rewardTokenInfo.rewardsDuration = _rewardsDuration;
    emit RewardsDurationUpdated(stakeToken, rewardToken, rewardTokenInfo.rewardsDuration);
  }

  /* ========== INTERNAL FUNCTIONS ========== */
  function _rewardPerToken(RewardInfo storage rewardTokenInfo, uint256 totalStakedSupply)
    internal
    view
    returns (uint256)
  {
    if (totalStakedSupply == 0) {
      return rewardTokenInfo.rewardPerTokenStored;
    }
    return
      rewardTokenInfo.rewardPerTokenStored.add(
        _lastTimeRewardApplicable(rewardTokenInfo.rewardsEndTimestamp)
          .sub(rewardTokenInfo.lastUpdateTime)
          .mul(rewardTokenInfo.rewardRate)
          .mul(1e18)
          .div(totalStakedSupply)
      );
  }

  function _lastTimeRewardApplicable(uint256 rewardsEndTimestamp) internal view returns (uint256) {
    return Math.min(block.timestamp, rewardsEndTimestamp);
  }
}

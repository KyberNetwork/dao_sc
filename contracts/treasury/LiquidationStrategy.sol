// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.7.6;

import {PermissionAdmin} from '@kyber.network/utils-sc/contracts/PermissionAdmin.sol';
import {Utils} from '@kyber.network/utils-sc/contracts/Utils.sol';
import {IERC20Ext} from '@kyber.network/utils-sc/contracts/IERC20Ext.sol';
import {ReentrancyGuard} from '@openzeppelin/contracts/utils/ReentrancyGuard.sol';
import {SafeMath} from '@openzeppelin/contracts/math/SafeMath.sol';
import {SafeERC20} from '@openzeppelin/contracts/token/ERC20/SafeERC20.sol';
import {EnumerableSet} from '@openzeppelin/contracts/utils/EnumerableSet.sol';
import {ILiquidationStrategy} from '../interfaces/liquidation/ILiquidationStrategy.sol';
import {ILiquidationCallback} from '../interfaces/liquidation/ILiquidationCallback.sol';
import {IPool} from '../interfaces/liquidation/IPool.sol';

contract LiquidationStrategy is ILiquidationStrategy, PermissionAdmin, Utils, ReentrancyGuard {

  using SafeERC20 for IERC20Ext;
  using SafeMath for uint256;
  using EnumerableSet for EnumerableSet.AddressSet;

  // after repeatedPeriod since startTime, there will be duration (in seconds)
  // for liquidators to liquidate tokens in the treasury pool
  // for example: from deployed time, every 2 weeks liquidation is enabled for 4 days
  struct LiquidationSchedule {
    uint128 startTime;
    uint64 repeatedPeriod;
    uint64 duration;
  }

  // list of tokens that can be liquidate to
  EnumerableSet.AddressSet private _whitelistedTokens;

  // if true, only whitelisted liquidators can call to liquidate tokens
  // otherwise no constraints
  bool private _isWhitelistedLiquidatorEnabled;
  EnumerableSet.AddressSet private _whitelistedLiquidators;

  LiquidationSchedule private _liquidationSchedule;
  IPool private _treasuryPool;
  address payable private _rewardPool;

  event TreasuryPoolSet(address indexed treasuryPool);
  event RewardPoolSet(address indexed rewardPool);
  event LiquidationScheduleUpdated(uint128 startTime, uint64 repeatedPeriod, uint64 duration);
  event WhitelistedTokenUpdated(address indexed token, bool indexed isAdd);
  event WhitelistedLiquidatorUpdated(address indexed liquidator, bool indexed isAdd);
  event WhitelistedLiquidatorsEnabled(bool indexed isEnabled);

  modifier onlyWhenLiquidationEnabled() {
    require(isLiquidationEnabled(), 'only when liquidation enabled');
    _;
  }

  constructor(
    address admin,
    address treasuryPoolAddress,
    address payable rewardPoolAddress,
    uint128 startTime,
    uint64 repeatedPeriod,
    uint64 duration,
    address[] memory whitelistedTokens
  ) PermissionAdmin(admin) {
    _setTreasuryPool(treasuryPoolAddress);
    _setRewardPool(rewardPoolAddress);
    _setLiquidationSchedule(startTime, repeatedPeriod, duration);
    _updateWhitelistedToken(whitelistedTokens, true);
    // default not using whitelisted liquidator mechanism
    _setWhitelistedLiquidatorsEnabled(false);
  }

  function updateLiquidationSchedule(
    uint128 startTime,
    uint64 repeatedPeriod,
    uint64 duration
  )
    external onlyAdmin
  {
    _setLiquidationSchedule(startTime, repeatedPeriod, duration);
  }

  function updateTreasuryPool(address pool) external override onlyAdmin {
    _setTreasuryPool(pool);
  }

  function updateRewardPool(address payable pool) external override onlyAdmin {
    _setRewardPool(pool);
  }

  function updateWhitelistedTokens(address[] calldata tokens, bool isAdd)
    external override onlyAdmin
  {
    _updateWhitelistedToken(tokens, isAdd);
  }

  function updateWhitelistedLiquidators(address[] calldata liquidators, bool isAdd)
    external override onlyAdmin
  {
    for(uint256 i = 0; i < liquidators.length; i++) {
      _updateWhitelistedLiquidator(liquidators[i], isAdd);
    }
  }

  function enableWhitelistedLiquidators() external override onlyAdmin {
    _setWhitelistedLiquidatorsEnabled(true);
  }

  function disableWhitelistedLiquidators() external override onlyAdmin {
    _setWhitelistedLiquidatorsEnabled(false);
  }

  /** @dev Liquidate list of tokens to a single dest token,
  *   source token must not be a whitelisted token, dest must be a whitelisted token
  *   in case whitelisted liquidator is enabled, sender must be whitelisted
  * @param sources list of source tokens to liquidate
  * @param amounts list of amounts corresponding to each source token
  * @param recipient receiver of source tokens
  * @param dest token to liquidate to, must be whitelisted
  * @param minReturn minimum return of dest token for this liquidation
  * @param txData data to callback to recipient
  */
  function liquidate(
    IERC20Ext[] memory sources,
    uint256[] memory amounts,
    address payable recipient,
    IERC20Ext dest,
    uint256 minReturn,
    bytes memory txData
  )
    internal virtual onlyWhenLiquidationEnabled nonReentrant
    returns (uint256 destAmount)
  {
    // Check whitelist tokens
    require(
      isWhitelistedToken(address(dest)),
      'only liquidate to whitelisted tokens'
    );
    for(uint256 i = 0; i < sources.length; i++) {
      require(
        !isWhitelistedToken(address(sources[i])),
        'cannot liquidate a whitelisted token'
      );
    }
    // check whitelisted liquidator if needed
    if (isWhitelistLiquidatorEnabled()) {
      require(
        isWhitelistedLiquidator(msg.sender),
        'only whitelisted liquidator'
      );
    }
    // request funds from treasury pool to recipient
    _treasuryPool.withdrawFunds(sources, amounts, recipient);
    uint256 balanceDestBefore = getBalance(dest, address(this));
    // callback for them to transfer dest amount to reward
    ILiquidationCallback(recipient).liquidationCallback(
      msg.sender, sources, amounts, payable(address(this)), dest, txData
    );
    destAmount = getBalance(dest, address(this)).sub(balanceDestBefore);
    require(destAmount >= minReturn, 'insufficient dest amount');
    _transferToken(dest, payable(rewardPool()), destAmount);
  }

  // Whitelisted tokens
  function getWhitelistedTokensLength() external override view returns (uint256) {
    return _whitelistedTokens.length();
  }

  function getWhitelistedTokenAt(uint256 index) external override view returns (address) {
    return _whitelistedTokens.at(index);
  }

  function getAllWhitelistedTokens()
    external view override returns (address[] memory tokens)
  {
    uint256 length = _whitelistedTokens.length();
    tokens = new address[](length);
    for(uint256 i = 0; i < length; i++) {
      tokens[i] = _whitelistedTokens.at(i);
    }
  }

  // Whitelisted liquidators
  function getWhitelistedLiquidatorsLength() external override view returns (uint256) {
    return _whitelistedLiquidators.length();
  }

  function getWhitelistedLiquidatorAt(uint256 index) external override view returns (address) {
    return _whitelistedLiquidators.at(index);
  }

  function getAllWhitelistedLiquidators()
    external view override returns (address[] memory liquidators)
  {
    uint256 length = _whitelistedLiquidators.length();
    liquidators = new address[](length);
    for(uint256 i = 0; i < length; i++) {
      liquidators[i] = _whitelistedLiquidators.at(i);
    }
  }

  function getLiquidationSchedule()
    external override view
    returns(
      uint128 startTime,
      uint64 repeatedPeriod,
      uint64 duration
    )
  {
    (startTime, repeatedPeriod, duration) = (
      _liquidationSchedule.startTime,
      _liquidationSchedule.repeatedPeriod,
      _liquidationSchedule.duration
    );
  }

  function treasuryPool() public override view returns (address) {
    return address(_treasuryPool);
  }

  function rewardPool() public override view returns (address) {
    return _rewardPool;
  }

  function isWhitelistedToken(address token)
    public view override returns (bool)
  {
    return _whitelistedTokens.contains(token);
  }

  function isWhitelistedLiquidator(address liquidator)
    public view override returns (bool)
  {
    return _whitelistedLiquidators.contains(liquidator);
  }

  function isWhitelistLiquidatorEnabled()
    public view override returns (bool)
  {
    return _isWhitelistedLiquidatorEnabled;
  }
  function isLiquidationEnabled() public view override returns (bool) {
    return isLiquidationEnabledAt(block.timestamp);
  }

  /** @dev Only support getting data for current or future timestamp
  */
  function isLiquidationEnabledAt(uint256 timestamp) public override view returns (bool) {
    if (timestamp < block.timestamp) return false;
    LiquidationSchedule memory schedule = _liquidationSchedule;
    if (timestamp < uint256(schedule.startTime)) return false;
    uint256 timeInPeriod = (timestamp - uint256(schedule.startTime)) % uint256(schedule.repeatedPeriod);
    return timeInPeriod < schedule.duration;
  }

  function _setTreasuryPool(address _pool) internal {
    require(_pool != address(0), 'invalid treasury pool');
    _treasuryPool = IPool(_pool);
    emit TreasuryPoolSet(_pool);
  }

  function _setRewardPool(address payable _pool) internal {
    require(_pool != address(0), 'invalid reward pool');
    _rewardPool = _pool;
    emit RewardPoolSet(_pool);
  }

  function _updateWhitelistedToken(address[] memory _tokens, bool _isAdd) internal {
    for(uint256 i = 0; i < _tokens.length; i++) {
      if (_isAdd) {
        _whitelistedTokens.add(_tokens[i]);
      } else {
        _whitelistedTokens.remove(_tokens[i]);
      }
      emit WhitelistedTokenUpdated(_tokens[i], _isAdd);
    }
  }

  function _updateWhitelistedLiquidator(address _liquidator, bool _isAdd) internal {
    if (_isAdd) {
      _whitelistedLiquidators.add(_liquidator);
    } else {
      _whitelistedLiquidators.remove(_liquidator);
    }
    emit WhitelistedLiquidatorUpdated(_liquidator, _isAdd);
  }

  function _setLiquidationSchedule(
    uint128 _startTime,
    uint64 _repeatedPeriod,
    uint64 _duration
  ) internal {
    // TODO: Validate
    _liquidationSchedule = LiquidationSchedule({
        startTime: _startTime,
        repeatedPeriod: _repeatedPeriod,
        duration: _duration
    });
    emit LiquidationScheduleUpdated(_startTime, _repeatedPeriod, _duration);
  }

  function _setWhitelistedLiquidatorsEnabled(bool _isEnabled) internal {
    _isWhitelistedLiquidatorEnabled = _isEnabled;
    emit WhitelistedLiquidatorsEnabled(_isEnabled); 
  }

  function _transferToken(IERC20Ext token, address payable recipient, uint256 amount) internal {
    if (token == ETH_TOKEN_ADDRESS) {
      (bool success, ) = recipient.call { value: amount }("");
      require(success, 'transfer eth failed');
    } else {
      token.safeTransfer(recipient, amount);
    }
  }
}

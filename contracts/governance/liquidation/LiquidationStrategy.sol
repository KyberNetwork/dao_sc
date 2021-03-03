// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.7.6;

import {PermissionAdmin} from '@kyber.network/utils-sc/contracts/PermissionAdmin.sol';
import {Utils} from "@kyber.network/utils-sc/contracts/Utils.sol";
import {IERC20Ext} from "@kyber.network/utils-sc/contracts/IERC20Ext.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SafeMath} from '@openzeppelin/contracts/math/SafeMath.sol';
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import {ILiquidationStrategy} from "../../interfaces/ILiquidationStrategy.sol";
import {ILiquidationCallback} from "../../interfaces/ILiquidationCallback.sol";
import {ITreasuryPool} from "../../interfaces/ITreasuryPool.sol";

contract LiquidationStrategy is ILiquidationStrategy, PermissionAdmin, Utils, ReentrancyGuard {

  using SafeERC20 for IERC20Ext;
  using SafeMath for uint256;

  // after repeatedPeriod since startTime, there will be duration (in seconds)
  // for liquidators to liquidate tokens in the fee pool
  // for example: from deployed time, every 2 weeks liquidation is enabled for 4 days
  struct LiquidationSchedule {
    uint128 startTime;
    uint64 repeatedPeriod;
    uint64 duration;
  }

  LiquidationSchedule public liquidationSchedule;
  ITreasuryPool public feePool;
  address payable public treasuryPool;
  // list of tokens that can be liquidate to
  mapping(address => bool) public whitelistedTokens;

  event FeePoolSet(address indexed feePool);
  event TreasuryPoolSet(address indexed treasuryPool);
  event LiquidationScheduleUpdated(uint128 startTime, uint64 repeatedPeriod, uint64 duration);
  event WhitelistedTokenUpdated(address indexed token, bool indexed isAdd);

  modifier onlyWhenLiquidationEnabled() {
    require(isLiquidationEnabled(), 'only when liquidation enabled');
    _;
  }

  constructor(
    address _admin,
    address _feePool,
    address payable _treasuryPool,
    uint128 _startTime,
    uint64 _repeatedPeriod,
    uint64 _duration,
    address[] memory _whitelistedTokens
  ) PermissionAdmin(_admin) {
    _setFeePool(_feePool);
    _setTreasuryPool(_treasuryPool);
    _setLiquidationSchedule(_startTime, _repeatedPeriod, _duration);
    _updateWhitelistedToken(_whitelistedTokens, true);
  }

  function updateLiquidationSchedule(
    uint128 _startTime,
    uint64 _repeatedPeriod,
    uint64 _duration
  )
    external onlyAdmin
  {
    _setLiquidationSchedule(_startTime, _repeatedPeriod, _duration);
  }

  function updateFeePool(address _feePool) external onlyAdmin {
    _setFeePool(_feePool);
  }

  function updateTreasuryPool(address payable _treasuryPool) external onlyAdmin {
    _setTreasuryPool(_treasuryPool);
  }

  function updateWhitelistedTokens(address[] calldata _tokens, bool _isAdd)
    external override onlyAdmin
  {
    _updateWhitelistedToken(_tokens, _isAdd);
  }

  /** @dev Liquidate list of tokens to a single dest token,
  *   source token must not be a whitelisted token, dest must be a whitelisted token
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
    public override virtual onlyWhenLiquidationEnabled nonReentrant
    returns (uint256 destAmount)
  {
    require(
      whitelistedTokens[address(dest)],
      'only liquidate to whitelisted tokens'
    );
    for(uint256 i = 0; i < sources.length; i++) {
      require(
        !whitelistedTokens[address(sources[i])],
        'cannot liquidate a whitelisted token'
      );
    }
    // withdraw funds from fee pool to recipient
    feePool.withdrawFunds(sources, amounts, recipient);
    uint256 balanceDestBefore = dest.balanceOf(treasuryPool);
    // callback for them to transfer dest amount to treasury
    ILiquidationCallback(recipient).liquidationCallback(
      msg.sender, sources, amounts, payable(treasuryPool), dest, txData
    );
    destAmount = dest.balanceOf(treasuryPool).sub(balanceDestBefore);
    require(destAmount >= minReturn, 'low dest amount after liquidated');
  }

  function isLiquidationEnabled() public view override returns (bool) {
    return isLiquidationEnabledAt(block.timestamp);
  }

  /** @dev Only support getting data for current or future timestamp
  */
  function isLiquidationEnabledAt(uint256 timestamp) public override view returns (bool) {
    if (timestamp < block.timestamp) return false;
    LiquidationSchedule memory schedule = liquidationSchedule;
    if (timestamp < uint256(schedule.startTime)) return false;
    uint256 timeInPeriod = (timestamp - uint256(schedule.startTime)) % uint256(schedule.repeatedPeriod);
    return timeInPeriod < schedule.duration;
  }

  function _setFeePool(address _feePool) internal {
    require(_feePool != address(0), 'invalid fee pool');
    feePool = ITreasuryPool(_feePool);
    emit FeePoolSet(_feePool);
  }

  function _setTreasuryPool(address payable _treasuryPool) internal {
    require(_treasuryPool != address(0), 'invalid treasury pool');
    treasuryPool = _treasuryPool;
    emit TreasuryPoolSet(_treasuryPool);
  }

  function _updateWhitelistedToken(address[] memory _tokens, bool _isAdd) internal {
    for(uint256 i = 0; i < _tokens.length; i++) {
      whitelistedTokens[_tokens[i]] = _isAdd;
      emit WhitelistedTokenUpdated(_tokens[i], _isAdd);
    }
  }

  function _setLiquidationSchedule(
    uint128 _startTime,
    uint64 _repeatedPeriod,
    uint64 _duration
  ) internal {
    // TODO: Validate
    liquidationSchedule = LiquidationSchedule({
        startTime: _startTime,
        repeatedPeriod: _repeatedPeriod,
        duration: _duration
    });
    emit LiquidationScheduleUpdated(_startTime, _repeatedPeriod, _duration);
  }
}

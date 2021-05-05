// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.7.6;
pragma abicoder v2;

import {IERC20Ext} from '@kyber.network/utils-sc/contracts/IERC20Ext.sol';
import {SafeMath} from '@openzeppelin/contracts/math/SafeMath.sol';
import {SafeCast} from '@openzeppelin/contracts/utils/SafeCast.sol';
import {SafeERC20} from '@openzeppelin/contracts/token/ERC20/SafeERC20.sol';
import {EnumerableSet} from '@openzeppelin/contracts/utils/EnumerableSet.sol';
import {PermissionAdmin} from '@kyber.network/utils-sc/contracts/PermissionAdmin.sol';

import {IKyberRewardLocker} from '../interfaces/liquidityMining/IKyberRewardLocker.sol';

interface IERC20Burnable {
  function burn(uint256 _value) external;
}

contract KyberRewardLocker is IKyberRewardLocker, PermissionAdmin {
  using SafeMath for uint256;
  using SafeCast for uint256;

  using SafeERC20 for IERC20Ext;
  using EnumerableSet for EnumerableSet.AddressSet;

  struct VestingSchedule {
    uint64 startTime;
    uint64 endTime;
    uint128 quantity;
  }

  struct VestingSchedules {
    uint256 length;
    mapping(uint256 => VestingSchedule) data;
  }

  uint256 private constant MAX_REWARD_CONTRACTS_SIZE = 10;

  /// @dev whitelist of reward contracts
  mapping(IERC20Ext => EnumerableSet.AddressSet) internal rewardContractsPerToken;

  /// @dev vesting schedule of an account
  mapping(address => mapping(IERC20Ext => VestingSchedules)) private accountsVestingSchedules;

  /// @dev An account's total escrowed balance per token to save recomputing this for fee extraction purposes
  mapping(address => mapping(IERC20Ext => uint256)) public accountEscrowedBalance;

  /// @dev An account's total vested reward per token
  mapping(address => mapping(IERC20Ext => uint256)) public accountVestedBalance;

  /// @dev where slashing tokens goes
  mapping(IERC20Ext => address) public slashingTargets;

  /// @dev lock time
  mapping(IERC20Ext => uint256) public lockTime;

  /* ========== EVENTS ========== */
  event RewardContractAdded(address indexed rewardContract, bool isAdded);
  event SetSlashingTarget(IERC20Ext indexed token, address target);
  event SetLockTime(IERC20Ext indexed token, uint256 _lockTime);

  /* ========== MODIFIERS ========== */

  modifier onlyRewardsContract(IERC20Ext token) {
    require(rewardContractsPerToken[token].contains(msg.sender), 'onlyRewardcontract');
    _;
  }

  constructor(address _admin) PermissionAdmin(_admin) {}

  /**
   * @notice Add a whitelisted rewards contract
   */
  function addRewardsContract(IERC20Ext token, address _rewardContract) external onlyAdmin {
    require(
      rewardContractsPerToken[token].length() < MAX_REWARD_CONTRACTS_SIZE,
      'rewardContracts is too long'
    );
    require(rewardContractsPerToken[token].add(_rewardContract), '_rewardContract is added');

    emit RewardContractAdded(_rewardContract, true);
  }

  /**
   * @notice Remove a whitelisted rewards contract
   */
  function removeRewardsContract(IERC20Ext token, address _rewardContract) external onlyAdmin {
    require(rewardContractsPerToken[token].remove(_rewardContract), '_rewardContract is removed');

    emit RewardContractAdded(_rewardContract, false);
  }

  function setSlashingTarget(IERC20Ext token, address target) external onlyAdmin {
    slashingTargets[token] = target;

    emit SetSlashingTarget(token, target);
  }

  function setLockTime(IERC20Ext token, uint256 _lockTime) external onlyAdmin {
    lockTime[token] = _lockTime;

    emit SetLockTime(token, _lockTime);
  }

  function lock(
    IERC20Ext token,
    address account,
    uint256 quantity
  ) external override {
    lockWithStartTime(token, account, quantity, _blockTimestamp());
  }

  function lockWithStartTime(
    IERC20Ext token,
    address account,
    uint256 quantity,
    uint256 startTime
  ) public override onlyRewardsContract(token) {
    require(quantity != 0, 'Quantity cannot be zero');

    // transfer token from reward contract to lock contract
    token.safeTransferFrom(msg.sender, address(this), quantity);

    VestingSchedules storage schedules = accountsVestingSchedules[account][token];
    uint256 schedulesLength = schedules.length;

    uint256 endTime = startTime.add(lockTime[token]);

    if (schedulesLength == 0) {
      accountEscrowedBalance[account][token] = quantity;
    } else {
      /* Disallow adding new vested XTK earlier than the last one. */
      require(schedules.data[schedulesLength - 1].endTime < endTime, 'not linear vesting');
      accountEscrowedBalance[account][token] = accountEscrowedBalance[account][token].add(
        quantity
      );
    }
    // append to storage, the schedule data
    schedules.data[schedulesLength] = VestingSchedule({
      startTime: startTime.toUint64(),
      endTime: endTime.toUint64(),
      quantity: quantity.toUint128()
    });
    schedules.length = schedulesLength + 1;

    emit VestingEntryCreated(token, account, _blockTimestamp(), quantity);
  }

  /**
   * @notice Allow a user to withdraw any XTK in their schedule that have vested.
   */
  function vestAll(IERC20Ext token) external returns (uint256) {
    VestingSchedules storage schedules = accountsVestingSchedules[msg.sender][token];
    uint256 schedulesLength = schedules.length;

    uint256 totalVesting = 0;
    uint256 totalSlashing = 0;
    for (uint256 i = 0; i < schedulesLength; i++) {
      VestingSchedule memory schedule = schedules.data[i];
      if (schedule.quantity == 0) {
        continue;
      }
      uint256 vestQuantity = _getVestingQuantity(
        schedule.quantity,
        schedule.startTime,
        schedule.endTime
      );
      totalVesting = totalVesting.add(vestQuantity);
      totalSlashing = totalSlashing.add(schedule.quantity - vestQuantity);
      // clear data after vesting
      schedules.data[i].quantity = 0;
    }
    require(totalVesting != 0, 'invalid vesting amount');
    accountEscrowedBalance[msg.sender][token] = accountEscrowedBalance[msg.sender][token].sub(
      totalVesting.add(totalSlashing)
    );
    accountVestedBalance[msg.sender][token] = accountVestedBalance[msg.sender][token].add(
      totalVesting
    );

    token.safeTransfer(msg.sender, totalVesting);
    if (totalSlashing != 0) _slash(token, totalSlashing);

    emit Vested(token, msg.sender, _blockTimestamp(), totalVesting, totalSlashing);

    return totalVesting;
  }

  function vestAtIndex(IERC20Ext token, uint256[] calldata indexes) external returns (uint256) {
    VestingSchedules storage schedules = accountsVestingSchedules[msg.sender][token];
    uint256 totalVesting = 0;
    uint256 totalSlashing = 0;
    for (uint256 i = 0; i < indexes.length; i++) {
      VestingSchedule memory schedule = schedules.data[indexes[i]];
      if (schedule.quantity == 0) {
        continue;
      }
      uint256 vestQuantity = _getVestingQuantity(
        schedule.quantity,
        schedule.startTime,
        schedule.endTime
      );
      totalVesting = totalVesting.add(vestQuantity);
      totalSlashing = totalSlashing.add(schedule.quantity - vestQuantity);
      // clear data after vesting
      schedules.data[i].quantity = 0;
    }
    require(totalVesting != 0, 'invalid vesting amount');

    accountEscrowedBalance[msg.sender][token] = accountEscrowedBalance[msg.sender][token].sub(
      totalVesting.add(totalSlashing)
    );
    accountVestedBalance[msg.sender][token] = accountVestedBalance[msg.sender][token].add(
      totalVesting
    );

    token.safeTransfer(msg.sender, totalVesting);
    if (totalSlashing != 0) _slash(token, totalSlashing);

    emit Vested(token, msg.sender, _blockTimestamp(), totalVesting, totalSlashing);

    return totalVesting;
  }

  /* ========== VIEW FUNCTIONS ========== */

  /**
   * @notice The number of vesting dates in an account's schedule.
   */
  function numVestingSchedules(address account, IERC20Ext token) external view returns (uint256) {
    return accountsVestingSchedules[account][token].length;
  }

  /**
   * @dev manually get vesting schedule at index
   */
  function getVestingScheduleAtIndex(
    address account,
    IERC20Ext token,
    uint256 index
  )
    external
    view
    returns (
      uint64 startTime,
      uint64 endTime,
      uint128 quantity
    )
  {
    VestingSchedule memory schedule = accountsVestingSchedules[account][token].data[index];
    return (schedule.startTime, schedule.endTime, schedule.quantity);
  }

  /**
   * @dev Get all schedules for an account.
   */
  function getVestingSchedules(address account, IERC20Ext token)
    external
    view
    returns (VestingSchedule[] memory schedules)
  {
    uint256 schedulesLength = accountsVestingSchedules[account][token].length;
    schedules = new VestingSchedule[](schedulesLength);
    for (uint256 i = 0; i < schedulesLength; i++) {
      schedules[i] = accountsVestingSchedules[account][token].data[i];
    }
  }

  function getRewardContractsPerToken(IERC20Ext token)
    external
    view
    returns (address[] memory rewardContracts)
  {
    rewardContracts = new address[](rewardContractsPerToken[token].length());
    for (uint256 i = 0; i < rewardContracts.length; i++) {
      rewardContracts[i] = rewardContractsPerToken[token].at(i);
    }
  }

  /* ========== INTERNAL FUNCTIONS ========== */

  /**
   * @dev if slashingTarget is equals to 0 address, burn the reward else transfer to the target
   */
  function _slash(IERC20Ext token, uint256 amount) internal {
    address target = slashingTargets[token];
    if (target != address(0)) {
      token.safeTransfer(target, amount);
    } else {
      IERC20Burnable(address(token)).burn(amount);
    }
  }

  /**
   * @dev implements slashing mechanism
   * @dev this will allow user to claim token early, but slash the rest of token.
   */
  function _getVestingQuantity(
    uint256 quantity,
    uint256 startTime,
    uint256 endTime
  ) internal view returns (uint256) {
    if (_blockTimestamp() >= endTime) {
      return quantity;
    }
    if (_blockTimestamp() <= startTime) {
      return 0;
    }
    return _blockTimestamp().sub(startTime).mul(quantity).div(endTime - startTime);
  }

  /**
   * @dev wrap timestamp so we can easily mock it
   */
  function _blockTimestamp() internal virtual view returns (uint256) {
    return block.timestamp;
  }
}

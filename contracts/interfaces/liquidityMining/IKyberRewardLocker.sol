// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.7.6;
pragma abicoder v2;

import {IERC20Ext} from '@kyber.network/utils-sc/contracts/IERC20Ext.sol';

interface IKyberRewardLocker {
  struct VestingSchedule {
    uint64 startTime;
    uint64 endTime;
    uint128 quantity;
  }

  event VestingEntryCreated(
    IERC20Ext indexed token,
    address indexed beneficiary,
    uint256 time,
    uint256 value
  );

  event Vested(
    IERC20Ext indexed token,
    address indexed beneficiary,
    uint256 time,
    uint256 vestedQuantity,
    uint256 slashedQuantity
  );

  /**
   * @dev queue a vesting schedule starting from now
   */
  function lock(
    IERC20Ext token,
    address account,
    uint256 amount
  ) external;

  /**
   * @dev queue a vesting schedule
   */
  function lockWithStartTime(
    IERC20Ext token,
    address account,
    uint256 quantity,
    uint256 startTime
  ) external;

  /**
   * @dev for all completed schedule, claim token
   */
  function vestCompletedSchedules(IERC20Ext token) external returns (uint256);

  /**
   * @dev claim token for specific vesting schedule,
   * @dev if schedule has not ended yet, claiming amount is linear with vesting time (the rest are slashing)
   */
  function vestScheduleAtIndex(IERC20Ext token, uint256[] calldata indexes)
    external
    returns (uint256);

  /**
   * @dev length of vesting schedules array
   */
  function numVestingSchedules(address account, IERC20Ext token) external view returns (uint256);

  /**
   * @dev get detailed of each vesting schedule
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
    );

  /**
   * @dev get vesting shedules array
   */
  function getVestingSchedules(address account, IERC20Ext token)
    external
    view
    returns (VestingSchedule[] memory schedules);
}

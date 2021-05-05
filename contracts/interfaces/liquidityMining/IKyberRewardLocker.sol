// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.7.6;
pragma abicoder v2;

import {IERC20Ext} from '@kyber.network/utils-sc/contracts/IERC20Ext.sol';

interface IKyberRewardLocker {
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

  function lock(
    IERC20Ext token,
    address account,
    uint256 amount
  ) external;

  function lockWithStartTime(
    IERC20Ext token,
    address account,
    uint256 quantity,
    uint256 startTime
  ) external;
}

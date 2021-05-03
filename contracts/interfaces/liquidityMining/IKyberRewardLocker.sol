// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.7.6;
pragma abicoder v2;

import {IERC20Ext} from '@kyber.network/utils-sc/contracts/IERC20Ext.sol';


interface IKyberRewardLocker {
  function lock(IERC20Ext token, address account, uint256 amount) external;
}

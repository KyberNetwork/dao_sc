// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.7.6;
pragma abicoder v2;

import {IERC20Ext} from '@kyber.network/utils-sc/contracts/IERC20Ext.sol';
import {SafeERC20} from '@openzeppelin/contracts/token/ERC20/SafeERC20.sol';


contract SimpleMockRewardLocker {
  using SafeERC20 for IERC20Ext;

  mapping (address => mapping (IERC20Ext => uint256)) public lockedAmounts;

  function lock(IERC20Ext token, address account, uint256 amount) external {
    token.safeTransferFrom(msg.sender, address(this), amount);
    lockedAmounts[account][token] += amount;
  }
}

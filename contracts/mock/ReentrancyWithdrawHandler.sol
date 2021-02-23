// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import {IERC20} from '@openzeppelin/contracts/token/ERC20/IERC20.sol';

import {IKyberStaking} from '../interfaces/IKyberStaking.sol';

contract ReentrancyWithdrawHandler {
  IKyberStaking public immutable staking;
  uint256 public totalDeposit;

  constructor(IKyberStaking _staking, IERC20 _knc) {
    staking = _staking;
    require(_knc.approve(address(_staking), 2**255), 'failed to approve');
  }

  function deposit(uint256 amount) public {
    staking.deposit(amount);
    totalDeposit += amount;
  }

  function withdraw(uint256 amount) public {
    totalDeposit -= amount;
    staking.withdraw(amount);
  }

  function handleWithdrawal(address, uint256) public {
    if (totalDeposit > 0) {
      // reentrant one
      uint256 amount = totalDeposit;
      totalDeposit = 0;
      staking.withdraw(amount);
    }
  }
}

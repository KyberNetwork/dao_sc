// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.7.6;

import {IERC20Ext} from '@kyber.network/utils-sc/contracts/IERC20Ext.sol';
import {LiquidationStrategyBase} from '../treasury/LiquidationStrategyBase.sol';
import {
  ILiquidationPriceOracleBase
} from '../interfaces/liquidation/ILiquidationPriceOracleBase.sol';

contract MockLiquidationStrategy is LiquidationStrategyBase {
  constructor(
    address admin,
    address treasuryPoolAddress,
    address payable rewardPoolAddress,
    uint128 startTime,
    uint64 repeatedPeriod,
    uint64 duration,
    address[] memory whitelistedLiquidators,
    address[] memory whitelistedOracles
  )
    LiquidationStrategyBase(
      admin,
      treasuryPoolAddress,
      rewardPoolAddress,
      startTime,
      repeatedPeriod,
      duration,
      whitelistedLiquidators,
      whitelistedOracles
    )
  {}
}

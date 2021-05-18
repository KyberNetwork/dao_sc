// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.7.6;

import '../../interfaces/dmm/IDMMRouter02.sol';
import {SafeERC20} from '@openzeppelin/contracts/token/ERC20/SafeERC20.sol';
import '../priceOracle/PriceOracleLiquidationStrategy.sol';

/// Liquidation strategy that breaks down LP tokens (removing liquidity)
/// Liquidator will receive a premimum for every transaction that they liquidate tokens in the treasury pool
contract DMMLiquidationStrategy is PriceOracleLiquidationStrategy {
  using SafeERC20 for IERC20Ext;

  IDMMRouter02 public immutable dmmRouter;

  constructor(
    address admin,
    address treasuryPool,
    address payable rewardPool,
    uint128 startTime,
    uint64 repeatedPeriod,
    uint64 duration,
    address oracle,
    uint256 premiumBps,
    address[] memory whitelistedTokens,
    IDMMRouter02 _dmmRouter
  )
    PriceOracleLiquidationStrategy(
      admin,
      treasuryPool,
      rewardPool,
      startTime,
      repeatedPeriod,
      duration,
      oracle,
      premiumBps,
      whitelistedTokens
    )
  {
    dmmRouter = _dmmRouter;
  }

  function setTokenApprovalsOnRouter(IERC20Ext[] calldata tokens, bool giveAllowance)
    external
    onlyAdmin
  {
    uint256 amount = giveAllowance ? type(uint256).max : 0;
    for (uint256 i; i < tokens.length; i++) {
      tokens[i].safeApprove(address(dmmRouter), amount);
    }
  }

  /**
   * @dev Call to break down DMM LP tokens
   * @notice LP token approval should have been given to dmmRouter
   */
  function removeLiquidity(
    IERC20[] calldata tokensA,
    IERC20[] calldata tokensB,
    IERC20Ext[] calldata poolTokens,
    uint256[] calldata amounts,
    uint256[] calldata amountsAMin,
    uint256[] calldata amountsBMin
  ) external {
    // check whitelisted liquidator if needed
    if (isWhitelistLiquidatorEnabled()) {
      require(isWhitelistedLiquidator(msg.sender), 'only whitelisted liquidator');
    }

    // check that array lengths are the same
    require(poolTokens.length == tokensA.length, 'bad input length');
    require(poolTokens.length == tokensB.length, 'bad input length');
    require(poolTokens.length == amounts.length, 'bad input length');
    require(poolTokens.length == amountsAMin.length, 'bad input length');
    require(poolTokens.length == amountsBMin.length, 'bad input length');

    // forward LP tokens from treasury pool to this contract
    IPool(treasuryPool()).withdrawFunds(poolTokens, amounts, address(this));

    // dmm router will verify pool and token addresses
    // liquified LP tokens are sent back to treasury pool
    for (uint256 i; i < poolTokens.length; i++) {
      dmmRouter.removeLiquidity(
        tokensA[i],
        tokensB[i],
        address(poolTokens[i]),
        amounts[i],
        amountsAMin[i],
        amountsBMin[i],
        treasuryPool(),
        block.timestamp + 3600 // arbitary deadline
      );
    }
  }
}

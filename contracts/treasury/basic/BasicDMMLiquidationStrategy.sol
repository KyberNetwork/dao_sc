// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.7.6;

import {IDMMRouter02} from '../../interfaces/swaps/IDMM.sol';
import '../LiquidationStrategy.sol';
import {IERC20Ext} from '@kyber.network/utils-sc/contracts/IERC20Ext.sol';
import {IERC20} from '@openzeppelin/contracts/token/ERC20/IERC20.sol';

/// Liquidation strategy that breaks down LP tokens (removing liquidity)
/// then exchange to a few whitelisted tokens
/// Liquidator will receive a premimum for every transaction that they liquidate tokens in the treasury pool
contract BasicLiquidationStrategy is LiquidationStrategy {
  using SafeERC20 for IERC20Ext;
  using SafeMath for uint256;

  IDMMRouter02 public immutable dmmRouter;
  address public swapper;

  event SwapperUpdated(address indexed swapper);

  constructor(
    address admin,
    address treasuryPool,
    address payable rewardPool,
    uint128 startTime,
    uint64 repeatedPeriod,
    uint64 duration,
    address[] memory whitelistedTokens,
    IDMMRouter02 _dmmRouter,
    address _swapper
  )
    LiquidationStrategy(
      admin,
      treasuryPool,
      rewardPool,
      startTime,
      repeatedPeriod,
      duration,
      whitelistedTokens
    )
  {
    dmmRouter = _dmmRouter;
    swapper = _swapper;
  }

  function updateSwapper(address _swapper) external onlyAdmin {
    _updateSwapper(_swapper);
  }

  function setTokenApprovals(
    address spender,
    IERC20Ext[] calldata tokens,
    bool giveAllowance
  ) external onlyAdmin {
    require(spender == swapper || spender == address(dmmRouter), 'bad spender address');
    uint256 amount = giveAllowance ? type(uint256).max : 0;
    for (uint256 i; i < tokens.length; i++) {
      tokens[i].safeApprove(spender, amount);
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
    require(isLiquidationEnabled(), 'only when liquidation enabled');
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
    // liquified LP tokens are sent to this contract
    for (uint256 i; i < poolTokens.length; i++) {
      dmmRouter.removeLiquidity(
      tokensA[i],
      tokensB[i],
      address(poolTokens[i]),
      amounts[i],
      amountsAMin[i],
      amountsBMin[i],
      address(this),
      block.timestamp + 3600 // arbitary deadline
      );
    }
  }

  /**
   * @dev Call to liquidate amount tokens to dest token
   * @dev Relies on swapper to handle liquidations
   * @param sources source tokens to liquidate
   * @param amounts source token amounts to liquidate
   * @param dest dest token to be received
   * @return destAmount dest token amounts to be received
   */
  function liquidate(
    IERC20Ext[] calldata sources,
    uint256[] calldata amounts,
    IERC20Ext dest,
    uint256 minReturn,
    bytes calldata txData
  ) external returns (uint256 destAmount) {
    require(isLiquidationEnabled(), 'only when liquidation enabled');
    // Check whitelist tokens
    require(
      isWhitelistedToken(address(dest)),
      'only liquidate to whitelisted tokens'
    );
    for(uint256 i; i < sources.length; i++) {
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
    // request funds from this contract to swapper
    for(uint256 i; i < sources.length; i++) {
      _transferToken(sources[i], payable(swapper), amounts[i]);
    }
    uint256 balanceDestBefore = getBalance(dest, address(this));
    // callback for them to transfer dest amount to reward
    ILiquidationCallback(swapper).liquidationCallback(
      msg.sender, sources, amounts, payable(address(this)), dest, txData
    );
    destAmount = getBalance(dest, address(this)).sub(balanceDestBefore);
    require(destAmount >= minReturn, 'insufficient dest amount');
    _transferToken(dest, payable(rewardPool()), destAmount);
  }

  function _updateSwapper(address _swapper) internal {
    swapper = _swapper;
    emit SwapperUpdated(swapper);
  }
}

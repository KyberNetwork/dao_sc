// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.7.6;

import {IDMMPool} from '../../interfaces/liquidation/thirdParty/IDMMPool.sol';
import {IDMMExchangeRouter} from '../../interfaces/liquidation/thirdParty/IDMMExchangeRouter.sol';
import {PermissionOperators} from '@kyber.network/utils-sc/contracts/PermissionOperators.sol';
import {Withdrawable} from '@kyber.network/utils-sc/contracts/Withdrawable.sol';
import {Utils} from '@kyber.network/utils-sc/contracts/Utils.sol';
import {IERC20Ext} from '@kyber.network/utils-sc/contracts/IERC20Ext.sol';
import {SafeMath} from '@openzeppelin/contracts/math/SafeMath.sol';
import {SafeERC20} from '@openzeppelin/contracts/token/ERC20/SafeERC20.sol';

/**
 * @dev Contract to help Liquidate Fee from KyberDAO multisig wallet
 */
contract LiquidateFeeWithKyberDMM is PermissionOperators, Withdrawable, Utils {
  using SafeMath for uint256;
  using SafeERC20 for IERC20Ext;

  /// KyberDMM router
  IDMMExchangeRouter public immutable dmmRouter;
  /// address to receive token after liquidation
  address public immutable recipient;

  mapping (address => mapping (address => IERC20Ext[])) internal tokenPath;
  mapping (address => mapping (address => address[])) internal poolPath;

  event LiquidateWithKyberDMM(
    address indexed caller,
    IERC20Ext[] sources,
    uint256[] amounts,
    IERC20Ext dest,
    uint256 minDestAmount,
    uint256 actualDestAmount
  );

  constructor(
    address admin,
    address _recipient,
    IDMMExchangeRouter _router
  ) Withdrawable(admin) {
    recipient = _recipient;
    dmmRouter = _router;
  }

  receive() external payable {}

  function manualApproveAllowances(IERC20Ext[] calldata tokens, bool isReset)
    external onlyOperator
  {
    for(uint256 i = 0; i < tokens.length; i++) {
      _safeApproveAllowance(
        tokens[i],
        address(dmmRouter),
        isReset ? 0 : type(uint256).max
      );
    }
  }

  /**
   * @dev Set token and pool path from src to dest token
   */
  function setTradePath(
    address src,
    address dest,
    IERC20Ext[] calldata _tokenPath,
    address[] calldata _poolPath
  ) external onlyOperator {
    require(_tokenPath.length == _poolPath.length + 1, 'invalid lengths');
    require(src == address(_tokenPath[0]), 'invalid src value');
    require(dest == address(_tokenPath[_tokenPath.length - 1]), 'invalid dest token');
    tokenPath[src][dest] = _tokenPath;
    poolPath[src][dest] = _poolPath;
  }

  /**
   * @dev Anyone can call this function to liquidate LP/normal tokens to a dest token
   *  To save gas, should specify the list of final tokens to swap to dest token
   *  Pass list of tradeTokens + corresponding balances before the liquidation happens
   *    as txData, will be used to get the received amount of each token to swap
   * @param source address to collect LP tokens from
   * @param lpTokens list of source tokens
   * @param amounts amount of each source token
   * @param dest dest token to swap to
   * @param tradeTokens list of final tokens to swap to dest token after removing liquidities
   * @param minReturn minimum amount of destToken to be received
   */
  function liquidate(
    address source,
    IERC20Ext[] calldata lpTokens,
    uint256[] calldata amounts,
    IERC20Ext dest,
    IERC20Ext[] calldata tradeTokens,
    uint256 minReturn
  ) external onlyOperator {
    require(lpTokens.length == amounts.length, 'invalid lengths');

    uint256 destBalanceBefore = dest.balanceOf(address(this));
    _removeLiquidity(source, lpTokens, amounts);

    uint256 totalReturn = _swapWithKyberDMM(tradeTokens, destBalanceBefore, dest);

    require(totalReturn >= minReturn, 'totalReturn < minReturn');
    dest.safeTransfer(recipient, totalReturn);

    emit LiquidateWithKyberDMM(
      tx.origin,
      lpTokens,
      amounts,
      dest,
      minReturn,
      totalReturn
    );
  }

  /**
   * @dev Take a list of lpTokens and remove all liquidity
   */
  function _removeLiquidity(
    address source,
    IERC20Ext[] memory lpTokens,
    uint256[] memory amounts
  )
    internal
  {
    for(uint256 i = 0; i < lpTokens.length; i++) {
      lpTokens[i].safeTransferFrom(source, address(lpTokens[i]), amounts[i]);
      IDMMPool(address(lpTokens[i])).burn(address(this));
    }
  }

  /**
   * @dev Simple swap with KyberDMM
   */
  function _swapWithKyberDMM(
    IERC20Ext[] memory tradeTokens,
    uint256 destTokenBefore,
    IERC20Ext dest
  )
    internal returns (uint256 totalReturn)
  {
    for(uint256 i = 0; i < tradeTokens.length; i++) {
      if (tradeTokens[i] == dest) continue;
      uint256 amount = getBalance(tradeTokens[i], address(this));
      if (amount == 0) continue;
      _safeApproveAllowance(tradeTokens[i], address(dmmRouter), type(uint256).max);
      uint256[] memory amounts = dmmRouter.swapExactTokensForTokens(
        amount,
        1,
        poolPath[address(tradeTokens[i])][address(dest)],
        tokenPath[address(tradeTokens[i])][address(dest)],
        address(this),
        block.timestamp + 1000
      );
      require(amounts[amounts.length - 1] > 0, '0 amount out');
    }
    totalReturn = getBalance(dest, address(this)).sub(destTokenBefore);
  }

  function getTradePath(address src, address dest)
    external view
    returns (IERC20Ext[] memory _tokenPath, address[] memory _poolPath) {
    _tokenPath = tokenPath[src][dest];
    _poolPath = poolPath[src][dest];
  }

  /**
   * @dev Estimate amount out from list of lp tokens
   * @notice It is just for references, since a pool can be traded multiple times
   */
  function estimateReturns(
    address[] calldata lpTokens,
    uint256[] calldata amountIns,
    address dest
  ) external view returns (uint256 amountOut) {
    require(lpTokens.length == amountIns.length, 'invalid lengths');
    uint256[] memory amountsOut;
    for (uint256 i = 0; i < lpTokens.length; i++) {
      (IERC20Ext[2] memory tokens, uint256[2] memory amounts) =
        _getExpectedTokensFromLp(lpTokens[i], amountIns[i]);
      
      for (uint256 j = 0; j <= 1; j++) {
        if (tokens[j] == IERC20Ext(dest)) {
          amountOut += amounts[j];
          continue;
        }
        amountsOut = dmmRouter.getAmountsOut(
          amounts[j],
          poolPath[address(tokens[j])][dest],
          tokenPath[address(tokens[j])][dest]
        );
        amountOut += amountsOut[amountsOut.length - 1];
      }
    }
  }

  // call approve only if amount is 0 or the current allowance is 0, only for tokens
  function _safeApproveAllowance(IERC20Ext token, address spender, uint256 amount) internal {
    if (amount == 0 || token.allowance(address(this), spender) == 0) {
      token.safeApprove(spender, amount);
    }
  }

  function _getExpectedTokensFromLp(
    address pool,
    uint256 lpAmount
  )
    public view
    returns (
      IERC20Ext[2] memory tokens,
      uint256[2] memory amounts
    )
  {
    uint256 totalSupply = IERC20Ext(pool).totalSupply();
    (tokens[0], tokens[1]) = (IDMMPool(pool).token0(), IDMMPool(pool).token1());
    uint256 amount0;
    uint256 amount1;
    (
      amount0,
      amount1,
      , // virtual balance 0
      , // virtual balance 1
      // fee in precision
    ) = IDMMPool(pool).getTradeInfo();

    (amounts[0], amounts[1]) = (
      amount0.mul(lpAmount) / totalSupply,
      amount1.mul(lpAmount) / totalSupply
    );
  }
}

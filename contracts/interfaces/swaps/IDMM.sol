// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.7.6;

import {IERC20} from '@openzeppelin/contracts/token/ERC20/IERC20.sol';

interface IDMMStruct {
  struct Swap {
    uint256 amountOutMin;
    address[] poolsPath;
    IERC20[] path;
    uint256 deadline;
  }
}

interface IDMMRouter02 {
  function removeLiquidity(
    IERC20 tokenA,
    IERC20 tokenB,
    address pool,
    uint256 liquidity,
    uint256 amountAMin,
    uint256 amountBMin,
    address to,
    uint256 deadline
  ) external returns (uint256 amountA, uint256 amountB);

  function swapExactTokensForTokensSupportingFeeOnTransferTokens(
    uint256 amountIn,
    uint256 amountOutMin,
    address[] calldata poolsPath,
    IERC20[] calldata path,
    address to,
    uint256 deadline
  ) external;
}

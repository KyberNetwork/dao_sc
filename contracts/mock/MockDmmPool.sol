// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import {IERC20Ext} from '@kyber.network/utils-sc/contracts/IERC20Ext.sol';

interface IDmmRouter {
  function swapExactETHForTokens(
      uint256 amountOutMin,
      address[] calldata poolsPath,
      IERC20Ext[] calldata path,
      address to,
      uint256 deadline
  ) external payable returns (uint256[] memory amounts);

  function addLiquidityETH(
    IERC20Ext token,
    address pool,
    uint256 amountTokenDesired,
    uint256 amountTokenMin,
    uint256 amountETHMin,
    uint256[2] calldata vReserveRatioBounds,
    address to,
    uint256 deadline
  )
    external payable
    returns (
      uint256 amountToken,
      uint256 amountETH,
      uint256 liquidity
    );

  function addLiquidity(
    IERC20Ext tokenA,
    IERC20Ext tokenB,
    address pool,
    uint256 amountADesired,
    uint256 amountBDesired,
    uint256 amountAMin,
    uint256 amountBMin,
    uint256[2] calldata vReserveRatioBounds,
    address to,
    uint256 deadline
  )
    external
    returns (
      uint256 amountA,
      uint256 amountB,
      uint256 liquidity
    );
}

contract MockDmmPool {

  IERC20Ext public token0;
  IERC20Ext public token1;
  uint112 internal _reserve0;
  uint112 internal _reserve1;
  uint256 public totalSupply;

  mapping (address => uint256) public balanceOf;

  constructor() {}

  function setData(
    IERC20Ext _t0, IERC20Ext _t1,
    uint112 _r0, uint112 _r1, uint256 _totalSupply
  ) external {
    token0 = _t0;
    token1 = _t1;
    _reserve0 = _r0;
    _reserve1 = _r1;
    totalSupply = _totalSupply;
  }

  function getReserves() external view returns (uint112 reserve0, uint112 reserve1)
  {
    (reserve0, reserve1) = (_reserve0, _reserve1);
  }
}

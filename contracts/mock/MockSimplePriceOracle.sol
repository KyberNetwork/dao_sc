// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.7.6;


import {IERC20Ext} from '@kyber.network/utils-sc/contracts/IERC20Ext.sol';


contract MockSimplePriceOracle {

  uint256 amountOut;

  constructor() {}

  function setAmountOut(uint256 _amountOut) external {
    amountOut = _amountOut;
  }

  function getExpectedReturn(
    address, // liquidator,
    IERC20Ext[] calldata,// tokenIns,
    uint256[] calldata,// amountIns,
    IERC20Ext,// tokenOuts,
    bytes calldata// hint
  )
    external view returns (uint256 minAmountOut)
  {
    minAmountOut = amountOut;
  }
}

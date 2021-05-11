// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.7.6;

import {IERC20} from '@openzeppelin/contracts/token/ERC20/IERC20.sol';

interface IOneSplit {
  function swap(
    IERC20 fromToken,
    IERC20 destToken,
    uint256 amount,
    uint256 minReturn,
    uint256[] memory distribution,
    uint256 flags
  ) external payable returns (uint256 returnAmount);

  function getExpectedReturn(
    IERC20 fromToken,
    IERC20 destToken,
    uint256 amount,
    uint256 parts,
    uint256 flags // See constants in IOneSplit.sol
  ) external view returns (uint256 returnAmount, uint256[] memory distribution);

  function getExpectedReturnWithGas(
    IERC20 fromToken,
    IERC20 destToken,
    uint256 amount,
    uint256 parts,
    uint256 flags, // See constants in IOneSplit.sol
    uint256 destTokenEthPriceTimesGasPrice
  )
    external
    view
    returns (
      uint256 returnAmount,
      uint256 estimateGasAmount,
      uint256[] memory distribution
    );
}

interface IOneSplitMulti is IOneSplit {
  struct Swap {
    IERC20[] tokens;
    uint256 minReturn;
    uint256[] distribution;
    uint256[] flags;
  }

  function swapMulti(
    IERC20[] memory tokens,
    uint256 amount,
    uint256 minReturn,
    uint256[] memory distribution,
    uint256[] memory flags
  ) external payable returns (uint256 returnAmount);

  function getExpectedReturnWithGasMulti(
    IERC20[] memory tokens,
    uint256 amount,
    uint256[] memory parts,
    uint256[] memory flags,
    uint256[] memory destTokenEthPriceTimesGasPrices
  )
    external
    view
    returns (
      uint256[] memory returnAmounts,
      uint256 estimateGasAmount,
      uint256[] memory distribution
    );
}

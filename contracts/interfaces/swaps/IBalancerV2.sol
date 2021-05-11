// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.7.6;
pragma abicoder v2;

interface IAsset {
  // solhint-disable-previous-line no-empty-blocks
}

interface IBalancerV2 {
  enum SwapKind {GIVEN_IN, GIVEN_OUT}

  struct Swap {
    SwapKind kind;
    BatchSwapStep[] swaps;
    IAsset[] assets;
    FundManagement funds;
    int256[] limits;
    uint256 deadline;
  }

  struct BatchSwapStep {
    bytes32 poolId;
    uint256 assetInIndex;
    uint256 assetOutIndex;
    uint256 amount;
    bytes userData;
  }

  struct FundManagement {
    address sender;
    bool fromInternalBalance;
    address payable recipient;
    bool toInternalBalance;
  }

  function batchSwap(
    SwapKind kind,
    BatchSwapStep[] memory swaps,
    IAsset[] memory assets,
    FundManagement memory funds,
    int256[] memory limits,
    uint256 deadline
  ) external payable returns (int256[] memory assetDeltas);
}

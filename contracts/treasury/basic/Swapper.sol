// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.7.6;
pragma abicoder v2;

import {ILiquidationCallback} from '../../interfaces/liquidation/ILiquidationCallback.sol';
import '@uniswap/v3-core/contracts/interfaces/callback/IUniswapV3SwapCallback.sol';
import {IBalancerV2} from '../../interfaces/swaps/IBalancerV2.sol';
import {IDMMStruct, IDMMRouter02} from '../../interfaces/swaps/IDMM.sol';
import {IOneSplitMulti} from '../../interfaces/swaps/IOneSplit.sol';
import {IERC20Ext} from '@kyber.network/utils-sc/contracts/IERC20Ext.sol';
import {SafeERC20} from '@openzeppelin/contracts/token/ERC20/SafeERC20.sol';
import {PermissionAdmin} from '@kyber.network/utils-sc/contracts/PermissionAdmin.sol';

contract Swapper is ILiquidationCallback, PermissionAdmin {
  using SafeERC20 for IERC20Ext;
  enum SwapperType {DMM, OneInch, BalV2, UniV3}

  IERC20Ext public constant ETH_TOKEN_ADDRESS = IERC20Ext(
    0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE
  );
  address public immutable liqStrat;
  IDMMRouter02 public dmmRouter;
  IOneSplitMulti public oneInchRouter;
  IBalancerV2 public balancerV2Router;

  constructor(
    address _liqStrat,
    IDMMRouter02 _dmmRouter,
    IOneSplitMulti _oneInchRouter,
    IBalancerV2 _balancerV2Router
  ) PermissionAdmin(msg.sender) {
    liqStrat = _liqStrat;
    dmmRouter = _dmmRouter;
    oneInchRouter = _oneInchRouter;
    balancerV2Router = _balancerV2Router;
  }

  function setTokenApprovals(
    address spender,
    IERC20Ext[] calldata tokens,
    bool giveAllowance
  ) external onlyAdmin {
    require(
      spender == address(dmmRouter) ||
        spender == address(oneInchRouter) ||
        spender == address(balancerV2Router),
      'bad spender address'
    );
    uint256 amount = giveAllowance ? type(uint256).max : 0;
    for (uint256 i; i < tokens.length; i++) {
      tokens[i].safeApprove(spender, amount);
    }
  }

  function liquidationCallback(
    address, /* caller */
    IERC20Ext[] calldata, /* sources */
    uint256[] calldata amounts,
    address payable recipient,
    IERC20Ext dest,
    bytes calldata txData
  ) external override {
    require(msg.sender == liqStrat, 'not authorized');
    SwapperType[] memory swapTypes;
    bytes memory accumulatedSwapsData;
    (swapTypes, accumulatedSwapsData) = abi.decode(txData, (SwapperType[], bytes));
    for (uint256 i; i < swapTypes.length; i++) {
      if (swapTypes[i] == SwapperType.DMM) {
        IDMMStruct.Swap memory currentSwapData;
        (currentSwapData, accumulatedSwapsData) = abi.decode(
          accumulatedSwapsData,
          (IDMMStruct.Swap, bytes)
        );
        dmmRouter.swapExactTokensForTokensSupportingFeeOnTransferTokens(
          amounts[i],
          currentSwapData.amountOutMin,
          currentSwapData.poolsPath,
          currentSwapData.path,
          recipient,
          currentSwapData.deadline
        );
      } else if (swapTypes[i] == SwapperType.OneInch) {
        IOneSplitMulti.Swap memory currentSwapData;
        (currentSwapData, accumulatedSwapsData) = abi.decode(
          accumulatedSwapsData,
          (IOneSplitMulti.Swap, bytes)
        );
        uint256 returnAmount = oneInchRouter.swapMulti(
          currentSwapData.tokens,
          amounts[i],
          currentSwapData.minReturn,
          currentSwapData.distribution,
          currentSwapData.flags
        );
        _transferToken(dest, payable(recipient), returnAmount);
      } else if (swapTypes[i] == SwapperType.BalV2) {
        IBalancerV2.Swap memory currentSwapData;
        (currentSwapData, accumulatedSwapsData) = abi.decode(
          accumulatedSwapsData,
          (IBalancerV2.Swap, bytes)
        );
        currentSwapData.funds.recipient = recipient;
        currentSwapData.swaps[0].amount = amounts[i];
        balancerV2Router.batchSwap(
          currentSwapData.kind,
          currentSwapData.swaps,
          currentSwapData.assets,
          currentSwapData.funds,
          currentSwapData.limits,
          currentSwapData.deadline
        );
      } else if (swapTypes[i] == SwapperType.UniV3) {} else {
        revert('bad swap type');
      }
    }
  }

  function encodeDMMSwap(IDMMStruct.Swap calldata _swapData, bytes calldata _accumulatedSwapsData)
    external
    view
    returns (bytes memory)
  {
    (SwapperType[] memory swapTypes, bytes memory accumulatedSwapsData) = abi.decode(
      _accumulatedSwapsData,
      (SwapperType[], bytes)
    );
    swapTypes = extendSwapperArray(swapTypes, SwapperType.DMM);
    bytes memory encodedSwapData = abi.encode(accumulatedSwapsData, _swapData);
    return abi.encode(swapTypes, encodedSwapData);
  }

  function encodeOneInchSwap(
    IOneSplitMulti.Swap calldata _swapData,
    bytes calldata _accumulatedSwapsData
  ) external view returns (bytes memory) {
    (SwapperType[] memory swapTypes, bytes memory accumulatedSwapsData) = abi.decode(
      _accumulatedSwapsData,
      (SwapperType[], bytes)
    );
    swapTypes = extendSwapperArray(swapTypes, SwapperType.OneInch);
    bytes memory encodedSwapData = abi.encode(accumulatedSwapsData, _swapData);
    return abi.encode(swapTypes, encodedSwapData);
  }

  function encodeBalancerV2Swap(
    IBalancerV2.Swap calldata _swapData,
    bytes calldata _accumulatedSwapsData
  ) external view returns (bytes memory) {
    (SwapperType[] memory swapTypes, bytes memory accumulatedSwapsData) = abi.decode(
      _accumulatedSwapsData,
      (SwapperType[], bytes)
    );
    swapTypes = extendSwapperArray(swapTypes, SwapperType.BalV2);
    bytes memory encodedSwapData = abi.encode(accumulatedSwapsData, _swapData);
    return abi.encode(swapTypes, encodedSwapData);
  }

  function _transferToken(
    IERC20Ext token,
    address payable recipient,
    uint256 amount
  ) internal {
    if (token == ETH_TOKEN_ADDRESS) {
      (bool success, ) = recipient.call{value: amount}('');
      require(success, 'transfer eth failed');
    } else {
      token.safeTransfer(recipient, amount);
    }
  }

  function extendSwapperArray(SwapperType[] memory swapTypes, SwapperType element)
    internal
    pure
    returns (SwapperType[] memory newSwapTypes)
  {
    newSwapTypes = new SwapperType[](swapTypes.length + 1);
    for (uint256 i; i < swapTypes.length; i++) {
      newSwapTypes[i] = swapTypes[i];
    }
    newSwapTypes[swapTypes.length] = element;
    return newSwapTypes;
  }
}

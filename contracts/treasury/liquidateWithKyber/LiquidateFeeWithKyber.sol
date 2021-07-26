// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.7.6;

import {ILiquidationCallback} from '../../interfaces/liquidation/ILiquidationCallback.sol';
import {IDMMPool} from '../../interfaces/liquidation/thirdParty/IDMMPool.sol';
import {ILiquidationStrategyBase, ILiquidationPriceOracleBase} from '../../interfaces/liquidation/ILiquidationStrategyBase.sol';
import {PermissionAdmin, PermissionOperators} from '@kyber.network/utils-sc/contracts/PermissionOperators.sol';
import {Utils} from '@kyber.network/utils-sc/contracts/Utils.sol';
import {IERC20Ext} from '@kyber.network/utils-sc/contracts/IERC20Ext.sol';
import {SafeMath} from '@openzeppelin/contracts/math/SafeMath.sol';
import {SafeERC20} from '@openzeppelin/contracts/token/ERC20/SafeERC20.sol';


interface IKyberNetworkProxy {
  function tradeWithHint(
      IERC20Ext src,
      uint256 srcAmount,
      IERC20Ext dest,
      address payable destAddress,
      uint256 maxDestAmount,
      uint256 minConversionRate,
      address payable walletId,
      bytes calldata hint
  ) external payable returns (uint256);
}

interface IWeth is IERC20Ext {
  function deposit() external payable;
  function withdraw(uint256) external;
}


contract LiquidateFeeWithKyber is ILiquidationCallback, PermissionOperators, Utils {
  using SafeMath for uint256;
  using SafeERC20 for IERC20Ext;

  // LIQUIDATE_LP: liquidate list of LP tokens to a single token
  // LIQUIDATE_TOKENS: liquidate list of tokens to a single token
  enum LiquidationType { LIQUIDATE_LP, LIQUIDATE_TOKENS }

  address public immutable weth;

  ILiquidationStrategyBase public liquidationStrategy;
  ILiquidationPriceOracleBase public priceOracle;
  IKyberNetworkProxy public kyberProxy;

  event LiquidatedWithKyber(
    address indexed caller,
    IERC20Ext[] sources,
    uint256[] amounts,
    IERC20Ext dest,
    uint256 minDestAmount,
    uint256 actualDestAmount
  );

  constructor(
    address admin,
    address wethAddress,
    ILiquidationStrategyBase strategy,
    ILiquidationPriceOracleBase oracle,
    IKyberNetworkProxy proxy
  ) PermissionAdmin(admin) {
    // no validation for addresses here, since it seems to be redundant
    weth = wethAddress;
    _setLiquidationStrategy(strategy);
    _setPriceOracle(oracle);
    _setKyberNetworkProxy(proxy);
  }

  receive() external payable {}

  function updateContracts(
    ILiquidationStrategyBase _strategy,
    ILiquidationPriceOracleBase _oracle,
    IKyberNetworkProxy _proxy
  ) external onlyAdmin {
    _setLiquidationStrategy(_strategy);
    _setPriceOracle(_oracle);
    _setKyberNetworkProxy(_proxy);
  }

  function manualApproveAllowancesToKyberProxy(IERC20Ext[] calldata tokens, bool isReset)
    external onlyOperator
  {
    for(uint256 i = 0; i < tokens.length; i++) {
      _safeApproveAllowance(
        tokens[i],
        address(kyberProxy),
        isReset ? 0 : type(uint256).max
      );
    }
  }

  /**
   * @dev Anyone can call this function to liquidate LP/normal tokens to a dest token
   *  To save gas, should specify the list of final tokens to swap to dest token
   *  Pass list of tradeTokens + corresponding balances before the liquidation happens
   *    as txData, will be used to get the received amount of each token to swap
   * @param tokens list of source tokens
   * @param amounts amount of each source token
   * @param types type of each token, either LP or normal token
   * @param dest dest token to swap to
   * @param tradeTokens list of final tokens to swap to dest token after removing liquidities
   */
  function liquidate(
    IERC20Ext[] calldata tokens,
    uint256[] calldata amounts,
    LiquidationType[] calldata types,
    IERC20Ext dest,
    IERC20Ext[] calldata tradeTokens
  ) external {
    require(
      tokens.length == amounts.length && amounts.length == types.length,
      'invalid lengths'
    );
    // add one extra element for balance of dest token before liquidate call
    uint256[] memory balances = new uint256[](tradeTokens.length + 1);
    for(uint256 i = 0; i < tradeTokens.length; i++) {
      balances[i] = getBalance(tradeTokens[i], address(this));
    }
    balances[tradeTokens.length] = getBalance(dest, address(this));
    bytes memory oracleHint = abi.encode(types);
    bytes memory txData = abi.encode(types, tradeTokens, balances);
    liquidationStrategy.liquidate(
      priceOracle,
      tokens,
      amounts,
      payable(address(this)),
      dest,
      oracleHint,
      txData
    );
  }

  /**
   * @dev Only accept the callback from the liquidationStrategy
   *    remove all liquidity if needed, then swap all tradeTokens to dest token
   */
  function liquidationCallback(
    address caller,
    IERC20Ext[] calldata sources,
    uint256[] calldata amounts,
    address payable recipient,
    IERC20Ext dest,
    uint256 minReturn,
    bytes calldata txData
  ) external override {
    require(msg.sender == address(liquidationStrategy), 'sender != liquidationStrategy');
    require(caller == address(this), 'caller != this address');
    (
      LiquidationType[] memory types,
      IERC20Ext[] memory tradeTokens,
      uint256[] memory balancesBefore
    ) = abi.decode(txData, (LiquidationType[], IERC20Ext[], uint256[]));

    _removeLiquidity(sources, amounts, types);
    uint256 totalReturn = _swapWithKyber(tradeTokens, balancesBefore, dest);

    require(totalReturn >= minReturn, 'totalReturn < minReturn');
    if (dest == ETH_TOKEN_ADDRESS) {
      (bool success, ) = recipient.call{ value: minReturn }('');
      require(success, 'transfer eth failed');
    } else {
      dest.safeTransfer(recipient, minReturn);
    }

    emit LiquidatedWithKyber(
      tx.origin,
      sources,
      amounts,
      dest,
      minReturn,
      totalReturn
    );
  }

  function _removeLiquidity(
    IERC20Ext[] memory sources,
    uint256[] memory amounts,
    LiquidationType[] memory types
  )
    internal
  {
    for(uint256 i = 0; i < sources.length; i++) {
      if (types[i] == LiquidationType.LIQUIDATE_LP) {
        // burn LP token to get back 2 underlying tokens
        sources[i].safeTransfer(address(sources[i]), amounts[i]);
        IDMMPool(address(sources[i])).burn(address(this));
      }
    }
  }

  function _swapWithKyber(
    IERC20Ext[] memory tradeTokens,
    uint256[] memory balancesBefore,
    IERC20Ext dest
  )
    internal returns (uint256 totalReturn)
  {
    // last element is the balance of dest token before calling liquidate function
    uint256 destTokenBefore = balancesBefore[balancesBefore.length - 1];
    for(uint256 i = 0; i < tradeTokens.length; i++) {
      if (tradeTokens[i] == dest) continue;
      uint256 amount = getBalance(tradeTokens[i], address(this)).sub(balancesBefore[i]);
      if (amount == 0) continue;
      bool isSrcEth = tradeTokens[i] == ETH_TOKEN_ADDRESS;
      if (address(tradeTokens[i]) == weth) {
        // special case, convert weth -> eth and do the swap to save gas
        // note: user can put both eth and weth as trade tokens, contract will make
        // 2 swap calls separately
        IWeth(weth).withdraw(amount);
        // no need to swap
        if (dest == ETH_TOKEN_ADDRESS) continue;
        isSrcEth = true;
      }
      if (!isSrcEth) {
        // approve allowance if needed
        _safeApproveAllowance(tradeTokens[i], address(kyberProxy), type(uint256).max);
      }
      kyberProxy.tradeWithHint{value: isSrcEth ? amount : 0}(
        isSrcEth ? ETH_TOKEN_ADDRESS : tradeTokens[i],
        amount,
        dest,
        address(this),
        type(uint256).max,
        0,
        address(0),
        ''
      );
    }
    totalReturn = getBalance(dest, address(this)).sub(destTokenBefore);
  }

  // call approve only if amount is 0 or the current allowance is 0, only for tokens
  function _safeApproveAllowance(IERC20Ext token, address spender, uint256 amount) internal {
    if (amount == 0 || token.allowance(address(this), spender) == 0) {
      token.safeApprove(spender, amount);
    }
  }

  function _setLiquidationStrategy(ILiquidationStrategyBase _contract) internal {
    if (_contract != ILiquidationStrategyBase(0)) {
      liquidationStrategy = _contract;
    }
  }

  function _setPriceOracle(ILiquidationPriceOracleBase _oracle) internal {
    if (_oracle != ILiquidationPriceOracleBase(0)) {
      priceOracle = _oracle;
    }
  }

  function _setKyberNetworkProxy(IKyberNetworkProxy _proxy) internal {
    if (_proxy != IKyberNetworkProxy(0)) {
      kyberProxy = _proxy;
    }
  }
}

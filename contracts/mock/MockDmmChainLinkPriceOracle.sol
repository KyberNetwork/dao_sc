// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.7.6;

import '../treasury/priceOracle/KyberDmmChainLinkPriceOracle.sol';

contract MockDmmChainLinkPriceOracle is KyberDmmChainLinkPriceOracle {
  constructor(
    address admin,
    address _weth,
    address[] memory whitelistedTokens,
    uint256 chainklinkValidDuration
  ) KyberDmmChainLinkPriceOracle(admin, _weth, whitelistedTokens, chainklinkValidDuration) {}

  function getExpectedReturnFromToken(
    IERC20Ext tokenIn,
    uint256 amountIn,
    IERC20Ext dest,
    uint256 destRateEth,
    uint256 destRateUsd,
    bool isFromLpToken
  )
    external view
    returns (uint256 totalReturn)
  {
    return _getExpectedReturnFromToken(
      tokenIn,
      amountIn,
      dest,
      destRateEth,
      destRateUsd,
      isFromLpToken
    );
  }

  function getRateWithDestTokenData(
    address src,
    uint256 destTokenRateEth,
    uint256 destTokenRateUsd
  ) external view returns (uint256) {
    return _getRateWithDestTokenData(src, destTokenRateEth, destTokenRateUsd);
  }

  function calculateReturnAmount(
    uint256 srcQty,
    uint256 srcDecimals,
    uint256 dstDecimals,
    uint256 rate
  ) external pure returns (uint256) {
    return _calculateReturnAmount(srcQty, srcDecimals, dstDecimals, rate);
  }

  function getEncodedData(LiquidationType[] calldata types) external pure returns (bytes memory) {
    return abi.encode(types);
  }
}

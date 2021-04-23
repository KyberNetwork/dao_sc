pragma solidity 0.7.6;

import {IERC20Ext} from '@kyber.network/utils-sc/contracts/IERC20Ext.sol';

contract MockKyberNetworkProxy {
  IERC20Ext public knc;

  // swap ether to knc
  // 1 ETH = 1 KNC
  function swapEtherToToken(IERC20Ext token, uint256 minConversionRate)
    external
    payable
    returns (uint256)
  {
    token;
    minConversionRate;
    knc.transfer(msg.sender, msg.value);
  }

  // swap token to knc
  // approval should be given to proxy
  function swapTokenToToken(
    IERC20Ext src,
    uint256 srcAmount,
    IERC20Ext dest,
    uint256 minConversionRate
  ) external returns (uint256) {
    dest;
    minConversionRate;
    src.transferFrom(msg.sender, address(this), srcAmount);
    knc.transfer(msg.sender, srcAmount);
  }

  function setKncAddress(IERC20Ext _knc) public {
    knc = _knc;
  }
}

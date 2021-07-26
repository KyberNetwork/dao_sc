// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.7.6;

import {IERC20Ext} from '@kyber.network/utils-sc/contracts/IERC20Ext.sol';
import {Utils} from '@kyber.network/utils-sc/contracts/Utils.sol';
import {SafeERC20} from '@openzeppelin/contracts/token/ERC20/SafeERC20.sol';

contract MockSimpleLiquidatorCallbackHandler is Utils {
  using SafeERC20 for IERC20Ext;

  constructor() {}

  receive() external payable {}

  function liquidationCallback(
    address, // caller,
    IERC20Ext[] calldata,
    uint256[] calldata,
    address payable recipient,
    IERC20Ext dest,
    uint256 minReturn,
    bytes calldata
  ) external {
    if (dest == ETH_TOKEN_ADDRESS) {
      (bool success, ) = recipient.call { value: minReturn }('');
      require(success, 'transfer failed');
    } else {
      dest.safeTransfer(recipient, minReturn);
    }
  }
}

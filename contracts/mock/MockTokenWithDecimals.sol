// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import '@openzeppelin/contracts/access/Ownable.sol';
import '@openzeppelin/contracts/token/ERC20/ERC20Burnable.sol';
import '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import '@openzeppelin/contracts/token/ERC20/SafeERC20.sol';

interface IERC20Burnable {
  function burnFrom(address _from, uint256 _value) external;
}

/// @dev copy from kyber network repo
contract MockTokenWithDecimals is ERC20Burnable, Ownable {
  using SafeERC20 for IERC20;

  uint8 private tokenDecimals;

  constructor(uint8 _decimals) ERC20('Kyber Network Crystal V2', 'KNCv2') {
    _mint(msg.sender, 10**(18 + _decimals));
    tokenDecimals = _decimals;
  }

  function decimals() public override view returns (uint8) {
    return tokenDecimals;
  }
}

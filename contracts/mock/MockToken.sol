// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import '@openzeppelin/contracts/access/Ownable.sol';
import '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import '@openzeppelin/contracts/token/ERC20/ERC20.sol';
import '@openzeppelin/contracts/token/ERC20/SafeERC20.sol';

/// @dev copy from kyber network repo
contract MockToken is ERC20, Ownable {
  using SafeERC20 for IERC20;

  constructor(
    string memory _name,
    string memory _symbol,
    uint256 _supply
  ) ERC20(_name, _symbol) {
    _mint(msg.sender, _supply);
  }
}

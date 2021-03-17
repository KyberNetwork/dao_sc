// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import '@openzeppelin/contracts/access/Ownable.sol';
import '@openzeppelin/contracts/token/ERC20/ERC20Burnable.sol';
import '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import '@openzeppelin/contracts/token/ERC20/SafeERC20.sol';

interface IERC20Burnable {
  function burnFrom(address _from, uint256 _value) external returns (bool);
}

/// @dev copy from kyber network repo
contract KyberNetworkTokenV2 is ERC20Burnable, Ownable {
  using SafeERC20 for IERC20;

  uint256 public constant INITIAL_SUPPLY = 10**(9 + 18);

  constructor() ERC20('Kyber Network Crystal V2', 'KNCv2') {
    _mint(msg.sender, INITIAL_SUPPLY);
  }
}

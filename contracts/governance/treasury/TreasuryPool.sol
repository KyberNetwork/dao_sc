// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.7.6;


import {Utils} from "@kyber.network/utils-sc/contracts/Utils.sol";
import {PermissionAdmin} from '@kyber.network/utils-sc/contracts/PermissionAdmin.sol';
import {IERC20Ext} from "@kyber.network/utils-sc/contracts/IERC20Ext.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import {ITreasuryPool} from "../../interfaces/ITreasuryPool.sol";

contract TreasuryPool is ITreasuryPool, PermissionAdmin, Utils {
  using SafeERC20 for IERC20Ext;

  mapping(address => bool) private _isAuthorizedStrategy;
  address[] private _authorizedStrategies;

  constructor(address _admin, address[] memory _strategies) PermissionAdmin(_admin) {
    for(uint256 i = 0; i < _strategies.length; i++) {
      _authorizedStrategy(_strategies[i]);
    }
  }

  receive() external payable {}

  function authorizeStrategies(address[] calldata _strategies) external override onlyAdmin {
    for(uint256 i = 0; i < _strategies.length; i++) {
      _authorizedStrategy(_strategies[i]);
    }
  }

  function unauthorizeStrategies(address[] calldata _strategies) external override onlyAdmin {
    for(uint256 i = 0; i < _strategies.length; i++) {
      _unauthorizedStrategy(_strategies[i]);
    }
  }

  function replaceStrategy(address _oldStrategy, address _newStrategy) external override onlyAdmin {
    _unauthorizedStrategy(_oldStrategy);
    _authorizedStrategy(_newStrategy);
  }

  function withdrawFunds(
    IERC20Ext[] calldata _tokens,
    uint256[] calldata _amounts,
    address payable _recipient
  ) external override {
    require(_isAuthorizedStrategy[msg.sender], "not authorized")
    require(_tokens.length == _amounts.length, 'invalid lengths');
    for(uint256 i = 0; i < _tokens.length; i++) {
      _transferToken(_tokens[i], _amounts[i], _recipient);
    }
  }

  function isAuthorizedStrategy(address _strategy) external view override returns (bool) {
    return _isAuthorizedStrategy[_strategy];
  }

  function getAuthorizedStrategies() external view override returns (address[] memory) {
    return _authorizedStrategies;
  }

  function _authorizedStrategy(address _strategy) internal {
    require(_strategy != address(0), 'invalid strategy');
    require(!_isAuthorizedStrategy[_strategy], 'only not authorized strategy');
    _isAuthorizedStrategy[_strategy] = true;
    _authorizedStrategies.push(_strategy);
    // TODO: Emit event
  }

  function _unauthorizedStrategy(address _strategy) internal {
    require(_strategy != address(0), 'invalid strategy');
    require(_isAuthorizedStrategy[_strategy], 'only not authorized strategy');
    _isAuthorizedStrategy[_strategy] = false;
    // remove from list
    for(uint256 i = 0; i < _authorizedStrategies.length; i++) {
      if (_authorizedStrategies[i] == _strategy) {
        _authorizedStrategies[i] = _authorizedStrategies[_authorizedStrategies.length - 1];
        _authorizedStrategies.pop();
      }
    }
    // TODO: Emit event
  }

  function _transferToken(
    IERC20Ext _token,
    uint256 _amount,
    address payable _recipient
  ) internal {
    if (_token == ETH_TOKEN_ADDRESS) {
      (bool success, ) = _recipient.call{ value: _amount }("");
        require(success, 'transfer eth failed');
    } else {
      _token.safeTransfer(_recipient, _amount);
    }
    // TODO: emit event
  }
}

// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.7.6;

import {Utils} from '@kyber.network/utils-sc/contracts/Utils.sol';
import {PermissionAdmin} from '@kyber.network/utils-sc/contracts/PermissionAdmin.sol';
import {PermissionOperators} from '@kyber.network/utils-sc/contracts/PermissionOperators.sol';
import {IERC20Ext} from '@kyber.network/utils-sc/contracts/IERC20Ext.sol';
import {SafeERC20} from '@openzeppelin/contracts/token/ERC20/SafeERC20.sol';
import {EnumerableSet} from '@openzeppelin/contracts/utils/EnumerableSet.sol';
import {IPool} from '../interfaces/IPool.sol';


/**
* Pool contract to contains all tokens with allowing
* whitelisted strategies can withdraw funds from
*/
contract Pool is IPool, PermissionAdmin, PermissionOperators, Utils {
  using SafeERC20 for IERC20Ext;
  using EnumerableSet for EnumerableSet.AddressSet;

  // mapping(address => bool) private _isAuthorizedStrategy;
  // address[] private _authorizedStrategies;
  EnumerableSet.AddressSet private _authorizedStrategies;
  bool private _isPaused;

  constructor(address _admin, address[] memory _strategies) PermissionAdmin(_admin) {
    for(uint256 i = 0; i < _strategies.length; i++) {
      _authorizedStrategy(_strategies[i]);
    }
    _isPaused = false;
  }

  receive() external payable {}

  function authorizeStrategies(address[] calldata _strategies)
    external override onlyAdmin
  {
    for(uint256 i = 0; i < _strategies.length; i++) {
      _authorizedStrategy(_strategies[i]);
    }
  }

  function unauthorizeStrategies(address[] calldata _strategies)
    external override onlyAdmin
  {
    for(uint256 i = 0; i < _strategies.length; i++) {
      _unauthorizedStrategy(_strategies[i]);
    }
  }

  function replaceStrategy(address _oldStrategy, address _newStrategy)
    external override onlyAdmin
  {
    _unauthorizedStrategy(_oldStrategy);
    _authorizedStrategy(_newStrategy);
  }

  function pause() external override onlyOperator {
    require(!_isPaused, 'already paused');
    _isPaused = true;
    emit Paused(msg.sender);
  }

  function unpause() external override onlyAdmin {
    require(_isPaused, 'not paused');
    _isPaused = false;
    emit Unpaused(msg.sender);
  }

  function withdrawFunds(
    IERC20Ext[] calldata _tokens,
    uint256[] calldata _amounts,
    address payable _recipient
  ) external override {
    require(!_isPaused, 'only when not paused');
    require(_isAuthorizedStrategy(msg.sender), 'not authorized');
    require(_tokens.length == _amounts.length, 'invalid lengths');
    for(uint256 i = 0; i < _tokens.length; i++) {
      _transferToken(_tokens[i], _amounts[i], _recipient);
    }
  }

  function isPaused() external view override returns (bool) {
    return _isPaused;
  }

  function isAuthorizedStrategy(address _strategy)
    external view override returns (bool)
  {
    return _isAuthorizedStrategy(_strategy);
  }

  function getAuthorizedStrategiesLength()
    external view override returns (uint256)
  {
    return _authorizedStrategies.length();
  }

  function getAuthorizedStrategyAt(uint256 index)
    external view override returns (address)
  {
    return _authorizedStrategies.at(index);
  }

  function getAllAuthorizedStrategies()
    external view override returns (address[] memory strategies)
  {
    uint256 length = _authorizedStrategies.length();
    strategies = new address[](length);
    for(uint256 i = 0; i < length; i++) {
      strategies[i] = _authorizedStrategies.at(i);
    }
  }

  function _authorizedStrategy(address _strategy) internal {
    require(_strategy != address(0), 'invalid strategy');
    require(!_isAuthorizedStrategy(_strategy), 'only not authorized strategy');
    _authorizedStrategies.add(_strategy);
    emit AuthorizedStrategy(_strategy);
  }

  function _unauthorizedStrategy(address _strategy) internal {
    require(_strategy != address(0), 'invalid strategy');
    require(_isAuthorizedStrategy(_strategy), 'only authorized strategy');
    _authorizedStrategies.remove(_strategy);
    emit UnauthorizedStrategy(_strategy);
  }

  function _transferToken(
    IERC20Ext _token,
    uint256 _amount,
    address payable _recipient
  ) internal {
    if (_token == ETH_TOKEN_ADDRESS) {
      (bool success, ) = _recipient.call{ value: _amount }('');
        require(success, 'transfer eth failed');
    } else {
      _token.safeTransfer(_recipient, _amount);
    }
    emit WithdrawToken(_token, msg.sender, _recipient, _amount);
  }

  function _isAuthorizedStrategy(address _strategy) internal view returns (bool) {
    return _authorizedStrategies.contains(_strategy);
  }
}

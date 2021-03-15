// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.7.6;


import {PermissionAdmin} from '@kyber.network/utils-sc/contracts/PermissionAdmin.sol';
import {PermissionOperators} from '@kyber.network/utils-sc/contracts/PermissionOperators.sol';
import {IERC20Ext} from '@kyber.network/utils-sc/contracts/IERC20Ext.sol';
import {IPool} from '../../interfaces/IPool.sol';
import {INoSwappingLiquidationStrategy} from '../../interfaces/INoSwappingLiquidationStrategy.sol';

/// @dev The simplest liquidation strategy which requests funds from FeePool and
/// 	transfer directly to treasury pool, no actual liquidation happens
contract NoSwappingLiquidationStrategy is PermissionAdmin, PermissionOperators,
	INoSwappingLiquidationStrategy {

  IPool private _feePool;
  address payable private _treasuryPool;

  constructor(
    address admin,
    address feePoolAddress,
    address payable treasuryPoolAddress
  ) PermissionAdmin(admin) {
    _setFeePool(feePoolAddress);
    _setTreasuryPool(treasuryPoolAddress);
  }

  function updateFeePool(address pool) external override onlyAdmin {
    _setFeePool(pool);
  }

  function updateTreasuryPool(address payable pool) external override onlyAdmin {
    _setTreasuryPool(pool);
  }

  /** @dev Fast forward tokens from fee pool to treasury pool
  * @param sources list of source tokens to liquidate
  * @param amounts list of amounts corresponding to each source token
  */
  function liquidate(IERC20Ext[] calldata sources, uint256[] calldata amounts)
		external override
	{
		// check for sources and amounts length will be done in fee pool
		_feePool.withdrawFunds(sources, amounts, _treasuryPool);
		emit Liquidated(msg.sender, sources, amounts);
	}

  function feePool() external override view returns (address) {
    return address(_feePool);
  }

  function treasuryPool() external override view returns (address) {
    return _treasuryPool;
  }

  function _setFeePool(address _pool) internal {
    require(_pool != address(0), 'invalid fee pool');
    _feePool = IPool(_pool);
    emit FeePoolSet(_pool);
  }

  function _setTreasuryPool(address payable _pool) internal {
    require(_pool != address(0), 'invalid treasury pool');
    _treasuryPool = _pool;
    emit TreasuryPoolSet(_pool);
  }
}

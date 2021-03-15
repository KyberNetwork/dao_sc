// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.7.6;
pragma abicoder v2;


import {MockProposalValidator} from './MockProposalValidator.sol';
import {IExecutorWithTimelock} from '../interfaces/governance/IExecutorWithTimelock.sol';
import {IKyberGovernance} from '../interfaces/governance/IKyberGovernance.sol';

contract MockExecutorWithTimelock is IExecutorWithTimelock, MockProposalValidator {

  uint256 public immutable override GRACE_PERIOD;
  uint256 public immutable override MINIMUM_DELAY;
  uint256 public immutable override MAXIMUM_DELAY;

  address public admin;
  uint256 public delay;

  bool public isQueueTransactionRevert;
  bool public isExecuteTransactionRevert;
  bool public isCancelTransactionRevert;
  bool public isCheckActionHashedFailed;
  bool public isCheckProposalOverGracePeriodFailed;

  constructor() {
    GRACE_PERIOD = 0;
    MINIMUM_DELAY = 0;
    MAXIMUM_DELAY = 0;
  }

  function setExecutionData(
    bool _isQueueRevert,
    bool _isExecuteRevert,
    bool _isCancelRevert,
    bool _isCheckActionFailed,
    bool _isCheckProposalGracePeriodPassed,
    uint256 _delay
  ) external {
    isQueueTransactionRevert = _isQueueRevert;
    isExecuteTransactionRevert = _isExecuteRevert;
    isCancelTransactionRevert = _isCancelRevert;
    isCheckActionHashedFailed = _isCheckActionFailed;
    isCheckProposalOverGracePeriodFailed = _isCheckProposalGracePeriodPassed;
    delay = _delay;
  }

  /**
   * @dev Function, called by Governance, that queue a transaction, returns action hash
   * @param target smart contract target
   * @param value wei value of the transaction
   * @param signature function signature of the transaction
   * @param data function arguments of the transaction or callData if signature empty
   * @param executionTime time at which to execute the transaction
   * @param withDelegatecall boolean, true = transaction delegatecalls the target, else calls the target
   **/
  function queueTransaction(
    address target,
    uint256 value,
    string memory signature,
    bytes memory data,
    uint256 executionTime,
    bool withDelegatecall
  )
    external override returns (bytes32)
  {
    bytes32 actionHash = keccak256(
      abi.encode(target, value, signature, data, executionTime, withDelegatecall)
    );
    if (isQueueTransactionRevert) revert();
    isQueueTransactionRevert = false; // silence the warning
    return actionHash;
  }

  /**
   * @dev Function, called by Governance, that cancels a transaction, returns the callData executed
   * @param target smart contract target
   * @param value wei value of the transaction
   * @param signature function signature of the transaction
   * @param data function arguments of the transaction or callData if signature empty
   * @param executionTime time at which to execute the transaction
   * @param withDelegatecall boolean, true = transaction delegatecalls the target, else calls the target
   **/
  function executeTransaction(
    address target,
    uint256 value,
    string memory signature,
    bytes memory data,
    uint256 executionTime,
    bool withDelegatecall
  )
    external payable override returns (bytes memory)
  {
    target;
    value;
    signature;
    data;
    executionTime;
    withDelegatecall;
    if (isExecuteTransactionRevert) revert();
    isExecuteTransactionRevert = false; // silence the warning
    return new bytes(0);
  }

  /**
   * @dev Function, called by Governance, that cancels a transaction, returns action hash
   * @param target smart contract target
   * @param value wei value of the transaction
   * @param signature function signature of the transaction
   * @param data function arguments of the transaction or callData if signature empty
   * @param executionTime time at which to execute the transaction
   * @param withDelegatecall boolean, true = transaction delegatecalls the target, else calls the target
   **/
  function cancelTransaction(
    address target,
    uint256 value,
    string memory signature,
    bytes memory data,
    uint256 executionTime,
    bool withDelegatecall
  )
    external override returns (bytes32)
  {
    bytes32 actionHash = keccak256(
      abi.encode(target, value, signature, data, executionTime, withDelegatecall)
    );
    if (isCancelTransactionRevert) revert();
    isCancelTransactionRevert = false; // silence the warning
    return actionHash;
  }

  /**
   * @dev Getter of the current admin address (should be governance)
   * @return The address of the current admin
   **/
  function getAdmin() external view override returns (address)
  {
    return admin;
  }

  /**
   * @dev Getter of the current pending admin address
   * @return The address of the pending admin
   **/
  function getPendingAdmin() external view override returns (address)
  {
    return admin;
  }

  /**
   * @dev Getter of the delay between queuing and execution
   * @return The delay in seconds
   **/
  function getDelay() external view override returns (uint256)
  {
    return delay;
  }

  /**
   * @dev Returns whether an action (via actionHash) is queued
   * @param actionHash hash of the action to be checked
   * keccak256(abi.encode(target, value, signature, data, executionTime, withDelegatecall))
   * @return true if underlying action of actionHash is queued
   **/
  function isActionQueued(bytes32 actionHash)
    external view override returns (bool)
  {
    actionHash;
    return isCheckActionHashedFailed;
  }

  /**
   * @dev Checks whether a proposal is over its grace period
   * @param governance Governance contract
   * @param proposalId Id of the proposal against which to test
   * @return true of proposal is over grace period
   **/
  function isProposalOverGracePeriod(IKyberGovernance governance, uint256 proposalId)
    external
    view
    override
    returns (bool)
  {
    governance;
    proposalId;
    return isCheckProposalOverGracePeriodFailed;
  }
}

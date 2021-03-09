const {expectEvent, expectRevert} = require('@openzeppelin/test-helpers');
const BN = web3.utils.BN;

const KyberGovernance = artifacts.require('KyberGovernance.sol');
const MockProposalValidator = artifacts.require('MockProposalValidator.sol');
const MockVotingPowerStrategy = artifacts.require('MockVotingPowerStrategy.sol');
const MockExecutorWithTimelock = artifacts.require('MockExecutorWithTimelock.sol');

const Helper = require('./helper.js');
const TestWallets = require('./../test-wallets');
const {zeroAddress, ProposalState} = require('./helper.js');
const {ecsign} = require('ethereumjs-util');
const DOMAIN_TYPEHASH = web3.utils.soliditySha3('EIP712Domain(string name,uint256 chainId,address verifyingContract)');
const VOTE_EMITTED_TYPEHASH = web3.utils.soliditySha3('VoteEmitted(uint256 id,uint256 optionBitMask)');

let voter;
let admin;
let daoOperator;
let governance;
let validator;
let votingStrategy;
let executor;
let chainId;

contract('KyberGovernance', function (accounts) {
  before('Global setup', async () => {
    voter = accounts[1];
    admin = accounts[2];
    daoOperator = accounts[3];
    validator = await MockProposalValidator.new();
    votingStrategy = await MockVotingPowerStrategy.new();
    executor = await MockExecutorWithTimelock.new();
    chainId = await web3.eth.net.getId();
  });

  describe('#test constructor', async () => {
    it('test invalid admin', async () => {
      await expectRevert((governance = KyberGovernance.new(zeroAddress, daoOperator, [], [])), 'admin 0');
    });

    it('test invalid dao operator', async () => {
      await expectRevert((governance = KyberGovernance.new(admin, zeroAddress, [], [])), 'invalid dao operator');
    });

    it('test correct data init', async () => {
      governance = await KyberGovernance.new(
        admin,
        daoOperator,
        [validator.address, executor.address],
        [votingStrategy.address]
      );
      Helper.assertEqual(admin, await governance.admin());
      Helper.assertEqual(daoOperator, await governance.getDaoOperator());
      Helper.assertEqual(true, await governance.isExecutorAuthorized(validator.address));
      Helper.assertEqual(true, await governance.isExecutorAuthorized(executor.address));
      Helper.assertEqual(true, await governance.isVotingPowerStrategyAuthorized(votingStrategy.address));
      Helper.assertEqual(0, await governance.getProposalsCount());
    });
  });

  describe('#test authorization', async () => {
    beforeEach('setup', async () => {
      governance = await KyberGovernance.new(
        admin,
        daoOperator,
        [validator.address, executor.address],
        [votingStrategy.address]
      );
    });

    describe('#authorize executor', async () => {
      it('test revert not admin', async () => {
        await expectRevert(governance.authorizeExecutors([validator.address]), 'only admin');
      });

      it('test authorize and event', async () => {
        await governance.unauthorizeExecutors([validator.address], {from: admin});
        Helper.assertEqual(false, await governance.isExecutorAuthorized(validator.address));
        let tx = await governance.authorizeExecutors([validator.address], {from: admin});
        expectEvent(tx, 'ExecutorAuthorized', {
          executor: validator.address,
        });
        Helper.assertEqual(true, await governance.isExecutorAuthorized(validator.address));
        await governance.authorizeExecutors([validator.address], {from: admin});
      });
    });

    describe('#unauthorize executor', async () => {
      it('test revert not admin', async () => {
        await expectRevert(governance.unauthorizeExecutors([validator.address]), 'only admin');
      });

      it('test unauthorize and event', async () => {
        await governance.authorizeExecutors([validator.address], {from: admin});
        Helper.assertEqual(true, await governance.isExecutorAuthorized(validator.address));
        let tx = await governance.unauthorizeExecutors([validator.address], {from: admin});
        expectEvent(tx, 'ExecutorUnauthorized', {
          executor: validator.address,
        });
        Helper.assertEqual(false, await governance.isExecutorAuthorized(validator.address));
        await governance.unauthorizeExecutors([validator.address], {from: admin});
      });
    });

    describe('#authorize voting power strategy', async () => {
      it('test revert not admin', async () => {
        await expectRevert(governance.authorizeVotingPowerStrategies([validator.address]), 'only admin');
      });

      it('test authorize and event', async () => {
        await governance.unauthorizeVotingPowerStrategies([votingStrategy.address], {from: admin});
        Helper.assertEqual(false, await governance.isVotingPowerStrategyAuthorized(votingStrategy.address));
        let tx = await governance.authorizeVotingPowerStrategies([votingStrategy.address], {from: admin});
        expectEvent(tx, 'VotingPowerStrategyAuthorized', {
          strategy: votingStrategy.address,
        });
        Helper.assertEqual(true, await governance.isVotingPowerStrategyAuthorized(votingStrategy.address));
        await governance.authorizeVotingPowerStrategies([votingStrategy.address], {from: admin});
      });
    });

    describe('#unauthorize executor', async () => {
      it('test revert not admin', async () => {
        await expectRevert(governance.unauthorizeVotingPowerStrategies([votingStrategy.address]), 'only admin');
      });

      it('test unauthorize and event', async () => {
        await governance.authorizeVotingPowerStrategies([votingStrategy.address], {from: admin});
        Helper.assertEqual(true, await governance.isVotingPowerStrategyAuthorized(votingStrategy.address));
        let tx = await governance.unauthorizeVotingPowerStrategies([votingStrategy.address], {from: admin});
        expectEvent(tx, 'VotingPowerStrategyUnauthorized', {
          strategy: votingStrategy.address,
        });
        Helper.assertEqual(false, await governance.isVotingPowerStrategyAuthorized(votingStrategy.address));
        await governance.unauthorizeVotingPowerStrategies([votingStrategy.address], {from: admin});
      });
    });

    describe('#transfer dao operator', async () => {
      it('test revert not dao operator', async () => {
        await expectRevert(governance.transferDaoOperator(admin), 'only dao operator');
      });

      it('test revert new dao operator is 0x0', async () => {
        await expectRevert(governance.transferDaoOperator(zeroAddress, {from: daoOperator}), 'invalid dao operator');
      });

      it('test transfer dao operator and event', async () => {
        Helper.assertEqual(daoOperator, await governance.getDaoOperator());
        let tx = await governance.transferDaoOperator(admin, {from: daoOperator});
        expectEvent(tx, 'DaoOperatorTransferred', {
          newDaoOperator: admin,
        });
        Helper.assertEqual(admin, await governance.getDaoOperator());
        await governance.transferDaoOperator(daoOperator, {from: admin});
      });
    });
  });

  // Binary Proposals
  let targets = [accounts[0]];
  let weiValues = [new BN(1000)];
  let signatures = ['signature'];
  let calldatas = ['0x1234'];
  let withDelegatecalls = [true];

  describe('#test create proposals', async () => {
    beforeEach('setup', async () => {
      governance = await KyberGovernance.new(
        admin,
        daoOperator,
        [validator.address, executor.address],
        [votingStrategy.address]
      );
    });

    // Generic Proposals
    it('generic proposal - reverts executor not authorized', async () => {
      await expectRevert(
        governance.createGenericProposal(accounts[0], votingStrategy.address, [], 0, 0, ''),
        'create generic executor not authorized'
      );
    });

    it('generic proposal - reverts strategy not authorized', async () => {
      await expectRevert(
        governance.createGenericProposal(executor.address, accounts[0], [], 0, 0, ''),
        'create generic strategy not authorized'
      );
    });

    it('generic proposal - reverts validator returns false', async () => {
      await executor.setData(false, true, true); // set creation always returns false
      await expectRevert(
        governance.createGenericProposal(executor.address, votingStrategy.address, [], 0, 0, ''),
        'validate proposal creation invalid'
      );
    });

    it('generic proposal - reverts validator returns false', async () => {
      await executor.setData(false, true, true); // set creation always returns false
      await expectRevert(
        governance.createGenericProposal(executor.address, votingStrategy.address, [], 0, 0, ''),
        'validate proposal creation invalid'
      );
      await executor.setData(true, true, true);
    });

    it('generic proposal - reverts when strategy reverts', async () => {
      await votingStrategy.setRevertStates(true, true, false);
      await expectRevert.unspecified(
        governance.createGenericProposal(executor.address, votingStrategy.address, [], 0, 0, '')
      );
      await votingStrategy.setRevertStates(false, false, false);
    });

    it('generic proposal - correct data and event', async () => {
      await executor.setData(true, true, true);
      await votingStrategy.setRevertStates(false, false, false);
      let maxVotingPower = new BN(10).pow(new BN(25));
      await votingStrategy.setMaxVotingPower(maxVotingPower);

      let proposalCount = await governance.getProposalsCount();
      let options = ['option 1', 'option 2', 'option 3'];
      let startTime = new BN(await Helper.getCurrentBlockTime());
      let endTime = startTime.add(new BN(10000));
      let link = 'link to desc';
      let tx = await governance.createGenericProposal(
        executor.address,
        votingStrategy.address,
        options,
        startTime,
        endTime,
        link,
        {from: daoOperator}
      );
      expectEvent(tx, 'GenericProposalCreated', {
        proposalId: proposalCount,
        creator: daoOperator,
        executor: executor.address,
        strategy: votingStrategy.address,
        startTime: startTime,
        endTime: endTime,
        link: link,
        maxVotingPower: maxVotingPower,
      });
      // check options, expectEvent doesn't support array
      let eventLogs;
      for (let i = 0; i < tx.logs.length; i++) {
        if (tx.logs[i].event == 'GenericProposalCreated') {
          eventLogs = tx.logs[i];
          break;
        }
      }
      Helper.assertEqualArray(eventLogs.args.options, options);
      // check correct proposal data
      await Helper.assertEqual(proposalCount.add(new BN(1)), await governance.getProposalsCount());
      let proposalData = await governance.getProposalById(proposalCount);
      Helper.assertEqual(proposalData.id, proposalCount);
      Helper.assertEqual(proposalData.proposalType, 0); // geneic is 0
      Helper.assertEqual(proposalData.creator, daoOperator);
      Helper.assertEqual(proposalData.executor, executor.address);
      Helper.assertEqual(proposalData.strategy, votingStrategy.address);
      Helper.assertEqualArray(proposalData.targets, []);
      Helper.assertEqualArray(proposalData.weiValues, []);
      Helper.assertEqualArray(proposalData.signatures, []);
      Helper.assertEqualArray(proposalData.calldatas, []);
      Helper.assertEqualArray(proposalData.withDelegatecalls, []);
      Helper.assertEqualArray(proposalData.options, options);
      let voteCounts = [];
      for (let i = 0; i < proposalData.options.length; i++) voteCounts.push(0);
      Helper.assertEqualArray(proposalData.voteCounts, voteCounts);
      Helper.assertEqual(proposalData.totalVotes, 0);
      Helper.assertEqual(proposalData.maxVotingPower, maxVotingPower);
      Helper.assertEqual(proposalData.startTime, startTime);
      Helper.assertEqual(proposalData.endTime, endTime);
      Helper.assertEqual(proposalData.executionTime, 0);
      Helper.assertEqual(proposalData.link, link);
      Helper.assertEqual(proposalData.executed, false);
      Helper.assertEqual(proposalData.canceled, false);
    });

    it('binary proposal - reverts execution params empty', async () => {
      await expectRevert(
        governance.createBinaryProposal(executor.address, votingStrategy.address, [[], [], [], [], []], 0, 0, ''),
        'create binary invalid empty targets'
      );
    });

    it('binary proposal - reverts execution params invalid', async () => {
      await expectRevert(
        governance.createBinaryProposal(
          executor.address,
          votingStrategy.address,
          [targets, [], signatures, calldatas, withDelegatecalls],
          0,
          0,
          ''
        ),
        'create binary inconsistent params length'
      );

      await expectRevert(
        governance.createBinaryProposal(
          executor.address,
          votingStrategy.address,
          [targets, weiValues, [], calldatas, withDelegatecalls],
          0,
          0,
          ''
        ),
        'create binary inconsistent params length'
      );

      await expectRevert(
        governance.createBinaryProposal(
          executor.address,
          votingStrategy.address,
          [targets, weiValues, signatures, [], withDelegatecalls],
          0,
          0,
          ''
        ),
        'create binary inconsistent params length'
      );

      await expectRevert(
        governance.createBinaryProposal(
          executor.address,
          votingStrategy.address,
          [targets, weiValues, signatures, calldatas, []],
          0,
          0,
          ''
        ),
        'create binary inconsistent params length'
      );
    });

    it('binary proposal - reverts executor not authorized', async () => {
      await expectRevert(
        governance.createBinaryProposal(
          accounts[0],
          votingStrategy.address,
          [targets, weiValues, signatures, calldatas, withDelegatecalls],
          0,
          0,
          ''
        ),
        'create binary executor not authorized'
      );
    });

    it('binary proposal - reverts strategy not authorized', async () => {
      await expectRevert(
        governance.createBinaryProposal(
          executor.address,
          accounts[0],
          [targets, weiValues, signatures, calldatas, withDelegatecalls],
          0,
          0,
          ''
        ),
        'create binary strategy not authorized'
      );
    });

    it('binary proposal - reverts validator returns false', async () => {
      await executor.setData(false, true, true); // set creation always returns false
      await expectRevert(
        governance.createBinaryProposal(
          executor.address,
          votingStrategy.address,
          [targets, weiValues, signatures, calldatas, withDelegatecalls],
          0,
          0,
          ''
        ),
        'validate proposal creation invalid'
      );
    });

    it('binary proposal - reverts when strategy reverts', async () => {
      await votingStrategy.setRevertStates(true, true, true);
      await expectRevert.unspecified(
        governance.createBinaryProposal(
          accounts[0],
          votingStrategy.address,
          [targets, weiValues, signatures, calldatas, withDelegatecalls],
          0,
          0,
          ''
        )
      );
      await votingStrategy.setRevertStates(false, false, false);
    });

    it('binary proposal - correct data and event', async () => {
      await executor.setData(true, true, true);
      await votingStrategy.setRevertStates(false, false, false);
      let maxVotingPower = new BN(10).pow(new BN(25));
      await votingStrategy.setMaxVotingPower(maxVotingPower);

      let proposalCount = await governance.getProposalsCount();
      let startTime = new BN(await Helper.getCurrentBlockTime());
      let endTime = startTime.add(new BN(10000));
      let link = 'link to desc';
      let weiValues = [1000];
      let tx = await governance.createBinaryProposal(
        executor.address,
        votingStrategy.address,
        [targets, weiValues, signatures, calldatas, withDelegatecalls],
        startTime,
        endTime,
        link,
        {from: daoOperator}
      );
      expectEvent(tx, 'BinaryProposalCreated', {
        proposalId: proposalCount,
        creator: daoOperator,
        executor: executor.address,
        strategy: votingStrategy.address,
        startTime: startTime,
        endTime: endTime,
        link: link,
        maxVotingPower: maxVotingPower,
      });
      // check execution params, expectEvent doesn't support array
      let eventLogs;
      for (let i = 0; i < tx.logs.length; i++) {
        if (tx.logs[i].event == 'BinaryProposalCreated') {
          eventLogs = tx.logs[i];
          break;
        }
      }
      Helper.assertEqualArray(eventLogs.args.targets, targets);
      Helper.assertEqualArray(eventLogs.args.weiValues, weiValues);
      Helper.assertEqualArray(eventLogs.args.signatures, signatures);
      Helper.assertEqualArray(eventLogs.args.calldatas, calldatas);
      Helper.assertEqualArray(eventLogs.args.withDelegatecalls, withDelegatecalls);

      let options = ['YES', 'NO'];
      let voteCounts = [0, 0];
      // check correct proposal data
      await Helper.assertEqual(proposalCount.add(new BN(1)), await governance.getProposalsCount());
      let proposalData = await governance.getProposalById(proposalCount);
      Helper.assertEqual(proposalData.id, proposalCount);
      Helper.assertEqual(proposalData.proposalType, 1); // binary is 0
      Helper.assertEqual(proposalData.creator, daoOperator);
      Helper.assertEqual(proposalData.executor, executor.address);
      Helper.assertEqual(proposalData.strategy, votingStrategy.address);
      Helper.assertEqualArray(proposalData.targets, targets);
      Helper.assertEqualArray(proposalData.weiValues, weiValues);
      Helper.assertEqualArray(proposalData.signatures, signatures);
      Helper.assertEqualArray(proposalData.calldatas, calldatas);
      Helper.assertEqualArray(proposalData.withDelegatecalls, withDelegatecalls);
      Helper.assertEqualArray(proposalData.options, options);
      Helper.assertEqualArray(proposalData.voteCounts, voteCounts);
      Helper.assertEqual(proposalData.totalVotes, 0);
      Helper.assertEqual(proposalData.maxVotingPower, maxVotingPower);
      Helper.assertEqual(proposalData.startTime, startTime);
      Helper.assertEqual(proposalData.endTime, endTime);
      Helper.assertEqual(proposalData.executionTime, 0);
      Helper.assertEqual(proposalData.link, link);
      Helper.assertEqual(proposalData.executed, false);
      Helper.assertEqual(proposalData.canceled, false);
    });
  });

  const createGenericProposal = async (executor, strategy, options, startTime, endTime, link) => {
    let proposalCount = await governance.getProposalsCount();
    await governance.createGenericProposal(executor, strategy, options, startTime, endTime, link);
    return proposalCount;
  };

  const createBinaryProposal = async (
    executor,
    strategy,
    targets,
    weiValues,
    signatures,
    calldatas,
    withDelegatecalls,
    startTime,
    endTime,
    link
  ) => {
    let proposalCount = await governance.getProposalsCount();
    await governance.createBinaryProposal(
      executor,
      strategy,
      [targets, weiValues, signatures, calldatas, withDelegatecalls],
      startTime,
      endTime,
      link
    );
    return proposalCount;
  };

  describe('#test cancel proposals', async () => {
    beforeEach('setup', async () => {
      governance = await KyberGovernance.new(
        admin,
        daoOperator,
        [validator.address, executor.address],
        [votingStrategy.address]
      );
    });

    it('reverts invalid proposal id', async () => {
      let proposalCount = await governance.getProposalsCount();
      await expectRevert(governance.cancel(proposalCount.add(new BN(1))), 'invalid proposal id');
    });

    it('reverts invalid sender', async () => {
      let currentTime = new BN(await Helper.getCurrentBlockTime());
      let proposalId = await createGenericProposal(
        executor.address,
        votingStrategy.address,
        ['option 1', 'option 2'],
        currentTime,
        currentTime.add(new BN(120)),
        'link to desc'
      );
      let state = await governance.getProposalState(proposalId);
      Helper.assertEqual(ProposalState.Active, state, 'wrong state');
      // return false for check cancellation from executor
      await executor.setData(true, false, true);
      await expectRevert(
        governance.cancel(proposalId, {from: admin}), // dao operator
        'validate proposal cancellation failed'
      );
      await executor.setData(true, true, true);
    });

    it('generic proposal - reverts invalid state for cancellation', async () => {
      // for generic proposal, can not cancel if it is finalized or cancelled
      // create generic proposal, set end time to the past so it is finalized
      let currentTime = await Helper.getCurrentBlockTime();
      let proposalId = await createGenericProposal(
        executor.address,
        votingStrategy.address,
        ['option 1', 'option 2'],
        currentTime,
        currentTime,
        'link to desc'
      );
      let state = await governance.getProposalState(proposalId);
      Helper.assertEqual(ProposalState.Finalized, state, 'wrong state');
      await expectRevert(governance.cancel(proposalId, {from: daoOperator}), 'invalid state to cancel');
      // create generic proposal, cancel it twice
      currentTime = new BN(await Helper.getCurrentBlockTime());
      proposalId = await createGenericProposal(
        executor.address,
        votingStrategy.address,
        ['option 1', 'option 2'],
        currentTime,
        currentTime.add(new BN(1000)),
        'link to desc'
      );
      state = await governance.getProposalState(proposalId);
      Helper.assertEqual(ProposalState.Active, state, 'wrong state');
      await governance.cancel(proposalId);
      Helper.assertEqual(ProposalState.Canceled, await governance.getProposalState(proposalId), 'wrong state');
      await expectRevert(governance.cancel(proposalId, {from: daoOperator}), 'invalid state to cancel');
    });

    it('binary proposal - reverts invalid state for cancellation', async () => {
      // for binary proposal, can not cancel if it is cancelled/executed/expired
      let delay = 30;
      await executor.setExecutionData(false, false, false, false, false, delay);
      let currentTime = new BN(await Helper.getCurrentBlockTime());
      let proposalId = await createBinaryProposal(
        executor.address,
        votingStrategy.address,
        targets,
        [0],
        signatures,
        calldatas,
        withDelegatecalls,
        currentTime,
        currentTime,
        'link to desc'
      );
      let state = await governance.getProposalState(proposalId);
      Helper.assertEqual(ProposalState.Succeeded, state, 'wrong state');

      // queue the tx
      await governance.queue(proposalId);
      state = await governance.getProposalState(proposalId);
      Helper.assertEqual(ProposalState.Queued, state, 'wrong state');

      // execute tx
      await governance.execute(proposalId);
      state = await governance.getProposalState(proposalId);
      Helper.assertEqual(ProposalState.Executed, state, 'wrong state');

      // can not cancel when it is executed
      await expectRevert(governance.cancel(proposalId), 'invalid state to cancel');
      // create generic proposal, cancel it twice
      currentTime = new BN(await Helper.getCurrentBlockTime());
      proposalId = await createBinaryProposal(
        executor.address,
        votingStrategy.address,
        targets,
        [0],
        signatures,
        calldatas,
        withDelegatecalls,
        currentTime,
        currentTime,
        'link to desc'
      );
      // check over grace period returns true, so proposal is expired after queued
      await executor.setExecutionData(false, false, false, false, true, delay);
      // queue the tx
      await governance.queue(proposalId);
      // make it expire
      await Helper.mineNewBlockAfter(delay);

      state = await governance.getProposalState(proposalId);
      Helper.assertEqual(ProposalState.Expired, state, 'wrong state');
      // can not cancel when it is expired
      await expectRevert(governance.cancel(proposalId, {from: daoOperator}), 'invalid state to cancel');

      // create generic proposal, cancel it twice
      currentTime = new BN(await Helper.getCurrentBlockTime());
      proposalId = await createBinaryProposal(
        executor.address,
        votingStrategy.address,
        targets,
        [0],
        signatures,
        calldatas,
        withDelegatecalls,
        currentTime,
        currentTime,
        'link to desc'
      );
      // check over grace period returns true, so proposal is expired after queued
      await executor.setExecutionData(false, false, false, false, false, delay);

      await governance.cancel(proposalId);
      state = await governance.getProposalState(proposalId);
      Helper.assertEqual(ProposalState.Canceled, state, 'wrong state');
      // can not cancel when it is cancelled
      await expectRevert(governance.cancel(proposalId, {from: daoOperator}), 'invalid state to cancel');
    });

    it('reverts binary proposal executor cancel tx failed', async () => {
      // for binary proposal, can not cancel if it is cancelled/executed/expired
      let delay = 30;
      // set cancel is not allowed in executor
      await executor.setExecutionData(false, false, true, false, false, delay);
      let currentTime = new BN(await Helper.getCurrentBlockTime());
      let proposalId = await createBinaryProposal(
        executor.address,
        votingStrategy.address,
        targets,
        [0],
        signatures,
        calldatas,
        withDelegatecalls,
        currentTime,
        currentTime,
        'link to desc'
      );
      let state = await governance.getProposalState(proposalId);
      Helper.assertEqual(ProposalState.Succeeded, state, 'wrong state');

      await expectRevert.unspecified(governance.cancel(proposalId, {from: daoOperator}));
      await executor.setExecutionData(false, false, false, false, false, delay);
    });

    it('reverts proposal strategy handle cancellation failed', async () => {
      // for binary proposal, can not cancel if it is cancelled/executed/expired
      let delay = 30;
      await executor.setExecutionData(false, false, false, false, false, delay);
      let currentTime = new BN(await Helper.getCurrentBlockTime());
      let proposalId = await createBinaryProposal(
        executor.address,
        votingStrategy.address,
        targets,
        [0],
        signatures,
        calldatas,
        withDelegatecalls,
        currentTime,
        currentTime,
        'link to desc'
      );
      let state = await governance.getProposalState(proposalId);
      Helper.assertEqual(ProposalState.Succeeded, state, 'wrong state');

      await votingStrategy.setRevertStates(false, true, false); // cancellation will be reverted
      await expectRevert.unspecified(governance.cancel(proposalId, {from: daoOperator}));
      await votingStrategy.setRevertStates(false, false, false);
    });

    it('test cancel data changes and event', async () => {
      let delay = 30;
      await executor.setExecutionData(false, false, false, false, false, delay);
      let currentTime = new BN(await Helper.getCurrentBlockTime());
      let proposalId = await createBinaryProposal(
        executor.address,
        votingStrategy.address,
        targets,
        [0],
        signatures,
        calldatas,
        withDelegatecalls,
        currentTime,
        currentTime,
        'link to desc'
      );
      let tx = await governance.cancel(proposalId, {from: daoOperator});
      let state = await governance.getProposalState(proposalId);
      Helper.assertEqual(ProposalState.Canceled, state, 'wrong state');
      let data = await governance.getProposalById(proposalId);
      Helper.assertEqual(data.canceled, true, 'wrong cancellation data');
      // check event
      expectEvent(tx, 'ProposalCanceled', {
        proposalId: proposalId,
      });
    });
  });

  describe('#test queue proposals', async () => {
    beforeEach('setup', async () => {
      governance = await KyberGovernance.new(
        admin,
        daoOperator,
        [validator.address, executor.address],
        [votingStrategy.address]
      );
    });

    it('reverts invalid proposal id', async () => {
      let proposalCount = await governance.getProposalsCount();
      await expectRevert(governance.queue(proposalCount), 'invalid proposal id');
    });

    it('generic proposal - reverts invalid state to queue', async () => {
      let currentTime = new BN(await Helper.getCurrentBlockTime());
      let startTime = currentTime.add(new BN(30));
      let endTime = startTime.add(new BN(60));
      let proposalId = await createGenericProposal(
        executor.address,
        votingStrategy.address,
        ['option 1', 'option 2'],
        startTime,
        endTime,
        'link to desc',
        {from: daoOperator}
      );
      // can not queue for pending proposal
      Helper.assertEqual(ProposalState.Pending, await governance.getProposalState(proposalId));
      await expectRevert(governance.queue(proposalId), 'invalid state to queue');
      await Helper.mineNewBlockAfter(30);

      Helper.assertEqual(ProposalState.Active, await governance.getProposalState(proposalId));
      await expectRevert(governance.queue(proposalId), 'invalid state to queue');
      await Helper.mineNewBlockAfter(60);
      Helper.assertEqual(ProposalState.Finalized, await governance.getProposalState(proposalId));
      await expectRevert(governance.queue(proposalId), 'invalid state to queue');

      currentTime = new BN(await Helper.getCurrentBlockTime());
      startTime = currentTime.add(new BN(30));
      endTime = startTime.add(new BN(60));
      proposalId = await createGenericProposal(
        executor.address,
        votingStrategy.address,
        ['option 1', 'option 2'],
        startTime,
        endTime,
        'link to desc',
        {from: daoOperator}
      );
      await governance.cancel(proposalId, {from: daoOperator});
      Helper.assertEqual(ProposalState.Canceled, await governance.getProposalState(proposalId));
      await expectRevert(governance.queue(proposalId), 'invalid state to queue');
    });

    it('binary proposal - reverts invalid state to queue', async () => {
      let currentTime = new BN(await Helper.getCurrentBlockTime());
      let startTime = currentTime.add(new BN(30));
      let endTime = startTime.add(new BN(60));
      let proposalId = await createBinaryProposal(
        executor.address,
        votingStrategy.address,
        targets,
        [0],
        signatures,
        calldatas,
        withDelegatecalls,
        startTime,
        endTime,
        'link to desc'
      );
      // can not queue for pending proposal
      Helper.assertEqual(ProposalState.Pending, await governance.getProposalState(proposalId));
      await expectRevert(governance.queue(proposalId), 'invalid state to queue');
      await Helper.mineNewBlockAfter(30);

      Helper.assertEqual(ProposalState.Active, await governance.getProposalState(proposalId));
      await expectRevert(governance.queue(proposalId), 'invalid state to queue');
      // delay to end
      await Helper.mineNewBlockAfter(60);

      await executor.setData(true, true, false); // set proposal is not passed
      Helper.assertEqual(ProposalState.Failed, await governance.getProposalState(proposalId));
      await expectRevert(governance.queue(proposalId), 'invalid state to queue');

      await governance.cancel(proposalId, {from: daoOperator});
      Helper.assertEqual(ProposalState.Canceled, await governance.getProposalState(proposalId));
      await expectRevert(governance.queue(proposalId), 'invalid state to queue');

      // can not queue executed proposal
      currentTime = new BN(await Helper.getCurrentBlockTime());
      proposalId = await createBinaryProposal(
        executor.address,
        votingStrategy.address,
        targets,
        [0],
        signatures,
        calldatas,
        withDelegatecalls,
        currentTime,
        currentTime,
        'link to desc'
      );

      await executor.setData(true, true, true); // set proposal is passed
      await governance.queue(proposalId); // can queue the proposal
      await governance.execute(proposalId); // can execute the proposal
      Helper.assertEqual(ProposalState.Executed, await governance.getProposalState(proposalId));
      await expectRevert(governance.queue(proposalId), 'invalid state to queue');

      // can not queue expired proposal
      currentTime = new BN(await Helper.getCurrentBlockTime());
      proposalId = await createBinaryProposal(
        executor.address,
        votingStrategy.address,
        targets,
        [0],
        signatures,
        calldatas,
        withDelegatecalls,
        currentTime,
        currentTime,
        'link to desc'
      );

      await executor.setData(true, true, true); // set proposal is passed
      await governance.queue(proposalId); // can queue the proposal
      await executor.setExecutionData(false, false, false, false, true, 0);
      Helper.assertEqual(ProposalState.Expired, await governance.getProposalState(proposalId));
      await expectRevert(governance.queue(proposalId), 'invalid state to queue');
      await executor.setExecutionData(true, true, true, true, true, 0);
    });

    it('reverts duplicated action', async () => {
      // can not queue expired proposal
      let currentTime = new BN(await Helper.getCurrentBlockTime());
      let proposalId = await createBinaryProposal(
        executor.address,
        votingStrategy.address,
        targets,
        [0],
        signatures,
        calldatas,
        withDelegatecalls,
        currentTime,
        currentTime,
        'link to desc'
      );

      await executor.setData(true, true, true); // set proposal is passed
      // set check action in executor returns false
      await executor.setExecutionData(false, false, false, true, false, 30);
      await expectRevert(governance.queue(proposalId), 'duplicated action');
    });

    it('reverts executor queue tx failed ', async () => {
      // can not queue expired proposal
      let currentTime = new BN(await Helper.getCurrentBlockTime());
      let proposalId = await createBinaryProposal(
        executor.address,
        votingStrategy.address,
        targets,
        [0],
        signatures,
        calldatas,
        withDelegatecalls,
        currentTime,
        currentTime,
        'link to desc'
      );

      await executor.setData(true, true, true); // set proposal is passed
      // set check queue reverts
      await executor.setExecutionData(true, false, false, false, false, 30);
      await expectRevert.unspecified(governance.queue(proposalId));
      await executor.setExecutionData(false, false, false, false, false, 30);
    });

    it('queue records correct data and event', async () => {
      let currentTime = new BN(await Helper.getCurrentBlockTime());
      let proposalId = await createBinaryProposal(
        executor.address,
        votingStrategy.address,
        targets,
        [0],
        signatures,
        calldatas,
        withDelegatecalls,
        currentTime,
        currentTime,
        'link to desc'
      );

      await executor.setData(true, true, true); // set proposal is passed
      let delay = 30;
      await executor.setExecutionData(false, false, false, false, false, delay);
      let tx = await governance.queue(proposalId, {from: accounts[5]}); // can queue the proposal
      currentTime = new BN(await Helper.getCurrentBlockTime());
      expectEvent(tx, 'ProposalQueued', {
        proposalId: proposalId,
        executionTime: currentTime.add(new BN(delay)),
        initiatorQueueing: accounts[5],
      });

      Helper.assertEqual(ProposalState.Queued, await governance.getProposalState(proposalId));
      let data = await governance.getProposalById(proposalId);
      Helper.assertEqual(data.executionTime, currentTime.add(new BN(delay)));
    });
  });

  describe('#test execute proposals', async () => {
    beforeEach('setup', async () => {
      governance = await KyberGovernance.new(
        admin,
        daoOperator,
        [validator.address, executor.address],
        [votingStrategy.address]
      );
    });

    it('reverts invalid proposal id', async () => {
      let proposalCount = await governance.getProposalsCount();
      await expectRevert(governance.execute(proposalCount), 'invalid proposal id');
    });

    // always reverts for generic proposal
    it('generic proposal - reverts invalid state to execute', async () => {
      let currentTime = new BN(await Helper.getCurrentBlockTime());
      let startTime = currentTime.add(new BN(30));
      let endTime = startTime.add(new BN(60));
      let proposalId = await createGenericProposal(
        executor.address,
        votingStrategy.address,
        ['option 1', 'option 2'],
        startTime,
        endTime,
        'link to desc',
        {from: daoOperator}
      );
      Helper.assertEqual(ProposalState.Pending, await governance.getProposalState(proposalId));
      await expectRevert(governance.execute(proposalId), 'only queued proposals');
      await Helper.mineNewBlockAfter(30);

      Helper.assertEqual(ProposalState.Active, await governance.getProposalState(proposalId));
      await expectRevert(governance.execute(proposalId), 'only queued proposals');
      await Helper.mineNewBlockAfter(60);
      Helper.assertEqual(ProposalState.Finalized, await governance.getProposalState(proposalId));
      await expectRevert(governance.execute(proposalId), 'only queued proposals');

      currentTime = new BN(await Helper.getCurrentBlockTime());
      startTime = currentTime.add(new BN(30));
      endTime = startTime.add(new BN(60));
      proposalId = await createGenericProposal(
        executor.address,
        votingStrategy.address,
        ['option 1', 'option 2'],
        startTime,
        endTime,
        'link to desc',
        {from: daoOperator}
      );
      await governance.cancel(proposalId, {from: daoOperator});
      Helper.assertEqual(ProposalState.Canceled, await governance.getProposalState(proposalId));
      await expectRevert(governance.execute(proposalId), 'only queued proposals');
    });

    // only proposals that are queued
    it('binary proposal - reverts invalid state to execute', async () => {
      let currentTime = new BN(await Helper.getCurrentBlockTime());
      let startTime = currentTime.add(new BN(30));
      let endTime = startTime.add(new BN(60));
      let proposalId = await createBinaryProposal(
        executor.address,
        votingStrategy.address,
        targets,
        [0],
        signatures,
        calldatas,
        withDelegatecalls,
        startTime,
        endTime,
        'link to desc'
      );
      // can not execute for pending proposal
      Helper.assertEqual(ProposalState.Pending, await governance.getProposalState(proposalId));
      await expectRevert(governance.execute(proposalId), 'only queued proposals');
      await Helper.mineNewBlockAfter(30);

      Helper.assertEqual(ProposalState.Active, await governance.getProposalState(proposalId));
      await expectRevert(governance.execute(proposalId), 'only queued proposals');
      // delay to end
      await Helper.mineNewBlockAfter(60);

      await executor.setData(true, true, false); // set proposal is not passed
      Helper.assertEqual(ProposalState.Failed, await governance.getProposalState(proposalId));
      await expectRevert(governance.execute(proposalId), 'only queued proposals');

      await governance.cancel(proposalId, {from: daoOperator});
      Helper.assertEqual(ProposalState.Canceled, await governance.getProposalState(proposalId));
      await expectRevert(governance.execute(proposalId), 'only queued proposals');

      // can not execute executed proposal
      currentTime = new BN(await Helper.getCurrentBlockTime());
      proposalId = await createBinaryProposal(
        executor.address,
        votingStrategy.address,
        targets,
        [0],
        signatures,
        calldatas,
        withDelegatecalls,
        currentTime,
        currentTime,
        'link to desc'
      );

      await executor.setData(true, true, true); // set proposal is passed
      await governance.queue(proposalId); // can queue the proposal
      await governance.execute(proposalId); // can execute the proposal
      Helper.assertEqual(ProposalState.Executed, await governance.getProposalState(proposalId));
      await expectRevert(governance.execute(proposalId), 'only queued proposals');

      // can not queue expired proposal
      currentTime = new BN(await Helper.getCurrentBlockTime());
      proposalId = await createBinaryProposal(
        executor.address,
        votingStrategy.address,
        targets,
        [0],
        signatures,
        calldatas,
        withDelegatecalls,
        currentTime,
        currentTime,
        'link to desc'
      );

      await executor.setData(true, true, true); // set proposal is passed
      await governance.queue(proposalId); // can queue the proposal
      await executor.setExecutionData(false, false, false, false, true, 0);
      Helper.assertEqual(ProposalState.Expired, await governance.getProposalState(proposalId));
      await expectRevert(governance.execute(proposalId), 'only queued proposals');
      await executor.setExecutionData(true, true, true, true, true, 0);
    });

    it('reverts executor execute tx failed ', async () => {
      // can not queue expired proposal
      let currentTime = new BN(await Helper.getCurrentBlockTime());
      let proposalId = await createBinaryProposal(
        executor.address,
        votingStrategy.address,
        targets,
        [new BN(1)],
        signatures,
        calldatas,
        withDelegatecalls,
        currentTime,
        currentTime,
        'link to desc'
      );

      await executor.setData(true, true, true); // set proposal is passed
      await executor.setExecutionData(false, false, false, false, false, 30);
      await governance.queue(proposalId);
      // wei value > 0 while governance doens't have any eth
      await expectRevert.unspecified(governance.execute(proposalId));

      currentTime = new BN(await Helper.getCurrentBlockTime());
      proposalId = await createBinaryProposal(
        executor.address,
        votingStrategy.address,
        targets,
        [0],
        signatures,
        calldatas,
        withDelegatecalls,
        currentTime,
        currentTime,
        'link to desc'
      );

      await executor.setData(true, true, true); // set proposal is passed
      await executor.setExecutionData(false, true, false, false, false, 30);
      await governance.queue(proposalId);
      // executor reverts when execute tx
      await expectRevert.unspecified(governance.execute(proposalId));
      await executor.setExecutionData(false, false, false, false, false, 30);
    });

    it('execute records correct data and event', async () => {
      let currentTime = new BN(await Helper.getCurrentBlockTime());
      let proposalId = await createBinaryProposal(
        executor.address,
        votingStrategy.address,
        targets,
        [0],
        signatures,
        calldatas,
        withDelegatecalls,
        currentTime,
        currentTime,
        'link to desc'
      );

      await executor.setData(true, true, true); // set proposal is passed
      let delay = 30;
      await executor.setExecutionData(false, false, false, false, false, delay);
      await governance.queue(proposalId, {from: accounts[5]}); // can queue the proposal
      let tx = await governance.execute(proposalId, {from: accounts[6]});
      expectEvent(tx, 'ProposalExecuted', {
        proposalId: proposalId,
        initiatorExecution: accounts[6],
      });

      Helper.assertEqual(ProposalState.Executed, await governance.getProposalState(proposalId));
      let data = await governance.getProposalById(proposalId);
      Helper.assertEqual(data.executed, true);
    });
  });

  const checkVoteDataChange = async (
    proposalId,
    totalVotes,
    options,
    voteCounts,
    voter,
    voterVotingPower,
    voterVoteOption
  ) => {
    let voteData = await governance.getProposalVoteDataById(proposalId);
    Helper.assertEqual(totalVotes, voteData[0], 'wrong total votes');
    Helper.assertEqualArray(voteCounts, voteData[1], 'wrong vote count for each option');
    Helper.assertEqualArray(options, voteData[2], 'wrong options data');
    let voterVoteData = await governance.getVoteOnProposal(proposalId, voter);
    Helper.assertEqual(voterVotingPower, voterVoteData.votingPower, "wrong voter's voting power");
    Helper.assertEqual(voterVoteOption, voterVoteData.optionBitMask, "wrong voter's voting options");
  };

  describe('#test vote', async () => {
    beforeEach('setup', async () => {
      governance = await KyberGovernance.new(
        admin,
        daoOperator,
        [validator.address, executor.address],
        [votingStrategy.address]
      );
    });

    it('reverts invalid proposal id', async () => {
      let proposalCount = await governance.getProposalsCount();
      await expectRevert(governance.submitVote(proposalCount, 1), 'invalid proposal id');
    });

    it('reverts invalid state to vote', async () => {
      let currentTime = new BN(await Helper.getCurrentBlockTime());
      let proposalId = await createGenericProposal(
        executor.address,
        votingStrategy.address,
        ['option 1', 'option 2'],
        currentTime.add(new BN(30)),
        currentTime.add(new BN(60)),
        'link to desc'
      );
      Helper.assertEqual(ProposalState.Pending, await governance.getProposalState(proposalId));
      await expectRevert(governance.submitVote(proposalId, 1), 'voting closed');
      await Helper.mineNewBlockAfter(60);
      Helper.assertEqual(ProposalState.Finalized, await governance.getProposalState(proposalId));
      await expectRevert(governance.submitVote(proposalId, 1), 'voting closed');

      currentTime = new BN(await Helper.getCurrentBlockTime());
      proposalId = await createGenericProposal(
        executor.address,
        votingStrategy.address,
        ['option 1', 'option 2'],
        currentTime.add(new BN(30)),
        currentTime.add(new BN(60)),
        'link to desc'
      );
      await governance.cancel(proposalId, {from: daoOperator});
      Helper.assertEqual(ProposalState.Canceled, await governance.getProposalState(proposalId));
      await expectRevert(governance.submitVote(proposalId, 1), 'voting closed');

      currentTime = new BN(await Helper.getCurrentBlockTime());
      proposalId = await createBinaryProposal(
        executor.address,
        votingStrategy.address,
        targets,
        [0],
        signatures,
        calldatas,
        withDelegatecalls,
        currentTime,
        currentTime,
        'link to desc'
      );
      await executor.setData(true, true, false); // proposal failed
      Helper.assertEqual(ProposalState.Failed, await governance.getProposalState(proposalId));
      await expectRevert(governance.submitVote(proposalId, 1), 'voting closed');
      await executor.setData(true, true, true); // proposal passed
      await governance.queue(proposalId);
      Helper.assertEqual(ProposalState.Queued, await governance.getProposalState(proposalId));
      await expectRevert(governance.submitVote(proposalId, 1), 'voting closed');

      // check expiry returns true
      await executor.setExecutionData(false, false, false, false, true, 0);
      Helper.assertEqual(ProposalState.Expired, await governance.getProposalState(proposalId));
      await expectRevert(governance.submitVote(proposalId, 1), 'voting closed');

      // check expiry returns false
      await executor.setExecutionData(false, false, false, false, false, 0);
      await governance.execute(proposalId);
      Helper.assertEqual(ProposalState.Executed, await governance.getProposalState(proposalId));
      await expectRevert(governance.submitVote(proposalId, 1), 'voting closed');
    });

    it('binary - reverts invalid option', async () => {
      let currentTime = new BN(await Helper.getCurrentBlockTime());
      let proposalId = await createBinaryProposal(
        executor.address,
        votingStrategy.address,
        targets,
        [0],
        signatures,
        calldatas,
        withDelegatecalls,
        currentTime,
        currentTime.add(new BN(100)),
        'link to desc'
      );
      await expectRevert(governance.submitVote(proposalId, 3), 'wrong vote for binary proposal');
      await expectRevert(governance.submitVote(proposalId, 0), 'wrong vote for binary proposal');
    });

    it('generic - reverts invalid option', async () => {
      let currentTime = new BN(await Helper.getCurrentBlockTime());
      let options = ['option 1', 'option 2'];
      let proposalId = await createGenericProposal(
        executor.address,
        votingStrategy.address,
        options,
        currentTime,
        currentTime.add(new BN(60)),
        'link to desc'
      );
      await expectRevert(governance.submitVote(proposalId, 0), 'invalid options for generic proposal');
      await expectRevert(
        governance.submitVote(proposalId, new BN(2).pow(new BN(options.length))),
        'invalid options for generic proposal'
      );
      await expectRevert(
        governance.submitVote(proposalId, new BN(2).pow(new BN(options.length)).add(new BN(1))),
        'invalid options for generic proposal'
      );
    });

    it('reverts voting strategy handleVote reverts', async () => {
      let currentTime = new BN(await Helper.getCurrentBlockTime());
      let options = ['option 1', 'option 2'];
      let proposalId = await createGenericProposal(
        executor.address,
        votingStrategy.address,
        options,
        currentTime,
        currentTime.add(new BN(60)),
        'link to desc'
      );
      await votingStrategy.setRevertStates(false, false, true); // revert in handle vote func
      await expectRevert.unspecified(governance.submitVote(proposalId, 1));
      await votingStrategy.setRevertStates(false, false, false);
    });

    it('reverts voting power is bigger than uint224', async () => {
      let currentTime = new BN(await Helper.getCurrentBlockTime());
      let options = ['option 1', 'option 2'];
      let proposalId = await createGenericProposal(
        executor.address,
        votingStrategy.address,
        options,
        currentTime,
        currentTime.add(new BN(60)),
        'link to desc'
      );

      let voter = accounts[5];
      let voterVotingPower = new BN(2).pow(new BN(224));
      await votingStrategy.setVotingPower(voter, voterVotingPower);
      await expectRevert(governance.submitVote(proposalId, 1, {from: voter}), 'value is too big (uint224)');
      await votingStrategy.setVotingPower(voter, 0);
    });

    it('reverts voting options is bigger than uint32', async () => {
      let currentTime = new BN(await Helper.getCurrentBlockTime());
      let options = [];
      for (let i = 0; i <= 32; i++) {
        options.push('option');
      }
      let proposalId = await createGenericProposal(
        executor.address,
        votingStrategy.address,
        options,
        currentTime,
        currentTime.add(new BN(60)),
        'link to desc'
      );

      let voter = accounts[5];
      let voterVotingPower = new BN(2).pow(new BN(20));
      await votingStrategy.setVotingPower(voter, voterVotingPower);
      await expectRevert(
        governance.submitVote(proposalId, new BN(2).pow(new BN(32)), {from: voter}),
        'value is too big (uint32)'
      );
    });

    it('generic - vote correct data and event', async () => {
      let currentTime = new BN(await Helper.getCurrentBlockTime());
      let options = ['option 1', 'option 2', 'option 3'];
      let voteCounts = [new BN(0), new BN(0), new BN(0)];
      let proposalId = await createGenericProposal(
        executor.address,
        votingStrategy.address,
        options,
        currentTime,
        currentTime.add(new BN(60)),
        'link to desc'
      );

      let voter = accounts[5];
      let voterVotingPower = new BN(10).pow(new BN(20));
      await votingStrategy.setVotingPower(voter, voterVotingPower);
      Helper.assertEqual(voterVotingPower, await votingStrategy.getVotingPower(voter, currentTime));

      let totalVotes = voterVotingPower;
      let oldOptions = 0;
      for (let i = 1; i < 2 ** voteCounts.length; i++) {
        let tx = await governance.submitVote(proposalId, i, {from: voter});
        expectEvent(tx, 'VoteEmitted', {
          proposalId: proposalId,
          voter: voter,
          voteOptions: new BN(i),
          votingPower: voterVotingPower,
        });
        voteCounts = updateVoteCountsOnOptionChanges(voteCounts, oldOptions, i, voterVotingPower);
        await checkVoteDataChange(proposalId, totalVotes, options, voteCounts, voter, voterVotingPower, i);
        oldOptions = i;
      }
    });

    it('generic - vote by signature correct data and event', async () => {
      let currentTime = new BN(await Helper.getCurrentBlockTime());
      let options = ['option 1', 'option 2', 'option 3'];
      let voteCounts = [new BN(0), new BN(0), new BN(0)];
      let proposalId = await createGenericProposal(
        executor.address,
        votingStrategy.address,
        options,
        currentTime,
        currentTime.add(new BN(60)),
        'link to desc'
      );

      let user = accounts[5];
      let userPk = TestWallets.accounts[5].privateKey;
      let userVotingPower = new BN(10).pow(new BN(20));
      await votingStrategy.setVotingPower(user, userVotingPower);
      Helper.assertEqual(userVotingPower, await votingStrategy.getVotingPower(user, currentTime));

      // test revert for invalid signature
      const digest = await getDigest(proposalId, 1, chainId, governance.address);
      let signature = ecsign(Buffer.from(digest.slice(2), 'hex'), Buffer.from(userPk.slice(2), 'hex'));
      await expectRevert(
        governance.submitVoteBySignature(proposalId, 1, 0, signature.r, signature.s, {
          from: accounts[6],
        }),
        'invalid signature'
      );

      let totalVotes = userVotingPower;
      let oldOptions = 0;
      for (let i = 1; i < 2 ** voteCounts.length; i++) {
        const digest = await getDigest(proposalId, i, chainId, governance.address);
        let signature = ecsign(Buffer.from(digest.slice(2), 'hex'), Buffer.from(userPk.slice(2), 'hex'));
        let tx = await governance.submitVoteBySignature(proposalId, i, signature.v, signature.r, signature.s, {
          from: accounts[6],
        });
        expectEvent(tx, 'VoteEmitted', {
          proposalId: proposalId,
          voter: user,
          voteOptions: new BN(i),
          votingPower: userVotingPower,
        });
        voteCounts = updateVoteCountsOnOptionChanges(voteCounts, oldOptions, i, userVotingPower);
        await checkVoteDataChange(proposalId, totalVotes, options, voteCounts, user, userVotingPower, i);
        oldOptions = i;
      }
    });

    it('binary - vote correct data and event', async () => {
      let currentTime = new BN(await Helper.getCurrentBlockTime());
      let options = ['YES', 'NO'];
      let voteCounts = [new BN(0), new BN(0)];
      let proposalId = await createBinaryProposal(
        executor.address,
        votingStrategy.address,
        targets,
        weiValues,
        signatures,
        calldatas,
        withDelegatecalls,
        currentTime,
        currentTime.add(new BN(60)),
        'link to desc'
      );

      let voter = accounts[5];
      let voterVotingPower = new BN(10).pow(new BN(20));
      await votingStrategy.setVotingPower(voter, voterVotingPower);
      Helper.assertEqual(voterVotingPower, await votingStrategy.getVotingPower(voter, currentTime));

      let totalVotes = voterVotingPower;
      let oldOptions = 0;
      for (let i = 1; i <= 2; i++) {
        let tx = await governance.submitVote(proposalId, i, {from: voter});
        expectEvent(tx, 'VoteEmitted', {
          proposalId: proposalId,
          voter: voter,
          voteOptions: new BN(i),
          votingPower: voterVotingPower,
        });
        voteCounts = updateVoteCountsOnOptionChanges(voteCounts, oldOptions, i, voterVotingPower);
        await checkVoteDataChange(proposalId, totalVotes, options, voteCounts, voter, voterVotingPower, i);
        oldOptions = i;
      }
    });

    it('binary - vote by signature correct data and event', async () => {
      let currentTime = new BN(await Helper.getCurrentBlockTime());
      let options = ['YES', 'NO'];
      let voteCounts = [new BN(0), new BN(0)];
      let proposalId = await createBinaryProposal(
        executor.address,
        votingStrategy.address,
        targets,
        weiValues,
        signatures,
        calldatas,
        withDelegatecalls,
        currentTime,
        currentTime.add(new BN(60)),
        'link to desc'
      );

      let user = accounts[5];
      let userPk = TestWallets.accounts[5].privateKey;
      let userVotingPower = new BN(10).pow(new BN(20));
      await votingStrategy.setVotingPower(user, userVotingPower);
      Helper.assertEqual(userVotingPower, await votingStrategy.getVotingPower(user, currentTime));

      let totalVotes = userVotingPower;
      let oldOptions = 0;
      for (let i = 1; i <= 2; i++) {
        const digest = await getDigest(proposalId, i, chainId, governance.address);
        let signature = ecsign(Buffer.from(digest.slice(2), 'hex'), Buffer.from(userPk.slice(2), 'hex'));
        let tx = await governance.submitVoteBySignature(proposalId, i, signature.v, signature.r, signature.s, {
          from: accounts[6],
        });
        expectEvent(tx, 'VoteEmitted', {
          proposalId: proposalId,
          voter: user,
          voteOptions: new BN(i),
          votingPower: userVotingPower,
        });
        voteCounts = updateVoteCountsOnOptionChanges(voteCounts, oldOptions, i, userVotingPower);
        await checkVoteDataChange(proposalId, totalVotes, options, voteCounts, user, userVotingPower, i);
        oldOptions = i;
      }
    });
  });

  describe('#test handle voting power changes', async () => {
    beforeEach('setup', async () => {
      governance = await KyberGovernance.new(
        admin,
        daoOperator,
        [validator.address, executor.address],
        [votingStrategy.address]
      );
    });

    it('reverts invalid proposal id', async () => {
      let proposalCount = await governance.getProposalsCount();
      let voter = accounts[0];
      await expectRevert(
        governance.handleVotingPowerChanged(voter, new BN(0), [proposalCount], {from: voter}),
        'invalid proposal id'
      );
    });

    it('no updates for proposal that is not active', async () => {
      let currentTime = new BN(await Helper.getCurrentBlockTime());
      let options = ['option 1', 'option 2', 'option 3'];
      let voteCounts = [new BN(0), new BN(0), new BN(0)];

      let voter = accounts[5];
      let voterVotingPower = new BN(10).pow(new BN(20));
      await votingStrategy.setVotingPower(voter, voterVotingPower);

      let proposalId = await createGenericProposal(
        executor.address,
        votingStrategy.address,
        options,
        currentTime.add(new BN(20)),
        currentTime.add(new BN(60)),
        'link to desc'
      );
      await checkVoteDataChange(proposalId, 0, options, voteCounts, voter, 0, 0);
      Helper.assertEqual(ProposalState.Pending, await governance.getProposalState(proposalId));
      let newVotingPower = voterVotingPower.div(new BN(2));
      await governance.handleVotingPowerChanged(voter, newVotingPower, [proposalId]);
      // no data should be recorded
      await checkVoteDataChange(proposalId, 0, options, voteCounts, voter, 0, 0);

      await Helper.mineNewBlockAfter(20);
      Helper.assertEqual(ProposalState.Active, await governance.getProposalState(proposalId));
      let voteOption = 1;
      await governance.submitVote(proposalId, voteOption, {from: voter});
      voteCounts = updateVoteCountsOnOptionChanges(voteCounts, 0, voteOption, voterVotingPower);
      await checkVoteDataChange(
        proposalId,
        voterVotingPower,
        options,
        voteCounts,
        voter,
        voterVotingPower,
        voteOption
      );
      await Helper.mineNewBlockAfter(60);

      Helper.assertEqual(ProposalState.Finalized, await governance.getProposalState(proposalId));
      await governance.handleVotingPowerChanged(voter, newVotingPower, [proposalId]);
      // no changes
      await checkVoteDataChange(
        proposalId,
        voterVotingPower,
        options,
        voteCounts,
        voter,
        voterVotingPower,
        voteOption
      );
    });

    it('reverts invalid voting power strategy of a proposal', async () => {
      let newVotingStrategy = await MockVotingPowerStrategy.new();
      governance = await KyberGovernance.new(
        admin,
        daoOperator,
        [validator.address, executor.address],
        [votingStrategy.address, newVotingStrategy.address]
      );
      let currentTime = new BN(await Helper.getCurrentBlockTime());
      let proposalId1 = await createGenericProposal(
        executor.address,
        newVotingStrategy.address,
        ['op1', 'op2'],
        currentTime,
        currentTime.add(new BN(50)),
        'link to desc'
      );
      let proposalId2 = await createBinaryProposal(
        executor.address,
        votingStrategy.address,
        targets,
        weiValues,
        signatures,
        calldatas,
        withDelegatecalls,
        currentTime,
        currentTime.add(new BN(50)),
        'link to desc'
      );
      let newVotingPower = new BN(10).pow(new BN(20));
      await expectRevert(
        newVotingStrategy.callbackWithdrawal(governance.address, voter, newVotingPower, [proposalId1, proposalId2]),
        'invalid voting power strategy'
      );
      await expectRevert(
        votingStrategy.callbackWithdrawal(governance.address, voter, newVotingPower, [proposalId1, proposalId2]),
        'invalid voting power strategy'
      );
      await expectRevert(
        governance.handleVotingPowerChanged(voter, newVotingPower, [proposalId1, proposalId2]),
        'invalid voting power strategy'
      );
      await votingStrategy.callbackWithdrawal(governance.address, voter, newVotingPower, [proposalId2]);
      await newVotingStrategy.callbackWithdrawal(governance.address, voter, newVotingPower, [proposalId1]);
      governance = await KyberGovernance.new(
        admin,
        daoOperator,
        [validator.address, executor.address],
        [votingStrategy.address]
      );
    });

    it('no changes when voter has not voted yet', async () => {
      let voter1 = accounts[4];
      let voter1VotingPower = new BN(10).pow(new BN(20));
      await votingStrategy.setVotingPower(voter1, voter1VotingPower);
      let voter2 = accounts[5];

      let currentTime = new BN(await Helper.getCurrentBlockTime());
      let options = ['opton1', 'option2'];
      let voteCounts = [new BN(0), new BN(0)];
      let proposalId = await createGenericProposal(
        executor.address,
        votingStrategy.address,
        options,
        currentTime,
        currentTime.add(new BN(50)),
        'link to desc'
      );
      await governance.submitVote(proposalId, 1, {from: voter1});
      let totalVotes = voter1VotingPower;
      voteCounts = updateVoteCountsOnOptionChanges(voteCounts, 0, 1, voter1VotingPower);

      await checkVoteDataChange(proposalId, totalVotes, options, voteCounts, voter1, voter1VotingPower, 1);
      await checkVoteDataChange(proposalId, totalVotes, options, voteCounts, voter2, 0, 0);

      let newVotingPower = new BN(10).pow(new BN(10));
      await votingStrategy.callbackWithdrawal(governance.address, voter2, newVotingPower, [proposalId]);
      // no changes
      await checkVoteDataChange(proposalId, totalVotes, options, voteCounts, voter1, voter1VotingPower, 1);
      await checkVoteDataChange(proposalId, totalVotes, options, voteCounts, voter2, 0, 0);

      await votingStrategy.callbackWithdrawal(governance.address, voter1, newVotingPower, [proposalId]);
      totalVotes = newVotingPower;
      voteCounts = updateVoteCountsOnVotingPowerChanges(voteCounts, 1, voter1VotingPower, newVotingPower);
      await checkVoteDataChange(proposalId, totalVotes, options, voteCounts, voter1, newVotingPower, 1);
      await checkVoteDataChange(proposalId, totalVotes, options, voteCounts, voter2, 0, 0);
    });

    it('no changes when voter has not voted yet', async () => {
      let voter1 = accounts[4];
      let voter1VotingPower = new BN(10).pow(new BN(20));
      await votingStrategy.setVotingPower(voter1, voter1VotingPower);
      let voter2 = accounts[5];

      let currentTime = new BN(await Helper.getCurrentBlockTime());
      let options = ['opton1', 'option2'];
      let voteCounts = [new BN(0), new BN(0)];
      let proposalId = await createGenericProposal(
        executor.address,
        votingStrategy.address,
        options,
        currentTime,
        currentTime.add(new BN(50)),
        'link to desc'
      );
      await governance.submitVote(proposalId, 1, {from: voter1});
      let totalVotes = voter1VotingPower;
      voteCounts = updateVoteCountsOnOptionChanges(voteCounts, 0, 1, voter1VotingPower);

      await checkVoteDataChange(proposalId, totalVotes, options, voteCounts, voter1, voter1VotingPower, 1);
      await checkVoteDataChange(proposalId, totalVotes, options, voteCounts, voter2, 0, 0);

      let newVotingPower = new BN(10).pow(new BN(10));
      let txResult = await votingStrategy.callbackWithdrawal(governance.address, voter2, newVotingPower, [proposalId]);
      // no changes
      await checkVoteDataChange(proposalId, totalVotes, options, voteCounts, voter1, voter1VotingPower, 1);
      await checkVoteDataChange(proposalId, totalVotes, options, voteCounts, voter2, 0, 0);
      await expectEvent.notEmitted.inTransaction(txResult.tx, governance, 'VotingPowerChanged');

      txResult = await votingStrategy.callbackWithdrawal(governance.address, voter1, newVotingPower, [proposalId]);
      totalVotes = newVotingPower;
      voteCounts = updateVoteCountsOnVotingPowerChanges(voteCounts, 1, voter1VotingPower, newVotingPower);
      await checkVoteDataChange(proposalId, totalVotes, options, voteCounts, voter1, newVotingPower, 1);
      await checkVoteDataChange(proposalId, totalVotes, options, voteCounts, voter2, 0, 0);
      await expectEvent.inTransaction(txResult.tx, governance, 'VotingPowerChanged', {
        proposalId: proposalId,
        voter: voter1,
        voteOptions: '1',
        oldVotingPower: voter1VotingPower,
        newVotingPower: newVotingPower,
      });
    });

    it('vote data changes correctly', async () => {
      let voter1 = accounts[4];
      let voter1VotingPower = new BN(10).pow(new BN(20));
      await votingStrategy.setVotingPower(voter1, voter1VotingPower);
      let voter2 = accounts[5];
      let voter2VotingPower = new BN(10).pow(new BN(19));
      await votingStrategy.setVotingPower(voter2, voter2VotingPower);

      let currentTime = new BN(await Helper.getCurrentBlockTime());
      let options = ['opton1', 'option2'];
      let voteCounts = [new BN(0), new BN(0)];
      let proposalId = await createGenericProposal(
        executor.address,
        votingStrategy.address,
        options,
        currentTime,
        currentTime.add(new BN(50)),
        'link to desc'
      );
      await governance.submitVote(proposalId, 1, {from: voter1});
      await governance.submitVote(proposalId, 2, {from: voter2});
      let totalVotes = voter1VotingPower.add(voter2VotingPower);
      voteCounts = updateVoteCountsOnOptionChanges(voteCounts, 0, 1, voter1VotingPower);
      voteCounts = updateVoteCountsOnOptionChanges(voteCounts, 0, 2, voter2VotingPower);

      await checkVoteDataChange(proposalId, totalVotes, options, voteCounts, voter1, voter1VotingPower, 1);
      await checkVoteDataChange(proposalId, totalVotes, options, voteCounts, voter2, voter2VotingPower, 2);

      let newVotingPower1 = new BN(10).pow(new BN(10));
      let tx = await votingStrategy.callbackWithdrawal(governance.address, voter1, newVotingPower1, [proposalId]);

      totalVotes = totalVotes.sub(voter1VotingPower).add(newVotingPower1);
      voteCounts = updateVoteCountsOnVotingPowerChanges(voteCounts, 1, voter1VotingPower, newVotingPower1);
      await checkVoteDataChange(proposalId, totalVotes, options, voteCounts, voter1, newVotingPower1, 1);
      await checkVoteDataChange(proposalId, totalVotes, options, voteCounts, voter2, voter2VotingPower, 2);

      let newVotingPower2 = new BN(10).pow(new BN(12));
      tx = await votingStrategy.callbackWithdrawal(governance.address, voter2, newVotingPower2, [proposalId]);
      totalVotes = totalVotes.sub(voter2VotingPower).add(newVotingPower2);
      voteCounts = updateVoteCountsOnVotingPowerChanges(voteCounts, 2, voter2VotingPower, newVotingPower2);
      await checkVoteDataChange(proposalId, totalVotes, options, voteCounts, voter2, newVotingPower2, 2);
    });
  });
});

function updateVoteCountsOnOptionChanges(voteCounts, oldOptions, newOptions, votingPower) {
  for (let i = 0; i < 2 ** voteCounts.length; i++) {
    let hasVoted = (oldOptions & (2 ** i)) == 2 ** i;
    let isVoting = (newOptions & (2 ** i)) == 2 ** i;
    if (hasVoted && !isVoting) {
      voteCounts[i] = voteCounts[i].sub(new BN(votingPower));
    } else if (!hasVoted && isVoting) {
      voteCounts[i] = voteCounts[i].add(new BN(votingPower));
    }
  }
  return voteCounts;
}

function updateVoteCountsOnVotingPowerChanges(voteCounts, optionBitMask, oldVotingPower, newVotingPower) {
  for (let i = 0; i < 2 ** voteCounts.length; i++) {
    let hasVoted = (optionBitMask & (2 ** i)) == 2 ** i;
    if (hasVoted) {
      voteCounts[i] = voteCounts[i].sub(new BN(oldVotingPower)).add(new BN(newVotingPower));
    }
  }
  return voteCounts;
}

function getDigest(proposalId, optionBitMask, chainId, governanceAddr) {
  const domainSeparator = web3.utils.soliditySha3(
    web3.eth.abi.encodeParameters(
      ['bytes32', 'bytes32', 'uint256', 'address'],
      [DOMAIN_TYPEHASH, web3.utils.soliditySha3('Kyber Governance'), chainId, governanceAddr]
    )
  );
  const msg = web3.utils.soliditySha3(
    web3.eth.abi.encodeParameters(
      ['bytes32', 'uint256', 'uint256'],
      [VOTE_EMITTED_TYPEHASH, proposalId.toNumber(), optionBitMask]
    )
  );
  return web3.utils.soliditySha3(
    '0x' +
      Buffer.concat([
        Buffer.from('1901', 'hex'),
        Buffer.from(domainSeparator.slice(2), 'hex'),
        Buffer.from(msg.slice(2), 'hex'),
      ]).toString('hex')
  );
}

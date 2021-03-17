const expectEvent = require('@openzeppelin/test-helpers/src/expectEvent');
const {expect} = require('chai');
const {artifacts, contract} = require('hardhat');
const Helper = require('./helper');
const BN = web3.utils.BN;

const KNC = artifacts.require('KyberNetworkTokenV2.sol');
const KyberStaking = artifacts.require('KyberStaking.sol');
const EpochVotingPowerStrategy = artifacts.require('EpochVotingPowerStrategy');
const KyberGovernance = artifacts.require('KyberGovernance');
const Executor = artifacts.require('DefaultExecutor');
const ERC20NoReturnMock = artifacts.require('ERC20NoReturnMock');

let daoOperator;
let knc;
let staking;
let governance;
let longExecutor;
let shortExecutor;
let votingPowerStrategy;

/// staking constant
const epochPeriod = 20;
const blockTime = 16;

/// executor constant
const delay = new BN(0); // no-delay
const gracePeriod = new BN(24).mul(new BN(3600)); // 1 days
const minimumDelay = new BN(0);
const maximumDelay = new BN(24).mul(new BN(3600));
const minVotingDuration = new BN(5);
const maxVotingOptions = new BN(5);
const voteDifferential = new BN(0); // 0%
const minimumQuorum = new BN(5000); // 50%

const link = 'test';

let startBlock;
let currentBlock;
let currentChainTime;

const blockToTimestamp = function (block) {
  return currentChainTime + (block - currentBlock) * blockTime;
};

const blocksToSeconds = function (blocks) {
  return blocks * blockTime;
};

contract('integration test governance + staking + voting power strategy + executor', (accounts) => {
  beforeEach('init', async () => {
    daoOperator = accounts[1];
    user1 = accounts[2];
    addressTo = accounts[3];
    // init knc and staking contract
    currentBlock = await Helper.getCurrentBlock();
    currentChainTime = await Helper.getCurrentBlockTime();
    startBlock = currentBlock + 50;
    knc = await KNC.new();
    staking = await KyberStaking.new(
      daoOperator,
      knc.address,
      blocksToSeconds(epochPeriod),
      blockToTimestamp(startBlock)
    );
    governance = await KyberGovernance.new(daoOperator /* daoOperator is temporary admin */, daoOperator, [], []);
    votingPowerStrategy = await EpochVotingPowerStrategy.new(governance.address, staking.address);
    await governance.authorizeVotingPowerStrategies([votingPowerStrategy.address], {from: daoOperator});
    // setup 2 executor but only authorize 1
    longExecutor = await Executor.new(
      governance.address,
      delay,
      gracePeriod,
      minimumDelay,
      maximumDelay,
      minVotingDuration,
      maxVotingOptions,
      voteDifferential,
      minimumQuorum
    );
    shortExecutor = await Executor.new(
      governance.address,
      delay,
      gracePeriod,
      minimumDelay,
      maximumDelay,
      minVotingDuration,
      maxVotingOptions,
      voteDifferential,
      minimumQuorum
    );
    await governance.authorizeExecutors([longExecutor.address], {from: daoOperator});
    // wrap up
    await staking.updateWithdrawHandler(votingPowerStrategy.address, {from: daoOperator});
    await governance.transferAdminQuickly(longExecutor.address, {from: daoOperator});
  });

  async function depositMinimumQuorum(user1, staking, knc, minimumQuorum) {
    let minimumQuorumAmount = (await knc.totalSupply()).mul(minimumQuorum).div(Helper.BPS);
    await knc.transfer(user1, minimumQuorumAmount);
    await knc.approve(staking.address, minimumQuorumAmount, {from: user1});
    await staking.deposit(minimumQuorumAmount, {from: user1});
  }

  it('authorize new executor', async () => {
    const authorizeSignature = 'authorizeExecutors(address[])';
    const authorizeCalldata = web3.eth.abi.encodeParameters(['address[]'], [[shortExecutor.address]]);
    // user1 deposit
    await depositMinimumQuorum(user1, staking, knc, minimumQuorum);

    await governance.createBinaryProposal(
      longExecutor.address,
      votingPowerStrategy.address,
      {
        targets: [governance.address],
        weiValues: [0],
        signatures: [authorizeSignature],
        calldatas: [authorizeCalldata],
        withDelegatecalls: [false],
      },
      blockToTimestamp(startBlock + 1),
      blockToTimestamp(startBlock + epochPeriod) - 1,
      link,
      {from: daoOperator}
    );
    const proposalID = new BN(0);
    // jump to epoch 1
    await Helper.mineNewBlockAt(blockToTimestamp(startBlock + 1));
    await governance.submitVote(proposalID, new BN(1), {from: user1});
    // check when campaign ends
    await Helper.mineNewBlockAt(blockToTimestamp(startBlock + epochPeriod));
    Helper.assertEqual(await governance.getProposalState(proposalID), Helper.ProposalState.Succeeded);
    await governance.queue(proposalID);
    // execute and verify result
    let txResult = await governance.execute(proposalID);
    expectEvent(txResult, 'ExecutorAuthorized', {executor: shortExecutor.address});
    expect(await governance.isExecutorAuthorized(shortExecutor.address), 'short executor should be authorized');
  });

  it('transfer special token', async () => {
    const tokenValue = new BN(10).pow(new BN(18));
    const mockUsdt = await ERC20NoReturnMock.new('test', 'tsk', new BN(10).pow(new BN(27)));
    await mockUsdt.transfer(longExecutor.address, tokenValue);

    const authorizeSignature = 'transfer(address,uint256)';
    const authorizeCalldata = web3.eth.abi.encodeParameters(
      ['address', 'uint256'],
      [addressTo, tokenValue.toString()]
    );
    // user1 deposit
    await depositMinimumQuorum(user1, staking, knc, minimumQuorum);

    await governance.createBinaryProposal(
      longExecutor.address,
      votingPowerStrategy.address,
      {
        targets: [mockUsdt.address],
        weiValues: [0],
        signatures: [authorizeSignature],
        calldatas: [authorizeCalldata],
        withDelegatecalls: [false],
      },
      blockToTimestamp(startBlock + 1),
      blockToTimestamp(startBlock + epochPeriod) - 1,
      link,
      {from: daoOperator}
    );
    const proposalID = new BN(0);
    // jump to epoch 1
    await Helper.mineNewBlockAt(blockToTimestamp(startBlock + 1));
    await governance.submitVote(proposalID, new BN(1), {from: user1});
    // check when campaign ends
    await Helper.mineNewBlockAt(blockToTimestamp(startBlock + epochPeriod));
    Helper.assertEqual(await governance.getProposalState(proposalID), Helper.ProposalState.Succeeded);
    await governance.queue(proposalID);
    // execute and verify result
    await governance.execute(proposalID);
    Helper.assertEqual(await mockUsdt.balanceOf(addressTo), tokenValue);
  });
});

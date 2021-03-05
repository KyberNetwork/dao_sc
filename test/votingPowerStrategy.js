const {expectRevert} = require('@openzeppelin/test-helpers');
const expectEvent = require('@openzeppelin/test-helpers/src/expectEvent');
const {assert} = require('chai');
const {artifacts} = require('hardhat');
const BN = web3.utils.BN;
const Helper = require('./helper');

const TestToken = artifacts.require('KyberNetworkTokenV2.sol');
const StakingContract = artifacts.require('KyberStaking.sol');
const VotingPowerStrategy = artifacts.require('KyberVotingPowerStrategy.sol');
const MockGovernance = artifacts.require('MockKyberGovernance');

let kncToken;
let governance;
let admin;
let votingPowerStrategy;
let stakingContract;

const blockTime = 16;
const MAX_PROPOSAL_PER_EPOCH = 10;
let epochPeriod;
let startBlock;
let currentChainTime;

contract('VotingPowerStrategy', (accounts) => {
  before('setup', async () => {
    governance = accounts[1];
    admin = accounts[2];
    victor = accounts[3];
    loi = accounts[4];
  });

  const blockToTimestamp = function (block) {
    return currentChainTime + (block - currentBlock) * blockTime;
  };

  const blocksToSeconds = function (blocks) {
    return blocks * blockTime;
  };

  const deployStakingContract = async (_epochPeriod, _startBlock) => {
    epochPeriod = _epochPeriod;
    startBlock = _startBlock;
    console.log(
      `deploy staking contract: period: ${blocksToSeconds(epochPeriod)}, start: ${blockToTimestamp(startBlock)}`
    );
    stakingContract = await StakingContract.new(
      admin,
      kncToken.address,
      blocksToSeconds(epochPeriod),
      blockToTimestamp(startBlock)
    );
  };

  beforeEach('deploy token & staking contract', async () => {
    kncToken = await TestToken.new();

    currentBlock = await Helper.getCurrentBlock();
    currentChainTime = await Helper.getCurrentBlockTime();
    await deployStakingContract(20, currentBlock + 10);
  });

  it('ctor', async () => {
    votingPowerStrategy = await VotingPowerStrategy.new(governance, stakingContract.address);

    Helper.assertEqual(await votingPowerStrategy.epochPeriodInSeconds(), blocksToSeconds(epochPeriod));
    Helper.assertEqual(await votingPowerStrategy.firstEpochStartTime(), blockToTimestamp(startBlock));
    assert.equal(await votingPowerStrategy.governance(), governance, 'mismatch governance field');
    assert.equal(await votingPowerStrategy.staking(), stakingContract.address, 'mismatch staking field');
  });

  describe('handle create & cancel proposal and vote', async () => {
    let mockGovernance;

    it('validateProposalCreation', async () => {
      votingPowerStrategy = await VotingPowerStrategy.new(governance, stakingContract.address);
      /// jump to epoch 1
      await Helper.mineNewBlockAt(blockToTimestamp(startBlock));
      // return false if proposal create time is in the past
      assert.isFalse(
        await votingPowerStrategy.validateProposalCreation(
          blockToTimestamp(startBlock) - 1,
          blockToTimestamp(startBlock + epochPeriod) - 1
        )
      );
      assert.isTrue(
        await votingPowerStrategy.validateProposalCreation(
          blockToTimestamp(startBlock),
          blockToTimestamp(startBlock + epochPeriod) - 1
        )
      );
      // return false if proposal create time and end time are in different epochs
      assert.isFalse(
        await votingPowerStrategy.validateProposalCreation(
          blockToTimestamp(startBlock),
          blockToTimestamp(startBlock + epochPeriod)
        )
      );
      assert.isTrue(
        await votingPowerStrategy.validateProposalCreation(
          blockToTimestamp(startBlock + epochPeriod),
          blockToTimestamp(startBlock + 2 * epochPeriod) - 1
        )
      );
      // return false if the proposal is not current or next epoch
      assert.isFalse(
        await votingPowerStrategy.validateProposalCreation(
          blockToTimestamp(startBlock + 2 * epochPeriod),
          blockToTimestamp(startBlock + 2 * epochPeriod)
        )
      );
      // return false if number of proposal in this epoch is too big
      for (let i = 0; i < MAX_PROPOSAL_PER_EPOCH; i++) {
        await votingPowerStrategy.handleProposalCreation(
          i,
          blockToTimestamp(startBlock + epochPeriod),
          blockToTimestamp(startBlock + epochPeriod * 2) - 1,
          {from: governance}
        );
      }
      assert.isFalse(
        await votingPowerStrategy.validateProposalCreation(
          blockToTimestamp(startBlock + epochPeriod),
          blockToTimestamp(startBlock + epochPeriod * 2) - 1
        )
      );
    });

    it('handleProposalCreation and handleProposalCancellation', async () => {
      mockGovernance = await MockGovernance.new();
      votingPowerStrategy = await VotingPowerStrategy.new(mockGovernance.address, stakingContract.address);
      await mockGovernance.setVotingPowerStrategy(votingPowerStrategy.address);
      // check permission
      await expectRevert(
        votingPowerStrategy.handleProposalCreation(
          0,
          blockToTimestamp(startBlock),
          blockToTimestamp(startBlock + epochPeriod) - 1
        ),
        'only governance'
      );
      // create proposal and result
      await mockGovernance.createProposal(
        0,
        blockToTimestamp(startBlock),
        blockToTimestamp(startBlock + epochPeriod) - 1
      );
      await mockGovernance.createProposal(
        2,
        blockToTimestamp(startBlock),
        blockToTimestamp(startBlock + epochPeriod) - 1
      );
      Helper.assertEqualArray(await votingPowerStrategy.getListProposalIds(1), [0, 2]);
      // check permission
      await expectRevert(votingPowerStrategy.handleProposalCancellation(0), 'only governance');
      // cancel proposal and result
      await mockGovernance.cancelProposal(2);
      Helper.assertEqualArray(await votingPowerStrategy.getListProposalIds(1), [0]);
      // Note: not revert if proposalId not exist
      await mockGovernance.cancelProposal(1);
    });

    it('handleVote', async () => {
      const depositAmount = new BN(10).pow(new BN(18)).mul(new BN(5));
      await kncToken.transfer(victor, depositAmount);
      await kncToken.approve(stakingContract.address, Helper.MAX_ALLOWANCE, {from: victor});
      await stakingContract.deposit(depositAmount, {from: victor});
      votingPowerStrategy = await VotingPowerStrategy.new(governance, stakingContract.address);
      // check permission
      await expectRevert(votingPowerStrategy.handleVote(victor, 1, 2), 'only governance');
      //jump to epoch 1
      Helper.mineNewBlockAt(blockToTimestamp(startBlock));
      await votingPowerStrategy.handleVote(victor, 1, 2, {from: governance});
      // check handleVote should invorke init staker raw data
      let stakerRawData = await stakingContract.getStakerRawData(victor, 2);
      Helper.assertEqual(stakerRawData.stake, depositAmount);
    });
  });

  it('get voting power function', async () => {
    votingPowerStrategy = await VotingPowerStrategy.new(governance, stakingContract.address);
    // victor deposit 5 knc, loi deposit 2 knc and delegate to victor
    await kncToken.transfer(victor, Helper.precisionUnits.mul(new BN(5)));
    await kncToken.approve(stakingContract.address, Helper.MAX_ALLOWANCE, {from: victor});
    await stakingContract.deposit(Helper.precisionUnits.mul(new BN(5)), {from: victor});

    await kncToken.transfer(loi, Helper.precisionUnits.mul(new BN(2)));
    await kncToken.approve(stakingContract.address, Helper.MAX_ALLOWANCE, {from: loi});
    await stakingContract.deposit(Helper.precisionUnits.mul(new BN(2)), {from: loi});
    await stakingContract.delegate(victor, {from: loi});

    Helper.assertEqual(
      await votingPowerStrategy.getVotingPower(victor, blockToTimestamp(startBlock)),
      Helper.precisionUnits.mul(new BN(7))
    );
    Helper.assertEqual(
      await votingPowerStrategy.getVotingPower(victor, blockToTimestamp(startBlock + epochPeriod) - 1),
      Helper.precisionUnits.mul(new BN(7))
    );

    Helper.assertEqual(
      await votingPowerStrategy.getVotingPower(loi, blockToTimestamp(startBlock)),
      Helper.precisionUnits.mul(new BN(0))
    );

    /// jump to epoch 1
    await Helper.mineNewBlockAt(blockToTimestamp(startBlock));
    // victor delegate not to himself
    await stakingContract.delegate(accounts[0], {from: victor});
    // stake values of victor at epoch 1 is unchanged
    Helper.assertEqual(
      await votingPowerStrategy.getVotingPower(victor, blockToTimestamp(startBlock)),
      Helper.precisionUnits.mul(new BN(7))
    );
    // stake values of victor at epoch 2 is equal to total delegate stake
    Helper.assertEqual(
      await votingPowerStrategy.getVotingPower(victor, blockToTimestamp(startBlock + epochPeriod)),
      Helper.precisionUnits.mul(new BN(2))
    );
  });

  it('test handle withdraw function', async () => {
    mockGovernance = await MockGovernance.new();
    votingPowerStrategy = await VotingPowerStrategy.new(mockGovernance.address, stakingContract.address);
    await mockGovernance.setVotingPowerStrategy(votingPowerStrategy.address);
    await stakingContract.updateWithdrawHandler(votingPowerStrategy.address, {from: admin});
    // victor deposit 5 knc, loi deposit 2 knc and delegate to victor
    await kncToken.transfer(victor, Helper.precisionUnits.mul(new BN(5)));
    await kncToken.approve(stakingContract.address, Helper.MAX_ALLOWANCE, {from: victor});
    await stakingContract.deposit(Helper.precisionUnits.mul(new BN(5)), {from: victor});

    await kncToken.transfer(loi, Helper.precisionUnits.mul(new BN(2)));
    await kncToken.approve(stakingContract.address, Helper.MAX_ALLOWANCE, {from: loi});
    await stakingContract.deposit(Helper.precisionUnits.mul(new BN(2)), {from: loi});
    await stakingContract.delegate(victor, {from: loi});
    // jump to epoch 1
    await Helper.mineNewBlockAt(blockToTimestamp(startBlock));
    // create a proposal
    await mockGovernance.createProposal(
      new BN(5),
      blockToTimestamp(startBlock) + 1,
      blockToTimestamp(startBlock + epochPeriod) - 1
    );
    // revert if not call from staking contract
    await expectRevert(votingPowerStrategy.handleWithdrawal(victor, Helper.precisionUnits), 'only staking');
    let result = await stakingContract.withdraw(Helper.precisionUnits, {from: victor});
    expectEvent.notEmitted(result, 'WithdrawDataUpdateFailed');
    await expectEvent.inTransaction(result.tx, mockGovernance, 'VotingPowerChanged', {
      staker: victor,
      newVotingPower: Helper.precisionUnits.mul(new BN(6)),
      proposalIds: ['5'],
    });
    // withdraw from delegator
    result = await stakingContract.withdraw(Helper.precisionUnits, {from: loi});
    expectEvent.notEmitted(result, 'WithdrawDataUpdateFailed');
    await expectEvent.inTransaction(result.tx, mockGovernance, 'VotingPowerChanged', {
      staker: victor,
      newVotingPower: Helper.precisionUnits.mul(new BN(5)),
      proposalIds: ['5'],
    });
  });

  it('getMaxVotingPower', async () => {
    votingPowerStrategy = await VotingPowerStrategy.new(governance, stakingContract.address);
    Helper.assertEqual(await votingPowerStrategy.getMaxVotingPower(), await kncToken.totalSupply());

    await kncToken.burn(Helper.precisionUnits.mul(new BN(10)));
    Helper.assertEqual(await votingPowerStrategy.getMaxVotingPower(), await kncToken.totalSupply());
  });
});

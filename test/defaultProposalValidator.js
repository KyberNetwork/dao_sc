const DefaultProposalValidator = artifacts.require('DefaultProposalValidator.sol');
const SimpleKyberGovernance = artifacts.require('MockSimpleKyberGovernance.sol');
const VotingPowerStrategy = artifacts.require('MockVotingPowerStrategy2.sol');

const Helper = require('./helper.js');
const {zeroBN} = require('./helper.js');
const BN = web3.utils.BN;
const {assert} = require('chai');
const {MAX_UINT256} = require('@openzeppelin/test-helpers/src/constants');

let daoOperator;
let user;
let proposalValidator;
let governance;
let strategy;

// constructor variables
let minVotingDuration;
let maxVotingOptions;
let voteDifferential;
let minimumQuorum;

let currentBlockTime;
let options = ['KNC', 'AAVE', 'SNX'];
let proposalId;
let maxVotingPower = new BN(10000);

contract('DefaultProposalValidator', function (accounts) {
  before('init global values and contract', async () => {
    daoOperator = accounts[1];
    governance = await SimpleKyberGovernance.new();
    strategy = await VotingPowerStrategy.new();
    user = accounts[2];

    minVotingDuration = new BN(86400);
    maxVotingOptions = new BN(8);
    voteDifferential = new BN(500);
    minimumQuorum = new BN(2000);

    proposalValidator = await DefaultProposalValidator.new(
      minVotingDuration,
      maxVotingOptions,
      voteDifferential,
      minimumQuorum
    );
  });

  it('should test constructor variables were set', async () => {
    Helper.assertEqual(minVotingDuration, await proposalValidator.MIN_VOTING_DURATION(), 'bad ctor value');
    Helper.assertEqual(maxVotingOptions, await proposalValidator.MAX_VOTING_OPTIONS(), 'bad ctor value');
    Helper.assertEqual(voteDifferential, await proposalValidator.VOTE_DIFFERENTIAL(), 'bad ctor value');
    Helper.assertEqual(minimumQuorum, await proposalValidator.MINIMUM_QUORUM(), 'bad ctor value');
  });

  it('should read constant values', async () => {
    Helper.assertEqual(zeroBN, await proposalValidator.YES_INDEX(), 'bad constant value');
    Helper.assertEqual(new BN(1), await proposalValidator.NO_INDEX(), 'bad constant value');
  });

  it('should return false for proposal cancellations regardless of values', async () => {
    assert.isFalse(await proposalValidator.validateProposalCancellation(governance.address, zeroBN, daoOperator));
    assert.isFalse(await proposalValidator.validateProposalCancellation(daoOperator, zeroBN, daoOperator));

    assert.isFalse(await proposalValidator.validateProposalCancellation(governance.address, new BN(1), daoOperator));

    assert.isFalse(
      await proposalValidator.validateProposalCancellation(governance.address, new BN(1), governance.address)
    );
  });

  describe('binary proposal creation', async () => {
    it('should return false if creator != daoOperator', async () => {
      assert.isFalse(
        await proposalValidator.validateBinaryProposalCreation(
          strategy.address,
          user,
          zeroBN,
          minVotingDuration,
          daoOperator
        )
      );

      assert.isFalse(
        await proposalValidator.validateBinaryProposalCreation(
          strategy.address,
          governance.address,
          zeroBN,
          minVotingDuration,
          daoOperator
        )
      );
    });

    it('should return false if proposal duration is too short', async () => {
      assert.isFalse(
        await proposalValidator.validateBinaryProposalCreation(
          strategy.address,
          daoOperator,
          zeroBN,
          zeroBN,
          daoOperator
        )
      );

      assert.isFalse(
        await proposalValidator.validateBinaryProposalCreation(
          strategy.address,
          daoOperator,
          zeroBN,
          new BN(5),
          daoOperator
        )
      );

      assert.isFalse(
        await proposalValidator.validateBinaryProposalCreation(
          strategy.address,
          daoOperator,
          minVotingDuration,
          minVotingDuration.add(new BN(1)),
          daoOperator
        )
      );

      assert.isFalse(
        await proposalValidator.validateBinaryProposalCreation(
          strategy.address,
          daoOperator,
          zeroBN,
          minVotingDuration.sub(new BN(1)),
          daoOperator
        )
      );

      currentBlockTime = new BN(await Helper.getCurrentBlockTime());
      assert.isFalse(
        await proposalValidator.validateBinaryProposalCreation(
          strategy.address,
          daoOperator,
          currentBlockTime,
          currentBlockTime.add(minVotingDuration).sub(new BN(1)),
          daoOperator
        )
      );
    });

    it('should return true for valid proposal creation', async () => {
      assert.isTrue(
        await proposalValidator.validateBinaryProposalCreation(
          strategy.address,
          daoOperator,
          zeroBN,
          minVotingDuration,
          daoOperator
        )
      );

      currentBlockTime = new BN(await Helper.getCurrentBlockTime());
      assert.isTrue(
        await proposalValidator.validateBinaryProposalCreation(
          strategy.address,
          daoOperator,
          currentBlockTime,
          currentBlockTime.add(minVotingDuration),
          daoOperator
        )
      );

      assert.isTrue(
        await proposalValidator.validateBinaryProposalCreation(
          strategy.address,
          daoOperator,
          zeroBN,
          MAX_UINT256,
          daoOperator
        )
      );
    });
  });

  describe('generic proposal creation', async () => {
    it('should return false if creator != daoOperator', async () => {
      assert.isFalse(
        await proposalValidator.validateGenericProposalCreation(
          strategy.address,
          user,
          zeroBN,
          minVotingDuration,
          options,
          daoOperator
        )
      );

      assert.isFalse(
        await proposalValidator.validateGenericProposalCreation(
          strategy.address,
          governance.address,
          zeroBN,
          minVotingDuration,
          options,
          daoOperator
        )
      );
    });

    it('should return false if proposal duration is too short', async () => {
      assert.isFalse(
        await proposalValidator.validateGenericProposalCreation(
          strategy.address,
          daoOperator,
          zeroBN,
          zeroBN,
          options,
          daoOperator
        )
      );

      assert.isFalse(
        await proposalValidator.validateGenericProposalCreation(
          strategy.address,
          daoOperator,
          zeroBN,
          new BN(5),
          options,
          daoOperator
        )
      );

      assert.isFalse(
        await proposalValidator.validateGenericProposalCreation(
          strategy.address,
          daoOperator,
          minVotingDuration,
          minVotingDuration.add(new BN(1)),
          options,
          daoOperator
        )
      );

      assert.isFalse(
        await proposalValidator.validateGenericProposalCreation(
          strategy.address,
          daoOperator,
          zeroBN,
          minVotingDuration.sub(new BN(1)),
          options,
          daoOperator
        )
      );

      currentBlockTime = new BN(await Helper.getCurrentBlockTime());
      assert.isFalse(
        await proposalValidator.validateGenericProposalCreation(
          strategy.address,
          daoOperator,
          currentBlockTime,
          currentBlockTime.add(minVotingDuration).sub(new BN(1)),
          options,
          daoOperator
        )
      );
    });

    it('should return false if option length check fails', async () => {
      // no options
      assert.isFalse(
        await proposalValidator.validateGenericProposalCreation(
          strategy.address,
          daoOperator,
          zeroBN,
          minVotingDuration,
          [],
          daoOperator
        )
      );

      // 1 option only
      assert.isFalse(
        await proposalValidator.validateGenericProposalCreation(
          strategy.address,
          daoOperator,
          zeroBN,
          minVotingDuration,
          ['DICTATOR'],
          daoOperator
        )
      );

      // exceeded max options
      assert.isFalse(
        await proposalValidator.validateGenericProposalCreation(
          strategy.address,
          daoOperator,
          zeroBN,
          minVotingDuration,
          options.concat(options).concat(options),
          daoOperator
        )
      );

      // set 0 MAX_OPTIONS
      let tempProposalValidator = await DefaultProposalValidator.new(
        minVotingDuration,
        zeroBN,
        voteDifferential,
        minimumQuorum
      );

      assert.isFalse(
        await tempProposalValidator.validateGenericProposalCreation(
          strategy.address,
          daoOperator,
          currentBlockTime,
          currentBlockTime.add(minVotingDuration).sub(new BN(1)),
          [],
          daoOperator
        )
      );

      assert.isFalse(
        await tempProposalValidator.validateGenericProposalCreation(
          strategy.address,
          daoOperator,
          currentBlockTime,
          currentBlockTime.add(minVotingDuration).sub(new BN(1)),
          ['DICTATOR'],
          daoOperator
        )
      );

      assert.isFalse(
        await tempProposalValidator.validateGenericProposalCreation(
          strategy.address,
          daoOperator,
          currentBlockTime,
          currentBlockTime.add(minVotingDuration).sub(new BN(1)),
          options,
          daoOperator
        )
      );
    });

    it('should return true for valid proposal creation', async () => {
      assert.isTrue(
        await proposalValidator.validateGenericProposalCreation(
          strategy.address,
          daoOperator,
          zeroBN,
          minVotingDuration,
          ['YES', 'NO'],
          daoOperator
        )
      );

      currentBlockTime = new BN(await Helper.getCurrentBlockTime());
      assert.isTrue(
        await proposalValidator.validateGenericProposalCreation(
          strategy.address,
          daoOperator,
          currentBlockTime,
          currentBlockTime.add(minVotingDuration),
          options,
          daoOperator
        )
      );

      assert.isTrue(
        await proposalValidator.validateGenericProposalCreation(
          strategy.address,
          daoOperator,
          zeroBN,
          MAX_UINT256,
          options,
          daoOperator
        )
      );

      assert.isTrue(
        await proposalValidator.validateGenericProposalCreation(
          strategy.address,
          daoOperator,
          currentBlockTime,
          currentBlockTime.add(minVotingDuration),
          ['0', '1', '2', '3', '4', '5', '6', '7'],
          daoOperator
        )
      );
    });
  });

  describe('binary proposal logic', async () => {
    beforeEach('create a binary proposal', async () => {
      await governance.createProposal(true);
    });

    it('should return false for isQuorumValid if proposal is not binary', async () => {
      proposalId = (await governance.proposalsCount()).sub(new BN(1));
      // change to generic type
      await governance.setProposalType(proposalId, false);
      assert.isFalse(await proposalValidator.isQuorumValid(governance.address, proposalId));
    });

    it('should return false when minimum quorum is not reached', async () => {
      proposalId = (await governance.proposalsCount()).sub(new BN(1));
      let result = await governance.getProposalById(proposalId);
      // check proposal type is binary
      Helper.assertEqual(result.proposalType, new BN(1), 'bad proposal type');

      // zero votes
      await governance.setVoteData(proposalId, [zeroBN, zeroBN], zeroBN, maxVotingPower);
      assert.isFalse(await proposalValidator.isQuorumValid(governance.address, proposalId));

      // all voted NO
      await governance.setVoteData(proposalId, [zeroBN, maxVotingPower], maxVotingPower, maxVotingPower);
      assert.isFalse(await proposalValidator.isQuorumValid(governance.address, proposalId));

      // all voted YES, but minimum quorum not reached
      await governance.setVoteData(proposalId, [new BN(5), zeroBN], new BN(5), maxVotingPower);
      assert.isFalse(await proposalValidator.isQuorumValid(governance.address, proposalId));

      await governance.setVoteData(proposalId, [new BN(1999), zeroBN], new BN(1999), maxVotingPower);
      assert.isFalse(await proposalValidator.isQuorumValid(governance.address, proposalId));

      // total votes (incl. NO votes) reached minimum quorum, but YES votes did not reach minimum quorum
      await governance.setVoteData(proposalId, [new BN(999), new BN(1001)], new BN(2000), maxVotingPower);
      assert.isFalse(await proposalValidator.isQuorumValid(governance.address, proposalId));

      // total votes (incl. NO votes) reached minimum quorum, YES votes just below minimum quorum by 1
      await governance.setVoteData(proposalId, [new BN(1999), new BN(1001)], new BN(3000), maxVotingPower);
      assert.isFalse(await proposalValidator.isQuorumValid(governance.address, proposalId));
    });

    it('should return true if for votes reached minimum quorum', async () => {
      proposalId = (await governance.proposalsCount()).sub(new BN(1));
      let result = await governance.getProposalById(proposalId);
      // check proposal type is binary
      Helper.assertEqual(result.proposalType, new BN(1), 'bad proposal type');

      // all who voted, voted YES
      await governance.setVoteData(proposalId, [new BN(2000), zeroBN], new BN(2000), maxVotingPower);
      assert.isTrue(await proposalValidator.isQuorumValid(governance.address, proposalId));

      // all eligible voters voted YES
      await governance.setVoteData(proposalId, [maxVotingPower, zeroBN], maxVotingPower, maxVotingPower);
      assert.isTrue(await proposalValidator.isQuorumValid(governance.address, proposalId));

      // YES votes > NO votes
      await governance.setVoteData(proposalId, [new BN(2000), new BN(1000)], new BN(3000), maxVotingPower);
      assert.isTrue(await proposalValidator.isQuorumValid(governance.address, proposalId));

      // YES votes = NO votes
      await governance.setVoteData(proposalId, [new BN(2000), new BN(2000)], new BN(4000), maxVotingPower);
      assert.isTrue(await proposalValidator.isQuorumValid(governance.address, proposalId));

      // YES votes < NO votes
      await governance.setVoteData(proposalId, [new BN(2000), new BN(5000)], new BN(7000), maxVotingPower);
      assert.isTrue(await proposalValidator.isQuorumValid(governance.address, proposalId));
    });

    it('should return false for isVoteDifferentialValid if proposal is not binary', async () => {
      proposalId = (await governance.proposalsCount()).sub(new BN(1));
      // change to generic type
      await governance.setProposalType(proposalId, false);
      assert.isFalse(await proposalValidator.isVoteDifferentialValid(governance.address, proposalId));
    });

    it('should return false when vote differential is not reached', async () => {
      proposalId = (await governance.proposalsCount()).sub(new BN(1));
      let result = await governance.getProposalById(proposalId);
      // check proposal type is binary
      Helper.assertEqual(result.proposalType, new BN(1), 'bad proposal type');

      // zero votes
      await governance.setVoteData(proposalId, [zeroBN, zeroBN], zeroBN, maxVotingPower);
      assert.isFalse(await proposalValidator.isVoteDifferentialValid(governance.address, proposalId));

      // all voted NO
      await governance.setVoteData(proposalId, [zeroBN, maxVotingPower], maxVotingPower, maxVotingPower);
      assert.isFalse(await proposalValidator.isVoteDifferentialValid(governance.address, proposalId));

      // YES votes < NO votes
      await governance.setVoteData(proposalId, [new BN(1), new BN(2)], new BN(3), maxVotingPower);
      assert.isFalse(await proposalValidator.isVoteDifferentialValid(governance.address, proposalId));

      // YES votes = NO votes
      await governance.setVoteData(proposalId, [new BN(2), new BN(2)], new BN(4), maxVotingPower);
      assert.isFalse(await proposalValidator.isVoteDifferentialValid(governance.address, proposalId));

      // YES votes > NO votes, but difference < VOTE_DIFFERENTIAL
      await governance.setVoteData(proposalId, [new BN(1500), new BN(1001)], new BN(2501), maxVotingPower);
      assert.isFalse(await proposalValidator.isVoteDifferentialValid(governance.address, proposalId));

      // YES votes > NO votes, but difference = VOTE_DIFFERENTIAL
      await governance.setVoteData(proposalId, [new BN(5000), new BN(4500)], new BN(9500), maxVotingPower);
      assert.isFalse(await proposalValidator.isVoteDifferentialValid(governance.address, proposalId));
    });

    it('should return true if vote differential is satisfied', async () => {
      proposalId = (await governance.proposalsCount()).sub(new BN(1));
      let result = await governance.getProposalById(proposalId);
      // check proposal type is binary
      Helper.assertEqual(result.proposalType, new BN(1), 'bad proposal type');

      // all who voted, voted YES
      await governance.setVoteData(proposalId, [new BN(2000), zeroBN], new BN(2000), maxVotingPower);
      assert.isTrue(await proposalValidator.isVoteDifferentialValid(governance.address, proposalId));

      // all eligible voters voted YES
      await governance.setVoteData(proposalId, [maxVotingPower, zeroBN], maxVotingPower, maxVotingPower);
      assert.isTrue(await proposalValidator.isVoteDifferentialValid(governance.address, proposalId));

      // YES votes = NO votes + vote differential + 1
      await governance.setVoteData(proposalId, [new BN(1500), new BN(999)], new BN(2499), maxVotingPower);
      assert.isTrue(await proposalValidator.isVoteDifferentialValid(governance.address, proposalId));

      // YES votes > NO votes, but below min quorum
      await governance.setVoteData(proposalId, [new BN(600), zeroBN], new BN(600), maxVotingPower);
      assert.isTrue(await proposalValidator.isVoteDifferentialValid(governance.address, proposalId));
    });

    it('should return false for isBinaryPassed if proposal is not binary', async () => {
      proposalId = (await governance.proposalsCount()).sub(new BN(1));
      // change to generic type
      await governance.setProposalType(proposalId, false);
      assert.isFalse(await proposalValidator.isBinaryProposalPassed(governance.address, proposalId));
    });

    it('should return false if either min quorum or vote differential condition not met', async () => {
      proposalId = (await governance.proposalsCount()).sub(new BN(1));
      let result = await governance.getProposalById(proposalId);
      // check proposal type is binary
      Helper.assertEqual(result.proposalType, new BN(1), 'bad proposal type');

      // zero votes
      await governance.setVoteData(proposalId, [zeroBN, zeroBN], zeroBN, maxVotingPower);
      assert.isFalse(await proposalValidator.isBinaryProposalPassed(governance.address, proposalId));

      // all voted NO
      await governance.setVoteData(proposalId, [zeroBN, maxVotingPower], maxVotingPower, maxVotingPower);
      assert.isFalse(await proposalValidator.isBinaryProposalPassed(governance.address, proposalId));

      // all voted YES, but minimum quorum not reached
      await governance.setVoteData(proposalId, [new BN(5), zeroBN], new BN(5), maxVotingPower);
      assert.isFalse(await proposalValidator.isBinaryProposalPassed(governance.address, proposalId));

      await governance.setVoteData(proposalId, [new BN(1999), zeroBN], new BN(1999), maxVotingPower);
      assert.isFalse(await proposalValidator.isBinaryProposalPassed(governance.address, proposalId));

      // total votes (incl. NO votes) reached minimum quorum, but YES votes did not reach minimum quorum
      await governance.setVoteData(proposalId, [new BN(999), new BN(1001)], new BN(2000), maxVotingPower);
      assert.isFalse(await proposalValidator.isBinaryProposalPassed(governance.address, proposalId));

      // total votes (incl. NO votes) reached minimum quorum, YES votes just below minimum quorum by 1
      await governance.setVoteData(proposalId, [new BN(1999), new BN(1001)], new BN(3000), maxVotingPower);
      assert.isFalse(await proposalValidator.isBinaryProposalPassed(governance.address, proposalId));

      // YES votes < NO votes, min quorum not reached
      await governance.setVoteData(proposalId, [new BN(1), new BN(2)], new BN(3), maxVotingPower);
      assert.isFalse(await proposalValidator.isBinaryProposalPassed(governance.address, proposalId));

      // YES votes = NO votes, min quorum not reached
      await governance.setVoteData(proposalId, [new BN(2), new BN(2)], new BN(4), maxVotingPower);
      assert.isFalse(await proposalValidator.isBinaryProposalPassed(governance.address, proposalId));

      // YES votes > NO votes, min quorum reached, but difference < VOTE_DIFFERENTIAL
      await governance.setVoteData(proposalId, [new BN(2500), new BN(2001)], new BN(4501), maxVotingPower);
      assert.isFalse(await proposalValidator.isBinaryProposalPassed(governance.address, proposalId));

      // YES votes > NO votes, min quorum reached, but difference = VOTE_DIFFERENTIAL
      await governance.setVoteData(proposalId, [new BN(5000), new BN(4500)], new BN(9500), maxVotingPower);
      assert.isFalse(await proposalValidator.isBinaryProposalPassed(governance.address, proposalId));
    });

    it('should return true only when both quorum and vote differential conditions are met', async () => {
      proposalId = (await governance.proposalsCount()).sub(new BN(1));
      let result = await governance.getProposalById(proposalId);
      // check proposal type is binary
      Helper.assertEqual(result.proposalType, new BN(1), 'bad proposal type');

      // all who voted, voted YES
      await governance.setVoteData(proposalId, [new BN(2000), zeroBN], new BN(2000), maxVotingPower);
      assert.isTrue(await proposalValidator.isBinaryProposalPassed(governance.address, proposalId));

      // all eligible voters voted YES
      await governance.setVoteData(proposalId, [maxVotingPower, zeroBN], maxVotingPower, maxVotingPower);
      assert.isTrue(await proposalValidator.isBinaryProposalPassed(governance.address, proposalId));

      // YES votes > NO votes
      await governance.setVoteData(proposalId, [new BN(2000), new BN(1000)], new BN(3000), maxVotingPower);
      assert.isTrue(await proposalValidator.isBinaryProposalPassed(governance.address, proposalId));

      // YES votes = NO votes + vote differential + 1
      await governance.setVoteData(proposalId, [new BN(2000), new BN(1499)], new BN(3499), maxVotingPower);
      assert.isTrue(await proposalValidator.isBinaryProposalPassed(governance.address, proposalId));
    });
  });
});

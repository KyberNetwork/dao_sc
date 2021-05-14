const {artifacts} = require('hardhat');
const {expectRevert} = require('@openzeppelin/test-helpers');
const Helper = require('../helper.js');
const expectEvent = require('@openzeppelin/test-helpers/src/expectEvent');
const {expect} = require('chai');
const BN = web3.utils.BN;
const {precisionUnits} = require('../helper.js');

const RewardLocker = artifacts.require('MockRewardLocker');
const KNC = artifacts.require('KyberNetworkTokenV2');

let admin;
let user1;
let user2;
let rewardLocker;
let rewardContract;
let rewardContract2;
let rewardToken;

let txResult;

contract('KyberRewardLocker', (accounts) => {
  before('setup', async () => {
    admin = accounts[1];

    user1 = accounts[2];
    user2 = accounts[3];
    rewardContract = accounts[4];
    rewardContract2 = accounts[5];

    rewardToken = await KNC.new();
  });
  describe('admin operations', async () => {
    beforeEach('init rewardLocker', async () => {
      rewardLocker = await RewardLocker.new(admin);
    });

    it('add/remove reward contract', async () => {
      await expectRevert(
        rewardLocker.addRewardsContract(rewardToken.address, rewardContract, {from: user1}),
        'only admin'
      );
      txResult = await rewardLocker.addRewardsContract(rewardToken.address, rewardContract, {from: admin});

      expectEvent(txResult, 'RewardContractAdded', {isAdded: true, rewardContract: rewardContract});
      await rewardLocker.addRewardsContract(rewardToken.address, rewardContract2, {from: admin});

      Helper.assertEqual(await rewardLocker.getRewardContractsPerToken(rewardToken.address), [
        rewardContract,
        rewardContract2,
      ]);

      await expectRevert(
        rewardLocker.removeRewardsContract(rewardToken.address, rewardContract2, {from: user1}),
        'only admin'
      );
      txResult = await rewardLocker.removeRewardsContract(rewardToken.address, rewardContract2, {from: admin});
      expectEvent(txResult, 'RewardContractAdded', {isAdded: false, rewardContract: rewardContract2});

      Helper.assertEqual(await rewardLocker.getRewardContractsPerToken(rewardToken.address), [rewardContract]);
    });

    it('set vesting config', async () => {
      await expectRevert(
        rewardLocker.setVestingDuration(rewardToken.address, new BN(1000), {from: user1}),
        'only admin'
      );

      txResult = await rewardLocker.setVestingDuration(rewardToken.address, new BN(1000), {from: admin});
      expectEvent(txResult, 'SetVestingDuration', {vestingDuration: new BN(1000)});
      Helper.assertEqual(await rewardLocker.vestingDurationPerToken(rewardToken.address), new BN(1000));
    });
  });

  describe('lock and vest', async () => {
    beforeEach('setup', async () => {
      rewardLocker = await RewardLocker.new(admin);
      await rewardLocker.addRewardsContract(rewardToken.address, accounts[0], {from: admin});
      await rewardLocker.setVestingDuration(rewardToken.address, new BN(3600), {from: admin});

      await rewardToken.approve(rewardLocker.address, Helper.MAX_ALLOWANCE);
    });

    it('lock and vest with full time', async () => {
      await rewardLocker.setBlockNumber(new BN(7200));
      await rewardLocker.lock(rewardToken.address, user1, precisionUnits.mul(new BN(7)));

      let vestingSchedules = await rewardLocker.getVestingSchedules(user1, rewardToken.address);
      expect(vestingSchedules.length).equals(1);
      Helper.assertEqual(vestingSchedules[0].startBlock, new BN(7200));
      Helper.assertEqual(vestingSchedules[0].endBlock, new BN(10800));
      Helper.assertEqual(vestingSchedules[0].quantity, precisionUnits.mul(new BN(7)));

      await rewardLocker.setBlockNumber(new BN(10800));
      txResult = await rewardLocker.vestCompletedSchedules(rewardToken.address, {from: user1});
      expectEvent(txResult, 'Vested', {
        token: rewardToken.address,
        beneficiary: user1,
        vestedQuantity: precisionUnits.mul(new BN(7)),
        index: new BN(0),
      });
    });

    it('lock and vest and claim with half time', async () => {
      await rewardLocker.setBlockNumber(new BN(7200));
      await rewardLocker.lock(rewardToken.address, user1, precisionUnits.mul(new BN(7)));

      await rewardLocker.setBlockNumber(new BN(9000));
      await rewardLocker.lock(rewardToken.address, user1, precisionUnits.mul(new BN(8)));

      await rewardLocker.setBlockNumber(new BN(10800));
      txResult = await rewardLocker.vestScheduleAtIndex(rewardToken.address, [new BN(0), new BN(1)], {from: user1});
      expectEvent(txResult, 'Vested', {
        token: rewardToken.address,
        beneficiary: user1,
        vestedQuantity: precisionUnits.mul(new BN(7)),
        index: new BN(0),
      });
      expectEvent(txResult, 'Vested', {
        token: rewardToken.address,
        beneficiary: user1,
        vestedQuantity: precisionUnits.mul(new BN(4)),
        index: new BN(1),
      });
      await expectEvent.inTransaction(txResult.tx, rewardToken, 'Transfer', {
        from: rewardLocker.address,
        to: user1,
        value: precisionUnits.mul(new BN(11)),
      });

      let vestingSchedules = await rewardLocker.getVestingSchedules(user1, rewardToken.address);
      expect(vestingSchedules.length).equals(2);
      Helper.assertEqual(vestingSchedules[0].vestedQuantity, precisionUnits.mul(new BN(7)));
      Helper.assertEqual(vestingSchedules[1].vestedQuantity, precisionUnits.mul(new BN(4)));

      await rewardLocker.setBlockNumber(new BN(11700));
      txResult = await rewardLocker.vestScheduleAtIndex(rewardToken.address, [new BN(0), new BN(1)], {from: user1});
      expectEvent(txResult, 'Vested', {
        token: rewardToken.address,
        beneficiary: user1,
        vestedQuantity: precisionUnits.mul(new BN(2)),
        index: new BN(1),
      });
      await expectEvent.inTransaction(txResult.tx, rewardToken, 'Transfer', {
        from: rewardLocker.address,
        to: user1,
        value: precisionUnits.mul(new BN(2)),
      });
      vestingSchedules = await rewardLocker.getVestingSchedules(user1, rewardToken.address);
      expect(vestingSchedules.length).equals(2);
      Helper.assertEqual(vestingSchedules[0].vestedQuantity, precisionUnits.mul(new BN(7)));
      Helper.assertEqual(vestingSchedules[1].vestedQuantity, precisionUnits.mul(new BN(6)));
    });

    it('#vestSchedulesInRange', async () => {
      await rewardLocker.setBlockNumber(new BN(7200));
      await rewardLocker.lock(rewardToken.address, user1, precisionUnits.mul(new BN(7)));

      await rewardLocker.setBlockNumber(new BN(9000));
      await rewardLocker.lock(rewardToken.address, user1, precisionUnits.mul(new BN(8)));

      await rewardLocker.setBlockNumber(new BN(10800));
      txResult = await rewardLocker.vestSchedulesInRange(rewardToken.address, new BN(0), new BN(1), {from: user1});
      expectEvent(txResult, 'Vested', {
        token: rewardToken.address,
        beneficiary: user1,
        vestedQuantity: precisionUnits.mul(new BN(7)),
        index: new BN(0),
      });
      expectEvent(txResult, 'Vested', {
        token: rewardToken.address,
        beneficiary: user1,
        vestedQuantity: precisionUnits.mul(new BN(4)),
        index: new BN(1),
      });
      await expectEvent.inTransaction(txResult.tx, rewardToken, 'Transfer', {
        from: rewardLocker.address,
        to: user1,
        value: precisionUnits.mul(new BN(11)),
      });

      let vestingSchedules = await rewardLocker.getVestingSchedules(user1, rewardToken.address);
      expect(vestingSchedules.length).equals(2);
      Helper.assertEqual(vestingSchedules[0].vestedQuantity, precisionUnits.mul(new BN(7)));
      Helper.assertEqual(vestingSchedules[1].vestedQuantity, precisionUnits.mul(new BN(4)));

      await rewardLocker.setBlockNumber(new BN(11700));
      txResult = await rewardLocker.vestSchedulesInRange(rewardToken.address, new BN(0), new BN(1), {from: user1});
      expectEvent(txResult, 'Vested', {
        token: rewardToken.address,
        beneficiary: user1,
        vestedQuantity: precisionUnits.mul(new BN(2)),
        index: new BN(1),
      });
      await expectEvent.inTransaction(txResult.tx, rewardToken, 'Transfer', {
        from: rewardLocker.address,
        to: user1,
        value: precisionUnits.mul(new BN(2)),
      });
      vestingSchedules = await rewardLocker.getVestingSchedules(user1, rewardToken.address);
      expect(vestingSchedules.length).equals(2);
      Helper.assertEqual(vestingSchedules[0].vestedQuantity, precisionUnits.mul(new BN(7)));
      Helper.assertEqual(vestingSchedules[1].vestedQuantity, precisionUnits.mul(new BN(6)));
    });
  });
});

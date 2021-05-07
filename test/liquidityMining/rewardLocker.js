const {artifacts} = require('hardhat');
const {expectRevert} = require('@openzeppelin/test-helpers');
const Helper = require('../helper.js');
const expectEvent = require('@openzeppelin/test-helpers/src/expectEvent');
const {expect} = require('chai');
const BN = web3.utils.BN;

const RewardLocker = artifacts.require('MockRewardLocker');
const KNC = artifacts.require('KyberNetworkTokenV2');

let admin;
let user1;
let user2;
let rewardLocker;
let rewardContract;
let rewardContract2;
let rewardToken;
let slashingTarget;

let txResult;

contract('KyberRewardLocker', (accounts) => {
  before('setup', async () => {
    admin = accounts[1];

    user1 = accounts[2];
    user2 = accounts[3];
    rewardContract = accounts[4];
    rewardContract2 = accounts[5];
    slashingTarget = accounts[6];

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
        rewardLocker.setVestingConfig(rewardToken.address, new BN(1000), new BN(10), {from: user1}),
        'only admin'
      );

      txResult = await rewardLocker.setVestingConfig(rewardToken.address, new BN(1000), new BN(10), {from: admin});
      expectEvent(txResult, 'SetVestingConfig', {lockTime: new BN(1000)});
      Helper.assertEqual((await rewardLocker.vestingConfigPerToken(rewardToken.address)).lockTime, new BN(1000));
    });

    it('set slashing target', async () => {
      await expectRevert(
        rewardLocker.setSlashingTarget(rewardToken.address, slashingTarget, {from: user1}),
        'only admin'
      );

      txResult = await rewardLocker.setSlashingTarget(rewardToken.address, slashingTarget, {from: admin});
      expectEvent(txResult, 'SetSlashingTarget', {target: slashingTarget});
      expect(await rewardLocker.slashingTargets(rewardToken.address)).equal(slashingTarget);
    });
  });

  describe('lock and vest', async () => {
    beforeEach('setup', async () => {
      rewardLocker = await RewardLocker.new(admin);
      await rewardLocker.addRewardsContract(rewardToken.address, rewardContract, {from: admin});
      await rewardLocker.setVestingConfig(rewardToken.address, new BN(3600), new BN(60), {from: admin});
    });

    it('lock and vest with full time', async () => {
      let vestingQuantity = new BN(10).pow(new BN(18)).mul(new BN(7));
      await rewardToken.transfer(rewardContract, vestingQuantity);
      await rewardToken.approve(rewardLocker.address, Helper.MAX_ALLOWANCE, {from: rewardContract});

      await rewardLocker.setTimestamp(new BN(7200));

      await rewardLocker.lock(rewardToken.address, user1, vestingQuantity, {from: rewardContract});

      let vestingSchedules = await rewardLocker.getVestingSchedules(user1, rewardToken.address);
      expect(vestingSchedules.length).equals(1);
      Helper.assertEqual(vestingSchedules[0].startTime, new BN(7200));
      Helper.assertEqual(vestingSchedules[0].endTime, new BN(10800));
      Helper.assertEqual(vestingSchedules[0].quantity, vestingQuantity);

      await rewardLocker.setTimestamp(new BN(10800));

      txResult = await rewardLocker.vestAll(rewardToken.address, {from: user1});
      expectEvent(txResult, 'Vested', {
        token: rewardToken.address,
        beneficiary: user1,
        time: new BN(10800),
        vestedQuantity: vestingQuantity,
        slashedQuantity: new BN(0),
      });
    });

    it('lock and vest and burn with half time', async () => {
      await rewardLocker.setSlashingTarget(rewardToken.address, Helper.zeroAddress, {from: admin});

      let vestingQuantity = new BN(10).pow(new BN(18)).mul(new BN(7));
      await rewardToken.transfer(rewardContract, vestingQuantity);
      await rewardToken.approve(rewardLocker.address, Helper.MAX_ALLOWANCE, {from: rewardContract});

      await rewardLocker.setTimestamp(new BN(7200));

      await rewardLocker.lock(rewardToken.address, user1, vestingQuantity, {from: rewardContract});

      await rewardLocker.setTimestamp(new BN(9000));

      txResult = await rewardLocker.vestAll(rewardToken.address, {from: user1});
      expectEvent(txResult, 'Vested', {
        token: rewardToken.address,
        beneficiary: user1,
        time: new BN(9000),
        vestedQuantity: vestingQuantity.div(new BN(2)),
        slashedQuantity: vestingQuantity.div(new BN(2)),
      });

      await expectEvent.inTransaction(txResult.tx, rewardToken, 'Transfer', {
        to: Helper.zeroAddress,
        value: vestingQuantity.div(new BN(2)),
      });
    });

    it('lock and vest and transfer slashing quantity with half time', async () => {
      await rewardLocker.setSlashingTarget(rewardToken.address, slashingTarget, {from: admin});

      let vestingQuantity = new BN(10).pow(new BN(18)).mul(new BN(7));
      await rewardToken.transfer(rewardContract, vestingQuantity);
      await rewardToken.approve(rewardLocker.address, Helper.MAX_ALLOWANCE, {from: rewardContract});

      await rewardLocker.setTimestamp(new BN(7200));

      await rewardLocker.lock(rewardToken.address, user1, vestingQuantity, {from: rewardContract});

      await rewardLocker.setTimestamp(new BN(9000));

      txResult = await rewardLocker.vestAll(rewardToken.address, {from: user1});
      expectEvent(txResult, 'Vested', {
        token: rewardToken.address,
        beneficiary: user1,
        time: new BN(9000),
        vestedQuantity: vestingQuantity.div(new BN(2)),
        slashedQuantity: vestingQuantity.div(new BN(2)),
      });

      await expectEvent.inTransaction(txResult.tx, rewardToken, 'Transfer', {
        to: slashingTarget,
        value: vestingQuantity.div(new BN(2)),
      });
    });
  });
});

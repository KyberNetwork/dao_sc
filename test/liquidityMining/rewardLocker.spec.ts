import { artifacts } from 'hardhat';
import chai from 'chai';
import { expect } from 'chai';
import * as Helper from '../helper.js';
import { BigNumber as BN, Contract, ContractTransaction, Wallet } from 'ethers';
import { solidity } from 'ethereum-waffle';

chai.use(solidity);

const { expectRevert } = require('@openzeppelin/test-helpers');
const hre = require('hardhat');
const MAX_ALLOWANCE = BN.from(2).pow(256).sub(1);

let RewardLocker: Contract;
let KNC: Contract;
let rewardLocker: Contract;
let rewardToken: Contract;
let admin: Wallet;
let user1: Wallet;
let user2: Wallet;
let rewardContract: Wallet;
let rewardContract2: Wallet;
let slashingTarget: Wallet;

let txResult: any;

describe('KyberRewardLocker', () => {
  before('setup', async () => {
    [admin, user1, user2, rewardContract, rewardContract2, slashingTarget] = await hre.ethers.getSigners();

    RewardLocker = await hre.ethers.getContractFactory('MockRewardLocker');
    KNC = await hre.ethers.getContractFactory('KyberNetworkTokenV2');

    rewardToken = await KNC.deploy();
  });

  describe('admin operations', async () => {
    beforeEach('init rewardLocker', async () => {
      rewardLocker = await RewardLocker.deploy(admin.address);
    });

    it('add/remove reward contract', async () => {
      await expectRevert(
        rewardLocker.connect(user1).addRewardsContract(rewardToken.address, rewardContract.address),
        'only admin'
      );

      await expect(rewardLocker.connect(admin).addRewardsContract(rewardToken.address, rewardContract.address))
        .to.emit(rewardLocker, 'RewardContractAdded')
        .withArgs(rewardContract.address, true);

      await rewardLocker.connect(admin).addRewardsContract(rewardToken.address, rewardContract2.address);

      Helper.assertEqual(await rewardLocker.getRewardContractsPerToken(rewardToken.address), [
        rewardContract,
        rewardContract2,
      ]);

      await expectRevert(
        rewardLocker.connect(user1).removeRewardsContract(rewardToken.address, rewardContract2.address),
        'only admin'
      );

      await expect(rewardLocker.connect(admin).removeRewardsContract(rewardToken.address, rewardContract2.address))
        .to.emit(rewardLocker, 'RewardContractAdded')
        .withArgs(rewardContract2.address, false);

      Helper.assertEqual(await rewardLocker.getRewardContractsPerToken(rewardToken.address), [rewardContract]);
    });

    it('set vesting config', async () => {
      await expectRevert(
        rewardLocker.connect(user1).setVestingConfig(rewardToken.address, BN.from(1000), BN.from(10)),
        'only admin'
      );

      await expect(rewardLocker.connect(admin).setVestingConfig(rewardToken.address, BN.from(1000), BN.from(10)))
        .to.emit(rewardLocker, 'SetVestingConfig')
        .withArgs(rewardToken.address, BN.from(1000), BN.from(10));

      expect((await rewardLocker.vestingConfigPerToken(rewardToken.address)).lockDuration).to.equal(BN.from(1000));
    });

    it('set slashing target', async () => {
      await expectRevert(
        rewardLocker.connect(user1).setSlashingTarget(rewardToken.address, slashingTarget.address),
        'only admin'
      );

      await expect(await rewardLocker.connect(admin).setSlashingTarget(rewardToken.address, slashingTarget.address))
        .to.emit(rewardLocker, 'SetSlashingTarget')
        .withArgs(rewardToken.address, slashingTarget.address);

      expect(await rewardLocker.slashingTargets(rewardToken.address)).to.equal(slashingTarget.address);
    });
  });

  describe('lock and vest', async () => {
    beforeEach('setup', async () => {
      rewardLocker = await RewardLocker.deploy(admin.address);
      await rewardLocker.connect(admin).addRewardsContract(rewardToken.address, rewardContract.address);
      await rewardLocker.connect(admin).setVestingConfig(rewardToken.address, BN.from(3600), BN.from(60));
    });

    it('lock and vest with full time', async () => {
      let vestingQuantity = BN.from(10).pow(18).mul(7);
      await rewardToken.transfer(rewardContract.address, vestingQuantity);
      await rewardToken.connect(rewardContract).approve(rewardLocker.address, MAX_ALLOWANCE);

      await rewardLocker.setTimestamp(BN.from(7200));

      await rewardLocker.connect(rewardContract).lock(rewardToken.address, user1.address, vestingQuantity);

      let vestingSchedules = await rewardLocker.getVestingSchedules(user1.address, rewardToken.address);
      expect(vestingSchedules.length).to.equal(1);
      expect(vestingSchedules[0].startTime).to.equal(BN.from(7200));
      expect(vestingSchedules[0].endTime).to.equal(BN.from(10800));
      expect(vestingSchedules[0].quantity).to.equal(vestingQuantity);

      await rewardLocker.setTimestamp(BN.from(10800));

      await expect(rewardLocker.connect(user1).vestCompletedSchedules(rewardToken.address))
        .to.emit(rewardLocker, 'Vested')
        .withArgs(rewardToken.address, user1.address, BN.from(10800), vestingQuantity, BN.from(0));
    });

    it('lock and vest and burn with half time', async () => {
      await rewardLocker.connect(admin).setSlashingTarget(rewardToken.address, Helper.zeroAddress);

      let vestingQuantity = BN.from(10).pow(18).mul(7);
      await rewardToken.transfer(rewardContract.address, vestingQuantity);
      await rewardToken.connect(rewardContract).approve(rewardLocker.address, MAX_ALLOWANCE);

      await rewardLocker.setTimestamp(BN.from(7200));

      await rewardLocker.connect(rewardContract).lock(rewardToken.address, user1.address, vestingQuantity);

      await rewardLocker.setTimestamp(BN.from(9000));

      await expect(rewardLocker.connect(user1).vestScheduleAtIndex(rewardToken.address, [BN.from(0)]))
        .to.emit(rewardLocker, 'Vested')
        .withArgs(
          rewardToken.address,
          user1.address,
          BN.from(9000),
          vestingQuantity.div(BN.from(2)),
          vestingQuantity.div(BN.from(2))
        );

      // await expectEvent.inTransaction(txResult.tx, rewardToken, 'Transfer', {
      //   to: Helper.zeroAddress,
      //   value: vestingQuantity.div(new BN(2)),
      // });
    });

    it('lock and vest and transfer slashing quantity with half time', async () => {
      await rewardLocker.connect(admin).setSlashingTarget(rewardToken.address, slashingTarget.address);

      let vestingQuantity = BN.from(10).pow(18).mul(7);
      await rewardToken.transfer(rewardContract.address, vestingQuantity);
      await rewardToken.connect(rewardContract).approve(rewardLocker.address, MAX_ALLOWANCE);

      await rewardLocker.setTimestamp(BN.from(7200));

      await rewardLocker.connect(rewardContract).lock(rewardToken.address, user1.address, vestingQuantity);

      await rewardLocker.setTimestamp(BN.from(9000));

      await expect(rewardLocker.connect(user1).vestScheduleAtIndex(rewardToken.address, [BN.from(0)]))
        .to.emit(rewardLocker, 'Vested')
        .withArgs(
          rewardToken.address,
          user1.address,
          BN.from(9000),
          vestingQuantity.div(BN.from(2)),
          vestingQuantity.div(BN.from(2))
        );

      // await expectEvent.inTransaction(txResult.tx, rewardToken, 'Transfer', {
      //   to: slashingTarget,
      //   value: vestingQuantity.div(new BN(2)),
      // });
    });
  });
});

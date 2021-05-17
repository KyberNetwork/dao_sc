import {artifacts} from 'hardhat';
import chai from 'chai';
import {expect} from 'chai';
import * as Helper from '../helper.js';
import {BigNumber as BN, Contract, ContractTransaction, Wallet} from 'ethers';
import {solidity} from 'ethereum-waffle';

import {MockRewardLocker, KyberNetworkTokenV2} from '../../typechain';

chai.use(solidity);

const {expectRevert} = require('@openzeppelin/test-helpers');
const hre = require('hardhat');
const MAX_ALLOWANCE = BN.from(2).pow(256).sub(1);

let RewardLocker: MockRewardLocker;
let KNC: KyberNetworkTokenV2;
let rewardLocker: MockRewardLocker;
let rewardToken: KyberNetworkTokenV2;
let admin: Wallet;
let user1: Wallet;
let user2: Wallet;
let rewardContract: Wallet;
let rewardContract2: Wallet;
let slashingTarget: Wallet;

let txResult: any;

describe('KyberRewardLocker', () => {
  before('setup', async () => {
    [admin, user1, user2, rewardContract, rewardContract2] = await hre.ethers.getSigners();

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
        rewardLocker.connect(user1).setVestingDuration(rewardToken.address, BN.from(1000)),
        'only admin'
      );

      await expect(rewardLocker.connect(admin).setVestingDuration(rewardToken.address, BN.from(1000)))
        .to.emit(rewardLocker, 'SetVestingDuration')
        .withArgs(rewardToken.address, BN.from(1000));

      expect(await rewardLocker.vestingDurationPerToken(rewardToken.address)).to.equal(BN.from(1000));
    });
  });

  describe('lock and vest', async () => {
    beforeEach('setup', async () => {
      rewardLocker = await RewardLocker.deploy(admin.address);
      await rewardLocker.connect(admin).addRewardsContract(rewardToken.address, admin.address);
      await rewardLocker.connect(admin).setVestingDuration(rewardToken.address, BN.from(3600));

      await rewardToken.approve(rewardLocker.address, MAX_ALLOWANCE);
    });

    it('lock and vest with full time', async () => {
      const vestingQuantity = BN.from(10).pow(18).mul(7);

      await rewardLocker.setBlockNumber(BN.from(7200));
      await rewardLocker.lock(rewardToken.address, user1.address, vestingQuantity);

      const vestingSchedules = await rewardLocker.getVestingSchedules(user1.address, rewardToken.address);
      expect(vestingSchedules.length).to.equal(1);
      expect(vestingSchedules[0].startBlock).to.equal(BN.from(7200));
      expect(vestingSchedules[0].endBlock).to.equal(BN.from(10800));
      expect(vestingSchedules[0].quantity).to.equal(vestingQuantity);

      await rewardLocker.setBlockNumber(BN.from(10800));

      await expect(rewardLocker.connect(user1).vestCompletedSchedules(rewardToken.address))
        .to.emit(rewardLocker, 'Vested')
        .withArgs(rewardToken.address, user1.address, vestingQuantity, BN.from(0));
    });

    it('lock and vest and claim with half time', async () => {
      await rewardLocker.setBlockNumber(BN.from(7200));
      await rewardLocker.lock(rewardToken.address, user1.address, BN.from(10).pow(18).mul(7));

      await rewardLocker.setBlockNumber(BN.from(9000));
      await rewardLocker.lock(rewardToken.address, user1.address, BN.from(10).pow(18).mul(8));

      await rewardLocker.setBlockNumber(BN.from(10800));
      await expect(rewardLocker.connect(user1).vestScheduleAtIndex(rewardToken.address, [BN.from(0), BN.from(1)]))
        .to.emit(rewardLocker, 'Vested')
        .withArgs(rewardToken.address, user1.address, BN.from(10).pow(18).mul(7), BN.from(0))
        .emit(rewardLocker, 'Vested')
        .withArgs(rewardToken.address, user1.address, BN.from(10).pow(18).mul(4), BN.from(1));

      // await expectEvent.inTransaction(txResult.tx, rewardToken, 'Transfer', {
      //   to: Helper.zeroAddress,
      //   value: vestingQuantity.div(new BN(2)),
      // });
    });

    it('#vestSchedulesInRange', async () => {
      await rewardLocker.setBlockNumber(BN.from(7200));
      await rewardLocker.lock(rewardToken.address, user1.address, BN.from(10).pow(18).mul(7));

      await rewardLocker.setBlockNumber(BN.from(9000));
      await rewardLocker.lock(rewardToken.address, user1.address, BN.from(10).pow(18).mul(8));

      await rewardLocker.setBlockNumber(BN.from(10800));
      await expect(rewardLocker.connect(user1).vestSchedulesInRange(rewardToken.address, BN.from(0), BN.from(1)))
        .to.emit(rewardLocker, 'Vested')
        .withArgs(rewardToken.address, user1.address, BN.from(10).pow(18).mul(7), BN.from(0))
        .emit(rewardLocker, 'Vested')
        .withArgs(rewardToken.address, user1.address, BN.from(10).pow(18).mul(4), BN.from(1));

      let vestingSchedules = await rewardLocker.getVestingSchedules(user1.address, rewardToken.address);
      expect(vestingSchedules.length).to.equal(2);
      expect(vestingSchedules[0].vestedQuantity).to.equal(BN.from(10).pow(18).mul(7));
      expect(vestingSchedules[1].vestedQuantity).to.equal(BN.from(10).pow(18).mul(4));

      await rewardLocker.setBlockNumber(BN.from(11700));
      await expect(rewardLocker.connect(user1).vestSchedulesInRange(rewardToken.address, BN.from(0), BN.from(1)))
        .to.emit(rewardLocker, 'Vested')
        .withArgs(rewardToken.address, user1.address, BN.from(10).pow(18).mul(2), BN.from(1));

      vestingSchedules = await rewardLocker.getVestingSchedules(user1.address, rewardToken.address);
      expect(vestingSchedules.length).to.equal(2);
      expect(vestingSchedules[0].vestedQuantity).to.equal(BN.from(10).pow(18).mul(7));
      expect(vestingSchedules[1].vestedQuantity).to.equal(BN.from(10).pow(18).mul(6));
    });
  });
});

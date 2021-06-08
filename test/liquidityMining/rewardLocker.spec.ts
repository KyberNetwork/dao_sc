import {ethers, waffle} from 'hardhat';
import {expect} from 'chai';
import {BigNumber as BN} from 'ethers';

import {SignerWithAddress} from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
const hre = require('hardhat');

import chai from 'chai';
const {solidity} = waffle;
chai.use(solidity);

import {
  MockRewardLocker,
  KyberNetworkTokenV2,
  MockRewardLocker__factory,
  KyberNetworkTokenV2__factory
} from '../../typechain';

const MAX_ALLOWANCE = BN.from(2)
  .pow(256)
  .sub(1);
let PRECISION = BN.from(10).pow(18);

let RewardLocker: MockRewardLocker__factory;
let KNC: KyberNetworkTokenV2__factory;
let rewardLocker: MockRewardLocker;
let rewardToken: KyberNetworkTokenV2;
let admin: SignerWithAddress;
let user1: SignerWithAddress;
let user2: SignerWithAddress;
let rewardContract: SignerWithAddress;
let rewardContract2: SignerWithAddress;

describe('KyberRewardLocker', () => {
  before('setup', async () => {
    [admin, user1, user2, rewardContract, rewardContract2] = await ethers.getSigners();

    RewardLocker = (await ethers.getContractFactory('MockRewardLocker')) as MockRewardLocker__factory;
    KNC = (await ethers.getContractFactory('KyberNetworkTokenV2')) as KyberNetworkTokenV2__factory;
    rewardToken = await KNC.deploy();
  });

  describe('admin operations', async () => {
    beforeEach('init rewardLocker', async () => {
      rewardLocker = await RewardLocker.deploy(admin.address);
    });

    it('add/remove reward contract', async () => {
      await expect(
        rewardLocker.connect(user1).addRewardsContract(rewardToken.address, rewardContract.address)
      ).to.be.revertedWith('only admin');

      await expect(rewardLocker.connect(admin).addRewardsContract(rewardToken.address, rewardContract.address))
        .to.emit(rewardLocker, 'RewardContractAdded')
        .withArgs(rewardContract.address, true);

      await rewardLocker.connect(admin).addRewardsContract(rewardToken.address, rewardContract2.address);

      expect(await rewardLocker.getRewardContractsPerToken(rewardToken.address)).to.eql([
        rewardContract.address,
        rewardContract2.address
      ]);

      await expect(
        rewardLocker.connect(user1).removeRewardsContract(rewardToken.address, rewardContract2.address)
      ).to.be.revertedWith('only admin');

      await expect(rewardLocker.connect(admin).removeRewardsContract(rewardToken.address, rewardContract2.address))
        .to.emit(rewardLocker, 'RewardContractAdded')
        .withArgs(rewardContract2.address, false);

      expect(await rewardLocker.getRewardContractsPerToken(rewardToken.address)).to.eql([rewardContract.address]);
    });

    it('set vesting config', async () => {
      await expect(
        rewardLocker.connect(user1).setVestingDuration(rewardToken.address, BN.from(1000))
      ).to.be.revertedWith('only admin');

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
      const vestingQuantity = BN.from(7).mul(PRECISION);

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
      await rewardLocker.lock(rewardToken.address, user1.address, BN.from(7).mul(PRECISION));

      await rewardLocker.setBlockNumber(BN.from(9000));
      await rewardLocker.lock(rewardToken.address, user1.address, BN.from(8).mul(PRECISION));

      await rewardLocker.setBlockNumber(BN.from(10800));
      await expect(rewardLocker.connect(user1).vestScheduleAtIndices(rewardToken.address, [BN.from(0), BN.from(1)]))
        .to.emit(rewardLocker, 'Vested')
        .withArgs(rewardToken.address, user1.address, BN.from(7).mul(PRECISION), BN.from(0))
        .to.emit(rewardLocker, 'Vested')
        .withArgs(rewardToken.address, user1.address, BN.from(4).mul(PRECISION), BN.from(1))
        .to.emit(rewardToken, 'Transfer')
        .withArgs(rewardLocker.address, user1.address, BN.from(11).mul(PRECISION));
    });

    it('#vestSchedulesInRange', async () => {
      await rewardLocker.setBlockNumber(BN.from(7200));
      await rewardLocker.lock(rewardToken.address, user1.address, BN.from(7).mul(PRECISION));

      await rewardLocker.setBlockNumber(BN.from(9000));
      await rewardLocker.lock(rewardToken.address, user1.address, BN.from(8).mul(PRECISION));

      await rewardLocker.setBlockNumber(BN.from(10800));
      await expect(rewardLocker.connect(user1).vestSchedulesInRange(rewardToken.address, BN.from(0), BN.from(1)))
        .to.emit(rewardLocker, 'Vested')
        .withArgs(rewardToken.address, user1.address, BN.from(7).mul(PRECISION), BN.from(0))
        .to.emit(rewardLocker, 'Vested')
        .withArgs(rewardToken.address, user1.address, BN.from(4).mul(PRECISION), BN.from(1));

      let vestingSchedules = await rewardLocker.getVestingSchedules(user1.address, rewardToken.address);
      expect(vestingSchedules.length).to.equal(2);
      expect(vestingSchedules[0].vestedQuantity).to.equal(BN.from(7).mul(PRECISION));
      expect(vestingSchedules[1].vestedQuantity).to.equal(BN.from(4).mul(PRECISION));

      await rewardLocker.setBlockNumber(BN.from(11700));
      await expect(rewardLocker.connect(user1).vestSchedulesInRange(rewardToken.address, BN.from(0), BN.from(1)))
        .to.emit(rewardLocker, 'Vested')
        .withArgs(rewardToken.address, user1.address, BN.from(2).mul(PRECISION), BN.from(1));

      vestingSchedules = await rewardLocker.getVestingSchedules(user1.address, rewardToken.address);
      expect(vestingSchedules.length).to.equal(2);
      expect(vestingSchedules[0].vestedQuantity).to.equal(BN.from(7).mul(PRECISION));
      expect(vestingSchedules[1].vestedQuantity).to.equal(BN.from(6).mul(PRECISION));
    });
  });
});

import {ethers, waffle} from 'hardhat';
import {expect} from 'chai';
import {Wallet} from 'ethers';
import {BigNumber as BN} from '@ethersproject/bignumber';

import chai from 'chai';
const {solidity, createFixtureLoader} = waffle;
chai.use(solidity);
const {constants} = require('@openzeppelin/test-helpers');

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
const NATIVE_TOKEN_ADDRESS = constants.ZERO_ADDRESS;

let RewardLocker: MockRewardLocker__factory;
let KNC: KyberNetworkTokenV2__factory;
let rewardLocker: MockRewardLocker;
let rewardToken: KyberNetworkTokenV2;
let rewardToken2: KyberNetworkTokenV2;
interface RewardLockerFixture {
  rewardLocker: MockRewardLocker;
  rewardToken: KyberNetworkTokenV2;
  rewardToken2: KyberNetworkTokenV2;
}

async function setupFixture ([admin, rewardContract]: Wallet[]): Promise<RewardLockerFixture> {
  const rewardLockerFactory = (await ethers.getContractFactory('MockRewardLocker')) as MockRewardLocker__factory;
  const rewardTokenFactory = (await ethers.getContractFactory('KyberNetworkTokenV2')) as KyberNetworkTokenV2__factory;

  let rewardToken = await rewardTokenFactory.connect(rewardContract).deploy();
  let rewardToken2 = await rewardTokenFactory.connect(rewardContract).deploy();
  let rewardLocker = await rewardLockerFactory.deploy(admin.address);

  for (const tk of [rewardToken, rewardToken2]) {
    await rewardLocker.connect(admin).addRewardsContract(tk.address, rewardContract.address);
    await rewardLocker.connect(admin).setVestingDuration(tk.address, 3600);
    await tk.connect(rewardContract).approve(rewardLocker.address, MAX_ALLOWANCE);
  }

  await rewardLocker.connect(admin).addRewardsContract(NATIVE_TOKEN_ADDRESS, rewardContract.address);
  await rewardLocker.connect(admin).setVestingDuration(NATIVE_TOKEN_ADDRESS, 3600);

  return {
    rewardLocker,
    rewardToken,
    rewardToken2
  };
}

describe('KyberRewardLocker', () => {
  const [admin, user1, rewardContract, rewardContract2] = waffle.provider.getWallets();
  const loadFixtures = createFixtureLoader([admin, rewardContract]);

  before('setup', async () => {
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
      ({rewardLocker, rewardToken, rewardToken2} = await loadFixtures(setupFixture));
    });

    it('locks and vests with full time', async () => {
      const vestingQuantity = BN.from(7).mul(PRECISION);

      await rewardLocker.setBlockNumber(7200);
      await rewardLocker.connect(rewardContract).lock(rewardToken.address, user1.address, vestingQuantity);

      const vestingSchedules = await rewardLocker.getVestingSchedules(user1.address, rewardToken.address);
      expect(vestingSchedules.length).to.equal(1);
      expect(vestingSchedules[0].startBlock).to.equal(7200);
      expect(vestingSchedules[0].endBlock).to.equal(10800);
      expect(vestingSchedules[0].quantity).to.equal(vestingQuantity);

      // test other view function
      expect(await rewardLocker.numVestingSchedules(user1.address, rewardToken.address)).to.equal(1);
      const vestingSchedule = await rewardLocker.getVestingScheduleAtIndex(user1.address, rewardToken.address, 0);
      expect(vestingSchedule.startBlock).to.equal(7200);
      expect(vestingSchedule.endBlock).to.equal(10800);
      expect(vestingSchedule.quantity).to.equal(vestingQuantity);

      // fast-forward to end of vesting schedule
      await rewardLocker.setBlockNumber(10800);
      await expect(rewardLocker.connect(user1).vestCompletedSchedules(rewardToken.address))
        .to.emit(rewardLocker, 'Vested')
        .withArgs(rewardToken.address, user1.address, vestingQuantity, BN.from(0))
        .to.emit(rewardToken, 'Transfer')
        .withArgs(rewardLocker.address, user1.address, vestingQuantity);

      await expect(rewardLocker.connect(user1).vestCompletedSchedules(rewardToken.address)).to.be.revertedWith(
        '0 vesting amount'
      );
    });

    it('locks and vests and claim with half time', async () => {
      await rewardLocker.setBlockNumber(7200);
      await rewardLocker.connect(rewardContract).lock(rewardToken.address, user1.address, BN.from(7).mul(PRECISION));

      await rewardLocker.setBlockNumber(BN.from(9000));
      await rewardLocker.connect(rewardContract).lock(rewardToken.address, user1.address, BN.from(8).mul(PRECISION));

      await rewardLocker.setBlockNumber(10800);
      await expect(rewardLocker.connect(user1).vestScheduleAtIndices(rewardToken.address, [BN.from(0), BN.from(1)]))
        .to.emit(rewardLocker, 'Vested')
        .withArgs(rewardToken.address, user1.address, BN.from(7).mul(PRECISION), BN.from(0))
        .to.emit(rewardLocker, 'Vested')
        .withArgs(rewardToken.address, user1.address, BN.from(4).mul(PRECISION), BN.from(1))
        .to.emit(rewardToken, 'Transfer')
        .withArgs(rewardLocker.address, user1.address, BN.from(11).mul(PRECISION));

      let vestingSchedules = await rewardLocker.getVestingSchedules(user1.address, rewardToken.address);
      expect(vestingSchedules.length).equals(2);
      expect(vestingSchedules[0].vestedQuantity).to.equal(BN.from(7).mul(PRECISION));
      expect(vestingSchedules[1].vestedQuantity).to.equal(BN.from(4).mul(PRECISION));

      await rewardLocker.setBlockNumber(11700);
      await expect(rewardLocker.connect(user1).vestScheduleAtIndices(rewardToken.address, [0, 1]))
        .to.emit(rewardLocker, 'Vested')
        .withArgs(rewardToken.address, user1.address, BN.from(2).mul(PRECISION), 1)
        .to.emit(rewardToken, 'Transfer')
        .withArgs(rewardLocker.address, user1.address, BN.from(2).mul(PRECISION));

      vestingSchedules = await rewardLocker.getVestingSchedules(user1.address, rewardToken.address);
      expect(vestingSchedules.length).equals(2);
      expect(vestingSchedules[0].vestedQuantity).to.equal(BN.from(7).mul(PRECISION));
      expect(vestingSchedules[1].vestedQuantity).to.equal(BN.from(6).mul(PRECISION));
    });

    it('#vestSchedulesInRange', async () => {
      await rewardLocker.setBlockNumber(7200);
      await rewardLocker.connect(rewardContract).lock(rewardToken.address, user1.address, BN.from(7).mul(PRECISION));

      await rewardLocker.setBlockNumber(BN.from(9000));
      await rewardLocker.connect(rewardContract).lock(rewardToken.address, user1.address, BN.from(8).mul(PRECISION));

      await rewardLocker.setBlockNumber(10800);
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
      await expect(rewardLocker.connect(user1).vestSchedulesInRange(rewardToken.address, 0, 1))
        .to.emit(rewardLocker, 'Vested')
        .withArgs(rewardToken.address, user1.address, BN.from(2).mul(PRECISION), BN.from(1));

      vestingSchedules = await rewardLocker.getVestingSchedules(user1.address, rewardToken.address);
      expect(vestingSchedules.length).to.equal(2);
      expect(vestingSchedules[0].vestedQuantity).to.equal(BN.from(7).mul(PRECISION));
      expect(vestingSchedules[1].vestedQuantity).to.equal(BN.from(6).mul(PRECISION));

      // revert with invalid input
      await expect(rewardLocker.connect(user1).vestSchedulesInRange(rewardToken.address, 1, 0)).to.be.revertedWith(
        'startIndex > endIndex'
      );
    });

    it('locks and vests with full time with native token', async () => {
      const vestingQuantity = BN.from(7).mul(PRECISION);

      await rewardLocker.setBlockNumber(7200);
      await rewardLocker
        .connect(rewardContract)
        .lock(NATIVE_TOKEN_ADDRESS, user1.address, vestingQuantity, {value: vestingQuantity});

      const vestingSchedules = await rewardLocker.getVestingSchedules(user1.address, NATIVE_TOKEN_ADDRESS);
      expect(vestingSchedules.length).to.equal(1);
      expect(vestingSchedules[0].startBlock).to.equal(7200);
      expect(vestingSchedules[0].endBlock).to.equal(10800);
      expect(vestingSchedules[0].quantity).to.equal(vestingQuantity);

      await rewardLocker.setBlockNumber(10800);

      let balanceBefore = (await user1.getBalance()) as BN;
      await expect(rewardLocker.connect(user1).vestCompletedSchedules(NATIVE_TOKEN_ADDRESS, {gasPrice: 0}))
        .to.emit(rewardLocker, 'Vested')
        .withArgs(NATIVE_TOKEN_ADDRESS, user1.address, vestingQuantity, BN.from(0));
      expect(await user1.getBalance()).to.equal(balanceBefore.add(vestingQuantity));
    });

    it('locks multiple shedule with the same start and end time', async () => {
      const vestingQuantity = BN.from(7).mul(PRECISION);

      await rewardLocker.setBlockNumber(7200);
      await rewardLocker
        .connect(rewardContract)
        .lock(NATIVE_TOKEN_ADDRESS, user1.address, vestingQuantity, {value: vestingQuantity});

      await rewardLocker.setBlockNumber(7200);
      await rewardLocker
        .connect(rewardContract)
        .lock(NATIVE_TOKEN_ADDRESS, user1.address, vestingQuantity, {value: vestingQuantity});
      const vestingSchedules = await rewardLocker.getVestingSchedules(user1.address, NATIVE_TOKEN_ADDRESS);
      expect(vestingSchedules.length).to.equal(1);
      expect(vestingSchedules[0].startBlock).to.equal(7200);
      expect(vestingSchedules[0].endBlock).to.equal(10800);
      expect(vestingSchedules[0].quantity).to.equal(BN.from(2).mul(vestingQuantity));
    });

    it('#vestCompletedSchedulesForMultipleTokens', async () => {
      await rewardLocker
        .connect(rewardContract)
        .lockWithStartBlock(rewardToken.address, user1.address, BN.from(4).mul(PRECISION), 7200);
      await rewardLocker
        .connect(rewardContract)
        .lockWithStartBlock(rewardToken2.address, user1.address, BN.from(7).mul(PRECISION), 7200);
      await rewardLocker
        .connect(rewardContract)
        .lockWithStartBlock(rewardToken.address, user1.address, BN.from(7).mul(PRECISION), 9000);

      await rewardLocker.setBlockNumber(10800);

      await expect(
        rewardLocker
          .connect(user1)
          .vestCompletedSchedulesForMultipleTokens([rewardToken.address, rewardToken2.address])
      )
        .to.emit(rewardToken, 'Transfer')
        .withArgs(rewardLocker.address, user1.address, BN.from(4).mul(PRECISION))
        .to.emit(rewardToken2, 'Transfer')
        .withArgs(rewardLocker.address, user1.address, BN.from(7).mul(PRECISION));
    });

    it('#vestCompletedSchedulesForMultipleTokens', async () => {
      await rewardLocker
        .connect(rewardContract)
        .lockWithStartBlock(rewardToken.address, user1.address, BN.from(4).mul(PRECISION), 7200);
      await rewardLocker
        .connect(rewardContract)
        .lockWithStartBlock(rewardToken2.address, user1.address, BN.from(7).mul(PRECISION), 7200);
      await rewardLocker
        .connect(rewardContract)
        .lockWithStartBlock(rewardToken.address, user1.address, BN.from(8).mul(PRECISION), 9000);
      //revert with invalid length of input
      await expect(
        rewardLocker
          .connect(user1)
          .vestScheduleForMultipleTokensAtIndices([rewardToken.address, rewardToken2.address], [[0, 1]])
      ).to.be.revertedWith('tokens.length != indices.length');

      await rewardLocker.setBlockNumber(10800);
      await expect(
        rewardLocker
          .connect(user1)
          .vestScheduleForMultipleTokensAtIndices([rewardToken.address, rewardToken2.address], [[0, 1], [0]])
      )
        .to.emit(rewardToken, 'Transfer')
        .withArgs(rewardLocker.address, user1.address, BN.from(8).mul(PRECISION))
        .to.emit(rewardToken2, 'Transfer')
        .withArgs(rewardLocker.address, user1.address, BN.from(7).mul(PRECISION));
    });

    it('#lockWithStartBlock', async () => {
      const vestingQuantity = BN.from(7).mul(PRECISION);

      await rewardLocker.setBlockNumber(7200);
      await rewardLocker
        .connect(rewardContract)
        .lockWithStartBlock(rewardToken.address, user1.address, vestingQuantity, 9000, {value: vestingQuantity});

      const vestingSchedules = await rewardLocker.getVestingSchedules(user1.address, rewardToken.address);
      expect(vestingSchedules.length).to.equal(1);
      expect(vestingSchedules[0].startBlock).to.equal(9000);
      expect(vestingSchedules[0].endBlock).to.equal(12600);
      expect(vestingSchedules[0].quantity).to.equal(vestingQuantity);

      await expect(rewardLocker.connect(user1).vestScheduleAtIndices(rewardToken.address, [0])).to.be.revertedWith(
        '0 vesting amount'
      );
    });

    it('reverts if invalid schedule index', async () => {
      await expect(rewardLocker.connect(user1).vestScheduleAtIndices(rewardToken.address, [0])).to.be.revertedWith(
        'invalid schedule index'
      );
    });

    it('reverts if invalid quantity', async () => {
      await expect(
        rewardLocker.connect(rewardContract).lock(rewardToken.address, user1.address, 0)
      ).to.be.revertedWith('0 quantity');
    });

    it('reverts if invalid msg.value', async () => {
      await expect(
        rewardLocker.connect(rewardContract).lock(NATIVE_TOKEN_ADDRESS, user1.address, 1)
      ).to.be.revertedWith('Invalid msg.value');
    });

    it('reverts if rewardContract is not whitelisted', async () => {
      await rewardLocker.connect(admin).removeRewardsContract(rewardToken.address, rewardContract.address);
      await expect(
        rewardLocker.connect(rewardContract).lock(rewardToken.address, user1.address, 1)
      ).to.be.revertedWith('only reward contract');
    });
  });
});

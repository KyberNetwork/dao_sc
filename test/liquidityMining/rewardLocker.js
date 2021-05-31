const {artifacts} = require('hardhat');
const {expectRevert} = require('@openzeppelin/test-helpers');
const Helper = require('../helper.js');
const expectEvent = require('@openzeppelin/test-helpers/src/expectEvent');
const {expect} = require('chai');
const BN = web3.utils.BN;
const {precisionUnits, zeroAddress} = require('../helper.js');

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
    let rewardTokens = [accounts[1], zeroAddress];
    beforeEach('init rewardLocker', async () => {
      rewardLocker = await RewardLocker.new(admin);
    });

    for(let i = 0; i < rewardTokens.length; i++) {
      it('add/remove reward contract', async () => {
        await expectRevert(
          rewardLocker.addRewardsContract(rewardTokens[i], rewardContract, {from: user1}),
          'only admin'
        );
        txResult = await rewardLocker.addRewardsContract(rewardTokens[i], rewardContract, {from: admin});

        expectEvent(txResult, 'RewardContractAdded', {isAdded: true, rewardContract: rewardContract});
        await rewardLocker.addRewardsContract(rewardTokens[i], rewardContract2, {from: admin});

        Helper.assertEqual(await rewardLocker.getRewardContractsPerToken(rewardTokens[i]), [
          rewardContract,
          rewardContract2,
        ]);

        await expectRevert(
          rewardLocker.removeRewardsContract(rewardTokens[i], rewardContract2, {from: user1}),
          'only admin'
        );
        txResult = await rewardLocker.removeRewardsContract(rewardTokens[i], rewardContract2, {from: admin});
        expectEvent(txResult, 'RewardContractAdded', {isAdded: false, rewardContract: rewardContract2});

        Helper.assertEqual(await rewardLocker.getRewardContractsPerToken(rewardTokens[i]), [rewardContract]);
      });

      it('set vesting config', async () => {
        await expectRevert(
          rewardLocker.setVestingDuration(rewardTokens[i], new BN(1000), {from: user1}),
          'only admin'
        );

        txResult = await rewardLocker.setVestingDuration(rewardTokens[i], new BN(1000), {from: admin});
        expectEvent(txResult, 'SetVestingDuration', {vestingDuration: new BN(1000)});
        Helper.assertEqual(await rewardLocker.vestingDurationPerToken(rewardTokens[i]), new BN(1000));
      });
    }
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

  describe('lock and vest native tokens', async () => {
    beforeEach('setup', async () => {
      rewardLocker = await RewardLocker.new(admin);
      await rewardLocker.addRewardsContract(zeroAddress, accounts[0], {from: admin});
      await rewardLocker.setVestingDuration(zeroAddress, new BN(3600), {from: admin});
    });

    it('revert invalid msg value', async () => {
      let lockedAmount = precisionUnits.div(new BN(5));
      await expectRevert(
        rewardLocker.lock(zeroAddress, user1, lockedAmount, { value: 0 }),
        'Invalid locked quantity'
      );
      await expectRevert(
        rewardLocker.lock(zeroAddress, user1, lockedAmount, { value: lockedAmount.mul(new BN(2)) }),
        'Invalid locked quantity'
      );
    });

    it('lock and vest with full time', async () => {
      await rewardLocker.setBlockNumber(new BN(7200));
      let lockedAmount = precisionUnits.div(new BN(5));
      await rewardLocker.lock(zeroAddress, user1, lockedAmount, { value: lockedAmount });

      let vestingSchedules = await rewardLocker.getVestingSchedules(user1, zeroAddress);
      expect(vestingSchedules.length).equals(1);
      Helper.assertEqual(vestingSchedules[0].startBlock, new BN(7200));
      Helper.assertEqual(vestingSchedules[0].endBlock, new BN(10800));
      Helper.assertEqual(vestingSchedules[0].quantity, lockedAmount);

      await rewardLocker.setBlockNumber(new BN(10800));
      txResult = await rewardLocker.vestCompletedSchedules(zeroAddress, {from: user1});
      expectEvent(txResult, 'Vested', {
        token: zeroAddress,
        beneficiary: user1,
        vestedQuantity: lockedAmount,
        index: new BN(0),
      });
    });

    it('lock and vest and claim with half time', async () => {
      await rewardLocker.setBlockNumber(new BN(7200));
      let lockedAmount1 = precisionUnits.div(new BN(7));
      await rewardLocker.lock(zeroAddress, user1, lockedAmount1, { value: lockedAmount1 });

      let lockedAmount2 = precisionUnits.div(new BN(8));
      await rewardLocker.setBlockNumber(new BN(9000));
      await rewardLocker.lock(zeroAddress, user1, lockedAmount2, { value: lockedAmount2 });

      await rewardLocker.setBlockNumber(new BN(10800));
      let userBalance = await Helper.getBalancePromise(user1);
      let lockerBalance = await Helper.getBalancePromise(rewardLocker.address);
      txResult = await rewardLocker.vestScheduleAtIndex(zeroAddress, [new BN(0), new BN(1)], { from: user1, gasPrice: new BN(0) });
      expectEvent(txResult, 'Vested', {
        token: zeroAddress,
        beneficiary: user1,
        vestedQuantity: lockedAmount1,
        index: new BN(0),
      });
      let vestedAmount2 = lockedAmount2.div(new BN(2));
      expectEvent(txResult, 'Vested', {
        token: zeroAddress,
        beneficiary: user1,
        vestedQuantity: vestedAmount2,
        index: new BN(1),
      });
      Helper.assertEqual(
        userBalance.add(lockedAmount1).add(vestedAmount2),
        await Helper.getBalancePromise(user1)
      );
      Helper.assertEqual(
        lockerBalance.sub(lockedAmount1).sub(vestedAmount2),
        await Helper.getBalancePromise(rewardLocker.address)
      );
      userBalance = userBalance.add(lockedAmount1).add(vestedAmount2);
      lockerBalance = lockerBalance.sub(lockedAmount1).sub(vestedAmount2);

      let vestingSchedules = await rewardLocker.getVestingSchedules(user1, zeroAddress);
      expect(vestingSchedules.length).equals(2);
      Helper.assertEqual(vestingSchedules[0].vestedQuantity, lockedAmount1);
      Helper.assertEqual(vestingSchedules[1].vestedQuantity, vestedAmount2);

      await rewardLocker.setBlockNumber(new BN(11700));
      txResult = await rewardLocker.vestScheduleAtIndex(zeroAddress, [new BN(0), new BN(1)], { from: user1, gasPrice: new BN(0) });
      let vestedAmount22 = lockedAmount2.div(new BN(4));
      expectEvent(txResult, 'Vested', {
        token: zeroAddress,
        beneficiary: user1,
        vestedQuantity: vestedAmount22,
        index: new BN(1),
      });
      Helper.assertEqual(
        userBalance.add(vestedAmount22), await Helper.getBalancePromise(user1)
      );
      Helper.assertEqual(
        lockerBalance.sub(vestedAmount22), await Helper.getBalancePromise(rewardLocker.address)
      );
      vestingSchedules = await rewardLocker.getVestingSchedules(user1, zeroAddress);
      expect(vestingSchedules.length).equals(2);
      Helper.assertEqual(vestingSchedules[0].vestedQuantity, lockedAmount1);
      Helper.assertEqual(vestingSchedules[1].vestedQuantity, vestedAmount2.add(vestedAmount22));
    });

    it('#vestSchedulesInRange', async () => {
      await rewardLocker.setBlockNumber(new BN(7200));
      let lockedAmount1 = precisionUnits.div(new BN(7));
      await rewardLocker.lock(zeroAddress, user1, lockedAmount1, { value: lockedAmount1 });

      await rewardLocker.setBlockNumber(new BN(9000));
      let lockedAmount2 = precisionUnits.div(new BN(8));
      await rewardLocker.lock(zeroAddress, user1, lockedAmount2, { value: lockedAmount2 });

      await rewardLocker.setBlockNumber(new BN(10800));

      let userBalance = await Helper.getBalancePromise(user1);
      let lockerBalance = await Helper.getBalancePromise(rewardLocker.address);

      txResult = await rewardLocker.vestSchedulesInRange(zeroAddress, new BN(0), new BN(1), { from: user1, gasPrice: new BN(0) });
      let vestedAmount2 = lockedAmount2.div(new BN(2));

      expectEvent(txResult, 'Vested', {
        token: zeroAddress,
        beneficiary: user1,
        vestedQuantity: lockedAmount1,
        index: new BN(0),
      });
      expectEvent(txResult, 'Vested', {
        token: zeroAddress,
        beneficiary: user1,
        vestedQuantity: vestedAmount2,
        index: new BN(1),
      });

      Helper.assertEqual(
        userBalance.add(lockedAmount1).add(vestedAmount2),
        await Helper.getBalancePromise(user1)
      );
      Helper.assertEqual(
        lockerBalance.sub(lockedAmount1).sub(vestedAmount2),
        await Helper.getBalancePromise(rewardLocker.address)
      );
      userBalance = userBalance.add(lockedAmount1).add(vestedAmount2);
      lockerBalance = lockerBalance.sub(lockedAmount1).sub(vestedAmount2);

      let vestingSchedules = await rewardLocker.getVestingSchedules(user1, zeroAddress);
      expect(vestingSchedules.length).equals(2);
      Helper.assertEqual(vestingSchedules[0].vestedQuantity, lockedAmount1);
      Helper.assertEqual(vestingSchedules[1].vestedQuantity, vestedAmount2);

      await rewardLocker.setBlockNumber(new BN(11700));
      let vestedAmount22 = lockedAmount2.div(new BN(4));
      txResult = await rewardLocker.vestSchedulesInRange(zeroAddress, new BN(0), new BN(1), { from: user1, gasPrice: new BN(0) });
      expectEvent(txResult, 'Vested', {
        token: zeroAddress,
        beneficiary: user1,
        vestedQuantity: vestedAmount22,
        index: new BN(1),
      });
      Helper.assertEqual(
        userBalance.add(vestedAmount22), await Helper.getBalancePromise(user1)
      );
      Helper.assertEqual(
        lockerBalance.sub(vestedAmount22), await Helper.getBalancePromise(rewardLocker.address)
      );
      vestingSchedules = await rewardLocker.getVestingSchedules(user1, zeroAddress);
      expect(vestingSchedules.length).equals(2);
      Helper.assertEqual(vestingSchedules[0].vestedQuantity, lockedAmount1);
      Helper.assertEqual(vestingSchedules[1].vestedQuantity, vestedAmount22.add(vestedAmount2));
    });
  });
});

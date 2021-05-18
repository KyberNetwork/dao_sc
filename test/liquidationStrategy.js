const {expectEvent, expectRevert} = require('@openzeppelin/test-helpers');
const BN = web3.utils.BN;

// const LiquidationStrategy = artifacts.require('LiquidationStrategy.sol');
const Token = artifacts.require('KyberNetworkTokenV2.sol');
const Pool = artifacts.require('Pool.sol');
const LiquidationStrategy = artifacts.require('MockLiquidationStrategy.sol');
const MockLiquidatorWithCallback = artifacts.require('MockLiquidatorWithCallback.sol');
const NonePayableContract = artifacts.require('NonePayableContract.sol');

const Helper = require('./helper.js');
const {zeroAddress, ethAddress, ProposalState} = require('./helper.js');

let admin;
let operators;
let treasuryPool;
let rewardPool;
let strategy;
let liquidatorCallback;

contract('LiquidationStrategy', function (accounts) {
  before('Global setup', async () => {
    admin = accounts[1];
    operators = [accounts[2], accounts[3]];
    strategies = [accounts[4], accounts[5]];
    treasuryPool = await Pool.new(admin, strategies);
    rewardPool = accounts[8];
  });

  describe('#constructor', async () => {
    it('revert invalid params', async () => {
      await expectRevert(
        LiquidationStrategy.new(zeroAddress, accounts[0], accounts[1], 1000, 100, 100, []),
        'admin 0'
      );

      await expectRevert(
        LiquidationStrategy.new(admin, zeroAddress, accounts[1], 1000, 100, 100, []),
        'invalid treasury pool'
      );

      await expectRevert(
        LiquidationStrategy.new(admin, accounts[0], zeroAddress, 1000, 100, 100, []),
        'invalid reward pool'
      );
    });

    it('reverts repeated period is 0', async () => {
      await expectRevert(
        LiquidationStrategy.new(admin, accounts[0], accounts[1], 1000, 0, 100, []),
        'repeatedPeriod == 0'
      );
    });

    it('correct data initialized', async () => {
      let strategy = await LiquidationStrategy.new(admin, accounts[2], accounts[4], 100, 200, 300, [
        accounts[5],
        accounts[6],
      ]);
      Helper.assertEqual(admin, await strategy.admin());
      Helper.assertEqual(accounts[2], await strategy.treasuryPool());
      Helper.assertEqual(accounts[4], await strategy.rewardPool());
      Helper.assertEqual(true, await strategy.isWhitelistedToken(accounts[5]));
      Helper.assertEqual(true, await strategy.isWhitelistedToken(accounts[6]));
      Helper.assertEqual(2, await strategy.getWhitelistedTokensLength());
      Helper.assertEqual(accounts[5], await strategy.getWhitelistedTokenAt(0));
      Helper.assertEqual(accounts[6], await strategy.getWhitelistedTokenAt(1));
      Helper.assertEqual([accounts[5], accounts[6]], await strategy.getAllWhitelistedTokens());
      Helper.assertEqual(false, await strategy.isWhitelistLiquidatorEnabled());
    });
  });

  describe('#update pools', async () => {
    before('init contract', async () => {
      strategy = await LiquidationStrategy.new(admin, accounts[1], accounts[2], 100, 200, 300, []);
    });

    it('fee pool - update revert not admin', async () => {
      await expectRevert(strategy.updateTreasuryPool(accounts[2], {from: accounts[0]}), 'only admin');
    });

    it('fee pool - update revert invalid address', async () => {
      await expectRevert(strategy.updateTreasuryPool(zeroAddress, {from: admin}), 'invalid treasury pool');
    });

    it('fee pool - test event', async () => {
      let tx = await strategy.updateTreasuryPool(accounts[0], {from: admin});
      Helper.assertEqual(accounts[0], await strategy.treasuryPool());
      expectEvent(tx, 'TreasuryPoolSet', {
        treasuryPool: accounts[0],
      });
      tx = await strategy.updateTreasuryPool(accounts[1], {from: admin});
      Helper.assertEqual(accounts[1], await strategy.treasuryPool());
      expectEvent(tx, 'TreasuryPoolSet', {
        treasuryPool: accounts[1],
      });
    });

    it('treasury pool - revert not admin', async () => {
      await expectRevert(strategy.updateRewardPool(accounts[2], {from: accounts[0]}), 'only admin');
    });

    it('treasury pool - revert invalid address', async () => {
      await expectRevert(strategy.updateRewardPool(zeroAddress, {from: admin}), 'invalid reward pool');
    });

    it('treasury pool - test event', async () => {
      let tx = await strategy.updateRewardPool(accounts[0], {from: admin});
      Helper.assertEqual(accounts[0], await strategy.rewardPool());
      expectEvent(tx, 'RewardPoolSet', {
        rewardPool: accounts[0],
      });
      tx = await strategy.updateRewardPool(accounts[1], {from: admin});
      Helper.assertEqual(accounts[1], await strategy.rewardPool());
      expectEvent(tx, 'RewardPoolSet', {
        rewardPool: accounts[1],
      });
    });
  });

  describe('#whitelisted tokens', async () => {
    beforeEach('init contract', async () => {
      strategy = await LiquidationStrategy.new(admin, accounts[1], accounts[2], 100, 200, 300, []);
    });

    it('update - revert not admin', async () => {
      await expectRevert(strategy.updateWhitelistedTokens([accounts[1]], true, {from: accounts[0]}), 'only admin');
      await expectRevert(strategy.updateWhitelistedTokens([accounts[1]], false, {from: accounts[0]}), 'only admin');
    });

    it('add new whitelisted tokens', async () => {
      let tokens = [accounts[0], accounts[1]];
      for (let i = 0; i < 2; i++) {
        // to test duplicated whitelisted tokens as well
        let tx = await strategy.updateWhitelistedTokens(tokens, true, {from: admin});
        Helper.assertEqual(true, await strategy.isWhitelistedToken(tokens[0]));
        Helper.assertEqual(true, await strategy.isWhitelistedToken(tokens[1]));
        Helper.assertEqual(tokens.length, await strategy.getWhitelistedTokensLength());
        Helper.assertEqualArray(tokens, await strategy.getAllWhitelistedTokens());
        for (let id = 0; id < tokens.length; id++) {
          Helper.assertEqual(tokens[id], await strategy.getWhitelistedTokenAt(id));
        }
        for (let id = 0; id < tx.receipt.logs.length; id++) {
          Helper.assertEqual('WhitelistedTokenUpdated', tx.receipt.logs[id].event);
          Helper.assertEqual(tokens[id], tx.receipt.logs[id].args.token);
          Helper.assertEqual(true, tx.receipt.logs[id].args.isAdd);
        }
        await strategy.updateWhitelistedTokens(tokens, false, {from: admin});
      }
    });

    it('remove whitelisted tokens', async () => {
      let tokens = [accounts[0], accounts[1]];
      await strategy.updateWhitelistedTokens(tokens, true, {from: admin});
      for (let i = 0; i < 2; i++) {
        let tx = await strategy.updateWhitelistedTokens(tokens, false, {from: admin});
        Helper.assertEqual(false, await strategy.isWhitelistedToken(tokens[0]));
        Helper.assertEqual(false, await strategy.isWhitelistedToken(tokens[1]));
        Helper.assertEqual(0, await strategy.getWhitelistedTokensLength());
        Helper.assertEqualArray([], await strategy.getAllWhitelistedTokens());
        for (let id = 0; id < tx.receipt.logs.length; id++) {
          Helper.assertEqual('WhitelistedTokenUpdated', tx.receipt.logs[id].event);
          Helper.assertEqual(tokens[id], tx.receipt.logs[id].args.token);
          Helper.assertEqual(false, tx.receipt.logs[id].args.isAdd);
        }
      }
    });
  });

  describe('#whitelisted liquidator', async () => {
    beforeEach('init contract', async () => {
      strategy = await LiquidationStrategy.new(admin, accounts[1], accounts[2], 100, 200, 300, []);
    });

    it('update liquidators - revert not admin', async () => {
      await expectRevert(
        strategy.updateWhitelistedLiquidators([accounts[1]], true, {from: accounts[0]}),
        'only admin'
      );
      await expectRevert(
        strategy.updateWhitelistedLiquidators([accounts[1]], false, {from: accounts[0]}),
        'only admin'
      );
    });

    it('enable/disable whitelisted - revert not admin', async () => {
      await expectRevert(strategy.enableWhitelistedLiquidators({from: accounts[0]}), 'only admin');
      await expectRevert(strategy.disableWhitelistedLiquidators({from: accounts[0]}), 'only admin');
    });

    it('test add new whitelisted liquidators', async () => {
      let liquidators = [accounts[0], accounts[1]];
      for (let i = 0; i < 2; i++) {
        // to test duplicated whitelisted liquidators as well
        let tx = await strategy.updateWhitelistedLiquidators(liquidators, true, {from: admin});
        Helper.assertEqual(true, await strategy.isWhitelistedLiquidator(liquidators[0]));
        Helper.assertEqual(true, await strategy.isWhitelistedLiquidator(liquidators[1]));
        Helper.assertEqual(liquidators.length, await strategy.getWhitelistedLiquidatorsLength());
        Helper.assertEqualArray(liquidators, await strategy.getAllWhitelistedLiquidators());
        for (let id = 0; id < liquidators.length; id++) {
          Helper.assertEqual(liquidators[id], await strategy.getWhitelistedLiquidatorAt(id));
        }
        for (let id = 0; id < tx.receipt.logs.length; id++) {
          Helper.assertEqual('WhitelistedLiquidatorUpdated', tx.receipt.logs[id].event);
          Helper.assertEqual(liquidators[id], tx.receipt.logs[id].args.liquidator);
          Helper.assertEqual(true, tx.receipt.logs[id].args.isAdd);
        }
        await strategy.updateWhitelistedLiquidators(liquidators, false, {from: admin});
      }
    });

    it('test remove whitelisted liquidators', async () => {
      let liquidators = [accounts[0], accounts[1]];
      await strategy.updateWhitelistedLiquidators(liquidators, true, {from: admin});
      for (let i = 0; i < 2; i++) {
        let tx = await strategy.updateWhitelistedLiquidators(liquidators, false, {from: admin});
        Helper.assertEqual(false, await strategy.isWhitelistedLiquidator(liquidators[0]));
        Helper.assertEqual(false, await strategy.isWhitelistedLiquidator(liquidators[1]));
        Helper.assertEqual(0, await strategy.getWhitelistedLiquidatorsLength());
        Helper.assertEqualArray([], await strategy.getAllWhitelistedLiquidators());
        for (let id = 0; id < tx.receipt.logs.length; id++) {
          Helper.assertEqual('WhitelistedLiquidatorUpdated', tx.receipt.logs[id].event);
          Helper.assertEqual(liquidators[id], tx.receipt.logs[id].args.liquidator);
          Helper.assertEqual(false, tx.receipt.logs[id].args.isAdd);
        }
      }
    });

    it('test enable/disable whitelisted liquidators', async () => {
      let tx = await strategy.enableWhitelistedLiquidators({from: admin});
      Helper.assertEqual(true, await strategy.isWhitelistLiquidatorEnabled());
      expectEvent(tx, 'WhitelistedLiquidatorsEnabled', {
        isEnabled: true,
      });
      tx = await strategy.disableWhitelistedLiquidators({from: admin});
      Helper.assertEqual(false, await strategy.isWhitelistLiquidatorEnabled());
      expectEvent(tx, 'WhitelistedLiquidatorsEnabled', {
        isEnabled: false,
      });
    });
  });

  describe('#liquidation schedule', async () => {
    beforeEach('init contract', async () => {
      strategy = await LiquidationStrategy.new(admin, accounts[1], accounts[2], 100, 200, 300, []);
    });

    it('update - reverts not admin', async () => {
      await expectRevert(strategy.updateLiquidationSchedule(100, 200, 300, {from: accounts[0]}), 'only admin');
    });

    it('update - reverts repeated period is 0', async () => {
      await expectRevert(strategy.updateLiquidationSchedule(100, 0, 300, {from: admin}), 'repeatedPeriod == 0');
    });

    it('update - correct data and event', async () => {
      let tx = await strategy.updateLiquidationSchedule(120, 240, 100, {from: admin});
      let data = await strategy.getLiquidationSchedule();
      Helper.assertEqual(120, data.startTime);
      Helper.assertEqual(240, data.repeatedPeriod);
      Helper.assertEqual(100, data.duration);
      expectEvent(tx, 'LiquidationScheduleUpdated', {
        startTime: new BN(120),
        repeatedPeriod: new BN(240),
        duration: new BN(100),
      });
    });

    it('test get liquidation enable', async () => {
      let currentTime = await Helper.getCurrentBlockTime();
      await strategy.updateLiquidationSchedule(currentTime + 10, 240, 100, {from: admin});
      for (let i = 0; i < 300; i++) {
        Helper.assertEqual(
          checkLiquidationEnabled(currentTime + i - 20, currentTime, currentTime + 10, 240, 100),
          await strategy.isLiquidationEnabledAt(i + currentTime - 20)
        );
      }
      currentTime = await Helper.getCurrentBlockTime();
      await strategy.updateLiquidationSchedule(currentTime, 240, 100, {from: admin});
      Helper.assertEqual(
        checkLiquidationEnabled(currentTime, currentTime, 120, 240, 100),
        await strategy.isLiquidationEnabled()
      );
    });
  });

  describe('#liquidate', async () => {
    beforeEach('init contract', async () => {
      treasuryPool = await Pool.new(admin, []);
      rewardPool = accounts[8];
      strategy = await LiquidationStrategy.new(admin, treasuryPool.address, rewardPool, 0, 200, 200, []);
      await treasuryPool.authorizeStrategies([strategy.address], {from: admin});
    });

    it('reverts when not enabled', async () => {
      // duration is 0, so never enabled
      await strategy.updateLiquidationSchedule(0, 1, 0, {from: admin});
      await expectRevert(
        strategy.callLiquidate([], [], accounts[1], zeroAddress, 0, '0x'),
        'only when liquidation enabled'
      );
    });

    it('reverts only whitelisted dest token', async () => {
      // period == duration, always enabled
      await strategy.updateLiquidationSchedule(0, 1, 1, {from: admin});
      await expectRevert(
        strategy.callLiquidate([], [], accounts[1], zeroAddress, 0, '0x'),
        'only liquidate to whitelisted tokens'
      );
    });

    it('reverts can not liquidate a whitelisted token as a src token', async () => {
      // period == duration, always enabled
      await strategy.updateLiquidationSchedule(0, 1, 1, {from: admin});
      await strategy.updateWhitelistedTokens([accounts[1]], true, {from: admin});
      await expectRevert(
        strategy.callLiquidate([accounts[1]], [new BN(10)], accounts[1], accounts[1], 0, '0x'),
        'cannot liquidate a whitelisted token'
      );
      await strategy.updateWhitelistedTokens([accounts[1]], false, {from: admin});
    });

    it('reverts only whitelisted liquidator', async () => {
      // period == duration, always enabled
      await strategy.updateLiquidationSchedule(0, 1, 1, {from: admin});
      await strategy.updateWhitelistedTokens([accounts[1]], true, {from: admin});
      await strategy.enableWhitelistedLiquidators({from: admin});
      await expectRevert(
        strategy.callLiquidate([accounts[2]], [new BN(10)], accounts[1], accounts[1], 0, '0x', {from: accounts[1]}),
        'only whitelisted liquidator'
      );
      await strategy.updateWhitelistedTokens([accounts[1]], false, {from: admin});
    });

    it('reverts treasury pool reverts', async () => {
      // period == duration, always enabled
      await strategy.enableWhitelistedLiquidators({from: admin});
      await strategy.updateLiquidationSchedule(0, 1, 1, {from: admin});
      await strategy.updateWhitelistedTokens([accounts[1]], true, {from: admin});
      await strategy.updateWhitelistedLiquidators([accounts[1]], true, {from: admin});
      await expectRevert.unspecified(
        strategy.callLiquidate([], [], accounts[1], accounts[1], 0, '0x', {from: accounts[1]})
      );
      await strategy.updateWhitelistedTokens([accounts[1]], false, {from: admin});
      await strategy.updateWhitelistedLiquidators([accounts[1]], false, {from: admin});
    });

    it('reverts recipient callbacks reverts', async () => {
      // period == duration, always enabled
      await strategy.disableWhitelistedLiquidators({from: admin});
      await strategy.updateLiquidationSchedule(0, 1, 1, {from: admin});
      await strategy.updateWhitelistedTokens([accounts[1]], true, {from: admin});
      await strategy.updateWhitelistedLiquidators([accounts[1]], true, {from: admin});
      let ethAmount = new BN(100);
      await Helper.sendEtherWithPromise(accounts[0], treasuryPool.address, ethAmount);
      await expectRevert.unspecified(
        strategy.callLiquidate([ethAddress], [ethAmount], accounts[1], accounts[1], 0, '0x', {from: accounts[1]})
      );
      await strategy.updateWhitelistedTokens([accounts[1]], false, {from: admin});
      await strategy.updateWhitelistedLiquidators([accounts[1]], false, {from: admin});
    });

    it('revert insufficient dest amount', async () => {
      await strategy.disableWhitelistedLiquidators({from: admin});
      await strategy.updateLiquidationSchedule(0, 1, 1, {from: admin});
      liquidatorCallback = await MockLiquidatorWithCallback.new();
      let ethAmount = new BN(100);
      await Helper.sendEtherWithPromise(accounts[0], treasuryPool.address, ethAmount);
      let token = await Token.new();
      let minReturn = new BN(100);
      await token.transfer(liquidatorCallback.address, minReturn);
      // return less than minReturn by 1 twei
      await liquidatorCallback.setTransferBackAmount(minReturn.sub(new BN(1)));

      await strategy.updateWhitelistedTokens([token.address], true, {from: admin});
      await strategy.updateWhitelistedLiquidators([liquidatorCallback.address], true, {from: admin});

      await expectRevert(
        strategy.callLiquidate([ethAddress], [ethAmount], liquidatorCallback.address, token.address, minReturn, '0x', {
          from: accounts[1],
        }),
        'insufficient dest amount'
      );
      await strategy.updateWhitelistedTokens([token.address], false, {from: admin});
      await strategy.updateWhitelistedLiquidators([liquidatorCallback.address], false, {from: admin});
    });

    it('revert - reentrancy call', async () => {
      await strategy.disableWhitelistedLiquidators({from: admin});
      await strategy.updateLiquidationSchedule(0, 1, 1, {from: admin});
      liquidatorCallback = await MockLiquidatorWithCallback.new();
      let ethAmount = new BN(100);
      await Helper.sendEtherWithPromise(accounts[0], treasuryPool.address, ethAmount);
      let token = await Token.new();

      await strategy.updateWhitelistedTokens([token.address], true, {from: admin});
      await strategy.updateWhitelistedLiquidators([liquidatorCallback.address], true, {from: admin});

      await liquidatorCallback.setTestReentrancy(true);
      await expectRevert.unspecified(
        strategy.callLiquidate([ethAddress], [ethAmount], liquidatorCallback.address, token.address, 0, '0x', {
          from: accounts[1],
        })
      );
      await liquidatorCallback.setTestReentrancy(false);
      await strategy.updateWhitelistedTokens([token.address], false, {from: admin});
      await strategy.updateWhitelistedLiquidators([liquidatorCallback.address], false, {from: admin});
    });

    it('revert - reward pool can not receive eth', async () => {
      let reward = await NonePayableContract.new();
      strategy = await LiquidationStrategy.new(admin, treasuryPool.address, reward.address, 0, 200, 200, []);
      await treasuryPool.authorizeStrategies([strategy.address], {from: admin});

      await strategy.disableWhitelistedLiquidators({from: admin});
      await strategy.updateLiquidationSchedule(0, 1, 1, {from: admin});
      liquidatorCallback = await MockLiquidatorWithCallback.new();
      let tokenAmount = new BN(100);
      let token = await Token.new();
      await token.transfer(treasuryPool.address, tokenAmount);

      await strategy.updateWhitelistedTokens([ethAddress], true, {from: admin});
      await strategy.updateWhitelistedLiquidators([liquidatorCallback.address], true, {from: admin});

      await expectRevert.unspecified(
        strategy.callLiquidate([token.address], [tokenAmount], liquidatorCallback.address, ethAddress, 0, '0x', {
          from: accounts[1],
        })
      );
      await strategy.updateWhitelistedTokens([ethAddress], false, {from: admin});
      await strategy.updateWhitelistedLiquidators([liquidatorCallback.address], false, {from: admin});
      strategy = await LiquidationStrategy.new(admin, treasuryPool.address, rewardPool, 0, 200, 200, []);
    });

    it('correct data changes', async () => {
      await strategy.disableWhitelistedLiquidators({from: admin});
      await strategy.updateLiquidationSchedule(0, 1, 1, {from: admin});
      liquidatorCallback = await MockLiquidatorWithCallback.new();
      let ethAmount = new BN(100);
      await Helper.sendEtherWithPromise(accounts[0], treasuryPool.address, ethAmount);
      let token = await Token.new();
      let minReturn = new BN(100);
      await token.transfer(liquidatorCallback.address, minReturn.mul(new BN(2)));
      let actualReturn = minReturn.add(new BN(2));
      await liquidatorCallback.setTransferBackAmount(actualReturn);

      await strategy.updateWhitelistedTokens([token.address], true, {from: admin});
      await strategy.updateWhitelistedLiquidators([liquidatorCallback.address], true, {from: admin});

      let rewardPoolTokenBal = await token.balanceOf(rewardPool);
      let treasuryPoolEthBal = await Helper.getBalancePromise(treasuryPool.address);
      await strategy.callLiquidate(
        [ethAddress],
        [ethAmount],
        liquidatorCallback.address,
        token.address,
        minReturn,
        '0x',
        {from: accounts[1]}
      );
      Helper.assertEqual(treasuryPoolEthBal.sub(ethAmount), await Helper.getBalancePromise(treasuryPool.address));
      Helper.assertEqual(rewardPoolTokenBal.add(actualReturn), await token.balanceOf(rewardPool));
      await strategy.updateWhitelistedTokens([token.address], false, {from: admin});

      // test liquidate to eth
      await strategy.updateWhitelistedTokens([ethAddress], true, {from: admin});
      let tokenAmount = new BN(100);
      await token.transfer(treasuryPool.address, tokenAmount);
      minReturn = new BN(100);
      await Helper.sendEtherWithPromise(accounts[0], liquidatorCallback.address, minReturn);
      await liquidatorCallback.setTransferBackAmount(minReturn);

      await strategy.callLiquidate(
        [token.address],
        [tokenAmount],
        liquidatorCallback.address,
        ethAddress,
        minReturn,
        '0x',
        {from: accounts[1]}
      );

      await strategy.updateWhitelistedTokens([ethAddress], false, {from: admin});
      await strategy.updateWhitelistedLiquidators([liquidatorCallback.address], false, {from: admin});
    });
  });
});

function checkLiquidationEnabled(timestamp, currentTime, startTime, repeatedPeriod, duration) {
  if (timestamp < currentTime) return false;
  if (timestamp < startTime) return false;
  let timeInPeriod = (timestamp - startTime) % repeatedPeriod;
  return timeInPeriod < duration;
}

const {expectEvent, expectRevert} = require('@openzeppelin/test-helpers');
const BN = web3.utils.BN;

const Token = artifacts.require('KyberNetworkTokenV2.sol');
const Pool = artifacts.require('Pool.sol');
const LiquidationStrategy = artifacts.require('MockLiquidationStrategy.sol');
const MockLiquidatorWithCallback = artifacts.require('MockLiquidatorWithCallback.sol');
const NonePayableContract = artifacts.require('NonePayableContract.sol');
const MockSimplePriceOracle = artifacts.require('MockSimplePriceOracle.sol');

const Helper = require('./helper.js');
const {zeroAddress, ethAddress, ProposalState} = require('./helper.js');

let admin;
let operators;
let treasuryPool;
let rewardPool;
let strategy;
let liquidatorCallback;
let strategies;
let priceOracleStrategy;

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
        LiquidationStrategy.new(zeroAddress, accounts[0], accounts[1], 1000, 100, 100, [], []),
        'admin 0'
      );

      await expectRevert(
        LiquidationStrategy.new(admin, zeroAddress, accounts[1], 1000, 100, 100, [], []),
        'invalid treasury pool'
      );

      await expectRevert(
        LiquidationStrategy.new(admin, accounts[0], zeroAddress, 1000, 100, 100, [], []),
        'invalid reward pool'
      );
    });

    it('correct data initialized', async () => {
      let strategy = await LiquidationStrategy.new(
        admin,
        accounts[2],
        accounts[4],
        100,
        200,
        300,
        [accounts[5], accounts[6]],
        [accounts[4], accounts[3]]
      );
      Helper.assertEqual(admin, await strategy.admin());
      Helper.assertEqual(false, await strategy.paused());
      Helper.assertEqual(accounts[2], await strategy.treasuryPool());
      Helper.assertEqual(accounts[4], await strategy.rewardPool());
      Helper.assertEqual(true, await strategy.isWhitelistedLiquidator(accounts[5]));
      Helper.assertEqual(true, await strategy.isWhitelistedLiquidator(accounts[6]));
      Helper.assertEqual(2, await strategy.getWhitelistedLiquidatorsLength());
      Helper.assertEqual(accounts[5], await strategy.getWhitelistedLiquidatorAt(0));
      Helper.assertEqual(accounts[6], await strategy.getWhitelistedLiquidatorAt(1));
      Helper.assertEqual([accounts[5], accounts[6]], await strategy.getAllWhitelistedLiquidators());

      Helper.assertEqual(true, await strategy.isWhitelistedOracle(accounts[3]));
      Helper.assertEqual(true, await strategy.isWhitelistedOracle(accounts[4]));
      Helper.assertEqual(2, await strategy.getWhitelistedPriceOraclesLength());
      Helper.assertEqual(accounts[4], await strategy.getWhitelistedPriceOracleAt(0));
      Helper.assertEqual(accounts[3], await strategy.getWhitelistedPriceOracleAt(1));
      Helper.assertEqual([accounts[4], accounts[3]], await strategy.getAllWhitelistedPriceOracles());
    });
  });

  describe('#update pools', async () => {
    before('init contract', async () => {
      strategy = await LiquidationStrategy.new(admin, accounts[1], accounts[2], 100, 200, 300, [], []);
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

  describe('#whitelisted price oracles', async () => {
    beforeEach('init contract', async () => {
      strategy = await LiquidationStrategy.new(admin, accounts[1], accounts[2], 100, 200, 300, [], []);
    });

    it('update - revert not admin', async () => {
      await expectRevert(strategy.updateWhitelistedOracles([accounts[1]], true, {from: accounts[0]}), 'only admin');
      await expectRevert(strategy.updateWhitelistedOracles([accounts[1]], false, {from: accounts[0]}), 'only admin');
    });

    it('add new whitelisted oracles', async () => {
      let oracles = [accounts[0], accounts[1]];
      for (let i = 0; i < 2; i++) {
        // to test duplicated whitelisted oracles as well
        let tx = await strategy.updateWhitelistedOracles(oracles, true, {from: admin});
        Helper.assertEqual(true, await strategy.isWhitelistedOracle(oracles[0]));
        Helper.assertEqual(true, await strategy.isWhitelistedOracle(oracles[1]));
        Helper.assertEqual(oracles.length, await strategy.getWhitelistedPriceOraclesLength());
        Helper.assertEqualArray(oracles, await strategy.getAllWhitelistedPriceOracles());
        for (let id = 0; id < oracles.length; id++) {
          Helper.assertEqual(oracles[id], await strategy.getWhitelistedPriceOracleAt(id));
        }
        for (let id = 0; id < tx.receipt.logs.length; id++) {
          Helper.assertEqual('WhitelistedPriceOracleUpdated', tx.receipt.logs[id].event);
          Helper.assertEqual(oracles[id], tx.receipt.logs[id].args.oracle);
          Helper.assertEqual(true, tx.receipt.logs[id].args.isAdd);
        }
        await strategy.updateWhitelistedOracles(oracles, false, {from: admin});
      }
    });

    it('remove whitelisted oracles', async () => {
      let oracles = [accounts[0], accounts[1]];
      await strategy.updateWhitelistedOracles(oracles, true, {from: admin});
      for (let i = 0; i < 2; i++) {
        let tx = await strategy.updateWhitelistedOracles(oracles, false, {from: admin});
        Helper.assertEqual(false, await strategy.isWhitelistedOracle(oracles[0]));
        Helper.assertEqual(false, await strategy.isWhitelistedOracle(oracles[1]));
        Helper.assertEqual(0, await strategy.getWhitelistedPriceOraclesLength());
        Helper.assertEqualArray([], await strategy.getAllWhitelistedPriceOracles());
        for (let id = 0; id < tx.receipt.logs.length; id++) {
          Helper.assertEqual('WhitelistedPriceOracleUpdated', tx.receipt.logs[id].event);
          Helper.assertEqual(oracles[id], tx.receipt.logs[id].args.oracle);
          Helper.assertEqual(false, tx.receipt.logs[id].args.isAdd);
        }
      }
    });
  });

  describe('#whitelisted liquidator', async () => {
    beforeEach('init contract', async () => {
      strategy = await LiquidationStrategy.new(admin, accounts[1], accounts[2], 100, 200, 300, [], []);
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
  });

  describe('#liquidation schedule', async () => {
    beforeEach('init contract', async () => {
      strategy = await LiquidationStrategy.new(admin, accounts[1], accounts[2], 100, 200, 300, [], []);
    });

    it('update - reverts not admin', async () => {
      await expectRevert(strategy.updateLiquidationSchedule(100, 200, 300, {from: accounts[0]}), 'only admin');
    });

    it('update - reverts repeated period is 0', async () => {
      await expectRevert(strategy.updateLiquidationSchedule(100, 0, 300, {from: admin}), 'repeated period is 0');
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
      await strategy.updateLiquidationSchedule(120, 240, 100, {from: admin});
      Helper.assertEqual(
        checkLiquidationEnabled(currentTime, currentTime, 120, 240, 100),
        await strategy.isLiquidationEnabled()
      );
      // timestamp < start timestamp
      await strategy.updateLiquidationSchedule(currentTime + 10, 240, 100, {from: admin});
      Helper.assertEqual(false, await strategy.isLiquidationEnabled());
    });
  });

  describe('#liquidate', async () => {
    beforeEach('init contract', async () => {
      treasuryPool = await Pool.new(admin, []);
      rewardPool = accounts[8];
      priceOracleStrategy = await MockSimplePriceOracle.new();
      strategy = await LiquidationStrategy.new(
        admin,
        treasuryPool.address,
        rewardPool,
        0,
        200,
        200,
        [],
        [priceOracleStrategy.address]
      );
      await treasuryPool.authorizeStrategies([strategy.address], {from: admin});
    });

    it('reverts when paused', async () => {
      // duration is 0, so never enabled
      await strategy.addOperator(accounts[0], {from: admin});
      let tx = await strategy.setPause(true, {from: accounts[0]});
      expectEvent(tx, 'Pause', {
        caller: accounts[0],
        isPaused: true,
      });
      Helper.assertEqual(true, await strategy.paused());

      await expectRevert(
        strategy.liquidate(priceOracleStrategy.address, [], [], accounts[1], zeroAddress, '0x', '0x', {
          from: accounts[0],
        }),
        'liquidate: only when not paused'
      );

      tx = await strategy.setPause(false, {from: accounts[0]});
      expectEvent(tx, 'Pause', {
        caller: accounts[0],
        isPaused: false,
      });
      Helper.assertEqual(false, await strategy.paused());
    });

    it('reverts when not enabled', async () => {
      // duration is 0, so never enabled
      await strategy.updateLiquidationSchedule(0, 1, 0, {from: admin});
      await strategy.updateWhitelistedLiquidators([accounts[0]], true, {from: admin});
      await expectRevert(
        strategy.liquidate(priceOracleStrategy.address, [], [], accounts[1], zeroAddress, '0x', '0x', {
          from: accounts[0],
        }),
        'liquidate: only when liquidation enabled'
      );
      await strategy.updateWhitelistedLiquidators([accounts[0]], false, {from: admin});
    });

    it('reverts only whitelisted liquidator', async () => {
      // period == duration, always enabled
      await strategy.updateLiquidationSchedule(0, 1, 1, {from: admin});
      await expectRevert(
        strategy.liquidate(
          priceOracleStrategy.address,
          [accounts[2]],
          [new BN(10)],
          accounts[1],
          accounts[1],
          '0x',
          '0x',
          {from: accounts[1]}
        ),
        'liquidate: only whitelisted liquidator'
      );
    });

    it('reverts only whitelisted oracle', async () => {
      // period == duration, always enabled
      await strategy.updateLiquidationSchedule(0, 1, 1, {from: admin});
      await strategy.updateWhitelistedLiquidators([accounts[1]], true, {from: admin});
      await expectRevert(
        strategy.liquidate(accounts[0], [accounts[2]], [new BN(10)], accounts[1], accounts[1], '0x', '0x', {
          from: accounts[1],
        }),
        'liquidate: only whitelisted oracle'
      );
    });

    it('reverts treasury pool reverts', async () => {
      // period == duration, always enabled
      await strategy.updateLiquidationSchedule(0, 1, 1, {from: admin});
      await strategy.updateWhitelistedLiquidators([accounts[1]], true, {from: admin});
      await expectRevert.unspecified(
        strategy.liquidate(priceOracleStrategy.address, [], [], accounts[1], accounts[1], '0x', '0x', {
          from: accounts[1],
        })
      );
      await strategy.updateWhitelistedLiquidators([accounts[1]], false, {from: admin});
    });

    it('reverts recipient callbacks reverts', async () => {
      // period == duration, always enabled
      await strategy.updateLiquidationSchedule(0, 1, 1, {from: admin});
      await strategy.updateWhitelistedLiquidators([accounts[1]], true, {from: admin});
      let ethAmount = new BN(100);
      await Helper.sendEtherWithPromise(accounts[0], treasuryPool.address, ethAmount);
      await expectRevert.unspecified(
        strategy.liquidate(
          priceOracleStrategy.address,
          [ethAddress],
          [ethAmount],
          accounts[1],
          accounts[1],
          '0x',
          '0x',
          {from: accounts[1]}
        )
      );
      await strategy.updateWhitelistedLiquidators([accounts[1]], false, {from: admin});
    });

    it('revert invalid length', async () => {
      await strategy.updateLiquidationSchedule(0, 1, 1, {from: admin});
      await strategy.updateWhitelistedLiquidators([accounts[1]], true, {from: admin});
      let minReturn = new BN(1000);
      await priceOracleStrategy.setAmountOut(minReturn);

      let token = await Token.new();
      let ethAmount = new BN(1000);
      await priceOracleStrategy.setAmountOut(0);
      await expectRevert(
        strategy.liquidate(
          priceOracleStrategy.address,
          [ethAddress],
          [ethAmount],
          accounts[0],
          token.address,
          '0x',
          '0x',
          {
            from: accounts[1],
          }
        ),
        'liquidate: minReturn == 0'
      );

      await strategy.updateWhitelistedLiquidators([accounts[1]], false, {from: admin});
    });

    it('revert insufficient dest amount', async () => {
      await strategy.updateLiquidationSchedule(0, 1, 1, {from: admin});
      liquidatorCallback = await MockLiquidatorWithCallback.new();
      let ethAmount = new BN(100);
      await Helper.sendEtherWithPromise(accounts[0], treasuryPool.address, ethAmount);
      let token = await Token.new();
      let minReturn = new BN(100);
      await token.transfer(liquidatorCallback.address, minReturn);
      // return less than minReturn by 1 twei
      await liquidatorCallback.setTransferBackAmount(minReturn.sub(new BN(1)));

      await strategy.updateWhitelistedLiquidators([accounts[1]], true, {from: admin});
      await priceOracleStrategy.setAmountOut(minReturn);
      await expectRevert(
        strategy.liquidate(
          priceOracleStrategy.address,
          [ethAddress],
          [ethAmount],
          liquidatorCallback.address,
          token.address,
          '0x',
          '0x',
          {
            from: accounts[1],
          }
        ),
        'liquidate: low return amount'
      );

      await strategy.updateWhitelistedLiquidators([accounts[1]], false, {from: admin});
    });

    it('revert - reentrancy call', async () => {
      await strategy.updateLiquidationSchedule(0, 1, 1, {from: admin});
      liquidatorCallback = await MockLiquidatorWithCallback.new();
      let ethAmount = new BN(100);
      await Helper.sendEtherWithPromise(accounts[0], treasuryPool.address, ethAmount);
      let token = await Token.new();
      let minReturn = new BN(1000);
      await priceOracleStrategy.setAmountOut(minReturn);

      await strategy.updateWhitelistedLiquidators([liquidatorCallback.address], true, {from: admin});

      await liquidatorCallback.setTestReentrancy(true);
      await expectRevert.unspecified(
        strategy.liquidate(
          priceOracleStrategy.address,
          [ethAddress],
          [ethAmount],
          liquidatorCallback.address,
          token.address,
          '0x',
          '0x',
          {
            from: accounts[1],
          }
        )
      );
      await liquidatorCallback.setTestReentrancy(false);
      await strategy.updateWhitelistedLiquidators([liquidatorCallback.address], false, {from: admin});
    });

    it('revert - reward pool can not receive eth', async () => {
      let reward = await NonePayableContract.new();
      strategy = await LiquidationStrategy.new(
        admin,
        treasuryPool.address,
        reward.address,
        0,
        200,
        200,
        [],
        [priceOracleStrategy.address]
      );
      await treasuryPool.authorizeStrategies([strategy.address], {from: admin});

      await strategy.updateLiquidationSchedule(0, 1, 1, {from: admin});
      liquidatorCallback = await MockLiquidatorWithCallback.new();
      let tokenAmount = new BN(100);
      let token = await Token.new();
      await token.transfer(treasuryPool.address, tokenAmount);

      let minReturn = new BN(1000);
      await priceOracleStrategy.setAmountOut(minReturn);
      await strategy.updateWhitelistedLiquidators([liquidatorCallback.address], true, {from: admin});

      await expectRevert.unspecified(
        strategy.liquidate(
          priceOracleStrategy.address,
          [token.address],
          [tokenAmount],
          liquidatorCallback.address,
          ethAddress,
          '0x',
          '0x',
          {
            from: accounts[1],
          }
        )
      );
      await strategy.updateWhitelistedLiquidators([liquidatorCallback.address], false, {from: admin});
      strategy = await LiquidationStrategy.new(
        admin,
        treasuryPool.address,
        rewardPool,
        0,
        200,
        200,
        [],
        [priceOracleStrategy.address]
      );
    });

    it('correct data changes', async () => {
      await strategy.updateLiquidationSchedule(0, 1, 1, {from: admin});
      liquidatorCallback = await MockLiquidatorWithCallback.new();
      let ethAmount = new BN(100);
      await Helper.sendEtherWithPromise(accounts[0], treasuryPool.address, ethAmount);
      let token = await Token.new();
      let minReturn = new BN(100);
      await token.transfer(liquidatorCallback.address, minReturn.mul(new BN(2)));
      let actualReturn = minReturn.add(new BN(2));
      await liquidatorCallback.setTransferBackAmount(actualReturn);

      await priceOracleStrategy.setAmountOut(minReturn);
      await strategy.updateWhitelistedLiquidators([liquidatorCallback.address, accounts[1]], true, {from: admin});

      let rewardPoolTokenBal = await token.balanceOf(rewardPool);
      let treasuryPoolEthBal = await Helper.getBalancePromise(treasuryPool.address);
      await strategy.liquidate(
        priceOracleStrategy.address,
        [ethAddress],
        [ethAmount],
        liquidatorCallback.address,
        token.address,
        '0x',
        '0x',
        {from: accounts[1]}
      );
      Helper.assertEqual(treasuryPoolEthBal.sub(ethAmount), await Helper.getBalancePromise(treasuryPool.address));
      Helper.assertEqual(rewardPoolTokenBal.add(actualReturn), await token.balanceOf(rewardPool));

      // test liquidate to eth
      let tokenAmount = new BN(100);
      await token.transfer(treasuryPool.address, tokenAmount);
      minReturn = new BN(100);
      await priceOracleStrategy.setAmountOut(minReturn);
      await Helper.sendEtherWithPromise(accounts[0], liquidatorCallback.address, minReturn);
      await liquidatorCallback.setTransferBackAmount(minReturn);

      await strategy.liquidate(
        priceOracleStrategy.address,
        [token.address],
        [tokenAmount],
        liquidatorCallback.address,
        ethAddress,
        '0x',
        '0x',
        {from: accounts[1]}
      );

      await strategy.updateWhitelistedLiquidators([liquidatorCallback.address, accounts[1]], false, {from: admin});
    });
  });
});

function checkLiquidationEnabled(timestamp, currentTime, startTime, repeatedPeriod, duration) {
  if (timestamp < currentTime) return false;
  if (duration == 0) return false;
  if (timestamp < startTime) return false;
  let timeInPeriod = (timestamp - startTime) % repeatedPeriod;
  return timeInPeriod < duration;
}

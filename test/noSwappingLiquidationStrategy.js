const {expectEvent, expectRevert} = require('@openzeppelin/test-helpers');
const BN = web3.utils.BN;

const NoSwappingLiquidationStrategy = artifacts.require('NoSwappingLiquidationStrategy.sol');
const Pool = artifacts.require('Pool.sol');
const Token = artifacts.require('KyberNetworkTokenV2.sol');

const Helper = require('./helper.js');
const {zeroAddress, ethAddress} = require('./helper.js');

let admin;
let operator;
let feePool;
let treasuryPool;
let strategy;

contract('KyberGovernance', function (accounts) {
  before('Global setup', async () => {
    admin = accounts[1];
    operator = accounts[4];
  });

  describe('#constructor', async () => {
    it('invalid params', async () => {
      await expectRevert(NoSwappingLiquidationStrategy.new(zeroAddress, accounts[0], accounts[0]), 'admin 0');
      await expectRevert(NoSwappingLiquidationStrategy.new(admin, zeroAddress, accounts[0]), 'invalid fee pool');
      await expectRevert(NoSwappingLiquidationStrategy.new(admin, accounts[0], zeroAddress), 'invalid treasury pool');
    });

    it('correct data inited', async () => {
      strategy = await NoSwappingLiquidationStrategy.new(admin, accounts[0], accounts[2]);
      Helper.assertEqual(admin, await strategy.admin());
      Helper.assertEqual(accounts[0], await strategy.feePool());
      Helper.assertEqual(accounts[2], await strategy.treasuryPool());
    });
  });

  describe('#update pool addresses', async () => {
    beforeEach('init data', async () => {
      strategy = await NoSwappingLiquidationStrategy.new(admin, accounts[0], accounts[2]);
    });

    it('fee pool - reverts not admin', async () => {
      await expectRevert(strategy.updateFeePool(accounts[2], {from: operator}), 'only admin');
    });

    it('fee pool - reverts invalid fee pool', async () => {
      await expectRevert(strategy.updateFeePool(zeroAddress, {from: admin}), 'invalid fee pool');
    });

    it('fee pool - data updates and events', async () => {
      let tx = await strategy.updateFeePool(accounts[5], {from: admin});
      Helper.assertEqual(accounts[5], await strategy.feePool());
      expectEvent(tx, 'FeePoolSet', {
        feePool: accounts[5],
      });
    });

    it('treasury pool - reverts not admin', async () => {
      await expectRevert(strategy.updateTreasuryPool(accounts[2], {from: operator}), 'only admin');
    });

    it('treasury pool - reverts invalid fee pool', async () => {
      await expectRevert(strategy.updateTreasuryPool(zeroAddress, {from: admin}), 'invalid treasury pool');
    });

    it('treasury pool - data updates and events', async () => {
      let tx = await strategy.updateTreasuryPool(accounts[5], {from: admin});
      Helper.assertEqual(accounts[5], await strategy.treasuryPool());
      expectEvent(tx, 'TreasuryPoolSet', {
        treasuryPool: accounts[5],
      });
    });
  });

  describe('#liquidate', async () => {
    let tokens = [];
    before('deploy tokens', async () => {
      feePool = await Pool.new(admin, []);
      treasuryPool = await Pool.new(admin, []);
      for (let i = 0; i < 4; i++) {
        let token = await Token.new();
        tokens.push(token);
      }
    });

    it('revert withdraw funds from fee pool reverts', async () => {
      strategy = await NoSwappingLiquidationStrategy.new(admin, accounts[2], accounts[3]);
      await expectRevert.unspecified(strategy.liquidate([tokens[0].address], [10]));
    });

    it('correct event', async () => {
      strategy = await NoSwappingLiquidationStrategy.new(admin, feePool.address, treasuryPool.address);
      let ethAmount = new BN(10000);
      let tokenAmount = new BN(2000);
      await Helper.sendEtherWithPromise(accounts[0], feePool.address, ethAmount);
      await tokens[0].transfer(feePool.address, tokenAmount);
      let feeEthBal = await Helper.getBalancePromise(feePool.address);
      let treasuryEthBal = await Helper.getBalancePromise(treasuryPool.address);
      let feeTokenBal = await tokens[0].balanceOf(feePool.address);
      let treasuryTokenBal = await tokens[0].balanceOf(treasuryPool.address);
      await feePool.authorizeStrategies([strategy.address], {from: admin});
      let tx = await strategy.liquidate([ethAddress, tokens[0].address], [ethAmount, tokenAmount], {
        from: accounts[4],
      });
      Helper.assertEqual(feeEthBal.sub(ethAmount), await Helper.getBalancePromise(feePool.address));
      Helper.assertEqual(treasuryEthBal.add(ethAmount), await Helper.getBalancePromise(treasuryPool.address));
      Helper.assertEqual(feeTokenBal.sub(tokenAmount), await tokens[0].balanceOf(feePool.address));
      Helper.assertEqual(treasuryTokenBal.add(tokenAmount), await tokens[0].balanceOf(treasuryPool.address));
      let hasEvent = false;
      for (let i = 0; i < tx.logs.length; i++) {
        if (tx.logs[i].event == 'Liquidated') {
          hasEvent = true;
          Helper.assertEqual(accounts[4], tx.logs[i].args.sender);
          Helper.assertEqualArray([ethAddress, tokens[0].address], tx.logs[i].args.sources);
          Helper.assertEqualArray([ethAmount, tokenAmount], tx.logs[i].args.amounts);
        }
      }
      assert(hasEvent);
    });
  });
});

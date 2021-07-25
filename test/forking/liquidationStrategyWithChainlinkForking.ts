import {waffle, artifacts} from 'hardhat';
import {BigNumber as BN} from '@ethersproject/bignumber';

import Helper from '../helper';
import {ethAddress} from '../helper';
const LiquidationHelper = require('./liquidationHelper');

import {
  TreasuryPool,
  LiquidationStrategyBase,
  MockSimpleLiquidatorCallbackHandler,
  MockToken,
  MockDmmChainLinkPriceOracle,
} from '../../typechain';
import {Dictionary} from 'underscore';

const Token: MockToken = artifacts.require('MockToken');
const CallbackHandler: MockSimpleLiquidatorCallbackHandler = artifacts.require('MockSimpleLiquidatorCallbackHandler');
const Pool: TreasuryPool = artifacts.require('TreasuryPool');
const LiquidationBase: LiquidationStrategyBase = artifacts.require('LiquidationStrategyBase');

enum LiquidationType {
  LP,
  TOKEN,
}

const kncAddress = LiquidationHelper.kncAddress;
const wbtcAddress = LiquidationHelper.wbtcAddress;
const usdtAddress = LiquidationHelper.usdtAddress;

const poolAddresses = [
  LiquidationHelper.ethKncPoolAddress,
  LiquidationHelper.ethWbtcPoolAddress,
  LiquidationHelper.ethUsdtPoolAddress,
];

let admin;
let user;

let priceOracle: MockDmmChainLinkPriceOracle;
let callbackHandler: MockSimpleLiquidatorCallbackHandler;
let treasuryPool: TreasuryPool;
let rewardPool: TreasuryPool;
let liquidationBase: LiquidationStrategyBase;

describe('LiquidationStrategyBase-Forking - only check expected returns, transfer src tokens & get back dest token', () => {
  const [admin, user] = waffle.provider.getWallets();

  before('reset state', async () => {
    await Helper.resetForking();
    await LiquidationHelper.setupLpTokens(user);
    priceOracle = await LiquidationHelper.setupPriceOracleContract(admin);
    callbackHandler = await CallbackHandler.new();
    treasuryPool = await Pool.new(admin.address, []);
    rewardPool = await Pool.new(admin.address, []);
    liquidationBase = await LiquidationBase.new(
      admin.address,
      treasuryPool.address,
      rewardPool.address,
      0,
      1,
      1,
      [user.address],
      [priceOracle.address]
    );
    await treasuryPool.authorizeStrategies([liquidationBase.address], {from: admin.address});
  });

  it('liquidate normal tokens', async () => {
    await Helper.sendEtherWithPromise(user.address, treasuryPool.address, BN.from(10).pow(18));

    let kncToken = await Token.at(kncAddress);
    let ethAmount = BN.from(10).pow(16);
    let tx;

    // transfer knc to callback
    await kncToken.transfer(callbackHandler.address, BN.from(10).pow(21), {from: user.address});
    tx = await liquidationBase.liquidate(
      priceOracle.address,
      [ethAddress],
      [ethAmount],
      callbackHandler.address,
      kncAddress,
      await priceOracle.getEncodedData([LiquidationType.TOKEN]),
      '0x',
      {from: user.address}
    );
    console.log(`    Liquidate eth -> knc gas used: ${getGasUsed(tx)}`);

    let tokenAddresses = [kncAddress, usdtAddress, wbtcAddress];
    let amounts = [];
    let types = [];

    for (let i = 0; i < tokenAddresses.length; i++) {
      let token = await Token.at(tokenAddresses[i]);
      let amount = BN.from(1000000);
      await token.transfer(treasuryPool.address, amount, {from: user.address});
      amounts.push(amount);
      types.push(LiquidationType.TOKEN);
    }
    tokenAddresses.push(ethAddress);
    amounts.push(ethAmount);
    types.push(LiquidationType.TOKEN);

    let oracleHint = await priceOracle.getEncodedData(types);
    tx = await liquidationBase.liquidate(
      priceOracle.address,
      tokenAddresses,
      amounts,
      callbackHandler.address,
      kncAddress,
      oracleHint,
      '0x',
      {from: user.address}
    );
    console.log(`    Liquidate ${tokenAddresses.length} tokens -> knc gas used: ${getGasUsed(tx)}`);
  });

  it('liquidate LP tokens', async () => {
    let amounts = [];
    let types = [];
    for (let i = 0; i < poolAddresses.length; i++) {
      let token = await Token.at(poolAddresses[i]);
      let amount = BN.from(1000000);
      await token.transfer(treasuryPool.address, amount, {from: user.address});
      amounts.push(amount);
      types.push(LiquidationType.LP);
    }
    let oracleHint = await priceOracle.getEncodedData(types);

    // transfer knc to callback
    let kncToken = await Token.at(kncAddress);
    await kncToken.transfer(callbackHandler.address, BN.from(10).pow(21), {from: user.address});
    let tx = await liquidationBase.liquidate(
      priceOracle.address,
      poolAddresses,
      amounts,
      callbackHandler.address,
      kncAddress,
      oracleHint,
      '0x',
      {from: user.address}
    );
    console.log(`    Liquidate ${poolAddresses.length} LP tokens gas used: ${getGasUsed(tx)}`);
  });

  it('liquidate combines tokens', async () => {
    let amounts = [];
    let addresses = [];
    let types = [];
    for (let i = 0; i < poolAddresses.length; i++) {
      let token = await Token.at(poolAddresses[i]);
      let amount = BN.from(1000000);
      await token.transfer(treasuryPool.address, amount, {from: user.address});
      amounts.push(amount);
      addresses.push(poolAddresses[i]);
      types.push(LiquidationType.LP);
    }

    let tokenAddresses = [kncAddress, usdtAddress, wbtcAddress];

    for (let i = 0; i < tokenAddresses.length; i++) {
      let token = await Token.at(tokenAddresses[i]);
      let amount = BN.from(1000000);
      await token.transfer(treasuryPool.address, amount, {from: user.address});
      addresses.push(tokenAddresses[i]);
      amounts.push(amount);
      types.push(LiquidationType.TOKEN);
    }

    addresses.push(ethAddress);
    amounts.push(BN.from(10).pow(16));
    types.push(LiquidationType.TOKEN);

    let oracleHint = await priceOracle.getEncodedData(types);

    // transfer knc to callback
    let kncToken = await Token.at(kncAddress);
    await kncToken.transfer(callbackHandler.address, BN.from(10).pow(21), {from: user.address});

    let tx = await liquidationBase.liquidate(
      priceOracle.address,
      addresses,
      amounts,
      callbackHandler.address,
      kncAddress,
      oracleHint,
      '0x',
      {from: user.address}
    );
    console.log(`    Liquidate combination ${addresses.length} tokens gas used: ${getGasUsed(tx)}`);
  });
});

function getGasUsed(tx: Object) {
  // tx.receipt.gasUsed
  return ((tx as Dictionary<Object>).receipt as Dictionary<Object>).gasUsed as Number;
}

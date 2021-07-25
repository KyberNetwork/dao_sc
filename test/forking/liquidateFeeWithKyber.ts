import {ethers, waffle, artifacts} from 'hardhat';
import {BigNumber as BN} from '@ethersproject/bignumber';

import {expect} from 'chai';
import Helper from '../helper';
import {ethAddress, zeroAddress} from '../helper';
const LiquidationHelper = require('./liquidationHelper');

import {
  TreasuryPool,
  LiquidationStrategyBase,
  MockSimpleLiquidatorCallbackHandler,
  MockToken,
  MockDmmChainLinkPriceOracle,
  LiquidateFeeWithKyber,
} from '../../typechain';
import {Dictionary} from 'underscore';

const Token: MockToken = artifacts.require('MockToken');
const CallbackHandler: MockSimpleLiquidatorCallbackHandler = artifacts.require('MockSimpleLiquidatorCallbackHandler');
const Pool: TreasuryPool = artifacts.require('TreasuryPool');
const LiquidationBase: LiquidationStrategyBase = artifacts.require('LiquidationStrategyBase');
const LiquidateWithKyber: LiquidateFeeWithKyber = artifacts.require('LiquidateFeeWithKyber');

enum LiquidationType {
  LP,
  TOKEN,
}

const kyberProxyAddress = '0x9AAb3f75489902f3a48495025729a0AF77d4b11e';
const wethAddress = LiquidationHelper.wethAddress;
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
let liquidateWithKyber: LiquidateFeeWithKyber;

describe('LiquidateFeeWithKyber-Forking', () => {
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
      [],
      [priceOracle.address]
    );
    liquidateWithKyber = await LiquidateWithKyber.new(
      admin.address,
      wethAddress,
      liquidationBase.address,
      priceOracle.address,
      kyberProxyAddress
    );
    await treasuryPool.authorizeStrategies([liquidationBase.address], {from: admin.address});
    await liquidationBase.updateWhitelistedLiquidators([liquidateWithKyber.address], true, {from: admin.address});
  });

  const getTokenBalance = async (token: string, account: string) => {
    if (token == ethAddress) {
      return await Helper.getBalancePromise(account);
    }
    let tokenContract = await Token.at(token);
    return await tokenContract.balanceOf(account);
  }

  const liquidateAndVerify = async (
    addresses: string[],
    amounts: BN[],
    types: LiquidationType[],
    tradeTokens: string[],
    dest: string
  ) => {
    let rewardPoolKncBalance: BN = await getTokenBalance(dest, rewardPool.address);
    let expectedReturn: BN = await priceOracle.getExpectedReturn(
      liquidateWithKyber.address,
      addresses,
      amounts,
      dest,
      await priceOracle.getEncodedData(types)
    );
    console.log(`        Expected returns: ${expectedReturn.toString()}`);
    let balanceLiquidator = await getTokenBalance(dest, liquidateWithKyber.address);
    let balances = [];
    for (let i = 0; i < addresses.length; i++) {
      balances.push(await getTokenBalance(addresses[i], treasuryPool.address));
    }
    let tx = await liquidateWithKyber.liquidate(addresses, amounts, types, dest, tradeTokens, {
      from: user.address,
    });
    // verify balance in treasury pool
    for (let i = 0; i < addresses.length; i++) {
      let balanceAfter = await getTokenBalance(addresses[i], treasuryPool.address);
      expect(amounts[i].toString()).to.be.eql(balances[i].sub(balanceAfter).toString());
    }
    let rewardPoolKncAfter: BN = await getTokenBalance(dest, rewardPool.address);
    // reward pool should receive correct amount of knc
    expect(expectedReturn.toString()).to.be.eql(rewardPoolKncAfter.sub(rewardPoolKncBalance).toString());
    let premiumDest = (await getTokenBalance(dest, liquidateWithKyber.address)).sub(balanceLiquidator);
    console.log(`        Premium received: ${premiumDest.toString()}`);
    return tx;
  };

  it('liquidate normal tokens', async () => {
    await Helper.sendEtherWithPromise(user.address, treasuryPool.address, BN.from(10).pow(19));

    let kncToken = await Token.at(kncAddress);
    let ethAmount = BN.from(10).pow(19); // 10 eth
    let tx;

    // transfer knc to callback
    await kncToken.transfer(callbackHandler.address, BN.from(10).pow(21), {from: user.address});
    tx = await liquidateAndVerify([ethAddress], [ethAmount], [LiquidationType.TOKEN], [ethAddress], kncAddress);

    console.log(`    Liquidate with Kyber eth -> knc gas used: ${getGasUsed(tx)}`);

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

    await Helper.sendEtherWithPromise(user.address, treasuryPool.address, BN.from(10).pow(19));
    tokenAddresses.push(ethAddress);
    amounts.push(ethAmount);
    types.push(LiquidationType.TOKEN);

    tx = await liquidateAndVerify(tokenAddresses, amounts, types, tokenAddresses, kncAddress);
    console.log(`    Liquidate with Kyber ${tokenAddresses.length} tokens -> knc gas used: ${getGasUsed(tx)}`);
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
    let tradeTokens = [ethAddress, wethAddress, kncAddress, wbtcAddress, usdtAddress];

    let tx = await liquidateAndVerify(poolAddresses, amounts, types, tradeTokens, kncAddress);
    console.log(`    Liquidate with Kyber ${poolAddresses.length} LP tokens gas used: ${getGasUsed(tx)}`);
  });

  let destTokens = [kncAddress, ethAddress, usdtAddress];
  let destTokenNames = ["knc", "eth", "usdt"];
  for (let d = 0; d < destTokens.length; d++) {
    it(`liquidate combines tokens to ${destTokenNames[d]}`, async () => {
      await priceOracle.updateWhitelistedTokens(destTokens, false, { from: admin.address });
      await priceOracle.updateWhitelistedTokens([destTokens[d]], true, { from: admin.address });
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
        let amount = BN.from(10).pow(await token.decimals() - 2);
        await token.transfer(treasuryPool.address, amount, {from: user.address});
        addresses.push(tokenAddresses[i]);
        amounts.push(amount);
        types.push(LiquidationType.TOKEN);
      }

      await Helper.sendEtherWithPromise(user.address, treasuryPool.address, BN.from(10).pow(19));
      addresses.push(ethAddress);
      amounts.push(BN.from(10).pow(19)); // 10 eth
      types.push(LiquidationType.TOKEN);

      let tradeTokens = [ethAddress, wethAddress, kncAddress, wbtcAddress, usdtAddress];

      let tx = await liquidateAndVerify(addresses, amounts, types, tradeTokens, destTokens[d]);
      console.log(`    Liquidate with Kyber combination ${addresses.length} tokens gas used: ${getGasUsed(tx)}`);
    });
  }
});

function getGasUsed(tx: Object) {
  // tx.receipt.gasUsed
  return ((tx as Dictionary<Object>).receipt as Dictionary<Object>).gasUsed as Number;
}

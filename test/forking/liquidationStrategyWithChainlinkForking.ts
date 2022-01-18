import {ethers, waffle} from 'hardhat';
import {BigNumber as BN} from '@ethersproject/bignumber';

import Helper from '../helper';
import {ethAddress} from '../helper';
const LiquidationHelper = require('./liquidationHelper');

import {
  TreasuryPool,
  LiquidationStrategyBase,
  LiquidationStrategyBase__factory,
  MockSimpleLiquidatorCallbackHandler,
  MockToken__factory,
  MockDmmChainLinkPriceOracle,
  MockSimpleLiquidatorCallbackHandler__factory,
  TreasuryPool__factory,
} from '../../typechain';

let Token: MockToken__factory;
let CallbackHandler: MockSimpleLiquidatorCallbackHandler__factory;
let Pool: TreasuryPool__factory;
let LiquidationBase: LiquidationStrategyBase__factory;

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

let priceOracle: MockDmmChainLinkPriceOracle;
let callbackHandler: MockSimpleLiquidatorCallbackHandler;
let treasuryPool: TreasuryPool;
let rewardPool: TreasuryPool;
let liquidationBase: LiquidationStrategyBase;

describe('LiquidationStrategyBase-Forking - only check expected returns, transfer src tokens & get back dest token', () => {
  const [admin, user] = waffle.provider.getWallets();

  before('reset state', async () => {
    LiquidationBase = (await ethers.getContractFactory('LiquidationStrategyBase')) as LiquidationStrategyBase__factory;
    Token = (await ethers.getContractFactory('MockToken')) as MockToken__factory;
    CallbackHandler = (await ethers.getContractFactory(
      'MockSimpleLiquidatorCallbackHandler'
    )) as MockSimpleLiquidatorCallbackHandler__factory;
    Pool = (await ethers.getContractFactory('TreasuryPool')) as TreasuryPool__factory;
    await Helper.resetForking();
    await LiquidationHelper.setupLpTokens(user);
    priceOracle = await LiquidationHelper.setupPriceOracleContract(admin);
    callbackHandler = await CallbackHandler.deploy();
    treasuryPool = await Pool.deploy(admin.address, []);
    rewardPool = await Pool.deploy(admin.address, []);
    liquidationBase = await LiquidationBase.deploy(
      admin.address,
      treasuryPool.address,
      rewardPool.address,
      0,
      1,
      1,
      [user.address],
      [priceOracle.address]
    );
    await treasuryPool.connect(admin).authorizeStrategies([liquidationBase.address]);
  });

  it('liquidate normal tokens', async () => {
    await Helper.sendEtherWithPromise(user.address, treasuryPool.address, BN.from(10).pow(18));

    let kncToken = await Token.attach(kncAddress);
    let ethAmount = BN.from(10).pow(16);
    let tx;

    // transfer knc to callback
    await kncToken.connect(user).transfer(callbackHandler.address, BN.from(10).pow(21));
    tx = await liquidationBase
      .connect(user)
      .liquidate(
        priceOracle.address,
        [ethAddress],
        [ethAmount],
        callbackHandler.address,
        kncAddress,
        await priceOracle.getEncodedData([LiquidationType.TOKEN]),
        '0x'
      );
    console.log(`    Liquidate eth -> knc gas used: ${(await tx.wait()).gasUsed.toString()}`);

    let tokenAddresses = [kncAddress, usdtAddress, wbtcAddress];
    let amounts = [];
    let types = [];

    for (let i = 0; i < tokenAddresses.length; i++) {
      let token = await Token.attach(tokenAddresses[i]);
      let amount = BN.from(1000000);
      await token.connect(user).transfer(treasuryPool.address, amount);
      amounts.push(amount);
      types.push(LiquidationType.TOKEN);
    }
    tokenAddresses.push(ethAddress);
    amounts.push(ethAmount);
    types.push(LiquidationType.TOKEN);

    let oracleHint = await priceOracle.getEncodedData(types);
    tx = await liquidationBase
      .connect(user)
      .liquidate(priceOracle.address, tokenAddresses, amounts, callbackHandler.address, kncAddress, oracleHint, '0x');
    console.log(
      `    Liquidate ${tokenAddresses.length} tokens -> knc gas used: ${(await tx.wait()).gasUsed.toString()}`
    );
  });

  it('liquidate LP tokens', async () => {
    let amounts = [];
    let types = [];
    for (let i = 0; i < poolAddresses.length; i++) {
      let token = await Token.attach(poolAddresses[i]);
      let amount = BN.from(1000000);
      await token.connect(user).transfer(treasuryPool.address, amount);
      amounts.push(amount);
      types.push(LiquidationType.LP);
    }
    let oracleHint = await priceOracle.getEncodedData(types);

    // transfer knc to callback
    let kncToken = await Token.attach(kncAddress);
    await kncToken.connect(user).transfer(callbackHandler.address, BN.from(10).pow(21));
    let tx = await liquidationBase
      .connect(user)
      .liquidate(priceOracle.address, poolAddresses, amounts, callbackHandler.address, kncAddress, oracleHint, '0x');
    console.log(`    Liquidate ${poolAddresses.length} LP tokens gas used: ${(await tx.wait()).gasUsed.toString()}`);
  });

  it('liquidate combines tokens', async () => {
    let amounts = [];
    let addresses = [];
    let types = [];
    for (let i = 0; i < poolAddresses.length; i++) {
      let token = await Token.attach(poolAddresses[i]);
      let amount = BN.from(1000000);
      await token.connect(user).transfer(treasuryPool.address, amount);
      amounts.push(amount);
      addresses.push(poolAddresses[i]);
      types.push(LiquidationType.LP);
    }

    let tokenAddresses = [kncAddress, usdtAddress, wbtcAddress];

    for (let i = 0; i < tokenAddresses.length; i++) {
      let token = await Token.attach(tokenAddresses[i]);
      let amount = BN.from(1000000);
      await token.connect(user).transfer(treasuryPool.address, amount);
      addresses.push(tokenAddresses[i]);
      amounts.push(amount);
      types.push(LiquidationType.TOKEN);
    }

    addresses.push(ethAddress);
    amounts.push(BN.from(10).pow(16));
    types.push(LiquidationType.TOKEN);

    let oracleHint = await priceOracle.getEncodedData(types);

    // transfer knc to callback
    let kncToken = await Token.attach(kncAddress);
    await kncToken.connect(user).transfer(callbackHandler.address, BN.from(10).pow(21));

    let tx = await liquidationBase
      .connect(user)
      .liquidate(priceOracle.address, addresses, amounts, callbackHandler.address, kncAddress, oracleHint, '0x');
    console.log(
      `    Liquidate combination ${addresses.length} tokens gas used: ${(await tx.wait()).gasUsed.toString()}`
    );
  });
});

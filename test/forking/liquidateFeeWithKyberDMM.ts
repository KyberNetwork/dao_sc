import {ethers, waffle} from 'hardhat';
import {BigNumber as BN} from '@ethersproject/bignumber';

import {expect} from 'chai';
import Helper from '../helper';

const LiquidationHelper = require('./liquidationHelper');

import {MockToken__factory, LiquidateFeeWithKyberDMM__factory, LiquidateFeeWithKyberDMM} from '../../typechain';

let Token: MockToken__factory;
let LiquidateWithKyberDmm: LiquidateFeeWithKyberDMM__factory;

const dmmRouter = LiquidationHelper.dmmRouterAddress;
const kncAddress = LiquidationHelper.kncAddress;
const wbtcAddress = LiquidationHelper.wbtcAddress;
const usdtAddress = LiquidationHelper.usdtAddress;
const wethAddress = LiquidationHelper.wethAddress;

const poolAddresses = [
  LiquidationHelper.ethKncPoolAddress,
  LiquidationHelper.ethWbtcPoolAddress,
  LiquidationHelper.ethUsdtPoolAddress,
];

const srcTokens = [wethAddress, wbtcAddress, usdtAddress];

const tokenPath = [
  [wethAddress, kncAddress],
  [wbtcAddress, wethAddress, kncAddress],
  [usdtAddress, wethAddress, kncAddress],
];

const poolPath = [
  [LiquidationHelper.ethKncPoolAddress],
  [LiquidationHelper.ethWbtcPoolAddress, LiquidationHelper.ethKncPoolAddress],
  [LiquidationHelper.ethUsdtPoolAddress, LiquidationHelper.ethKncPoolAddress],
];

const tradeTokens = [wethAddress, usdtAddress, wbtcAddress];

let liquidateWithDmm: LiquidateFeeWithKyberDMM;

describe('LiquidateWithKyberDMM-Forking', () => {
  const [admin, user] = waffle.provider.getWallets();

  before('reset state', async () => {
    await Helper.resetForking();
    Token = (await ethers.getContractFactory('MockToken')) as MockToken__factory;
    await LiquidationHelper.setupLpTokens(user);
    LiquidateWithKyberDmm = (await ethers.getContractFactory(
      'LiquidateFeeWithKyberDMM'
    )) as LiquidateFeeWithKyberDMM__factory;
    liquidateWithDmm = await LiquidateWithKyberDmm.deploy(admin.address, user.address, dmmRouter);
    await liquidateWithDmm.connect(admin).addOperator(user.address);
    for (let i = 0; i < srcTokens.length; i++) {
      await liquidateWithDmm.connect(user).setTradePath(srcTokens[i], kncAddress, tokenPath[i], poolPath[i]);
    }
  });

  it('revert not operator', async () => {
    await expect(
      liquidateWithDmm.connect(admin).liquidate(user.address, [poolAddresses[0]], [1], kncAddress, tradeTokens, 0)
    ).to.be.revertedWith('only operator');
  });

  it('revert invalid length', async () => {
    await expect(
      liquidateWithDmm.connect(user).liquidate(user.address, poolAddresses, [1], kncAddress, tradeTokens, 0)
    ).to.be.revertedWith('invalid lengths');
  });

  it('revert not approve yet', async () => {
    await expect(
      liquidateWithDmm.connect(user).liquidate(user.address, [poolAddresses[0]], [1], kncAddress, tradeTokens, 0)
    ).to.be.revertedWith('ERC20: transfer amount exceeds allowance');
  });

  it('revert min amount too high', async () => {
    let amounts = [];
    for (let i = 0; i < poolAddresses.length; i++) {
      let token = await Token.attach(poolAddresses[i]);
      amounts.push(await token.balanceOf(user.address));
      await token.connect(user).approve(liquidateWithDmm.address, amounts[i]);
    }
    await expect(
      liquidateWithDmm
        .connect(user)
        .liquidate(user.address, poolAddresses, amounts, kncAddress, tradeTokens, BN.from(2).pow(255))
    ).to.be.revertedWith('totalReturn < minReturn');
  });

  it('revert path not set', async () => {
    let pools = [LiquidationHelper.usdcUsdtPoolAddress];
    let amounts = [];
    for (let i = 0; i < pools.length; i++) {
      let token = await Token.attach(pools[i]);
      amounts.push(await token.balanceOf(user.address));
      await token.connect(user).approve(liquidateWithDmm.address, amounts[i]);
    }
    await expect(
      liquidateWithDmm
        .connect(user)
        .liquidate(user.address, pools, amounts, kncAddress, [LiquidationHelper.usdcAddress], 0)
    ).to.be.revertedWith('DMMRouter: INVALID_PATH');
  });

  it('liquidate LP tokens', async () => {
    let amounts = [];
    for (let i = 0; i < poolAddresses.length; i++) {
      let token = await Token.attach(poolAddresses[i]);
      amounts.push(await token.balanceOf(user.address));
      await token.connect(user).approve(liquidateWithDmm.address, amounts[i]);
    }

    let kncToken = await Token.attach(kncAddress);
    let kncBalanceBefore = await kncToken.balanceOf(user.address);
    console.log(`KNC balance before: ${kncBalanceBefore.toString()}`);
    let estimateReturnAmount = await liquidateWithDmm.estimateReturns(poolAddresses, amounts, kncAddress);
    console.log(`Estimated amount KNC: ${estimateReturnAmount.toString()}`);

    let tx = await liquidateWithDmm
      .connect(user)
      .liquidate(user.address, poolAddresses, amounts, kncAddress, tradeTokens, 0);

    let kncBalanceAfter = await kncToken.balanceOf(user.address);
    console.log(`KNC balance after: ${kncBalanceAfter.toString()}`);
    console.log(`KNC delta: ${kncBalanceAfter.sub(kncBalanceBefore).toString()}`);
  });
});

import {ethers, waffle} from 'hardhat';
import {BigNumber as BN} from '@ethersproject/bignumber';

import {expect} from 'chai';
import Helper from '../helper';
import {ethAddress} from '../helper';
const LiquidationHelper = require('./liquidationHelper');

import {
  TreasuryPool__factory,
  TreasuryPool,
  LiquidationStrategyBase__factory,
  LiquidationStrategyBase,
  MockToken__factory,
  MockDmmChainLinkPriceOracle,
  LiquidateFeeWithKyber,
  LiquidateFeeWithKyber__factory,
} from '../../typechain';
import { access } from 'fs';

let Token: MockToken__factory;
let Pool: TreasuryPool__factory;
let LiquidationBase: LiquidationStrategyBase__factory;
let LiquidateWithKyber: LiquidateFeeWithKyber__factory;

enum LiquidationType {
  LP,
  TOKEN,
}

const kyberProxyAddress = '0x9AAb3f75489902f3a48495025729a0AF77d4b11e';
const wethAddress = LiquidationHelper.wethAddress;
const kncAddress = LiquidationHelper.kncAddress;
const wbtcAddress = LiquidationHelper.wbtcAddress;
const usdtAddress = LiquidationHelper.usdtAddress;
const usdcAddress = LiquidationHelper.usdcAddress;

const poolAddresses = [
  LiquidationHelper.ethKncPoolAddress,
  LiquidationHelper.ethWbtcPoolAddress,
  LiquidationHelper.ethUsdtPoolAddress,
];

let priceOracle: MockDmmChainLinkPriceOracle;
let treasuryPool: TreasuryPool;
let rewardPool: TreasuryPool;
let liquidationBase: LiquidationStrategyBase;
let liquidateWithKyber: LiquidateFeeWithKyber;

describe('LiquidateFeeWithKyber-Forking', () => {
  const [admin, user] = waffle.provider.getWallets();

  before('reset state', async () => {
    LiquidationBase = (await ethers.getContractFactory('LiquidationStrategyBase')) as LiquidationStrategyBase__factory;
    Token = (await ethers.getContractFactory('MockToken')) as MockToken__factory;
    Pool = (await ethers.getContractFactory('TreasuryPool')) as TreasuryPool__factory;
    LiquidateWithKyber = (await ethers.getContractFactory('LiquidateFeeWithKyber')) as LiquidateFeeWithKyber__factory;

    await Helper.resetForking();
    await LiquidationHelper.setupLpTokens(user);
    priceOracle = await LiquidationHelper.setupPriceOracleContract(admin);
    treasuryPool = await Pool.deploy(admin.address, []);
    rewardPool = await Pool.deploy(admin.address, []);
    liquidationBase = await LiquidationBase.deploy(
      admin.address, treasuryPool.address, rewardPool.address,
      0, 1, 1, [], [priceOracle.address]
    );
    liquidateWithKyber = await LiquidateWithKyber.deploy(
      admin.address,
      wethAddress,
      liquidationBase.address,
      kyberProxyAddress
    );
    await treasuryPool.authorizeStrategies([liquidationBase.address], {from: admin.address});
    await liquidationBase.updateWhitelistedLiquidators([liquidateWithKyber.address], true, {from: admin.address});
  });

  const getTokenBalance = async (token: string, account: string) => {
    if (token == ethAddress) {
      return await Helper.getBalancePromise(account);
    }
    let tokenContract = await Token.attach(token);
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
    let tx = await liquidateWithKyber.connect(user).liquidate(priceOracle.address, addresses, amounts, types, dest, tradeTokens, true);
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
    // test withdraw dest token by admin
    if (dest == ethAddress) {
      await liquidateWithKyber.connect(admin).withdrawEther(100, admin.address);
    } else {
      await liquidateWithKyber.connect(admin).withdrawToken(dest, 100, admin.address);
    }
    return tx;
  };

  it('liquidate normal tokens', async () => {
    await Helper.sendEtherWithPromise(user.address, treasuryPool.address, BN.from(10).pow(19));

    let ethAmount = BN.from(10).pow(19); // 10 eth
    let tx;

    tx = await liquidateAndVerify([ethAddress], [ethAmount], [LiquidationType.TOKEN], [ethAddress], kncAddress);

    console.log(`    Liquidate with Kyber eth -> knc gas used: ${tx.gasLimit.toString()}`);

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

    await Helper.sendEtherWithPromise(user.address, treasuryPool.address, BN.from(10).pow(19));
    tokenAddresses.push(ethAddress);
    amounts.push(ethAmount);
    types.push(LiquidationType.TOKEN);

    tx = await liquidateAndVerify(tokenAddresses, amounts, types, tokenAddresses, kncAddress);
    console.log(`    Liquidate with Kyber ${tokenAddresses.length} tokens -> knc gas used: ${(await tx.wait()).gasUsed.toString()}`);
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
    let tradeTokens = [ethAddress, wethAddress, kncAddress, wbtcAddress, usdtAddress, usdcAddress];

    let tx = await liquidateAndVerify(poolAddresses, amounts, types, tradeTokens, kncAddress);
    console.log(`    Liquidate with Kyber ${poolAddresses.length} LP tokens gas used: ${(await tx.wait()).gasUsed.toString()}`);
  });

  let destTokens = [kncAddress, ethAddress, usdtAddress];
  let destTokenNames = ["knc", "eth", "usdt"];
  for (let d = 0; d < destTokens.length; d++) {
    it(`liquidate combines tokens to ${destTokenNames[d]}`, async () => {
      await priceOracle.connect(admin).updateWhitelistedTokens(destTokens, false);
      await priceOracle.connect(admin).updateWhitelistedTokens([destTokens[d]], true);
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
        let amount = BN.from(10).pow(await token.decimals() - 2);
        await token.connect(user).transfer(treasuryPool.address, amount);
        addresses.push(tokenAddresses[i]);
        amounts.push(amount);
        types.push(LiquidationType.TOKEN);
      }

      await Helper.sendEtherWithPromise(user.address, treasuryPool.address, BN.from(10).pow(19));
      addresses.push(ethAddress);
      amounts.push(BN.from(10).pow(19)); // 10 eth
      types.push(LiquidationType.TOKEN);

      let tradeTokens = [ethAddress, wethAddress, kncAddress, wbtcAddress, usdtAddress, usdcAddress];

      let tx = await liquidateAndVerify(addresses, amounts, types, tradeTokens, destTokens[d]);
      console.log(`    Liquidate with Kyber combination ${addresses.length} tokens gas used: ${(await tx.wait()).gasUsed.toString()}`);
    });
  }

  it('test first time liquidation all normal and LP tokens for KyberDAO', async () => {
    let addresses = [
      ethAddress,
      LiquidationHelper.ethKncPoolAddress,
      LiquidationHelper.ethWbtcPoolAddress,
      LiquidationHelper.ethUsdtPoolAddress,
      LiquidationHelper.wbtcUsdtPoolAddress,
      LiquidationHelper.usdcUsdtPoolAddress
    ];

    await Helper.sendEtherWithPromise(user.address, treasuryPool.address, BN.from(10).pow(19));

    let amounts = [];
    let types = [];
    for (let i = 0; i < addresses.length; i++) {
      if (addresses[i] == ethAddress) {
        // liquidate all balance
        amounts.push(BN.from(10).pow(19));
        types.push(LiquidationType.TOKEN);
        continue;
      }
      let token = await Token.attach(addresses[i]);
      let amount = await token.balanceOf(user.address);
      await token.connect(user).transfer(treasuryPool.address, amount);
      amounts.push(await token.balanceOf(treasuryPool.address)); // all treasury balance
      types.push(LiquidationType.LP);
    }
    let tradeTokens = [ethAddress, wethAddress, kncAddress, wbtcAddress, usdtAddress, usdcAddress];

    await priceOracle.connect(admin).updateWhitelistedTokens(tradeTokens, false);
    await priceOracle.connect(admin).updateWhitelistedTokens([kncAddress], true);

    let tx = await liquidateAndVerify(addresses, amounts, types, tradeTokens, kncAddress);
    console.log(`    Simulate liquidating all KyberDAO fees with Kyber, gas used: ${(await tx.wait()).gasUsed.toString()}`);
  });

  it('test reverts', async () => {
    // invaid lengths
    await expect(
      liquidateWithKyber.connect(user).liquidate(priceOracle.address, [], [0], [LiquidationType.LP], kncAddress, [], true)
    ).to.be.revertedWith('invalid lengths');
    await expect(
      liquidateWithKyber.connect(user).liquidate(priceOracle.address, [ethAddress], [0], [], kncAddress, [], true)
    ).to.be.revertedWith('invalid lengths');

    // not enough tokens in treasury
    let addresses = [ LiquidationHelper.ethKncPoolAddress ];
    let token = await Token.attach(addresses[0]);
    let amounts = [ (await token.balanceOf(treasuryPool.address)).add(BN.from(1)) ];
    let types = [ LiquidationType.LP ];
    let tradeTokens = [ethAddress, wethAddress, kncAddress, wbtcAddress, usdtAddress, usdcAddress];

    await expect(
      liquidateWithKyber.connect(user).liquidate(priceOracle.address, addresses, amounts, types, kncAddress, tradeTokens, true)
    ).to.be.revertedWith('not enough balance in treasury pool');
    // no checking for treasury balance before calling liquidate
    await expect(
      liquidateWithKyber.connect(user).liquidate(priceOracle.address, addresses, amounts, types, kncAddress, tradeTokens, false)
    ).to.be.revertedWith('ERC20: transfer amount exceeds balance');

    // invalid data for liquidation callback
    await expect(
      liquidateWithKyber.connect(user).liquidationCallback(user.address, addresses, amounts, liquidationBase.address, kncAddress, BN.from(0), '0x')
    ).to.be.revertedWith('sender != liquidationStrategy');
    // override liquidation strategy contract to user
    await liquidateWithKyber.connect(admin).updateContracts(user.address, kyberProxyAddress);
    await expect(
      liquidateWithKyber.connect(user).liquidationCallback(user.address, addresses, amounts, liquidationBase.address, kncAddress, BN.from(0), '0x')
    ).to.be.revertedWith('caller != this address');

    await liquidateWithKyber.connect(admin).updateContracts(liquidationBase.address, kyberProxyAddress);

    // set premium to 0, swap with big amount, expect to get lower total return
    // 50 eth -> knc should result in around 0.5 -> 1% spread
    let ethAmount = BN.from(5).mul(BN.from(10).pow(19));
    await Helper.sendEtherWithPromise(admin.address, treasuryPool.address, ethAmount);
    let defaultPremium = await priceOracle.getDefaultPremiumData();
    await priceOracle.connect(admin).updateDefaultPremiumData(0, 0);

    await expect(
      liquidateWithKyber.connect(user).liquidate(priceOracle.address, [ethAddress], [ethAmount], [LiquidationType.TOKEN], kncAddress, tradeTokens, false)
    ).to.be.revertedWith('totalReturn < minReturn');

    await priceOracle.connect(admin).updateDefaultPremiumData(defaultPremium.liquidateLpBps, defaultPremium.liquidateTokenBps);
  });
});

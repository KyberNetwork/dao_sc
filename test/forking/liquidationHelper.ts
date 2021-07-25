import {ethers, artifacts} from 'hardhat';
import {BigNumber as BN} from '@ethersproject/bignumber';
import {Wallet} from 'ethers';

import {ethAddress, zeroAddress} from '../helper';

import {MockToken, MockDmmChainLinkPriceOracle__factory, IDmmRouter} from '../../typechain';

const DmmRouter: IDmmRouter = artifacts.require('IDmmRouter');
const Token: MockToken = artifacts.require('MockToken');

const dmmRouterAddress = '0x1c87257f5e8609940bc751a07bb085bb7f8cdbe6';
const ethKncPoolAddress = '0x61639d6ec06c13a96b5eb9560b359d7c648c7759';
const ethWbtcPoolAddress = '0x1cf68bbc2b6d3c6cfe1bd3590cf0e10b06a05f17';
const ethUsdtPoolAddress = '0xce9874c42dce7fffbe5e48b026ff1182733266cb';
const wbtcUsdtPoolAddress = '0xd343d5dba2fba55eef58189619c05e33cab95ca1';

const btcEthProxy = '0xdeb288F737066589598e9214E782fa5A8eD689e8';
const btcUsdProxy = '0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c';
const ethUsdProxy = '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419';
const kncEthProxy = '0x656c0544eF4C98A6a98491833A89204Abb045d6b';
const kncUsdProxy = '0xf8fF43E991A81e6eC886a3D281A2C6cC19aE70Fc';
const usdtEthProxy = '0xEe9F2375b4bdF6387aa8265dD4FB8F16512A1d46';
const usdtUsdProxy = '0x3E7d1eAB13ad0104d2750B8863b489D65364e32D';
const daiEthProxy = '0x773616E4d11A78F511299002da57A0a94577F1f4';
const daiUsdProxy = '0xAed0c38402a5d19df6E4c03F4E2DceD6e29c1ee9';
const usdcEthProxy = '0x986b5E1e1755e3C2440e960477f25201B0a8bbD4';
const usdcUsdProxy = '0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6';

const wethAddress = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
const kncAddress = '0xdeFA4e8a7bcBA345F687a2f1456F5Edd9CE97202';
const wbtcAddress = '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599';
const usdtAddress = '0xdac17f958d2ee523a2206206994597c13d831ec7';
const usdcAddress = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const daiAddress = '0x6b175474e89094c44da98b954eedeac495271d0f';

module.exports = {
  ethKncPoolAddress,
  ethWbtcPoolAddress,
  ethUsdtPoolAddress,
  kncAddress,
  wbtcAddress,
  usdtAddress,
  usdcAddress,
  daiAddress,
  wethAddress,
};

const validDuration = 365 * 60 * 60; // 1 year, depends on fork block

module.exports.setupPriceOracleContract = async function (admin: Wallet) {
  let DmmChainLink = (await ethers.getContractFactory(
    'MockDmmChainLinkPriceOracle'
  )) as MockDmmChainLinkPriceOracle__factory;
  let priceOracle = await DmmChainLink.deploy(admin.address, wethAddress, [kncAddress], validDuration);
  await priceOracle.connect(admin).addOperator(admin.address);
  await priceOracle.connect(admin).updateDefaultPremiumData(500, 500);
  await priceOracle
    .connect(admin)
    .updateAggregatorProxyData(
      [ethAddress, wethAddress, kncAddress, wbtcAddress, usdtAddress, usdcAddress, daiAddress],
      [zeroAddress, zeroAddress, kncEthProxy, btcEthProxy, usdtEthProxy, usdcEthProxy, daiEthProxy],
      [ethUsdProxy, ethUsdProxy, kncUsdProxy, btcUsdProxy, usdtUsdProxy, usdcUsdProxy, daiUsdProxy]
    );
  return priceOracle;
};

// Swap eths to knc/wbtc/usdt, then add eth + token to the pool
module.exports.setupLpTokens = async function (user: Wallet) {
  let router = await DmmRouter.at(dmmRouterAddress);
  let ethAmount = BN.from(5).mul(BN.from(10).pow(18));
  let bigAmount = BN.from(2).pow(255);
  await router.swapExactETHForTokens(
    0,
    [ethKncPoolAddress],
    [wethAddress, kncAddress],
    user.address,
    bigAmount,
    {from: user.address, value: ethAmount.mul(BN.from(2))} // swap more eth to knc to pay for liquidation
  );
  await router.swapExactETHForTokens(0, [ethUsdtPoolAddress], [wethAddress, usdtAddress], user.address, bigAmount, {
    from: user.address,
    value: ethAmount,
  });
  await router.swapExactETHForTokens(0, [ethWbtcPoolAddress], [wethAddress, wbtcAddress], user.address, bigAmount, {
    from: user.address,
    value: ethAmount,
  });
  ethAmount = BN.from(2).mul(BN.from(10).pow(18));
  let kncToken = await Token.at(kncAddress);
  if ((await kncToken.allowance(user.address, dmmRouterAddress)) == 0) {
    await kncToken.approve(dmmRouterAddress, bigAmount, {from: user.address});
  }
  await router.addLiquidityETH(
    kncAddress,
    ethKncPoolAddress,
    await kncToken.balanceOf(user.address),
    0,
    0,
    [BN.from(0), bigAmount],
    user.address,
    bigAmount,
    {from: user.address, value: ethAmount}
  );
  let usdtToken = await Token.at(usdtAddress);
  if ((await usdtToken.allowance(user.address, dmmRouterAddress)) == 0) {
    await usdtToken.approve(dmmRouterAddress, bigAmount, {from: user.address});
  }
  await router.addLiquidityETH(
    usdtAddress,
    ethUsdtPoolAddress,
    await usdtToken.balanceOf(user.address),
    0,
    0,
    [BN.from(0), bigAmount],
    user.address,
    bigAmount,
    {from: user.address, value: ethAmount}
  );
  let wbtcToken = await Token.at(wbtcAddress);
  if ((await wbtcToken.allowance(user.address, dmmRouterAddress)) == 0) {
    await wbtcToken.approve(dmmRouterAddress, bigAmount, {from: user.address});
  }
  await router.addLiquidityETH(
    wbtcAddress,
    ethWbtcPoolAddress,
    await wbtcToken.balanceOf(user.address),
    0,
    0,
    [BN.from(0), bigAmount],
    user.address,
    bigAmount,
    {from: user.address, value: ethAmount}
  );
};

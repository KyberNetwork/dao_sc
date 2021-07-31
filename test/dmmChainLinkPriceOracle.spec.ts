import {ethers, waffle} from 'hardhat';
import {expect} from 'chai';
import {Wallet} from 'ethers';
import {BigNumber as BN} from '@ethersproject/bignumber';

import chai from 'chai';
const {solidity} = waffle;
chai.use(solidity);
const {zeroAddress, ethAddress} = require('./helper.js');
const Helper = require('./helper.js');

import {
  MockDmmChainLinkPriceOracle,
  MockDmmChainLinkPriceOracle__factory,
  MockDmmPool,
  MockDmmPool__factory,
  MockChainkLink,
  MockChainkLink__factory,
  KyberNetworkTokenV2__factory,
  KyberNetworkTokenV2,
} from '../typechain';
import {_Chain} from 'underscore';
import {Zero} from '@ethersproject/constants';
import {encode} from '@ethersproject/base64';
import {min} from 'bn.js';

const BPS = BN.from(10000);
const PRECISION = BN.from(10).pow(18);

let DmmChainLinkPriceOracle: MockDmmChainLinkPriceOracle__factory;
let dmmChainLinkPriceOracle: MockDmmChainLinkPriceOracle;
let ChainLink: MockChainkLink__factory;
let DmmPool: MockDmmPool__factory;
let Token: KyberNetworkTokenV2__factory;

enum LiquidationType {
  LP,
  TOKEN,
}

let whitelistedTokens;
let admin;
let operator;
let user;
let token0: KyberNetworkTokenV2;
let token1: KyberNetworkTokenV2;
let weth: KyberNetworkTokenV2;
let minValidDurationInSeconds = 30 * 60; // 30 mins
let lpThreshold = 200;

describe('KyberDmmChainLinkPriceOracle', () => {
  const [admin, operator, user] = waffle.provider.getWallets();

  before('setup', async () => {
    DmmChainLinkPriceOracle = (await ethers.getContractFactory(
      'MockDmmChainLinkPriceOracle'
    )) as MockDmmChainLinkPriceOracle__factory;
    ChainLink = (await ethers.getContractFactory('MockChainkLink')) as MockChainkLink__factory;
    DmmPool = (await ethers.getContractFactory('MockDmmPool')) as MockDmmPool__factory;
    Token = (await ethers.getContractFactory('KyberNetworkTokenV2')) as KyberNetworkTokenV2__factory;
    token0 = await Token.deploy();
    token1 = await Token.deploy();
    weth = await Token.deploy();
  });

  describe('#update data', async () => {
    beforeEach('init contract', async () => {
      dmmChainLinkPriceOracle = await DmmChainLinkPriceOracle.deploy(
        admin.address,
        weth.address,
        [],
        minValidDurationInSeconds,
        lpThreshold
      );
    });

    it('add/remove whitelist tokens', async () => {
      // revert only admin
      await expect(dmmChainLinkPriceOracle.connect(user).updateWhitelistedTokens([], true)).to.be.revertedWith(
        'only admin'
      );
      await expect(dmmChainLinkPriceOracle.connect(user).updateWhitelistedTokens([], true)).to.be.revertedWith(
        'only admin'
      );

      await expect(
        dmmChainLinkPriceOracle.connect(admin).updateWhitelistedTokens([token0.address, token1.address], true)
      )
        .to.emit(dmmChainLinkPriceOracle, 'WhitelistedTokenUpdated')
        .withArgs(token0.address, true)
        .to.emit(dmmChainLinkPriceOracle, 'WhitelistedTokenUpdated')
        .withArgs(token1.address, true);
      expect(await dmmChainLinkPriceOracle.getAllWhitelistedTokens()).to.eql([token0.address, token1.address]);
      expect(await dmmChainLinkPriceOracle.getWhitelistedTokensLength()).to.eql(BN.from(2));
      expect(await dmmChainLinkPriceOracle.getWhitelistedTokenAt(0)).to.eql(token0.address);
      expect(await dmmChainLinkPriceOracle.getWhitelistedTokenAt(1)).to.eql(token1.address);
      expect(await dmmChainLinkPriceOracle.isWhitelistedToken(token0.address)).to.be.eql(true);
      expect(await dmmChainLinkPriceOracle.isWhitelistedToken(token1.address)).to.be.eql(true);
      await expect(dmmChainLinkPriceOracle.connect(admin).updateWhitelistedTokens([token1.address], false))
        .to.emit(dmmChainLinkPriceOracle, 'WhitelistedTokenUpdated')
        .withArgs(token1.address, false);

      expect(await dmmChainLinkPriceOracle.getAllWhitelistedTokens()).to.eql([token0.address]);
      expect(await dmmChainLinkPriceOracle.getWhitelistedTokensLength()).to.eql(BN.from(1));
      expect(await dmmChainLinkPriceOracle.getWhitelistedTokenAt(0)).to.eql(token0.address);
      expect(await dmmChainLinkPriceOracle.isWhitelistedToken(token0.address)).to.be.eql(true);
      expect(await dmmChainLinkPriceOracle.isWhitelistedToken(token1.address)).to.be.eql(false);

      await expect(
        dmmChainLinkPriceOracle.connect(admin).updateWhitelistedTokens([token0.address, token1.address], false)
      )
        .to.emit(dmmChainLinkPriceOracle, 'WhitelistedTokenUpdated')
        .withArgs(token0.address, false)
        .to.emit(dmmChainLinkPriceOracle, 'WhitelistedTokenUpdated')
        .withArgs(token1.address, false);
    });

    it('update default premium data - reverts', async () => {
      // revert only admin
      await expect(dmmChainLinkPriceOracle.connect(user).updateDefaultPremiumData(2, 3)).to.be.revertedWith(
        'only admin'
      );

      // update default premium invalid data
      await expect(dmmChainLinkPriceOracle.connect(admin).updateDefaultPremiumData(2001, 3)).to.be.revertedWith(
        'invalid liquidate lp bps'
      );
      await expect(dmmChainLinkPriceOracle.connect(admin).updateDefaultPremiumData(3, 2001)).to.be.revertedWith(
        'invalid liquidate token bps'
      );
    });

    it('update default premium data', async () => {
      await expect(dmmChainLinkPriceOracle.connect(admin).updateDefaultPremiumData(200, 300))
        .to.emit(dmmChainLinkPriceOracle, 'DefaultPremiumDataSet')
        .withArgs(BN.from(200), BN.from(300));
      let data = await dmmChainLinkPriceOracle.getConfig();
      expect(data.liquidateLpBps).to.eql(BN.from(200));
      expect(data.liquidateTokenBps).to.eql(BN.from(300));
    });

    it('update group premium data - reverts', async () => {
      // revert only admin
      await expect(dmmChainLinkPriceOracle.connect(user).updateGroupPremiumData([], [], [])).to.be.revertedWith(
        'only admin'
      );
      // update group premium invalid data
      await expect(
        dmmChainLinkPriceOracle.connect(admin).updateGroupPremiumData([user.address], [], [])
      ).to.be.revertedWith('invalid length');
      await expect(
        dmmChainLinkPriceOracle.connect(admin).updateGroupPremiumData([user.address], [2], [3, 4])
      ).to.be.revertedWith('invalid length');
      await expect(
        dmmChainLinkPriceOracle.connect(admin).updateGroupPremiumData([user.address], [2001], [0])
      ).to.be.revertedWith('invalid liquidate lp bps');
      await expect(
        dmmChainLinkPriceOracle.connect(admin).updateGroupPremiumData([user.address], [2], [2001])
      ).to.be.revertedWith('invalid liquidate token bps');
    });

    it('update default premium data', async () => {
      await expect(dmmChainLinkPriceOracle.connect(admin).updateGroupPremiumData([user.address], [200], [300]))
        .to.emit(dmmChainLinkPriceOracle, 'UpdateGroupPremiumData')
        .withArgs(user.address, BN.from(200), BN.from(300));

      let data = await dmmChainLinkPriceOracle.getPremiumData(user.address);
      expect(data.liquidateLpBps).to.eql(BN.from(200));
      expect(data.liquidateTokenBps).to.eql(BN.from(300));

      await dmmChainLinkPriceOracle.connect(admin).updateDefaultPremiumData(100, 200);
      await expect(dmmChainLinkPriceOracle.connect(admin).updateGroupPremiumData([user.address], [20], [0]))
        .to.emit(dmmChainLinkPriceOracle, 'UpdateGroupPremiumData')
        .withArgs(user.address, BN.from(20), BN.from(0));

      data = await dmmChainLinkPriceOracle.getPremiumData(user.address);
      expect(data.liquidateLpBps).to.eql(BN.from(20));
      expect(data.liquidateTokenBps).to.eql(BN.from(0));

      // not set premium data for the address yet, it uses default premium
      data = await dmmChainLinkPriceOracle.getPremiumData(admin.address);
      expect(data.liquidateLpBps).to.eql(BN.from(100));
      expect(data.liquidateTokenBps).to.eql(BN.from(200));
    });

    it('update chainlink proxies', async () => {
      // revert only operator
      await expect(dmmChainLinkPriceOracle.connect(operator).updateAggregatorProxyData([], [], [])).to.be.revertedWith(
        'only operator'
      );

      // invalid data
      await dmmChainLinkPriceOracle.connect(admin).addOperator(operator.address);
      await expect(
        dmmChainLinkPriceOracle.connect(operator).updateAggregatorProxyData([token0.address], [], [])
      ).to.be.revertedWith('invalid length');
      await expect(
        dmmChainLinkPriceOracle.connect(operator).updateAggregatorProxyData([token0.address], [token0.address], [])
      ).to.be.revertedWith('invalid length');
      await expect(
        dmmChainLinkPriceOracle
          .connect(operator)
          .updateAggregatorProxyData([token0.address], [token0.address], [token0.address, token1.address])
      ).to.be.revertedWith('invalid length');

      let chainlink0 = await ChainLink.deploy(8);
      let chainlink1 = await ChainLink.deploy(18);

      await expect(
        dmmChainLinkPriceOracle
          .connect(operator)
          .updateAggregatorProxyData(
            [token0.address, token1.address],
            [chainlink0.address, zeroAddress],
            [zeroAddress, chainlink1.address]
          )
      )
        .to.emit(dmmChainLinkPriceOracle, 'UpdateAggregatorProxyData')
        .withArgs(token0.address, chainlink0.address, zeroAddress)
        .to.emit(dmmChainLinkPriceOracle, 'UpdateAggregatorProxyData')
        .withArgs(token1.address, zeroAddress, chainlink1.address);

      // verify token0 data
      let tokenData = await dmmChainLinkPriceOracle.getTokenAggregatorProxyData(token0.address);
      expect(tokenData.quoteEthProxy).to.be.eql(chainlink0.address);
      expect(tokenData.quoteUsdProxy).to.be.eql(zeroAddress);
      expect(tokenData.quoteEthDecimals).to.be.eql(await chainlink0.decimals());
      expect(tokenData.quoteUsdDecimals).to.be.eql(0);

      // verify token1 data
      tokenData = await dmmChainLinkPriceOracle.getTokenAggregatorProxyData(token1.address);
      expect(tokenData.quoteEthProxy).to.be.eql(zeroAddress);
      expect(tokenData.quoteUsdProxy).to.be.eql(chainlink1.address);
      expect(tokenData.quoteEthDecimals).to.be.eql(0);
      expect(tokenData.quoteUsdDecimals).to.be.eql(await chainlink1.decimals());
    });

    it('update min chainlink valid duration', async () => {
      let config = await dmmChainLinkPriceOracle.getConfig()
      expect(config.minValidDurationInSeconds).to.be.equal(
        BN.from(minValidDurationInSeconds)
      );
      // revert min duration is low
      await expect(dmmChainLinkPriceOracle.updateMinValidDuration(minValidDurationInSeconds)).to.be.revertedWith(
        'only operator'
      );

      await dmmChainLinkPriceOracle.connect(admin).addOperator(admin.address);
      await expect(
        dmmChainLinkPriceOracle.connect(admin).updateMinValidDuration(minValidDurationInSeconds - 1)
      ).to.be.revertedWith('duration is too low');

      let duration = BN.from(100000);
      await expect(dmmChainLinkPriceOracle.connect(admin).updateMinValidDuration(duration))
        .to.emit(dmmChainLinkPriceOracle, 'UpdatedMinValidDurationInSeconds')
        .withArgs(BN.from(duration));

      config = await dmmChainLinkPriceOracle.getConfig()
      expect(config.minValidDurationInSeconds).to.be.equal(BN.from(duration));
    });
  });

  describe('#get data from LP tokens', async () => {
    beforeEach('init contract', async () => {
      dmmChainLinkPriceOracle = await DmmChainLinkPriceOracle.deploy(
        admin.address,
        weth.address,
        [],
        minValidDurationInSeconds,
        lpThreshold
      );
    });

    it('get expected tokens', async () => {
      let pool = await DmmPool.deploy();
      // set tokens, balances and total supply
      let balance0 = BN.from(2312312312);
      let balance1 = BN.from(12387334);
      let totalSupply = BN.from(123456);
      await pool.setData(token0.address, token1.address, balance0, balance1, totalSupply);

      for (let i = 0; i < 50; i++) {
        let amount = BN.from(Helper.getRandomInt(1, 123456));
        let amount0 = amount.mul(balance0).div(totalSupply);
        let amount1 = amount.mul(balance1).div(totalSupply);
        let data = await dmmChainLinkPriceOracle.getExpectedTokensFromLp(pool.address, amount);
        expect(data.tokens).to.be.eql([token0.address, token1.address]);
        expect(data.amounts[0]).to.be.eql(amount0);
        expect(data.amounts[1]).to.be.eql(amount1);
      }
    });
  });

  const setChainlinkRates = async (chainlinks: MockChainkLink[], rates: BN[]) => {
    for (let i = 0; i < chainlinks.length; i++) {
      await chainlinks[i].setAnswerData(rates[i], await Helper.getCurrentBlockTime());
    }
  };

  const encodeLiquidationType = async (types: LiquidationType[]) => {
    return await dmmChainLinkPriceOracle.getEncodedData(types);
  };

  describe('#get data from chainlink proxies', async () => {
    let chainlink0EthProxy: MockChainkLink;
    let chainlink0UsdProxy: MockChainkLink;
    let chainlink1EthProxy: MockChainkLink;
    let chainlink1UsdProxy: MockChainkLink;

    let proxyEth0Decimal = 10;
    let proxyUsd0Decimal = 10;
    let proxyEth1Decimal = 18;
    let proxyUsd1Decimal = 19;

    beforeEach('init contract', async () => {
      dmmChainLinkPriceOracle = await DmmChainLinkPriceOracle.deploy(
        admin.address,
        weth.address,
        [],
        minValidDurationInSeconds,
        lpThreshold
      );
      await dmmChainLinkPriceOracle.connect(admin).addOperator(operator.address);
      chainlink0EthProxy = await ChainLink.deploy(proxyEth0Decimal);
      chainlink0UsdProxy = await ChainLink.deploy(proxyUsd0Decimal);
      chainlink1EthProxy = await ChainLink.deploy(proxyEth1Decimal);
      chainlink1UsdProxy = await ChainLink.deploy(proxyUsd1Decimal);
    });

    it('check rate over eth/usd', async () => {
      await dmmChainLinkPriceOracle
        .connect(operator)
        .updateAggregatorProxyData(
          [token0.address, token1.address],
          [chainlink0EthProxy.address, zeroAddress],
          [zeroAddress, chainlink1UsdProxy.address]
        );
      // price of eth or weth over eth should be equal PRECISION
      expect(await dmmChainLinkPriceOracle.getRateOverEth(ethAddress)).to.be.eql(PRECISION);
      expect(await dmmChainLinkPriceOracle.getRateOverEth(weth.address)).to.be.eql(PRECISION);

      let rate = BN.from(123124);
      await setChainlinkRates([chainlink0EthProxy], [rate]);
      // need to multiply with 10**(18 - 10)
      expect(await dmmChainLinkPriceOracle.getRateOverEth(token0.address)).to.be.eql(
        convertToDecimals18(rate, proxyEth0Decimal)
      );
      expect(await dmmChainLinkPriceOracle.getRateOverUsd(token0.address)).to.be.eql(BN.from(0));

      rate = BN.from(352341);
      await setChainlinkRates([chainlink1UsdProxy], [rate]);
      expect(await dmmChainLinkPriceOracle.getRateOverEth(token1.address)).to.be.eql(BN.from(0));
      expect(await dmmChainLinkPriceOracle.getRateOverUsd(token1.address)).to.be.eql(
        convertToDecimals18(rate, proxyUsd1Decimal)
      );

      await dmmChainLinkPriceOracle
        .connect(operator)
        .updateAggregatorProxyData(
          [token0.address, token1.address],
          [chainlink0EthProxy.address, chainlink1EthProxy.address],
          [zeroAddress, chainlink1UsdProxy.address]
        );

      rate = BN.from(542524);
      await setChainlinkRates([chainlink1EthProxy, chainlink1UsdProxy], [rate, BN.from(0)]);

      expect(await dmmChainLinkPriceOracle.getRateOverEth(token1.address)).to.be.eql(
        convertToDecimals18(rate, proxyEth1Decimal)
      );
      expect(await dmmChainLinkPriceOracle.getRateOverUsd(token1.address)).to.be.eql(BN.from(0));

      let duration = BN.from((await dmmChainLinkPriceOracle.getConfig()).minValidDurationInSeconds);
      let currentTime = BN.from(await Helper.getCurrentBlockTime());
      // rate is 0 when the valid duration is over
      await chainlink1EthProxy.setAnswerData(rate, currentTime.sub(duration).sub(BN.from(1)));
      expect(await dmmChainLinkPriceOracle.getRateOverEth(token1.address)).to.be.eql(BN.from(0));

      // rate is 0 when the valid duration is over
      await chainlink1UsdProxy.setAnswerData(rate, currentTime.sub(duration).sub(BN.from(1)));
      expect(await dmmChainLinkPriceOracle.getRateOverUsd(token1.address)).to.be.eql(BN.from(0));
    });

    it('test _getRateWithDestTokenData - src is eth or weth', async () => {
      // with eth
      await dmmChainLinkPriceOracle
        .connect(operator)
        .updateAggregatorProxyData(
          [token0.address, token1.address],
          [chainlink0EthProxy.address, chainlink1EthProxy.address],
          [chainlink0UsdProxy.address, chainlink1UsdProxy.address]
        );

      let rate = BN.from(142352);
      // dest is eth or weth
      expect(await dmmChainLinkPriceOracle.getRateWithDestTokenData(ethAddress, 0, 0)).to.be.eql(BN.from(0));
      expect(await dmmChainLinkPriceOracle.getRateWithDestTokenData(ethAddress, rate, 0)).to.be.eql(
        PRECISION.mul(PRECISION).div(rate)
      );

      expect(await dmmChainLinkPriceOracle.getRateWithDestTokenData(weth.address, 0, 0)).to.be.eql(BN.from(0));
      expect(await dmmChainLinkPriceOracle.getRateWithDestTokenData(weth.address, rate, 0)).to.be.eql(
        PRECISION.mul(PRECISION).div(rate)
      );
    });

    it('test _getRateWithDestTokenData - rate quote eth is 0', async () => {
      // with eth
      await dmmChainLinkPriceOracle
        .connect(operator)
        .updateAggregatorProxyData(
          [token0.address, token1.address],
          [chainlink0EthProxy.address, chainlink1EthProxy.address],
          [chainlink0UsdProxy.address, chainlink1UsdProxy.address]
        );

      for (let i = 0; i < 20; i++) {
        let usd0Rate = BN.from(Helper.getRandomInt(1, 1000000));
        let usd1Rate = BN.from(Helper.getRandomInt(1, 1000000));

        await setChainlinkRates([chainlink0EthProxy, chainlink0UsdProxy], [BN.from(0), usd0Rate]);

        // convert to decimals 18
        usd0Rate = convertToDecimals18(usd0Rate, proxyUsd0Decimal);
        let expectedRate = usd0Rate.mul(PRECISION).div(usd1Rate);

        // dest token rate over eth is 0
        expect(await dmmChainLinkPriceOracle.getRateWithDestTokenData(token0.address, 0, usd1Rate)).to.be.eql(
          expectedRate
        );
        // src token rate over eth is 0
        expect(await dmmChainLinkPriceOracle.getRateWithDestTokenData(token0.address, 1000, usd1Rate)).to.be.eql(
          expectedRate
        );
        // set rate for eth, but updated time is 0, so it should return rate over eth as 0
        await chainlink0EthProxy.setAnswerData(100000, 0);
        expect(await dmmChainLinkPriceOracle.getRateWithDestTokenData(token0.address, 1000, usd1Rate)).to.be.eql(
          expectedRate
        );
      }
    });

    it('check _getRateWithDestTokenData - rate quote usd is 0', async () => {
      // with eth
      await dmmChainLinkPriceOracle
        .connect(operator)
        .updateAggregatorProxyData(
          [token0.address, token1.address],
          [chainlink0EthProxy.address, chainlink1EthProxy.address],
          [chainlink0UsdProxy.address, chainlink1UsdProxy.address]
        );

      for (let i = 0; i < 20; i++) {
        let eth0Rate = BN.from(Helper.getRandomInt(1, 1000000));
        let eth1Rate = BN.from(Helper.getRandomInt(1, 1000000));

        await setChainlinkRates([chainlink0EthProxy, chainlink0UsdProxy], [eth0Rate, BN.from(0)]);

        // convert to decimals of 18
        eth0Rate = convertToDecimals18(eth0Rate, proxyEth0Decimal);
        let expectedRate = eth0Rate.mul(PRECISION).div(eth1Rate);

        // dest rate over usd is 0
        expect(await dmmChainLinkPriceOracle.getRateWithDestTokenData(token0.address, eth1Rate, 0)).to.be.eql(
          expectedRate
        );
        // src rate over usd is 0
        expect(await dmmChainLinkPriceOracle.getRateWithDestTokenData(token0.address, eth1Rate, 1000)).to.be.eql(
          expectedRate
        );
        // set rate for usd, but the updated time is 0, so it should return rate over usd as 0
        await chainlink0UsdProxy.setAnswerData(100000, 0);
        expect(await dmmChainLinkPriceOracle.getRateWithDestTokenData(token0.address, eth1Rate, 1000)).to.be.eql(
          expectedRate
        );
      }
    });

    it('check _getRateWithDestTokenData - average of rates over eth + usd', async () => {
      await dmmChainLinkPriceOracle
        .connect(operator)
        .updateAggregatorProxyData(
          [token0.address, token1.address],
          [chainlink0EthProxy.address, chainlink1EthProxy.address],
          [chainlink0UsdProxy.address, chainlink1UsdProxy.address]
        );

      for (let i = 0; i < 20; i++) {
        let eth0Rate = BN.from(Helper.getRandomInt(1, 1000000));
        let eth1Rate = BN.from(Helper.getRandomInt(1, 1000000));
        let usd0Rate = BN.from(Helper.getRandomInt(1, 1000000));
        let usd1Rate = BN.from(Helper.getRandomInt(1, 1000000));

        await setChainlinkRates([chainlink0EthProxy, chainlink0UsdProxy], [eth0Rate, usd0Rate]);

        // convert to decimals of 18
        eth0Rate = convertToDecimals18(eth0Rate, proxyEth0Decimal);
        usd0Rate = convertToDecimals18(usd0Rate, proxyUsd0Decimal);
        let expectedEthRate = eth0Rate.mul(PRECISION).div(eth1Rate);
        let expectedUsdRate = usd0Rate.mul(PRECISION).div(usd1Rate);
        let expectedRate = expectedEthRate.add(expectedUsdRate).div(BN.from(2));

        let rateFromContract = await dmmChainLinkPriceOracle.getRateWithDestTokenData(
          token0.address,
          eth1Rate,
          usd1Rate
        );
        expect(rateFromContract).to.be.eql(expectedRate);
      }
    });

    it('check _getExpectedReturnFromToken - src is normal token', async () => {
      await dmmChainLinkPriceOracle
        .connect(operator)
        .updateAggregatorProxyData(
          [token0.address, token1.address],
          [chainlink0EthProxy.address, chainlink1EthProxy.address],
          [chainlink0UsdProxy.address, chainlink1UsdProxy.address]
        );

      // revert rate is 0
      await setChainlinkRates([chainlink0EthProxy, chainlink0UsdProxy], [BN.from(0), BN.from(0)]);
      await expect(
        dmmChainLinkPriceOracle.getExpectedReturnFromToken(token0.address, 0, ethAddress, 0, 0, false)
      ).to.be.revertedWith('0 aggregator rate');
      await expect(
        dmmChainLinkPriceOracle.getExpectedReturnFromToken(token0.address, 0, weth.address, 0, 0, false)
      ).to.be.revertedWith('0 aggregator rate');
      await expect(
        dmmChainLinkPriceOracle.getExpectedReturnFromToken(token0.address, 0, token1.address, 0, 0, false)
      ).to.be.revertedWith('0 aggregator rate');

      for (let i = 0; i < 20; i++) {
        let eth0Rate = BN.from(Helper.getRandomInt(1, 1000));
        let eth1Rate = BN.from(Helper.getRandomInt(1, 1000));
        let usd0Rate = BN.from(Helper.getRandomInt(1, 1000));
        let usd1Rate = BN.from(Helper.getRandomInt(1, 1000));
        let amount = BN.from(Helper.getRandomInt(1, 1000000000));

        await setChainlinkRates([chainlink0EthProxy, chainlink0UsdProxy], [eth0Rate, usd0Rate]);

        // convert to decimals of 18
        eth0Rate = convertToDecimals18(eth0Rate, proxyEth0Decimal);
        usd0Rate = convertToDecimals18(usd0Rate, proxyUsd0Decimal);

        let expectedReturn = calculateDestAmount(amount, await token0.decimals(), 18, eth0Rate);
        let returnFromContract = await dmmChainLinkPriceOracle.getExpectedReturnFromToken(
          token0.address,
          amount,
          ethAddress,
          0,
          0,
          false
        );
        expect(returnFromContract).to.be.eql(expectedReturn);
        returnFromContract = await dmmChainLinkPriceOracle.getExpectedReturnFromToken(
          token0.address,
          amount,
          weth.address,
          0,
          0,
          false
        );
        expect(returnFromContract).to.be.eql(expectedReturn);

        let expectedEthRate = eth0Rate.mul(PRECISION).div(eth1Rate);
        let expectedUsdRate = usd0Rate.mul(PRECISION).div(usd1Rate);
        let expectedRate = expectedEthRate.add(expectedUsdRate).div(BN.from(2));
        expectedReturn = calculateDestAmount(amount, await token0.decimals(), await token1.decimals(), expectedRate);
        returnFromContract = await dmmChainLinkPriceOracle.getExpectedReturnFromToken(
          token0.address,
          amount,
          token1.address,
          eth1Rate,
          usd1Rate,
          false
        );
        expect(returnFromContract).to.be.eql(expectedReturn);
      }
    });

    it('check _getExpectedReturnFromToken - src is LP token', async () => {
      await dmmChainLinkPriceOracle
        .connect(operator)
        .updateAggregatorProxyData(
          [token0.address, token1.address],
          [chainlink0EthProxy.address, chainlink1EthProxy.address],
          [chainlink0UsdProxy.address, chainlink1UsdProxy.address]
        );

      let dmmPool0 = await DmmPool.deploy();
      let balance0 = BN.from(2312312312);
      let balance1 = BN.from(12387334);
      let totalSupply = BN.from(123456);
      await dmmPool0.setData(token0.address, token1.address, balance0, balance1, totalSupply);

      // token0 -> dest rate is 0
      await setChainlinkRates([chainlink0EthProxy, chainlink0UsdProxy], [BN.from(0), BN.from(0)]);
      // dest is eth/weth
      await expect(
        dmmChainLinkPriceOracle.getExpectedReturnFromToken(dmmPool0.address, 0, ethAddress, 0, 0, true)
      ).to.be.revertedWith('0 aggregator rate');
      // dest is normal token
      await expect(
        dmmChainLinkPriceOracle.getExpectedReturnFromToken(dmmPool0.address, 0, token1.address, 10, 20, true)
      ).to.be.revertedWith('0 aggregator rate');

      // token1 -> dest rate is 0
      await setChainlinkRates(
        [chainlink0EthProxy, chainlink0UsdProxy, chainlink1EthProxy, chainlink1UsdProxy],
        [BN.from(10000), BN.from(10000), BN.from(0), BN.from(0)]
      );
      // dest is eth/weth
      await expect(
        dmmChainLinkPriceOracle.getExpectedReturnFromToken(dmmPool0.address, 0, ethAddress, 0, 0, true)
      ).to.be.revertedWith('0 aggregator rate');
      // dest is normal token
      await expect(
        dmmChainLinkPriceOracle.getExpectedReturnFromToken(dmmPool0.address, 0, token0.address, 10, 20, true)
      ).to.be.revertedWith('0 aggregator rate');

      for (let i = 0; i < 20; i++) {
        let eth0Rate = BN.from(Helper.getRandomInt(1, 100000));
        let eth1Rate = BN.from(Helper.getRandomInt(1, 100000));
        let usd0Rate = BN.from(Helper.getRandomInt(1, 100000));
        let usd1Rate = BN.from(Helper.getRandomInt(1, 100000));
        let amount = BN.from(Helper.getRandomInt(10, 1000));

        await setChainlinkRates(
          [chainlink0EthProxy, chainlink0UsdProxy, chainlink1EthProxy, chainlink1UsdProxy],
          [eth0Rate, usd0Rate, eth1Rate, usd1Rate]
        );

        // convert to decimals of 18
        eth0Rate = convertToDecimals18(eth0Rate, proxyEth0Decimal);
        usd0Rate = convertToDecimals18(usd0Rate, proxyUsd0Decimal);
        eth1Rate = convertToDecimals18(eth1Rate, proxyEth1Decimal);
        usd1Rate = convertToDecimals18(usd1Rate, proxyUsd1Decimal);

        let expectedReturn = BN.from(0);
        let returnFromContract = BN.from(0);

        // token0 == dest token
        returnFromContract = await dmmChainLinkPriceOracle.getExpectedReturnFromToken(
          dmmPool0.address,
          amount,
          token0.address,
          eth0Rate,
          usd0Rate,
          true
        );
        expectedReturn = amount.mul(balance0).div(totalSupply); // token0 -> dest
        let rate1 = eth1Rate.mul(PRECISION).div(eth0Rate).add(usd1Rate.mul(PRECISION).div(usd0Rate)).div(BN.from(2));
        let return1 = calculateDestAmount(
          amount.mul(balance1).div(totalSupply),
          await token1.decimals(),
          await token0.decimals(),
          rate1
        );
        expectedReturn = expectedReturn.add(return1);
        expect(returnFromContract).to.be.eql(expectedReturn);

        // token1 == dest token
        returnFromContract = await dmmChainLinkPriceOracle.getExpectedReturnFromToken(
          dmmPool0.address,
          amount,
          token1.address,
          eth1Rate,
          usd1Rate,
          true
        );
        let rate0 = eth0Rate.mul(PRECISION).div(eth1Rate).add(usd0Rate.mul(PRECISION).div(usd1Rate)).div(BN.from(2));
        expectedReturn = calculateDestAmount(
          amount.mul(balance0).div(totalSupply),
          await token0.decimals(),
          await token1.decimals(),
          rate0
        );
        expectedReturn = expectedReturn.add(
          amount.mul(balance1).div(totalSupply) // token1 -> dest
        );
        expect(returnFromContract).to.be.eql(expectedReturn);

        // both tokens are different from dest token
        // also use average rate over eth and usd
        let token2 = await Token.deploy();
        let chainlink2EthProxyProxy = await ChainLink.deploy(18);
        let chainlink2UsdProxyProxy = await ChainLink.deploy(18);
        let eth2Rate = BN.from(Helper.getRandomInt(100, 100000));
        let usd2Rate = BN.from(Helper.getRandomInt(100, 100000));

        await setChainlinkRates([chainlink2EthProxyProxy, chainlink2UsdProxyProxy], [eth2Rate, usd2Rate]);

        await dmmChainLinkPriceOracle
          .connect(operator)
          .updateAggregatorProxyData(
            [token2.address],
            [chainlink2EthProxyProxy.address],
            [chainlink2UsdProxyProxy.address]
          );
        returnFromContract = await dmmChainLinkPriceOracle.getExpectedReturnFromToken(
          dmmPool0.address,
          amount,
          token2.address,
          eth2Rate,
          usd2Rate,
          true
        );
        rate0 = eth0Rate.mul(PRECISION).div(eth2Rate).add(usd0Rate.mul(PRECISION).div(usd2Rate)).div(BN.from(2));
        expectedReturn = calculateDestAmount(
          amount.mul(balance0).div(totalSupply),
          await token0.decimals(),
          await token2.decimals(),
          rate0
        );
        rate1 = eth1Rate.mul(PRECISION).div(eth2Rate).add(usd1Rate.mul(PRECISION).div(usd2Rate)).div(BN.from(2));
        expectedReturn = expectedReturn.add(
          calculateDestAmount(
            amount.mul(balance1).div(totalSupply),
            await token1.decimals(),
            await token2.decimals(),
            rate1
          )
        );
        expect(returnFromContract).to.be.eql(expectedReturn);
      }
    });
  });

  describe('#get expected returns', async () => {
    let chainlink0EthProxy: MockChainkLink;
    let chainlink0UsdProxy: MockChainkLink;
    let chainlink1EthProxy: MockChainkLink;
    let chainlink1UsdProxy: MockChainkLink;
    let chainlink2EthProxy: MockChainkLink;
    let chainlink2UsdProxy: MockChainkLink;
    let dmmPool0: MockDmmPool;
    let rate0Eth: BN;
    let rate0Usd: BN;
    let rate1Eth: BN;
    let rate1Usd: BN;
    let rate2Eth: BN;
    let rate2Usd: BN;
    let token2: KyberNetworkTokenV2;

    const setupChainlinkRates = async () => {
      rate0Eth = BN.from(Helper.getRandomInt(1000000, 2000000));
      rate1Eth = BN.from(Helper.getRandomInt(1000000, 2000000));
      rate2Eth = BN.from(Helper.getRandomInt(1000000, 2000000));
      rate0Usd = BN.from(Helper.getRandomInt(1000000, 2000000));
      rate1Usd = BN.from(Helper.getRandomInt(1000000, 2000000));
      rate2Usd = BN.from(Helper.getRandomInt(1000000, 2000000));
      await setChainlinkRates(
        [chainlink0EthProxy, chainlink1EthProxy, chainlink2EthProxy],
        [rate0Eth, rate1Eth, rate2Eth]
      );
      await setChainlinkRates(
        [chainlink0UsdProxy, chainlink1UsdProxy, chainlink2UsdProxy],
        [rate0Usd, rate1Usd, rate2Usd]
      );
      await dmmChainLinkPriceOracle
        .connect(operator)
        .updateAggregatorProxyData(
          [token0.address, token1.address, token2.address],
          [chainlink0EthProxy.address, chainlink1EthProxy.address, chainlink2EthProxy.address],
          [chainlink0UsdProxy.address, chainlink1UsdProxy.address, chainlink2UsdProxy.address]
        );
    };

    const setupDataForDmmPool = async (
      dmmPool: MockDmmPool,
      token0: KyberNetworkTokenV2,
      token1: KyberNetworkTokenV2
    ) => {
      let balance0 = BN.from(Helper.getRandomInt(10000, 1000000));
      let balance1 = BN.from(Helper.getRandomInt(10000, 1000000));
      let totalSupply = Helper.getRandomInt(1000, 100000);
      await dmmPool.setData(token0.address, token1.address, balance0, balance1, totalSupply);
      let amount = BN.from(Helper.getRandomInt(0, totalSupply));
      let amount0 = amount.mul(balance0).div(BN.from(totalSupply));
      let amount1 = amount.mul(balance1).div(BN.from(totalSupply));
      return [amount, amount0, amount1];
    };

    beforeEach('init contract', async () => {
      dmmChainLinkPriceOracle = await DmmChainLinkPriceOracle.deploy(
        admin.address,
        weth.address,
        [],
        minValidDurationInSeconds,
        lpThreshold
      );
      await dmmChainLinkPriceOracle.connect(admin).addOperator(operator.address);
      chainlink0EthProxy = await ChainLink.deploy(10);
      chainlink0UsdProxy = await ChainLink.deploy(10);
      chainlink1EthProxy = await ChainLink.deploy(18);
      chainlink1UsdProxy = await ChainLink.deploy(19);
      chainlink2EthProxy = await ChainLink.deploy(10);
      chainlink2UsdProxy = await ChainLink.deploy(10);
      token2 = await Token.deploy();
      dmmPool0 = await DmmPool.deploy();
    });

    it('test reverts', async () => {
      // tokenIns.length != amountIns.length
      await expect(
        dmmChainLinkPriceOracle.getExpectedReturn(
          user.address,
          [dmmPool0.address],
          [BN.from(0), BN.from(0)],
          token0.address,
          await encodeLiquidationType([LiquidationType.LP])
        )
      ).to.be.revertedWith('invalid lengths');
      await expect(
        dmmChainLinkPriceOracle.getExpectedReturn(
          user.address,
          [token0.address, token1.address],
          [BN.from(0)],
          token0.address,
          await encodeLiquidationType([LiquidationType.LP])
        )
      ).to.be.revertedWith('invalid lengths');
      // tokenIns.length != hintTypes.length
      await expect(
        dmmChainLinkPriceOracle.getExpectedReturn(
          user.address,
          [token0.address, token1.address],
          [BN.from(0), BN.from(0)],
          token0.address,
          await encodeLiquidationType([LiquidationType.LP])
        )
      ).to.be.revertedWith('invalid lengths');
    });

    it('test liquidate LP - reverts', async () => {
      await expect(
        dmmChainLinkPriceOracle.getExpectedReturn(
          user.address,
          [dmmPool0.address],
          [BN.from(0)],
          token0.address,
          await encodeLiquidationType([LiquidationType.LP])
        )
      ).to.be.revertedWith('token out must be whitelisted');
      await dmmChainLinkPriceOracle.connect(admin).updateWhitelistedTokens([token0.address], true);
      await dmmChainLinkPriceOracle
        .connect(operator)
        .updateAggregatorProxyData(
          [token0.address, token1.address],
          [zeroAddress, zeroAddress],
          [zeroAddress, zeroAddress]
        );

      // revert rate is 0
      await dmmPool0.setData(token1.address, token0.address, 0, 0, 1);
      await expect(
        dmmChainLinkPriceOracle.getExpectedReturn(
          user.address,
          [dmmPool0.address],
          [BN.from(0)],
          token0.address,
          await encodeLiquidationType([LiquidationType.LP])
        )
      ).to.be.revertedWith('0 aggregator rate');
      await dmmPool0.setData(token0.address, token1.address, 0, 0, 1);
      await expect(
        dmmChainLinkPriceOracle.getExpectedReturn(
          user.address,
          [dmmPool0.address],
          [BN.from(0)],
          token0.address,
          await encodeLiquidationType([LiquidationType.LP])
        )
      ).to.be.revertedWith('0 aggregator rate');
    });

    it('test liquidate LPs', async () => {
      await dmmChainLinkPriceOracle.connect(admin).updateWhitelistedTokens([token0.address, token1.address], false);
      await dmmChainLinkPriceOracle.connect(admin).updateWhitelistedTokens([token2.address], true);
      for (let i = 0; i < 20; i++) {
        await setupChainlinkRates();
        let amount, amount0, amount1: BN;
        [amount, amount0, amount1] = await setupDataForDmmPool(dmmPool0, token0, token1);
        let premiumBps = Helper.getRandomInt(0, 2000);
        await dmmChainLinkPriceOracle.updateGroupPremiumData([user.address], [premiumBps], [0]);
        let rate0 = conversionRate(
          rate0Eth,
          rate0Usd,
          rate2Eth,
          rate2Usd,
          await chainlink0EthProxy.decimals(),
          await chainlink0UsdProxy.decimals(),
          await chainlink2EthProxy.decimals(),
          await chainlink2UsdProxy.decimals()
        );
        let returnAmount0 = calculateDestAmount(amount0, await token0.decimals(), await token2.decimals(), rate0);
        let rate1 = conversionRate(
          rate1Eth,
          rate1Usd,
          rate2Eth,
          rate2Usd,
          await chainlink1EthProxy.decimals(),
          await chainlink1UsdProxy.decimals(),
          await chainlink2EthProxy.decimals(),
          await chainlink2UsdProxy.decimals()
        );
        let returnAmount1 = calculateDestAmount(amount1, await token1.decimals(), await token2.decimals(), rate1);
        let returnAmount = returnAmount0.add(returnAmount1);
        returnAmount = applyPremiumBps(returnAmount, premiumBps);
        expect(
          await dmmChainLinkPriceOracle.getExpectedReturn(
            user.address,
            [dmmPool0.address],
            [amount],
            token2.address,
            await encodeLiquidationType([LiquidationType.LP])
          )
        ).to.be.eql(returnAmount);
      }
    });

    it('test liquidate tokens - reverts', async () => {
      await dmmChainLinkPriceOracle.connect(admin).updateWhitelistedTokens([token0.address], false);
      await expect(
        dmmChainLinkPriceOracle.getExpectedReturn(
          user.address,
          [token0.address],
          [BN.from(0)],
          token0.address,
          await encodeLiquidationType([LiquidationType.TOKEN])
        )
      ).to.be.revertedWith('token out must be whitelisted');

      await dmmChainLinkPriceOracle.connect(admin).updateWhitelistedTokens([token0.address, token1.address], true);
      await expect(
        dmmChainLinkPriceOracle.getExpectedReturn(
          user.address,
          [token0.address, token1.address],
          [BN.from(0), BN.from(0)],
          token0.address,
          await encodeLiquidationType([LiquidationType.TOKEN, LiquidationType.TOKEN])
        )
      ).to.be.revertedWith('token in can not be a whitelisted token');

      await dmmChainLinkPriceOracle
        .connect(operator)
        .updateAggregatorProxyData(
          [token0.address, token1.address],
          [zeroAddress, zeroAddress],
          [zeroAddress, zeroAddress]
        );

      // revert rate is 0
      await dmmChainLinkPriceOracle.connect(admin).updateWhitelistedTokens([token1.address], false);
      await expect(
        dmmChainLinkPriceOracle.getExpectedReturn(
          user.address,
          [token1.address],
          [BN.from(0)],
          token0.address,
          await encodeLiquidationType([LiquidationType.TOKEN])
        )
      ).to.be.revertedWith('0 aggregator rate');
    });

    it('test liquidate tokens', async () => {
      await dmmChainLinkPriceOracle.connect(admin).updateWhitelistedTokens([token0.address, token1.address], false);
      await dmmChainLinkPriceOracle.connect(admin).updateWhitelistedTokens([token2.address], true);
      for (let i = 0; i < 20; i++) {
        await setupChainlinkRates();
        let premiumBps = Helper.getRandomInt(0, 2000);
        await dmmChainLinkPriceOracle.updateGroupPremiumData([user.address], [0], [premiumBps]);
        let amount0 = BN.from(Helper.getRandomInt(10000, 100000));
        let amount1 = BN.from(Helper.getRandomInt(10000, 100000));
        let rate0 = conversionRate(
          rate0Eth,
          rate0Usd,
          rate2Eth,
          rate2Usd,
          await chainlink0EthProxy.decimals(),
          await chainlink0UsdProxy.decimals(),
          await chainlink2EthProxy.decimals(),
          await chainlink2UsdProxy.decimals()
        );
        let returnAmount0 = calculateDestAmount(amount0, await token0.decimals(), await token2.decimals(), rate0);
        let rate1 = conversionRate(
          rate1Eth,
          rate1Usd,
          rate2Eth,
          rate2Usd,
          await chainlink1EthProxy.decimals(),
          await chainlink1UsdProxy.decimals(),
          await chainlink2EthProxy.decimals(),
          await chainlink2UsdProxy.decimals()
        );
        let returnAmount1 = calculateDestAmount(amount1, await token1.decimals(), await token2.decimals(), rate1);
        let returnAmount = returnAmount0.add(returnAmount1);
        returnAmount = applyPremiumBps(returnAmount, premiumBps);
        expect(
          await dmmChainLinkPriceOracle.getExpectedReturn(
            user.address,
            [token0.address, token1.address],
            [amount0, amount1],
            token2.address,
            await encodeLiquidationType([LiquidationType.TOKEN, LiquidationType.TOKEN])
          )
        ).to.be.eql(returnAmount);

        // test liquidate same whitelisted token
        expect(
          await dmmChainLinkPriceOracle.getExpectedReturn(
            user.address,
            [token2.address],
            [amount0],
            token2.address,
            await encodeLiquidationType([LiquidationType.TOKEN])
          )
        ).to.be.eql(amount0);
      }
    });

    it(`test combine lps and tokens`, async () => {
      await dmmChainLinkPriceOracle.connect(admin).updateWhitelistedTokens([token0.address, token1.address], false);
      await dmmChainLinkPriceOracle.connect(admin).updateWhitelistedTokens([token2.address], true);

      for (let i = 0; i < 10; i++) {
        await setupChainlinkRates();
        let premiumLpBps = Helper.getRandomInt(0, 2000);
        let premiumTokenBps = Helper.getRandomInt(0, 2000);
        await dmmChainLinkPriceOracle.updateGroupPremiumData([user.address], [premiumLpBps], [premiumTokenBps]);
        let rate0 = conversionRate(
          rate0Eth,
          rate0Usd,
          rate2Eth,
          rate2Usd,
          await chainlink0EthProxy.decimals(),
          await chainlink0UsdProxy.decimals(),
          await chainlink2EthProxy.decimals(),
          await chainlink2UsdProxy.decimals()
        );
        let rate1 = conversionRate(
          rate1Eth,
          rate1Usd,
          rate2Eth,
          rate2Usd,
          await chainlink1EthProxy.decimals(),
          await chainlink1UsdProxy.decimals(),
          await chainlink2EthProxy.decimals(),
          await chainlink2UsdProxy.decimals()
        );

        let amount, amount0, amount1: BN;
        let tokenIns = [];
        let amountIns = [];
        let liquidationTypes = [];
        let totalReturn = BN.from(0);
        let totalReturnLp = BN.from(0);
        let totalReturnToken = BN.from(0);

        // calculate returns for LP tokens
        let tokens = [token0, token1, token2];
        for (let j = 0; j < 4; j++) {
          let dmmPool = await DmmPool.deploy();
          // ok if _token0 == _token1
          let _token0 = tokens[Helper.getRandomInt(0, 2)];
          let _token1 = tokens[Helper.getRandomInt(0, 2)];
          [amount, amount0, amount1] = await setupDataForDmmPool(dmmPool, _token0, _token1);
          let returnAmount0 = calculateDestAmount(
            amount0,
            await _token0.decimals(),
            await token2.decimals(),
            _token0 == token2 ? PRECISION : _token0 == token0 ? rate0 : rate1
          );
          let returnAmount1 = calculateDestAmount(
            amount1,
            await _token1.decimals(),
            await token2.decimals(),
            _token1 == token2 ? PRECISION : _token1 == token0 ? rate0 : rate1
          );
          totalReturnLp = totalReturnLp.add(returnAmount0.add(returnAmount1));
          tokenIns.push(dmmPool.address);
          amountIns.push(amount);
          liquidationTypes.push(LiquidationType.LP);
        }

        // calculate returns for tokens
        tokens = [token0, token1];
        for (let j = 0; j < 4; j++) {
          let _token = tokens[Helper.getRandomInt(0, 1)];
          amount = BN.from(Helper.getRandomInt(1, 1000000));
          if (_token == token2) {
            // no apply premium
            totalReturn = totalReturn.add(amount);
          } else {
            // apply token premium
            let rate = _token == token0 ? rate0 : rate1;
            let returnAmount = calculateDestAmount(amount, await _token.decimals(), await token2.decimals(), rate);
            totalReturnToken = totalReturnToken.add(returnAmount);
          }
          tokenIns.push(_token.address);
          amountIns.push(amount);
          liquidationTypes.push(LiquidationType.TOKEN);
        }
        totalReturnLp = applyPremiumBps(totalReturnLp, premiumLpBps);
        totalReturnToken = applyPremiumBps(totalReturnToken, premiumTokenBps);
        totalReturn = totalReturn.add(totalReturnLp).add(totalReturnToken);

        expect(
          await dmmChainLinkPriceOracle.getExpectedReturn(
            user.address,
            tokenIns,
            amountIns,
            token2.address,
            await encodeLiquidationType(liquidationTypes)
          )
        ).to.be.eql(totalReturn);
      }
    });
  });

  describe(`#calculate return amount`, async () => {
    beforeEach('init contract', async () => {
      dmmChainLinkPriceOracle = await DmmChainLinkPriceOracle.deploy(
        admin.address,
        weth.address,
        [],
        minValidDurationInSeconds,
        lpThreshold
      );
    });

    it('revert |dstDecimals - srcDecimals| > MAX_DECIMALS', async () => {
      await expect(dmmChainLinkPriceOracle.calculateReturnAmount(10000, 0, 19, 10000)).to.be.revertedWith(
        'dst - src > MAX_DECIMALS'
      );
      await expect(dmmChainLinkPriceOracle.calculateReturnAmount(10000, 19, 0, 10000)).to.be.revertedWith(
        'src - dst > MAX_DECIMALS'
      );
      for (let i = 0; i < 10; i++) {
        let decimal0 = Helper.getRandomInt(0, 18);
        let decimal1 = Helper.getRandomInt(0, 18);
        let amount = BN.from(Helper.getRandomInt(1, 1000000));
        amount = amount.mul(BN.from(10).pow(decimal0)).div(BN.from(Helper.getRandomInt(1, 1000000)));
        let rate = PRECISION.div(BN.from(Helper.getRandomInt(1, 1000)));
        expect(await dmmChainLinkPriceOracle.calculateReturnAmount(amount, decimal0, decimal1, rate)).to.be.equal(
          calculateDestAmount(amount, decimal0, decimal1, rate)
        );
      }
    });
  });
});

function applyPremiumBps(amount: BN, premiumBps: BN) {
  return amount.sub(amount.mul(premiumBps).div(BPS));
}

function conversionRate(
  rate0Eth: BN,
  rate0Usd: BN,
  rate1Eth: BN,
  rate1Usd: BN,
  decimal0Eth: number,
  decimal0Usd: number,
  decimal1Eth: number,
  decimal1Usd: number
) {
  rate0Eth = convertToPrecisionUnit(rate0Eth, decimal0Eth);
  rate1Eth = convertToPrecisionUnit(rate1Eth, decimal1Eth);
  rate0Usd = convertToPrecisionUnit(rate0Usd, decimal0Usd);
  rate1Usd = convertToPrecisionUnit(rate1Usd, decimal1Usd);
  let quoteEthRate = BN.from(0);
  let quoteUsdRate = BN.from(0);
  if (rate1Eth.gt(Zero)) {
    quoteEthRate = rate0Eth.mul(PRECISION).div(rate1Eth);
  }
  if (rate1Usd.gt(Zero)) {
    quoteUsdRate = rate0Usd.mul(PRECISION).div(rate1Usd);
  }
  if (quoteEthRate.eq(Zero)) return quoteUsdRate;
  if (quoteUsdRate.eq(Zero)) return quoteEthRate;
  return quoteEthRate.add(quoteUsdRate).div(BN.from(2));
}

function convertToPrecisionUnit(amount: BN, decimal: number) {
  if (decimal >= 18) {
    return amount.div(BN.from(10).pow(decimal - 18));
  }
  return amount.mul(BN.from(10).pow(18 - decimal));
}

function calculateDestAmount(amount: BN, decimal0: number, decimal1: number, rate: BN) {
  if (decimal1 >= decimal0) {
    // amount * rate * 10**(decimal1-decimal0) / PRECISION
    return amount
      .mul(rate)
      .mul(BN.from(10).pow(decimal1 - decimal0))
      .div(PRECISION);
  }
  // amount * rate / (PRECISION * 10**(decimal0-decimal1))
  return amount.mul(rate).div(PRECISION.mul(BN.from(10).pow(decimal0 - decimal1)));
}

function convertToDecimals18(amount: BN, decimals: number) {
  if (decimals <= 18) return amount.mul(BN.from(10).pow(18 - decimals));
  return amount.div(BN.from(10).pow(decimals - 18));
}

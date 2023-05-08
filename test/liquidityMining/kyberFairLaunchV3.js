const {expectEvent, expectRevert} = require('@openzeppelin/test-helpers');
const BN = web3.utils.BN;

const Token = artifacts.require('KyberNetworkTokenV2.sol');
const Token2 = artifacts.require('MockTokenWithDecimals.sol');
const KyberFairLaunch = artifacts.require('MockFairLaunchV3.sol');

const Helper = require('../helper.js');
const {precisionUnits, zeroAddress} = require('../helper.js');
const REWARD_PER_SHARE_PRECISION = new BN(10).pow(new BN(12));
const TOKEN_DECIMALS = 6;

let admin;
let kncToken;
let secondRewardToken;

let fairLaunch;

let user1;
let user2;
let user3;
let user4;

let tokens = [];

let userInfo = {};
let userClaimData = {};
let poolInfo = {};

let rewardTokens = [];
let multipliers = [];

let currentBlockTime;
let rw1 = '10000000000000000000';
let rw2 = '20000000000000000000';

let totalRewards = [rw1, rw2];

contract('KyberFairLaunchV2', function (accounts) {
  before('Global setup', async () => {
    admin = accounts[1];
    kncToken = await Token.new({from: admin});
    secondRewardToken = await Token2.new(TOKEN_DECIMALS, {from: admin});
    user1 = accounts[2];
    user2 = accounts[5];
    user3 = accounts[6];
    user4 = accounts[8];
    for (let i = 0; i < 10; i++) {
      let token = await Token.new();
      await token.transfer(user1, precisionUnits.mul(new BN(1000000)));
      await token.transfer(user2, precisionUnits.mul(new BN(1000000)));
      await token.transfer(user3, precisionUnits.mul(new BN(1000000)));
      await token.transfer(user4, precisionUnits.mul(new BN(1000000)));
      tokens.push(token);
    }
  });

  const deployContracts = async (rTokens) => {
    rewardTokens = rTokens;
    let addresses = [];
    multipliers = [];
    for (let i = 0; i < rewardTokens.length; i++) {
      if (rewardTokens[i] == zeroAddress) {
        addresses.push(zeroAddress);
        multipliers.push(new BN(1));
      } else {
        addresses.push(rewardTokens[i].address);
        let dRewardToken = await rewardTokens[i].decimals();
        let d = dRewardToken >= 18 ? new BN(1) : new BN(10).pow(new BN(18).sub(new BN(dRewardToken)));
        multipliers.push(d);
      }
    }
    fairLaunch = await KyberFairLaunch.new(admin, addresses);
    Helper.assertEqual(addresses, await fairLaunch.getRewardTokens());
    for (let i = 0; i < tokens.length; i++) {
      await tokens[i].approve(fairLaunch.address, new BN(2).pow(new BN(255)), {from: user1});
      await tokens[i].approve(fairLaunch.address, new BN(2).pow(new BN(255)), {from: user2});
      await tokens[i].approve(fairLaunch.address, new BN(2).pow(new BN(255)), {from: user3});
      await tokens[i].approve(fairLaunch.address, new BN(2).pow(new BN(255)), {from: user4});
    }
    userInfo[user1] = {};
    userInfo[user2] = {};
    userInfo[user3] = {};
    userInfo[user4] = {};
    userClaimData[user1] = [];
    userClaimData[user2] = [];
    userClaimData[user3] = [];
    userClaimData[user4] = [];
    for (let i = 0; i < rewardTokens.length; i++) {
      userClaimData[user1].push(new BN(0));
      userClaimData[user2].push(new BN(0));
      userClaimData[user3].push(new BN(0));
      userClaimData[user4].push(new BN(0));
    }
  };

  describe('#harvest', async () => {
    beforeEach('deploy contracts', async () => {
      await deployContracts([kncToken, secondRewardToken]);
    });

    it('correct data harvest', async () => {
      let poolLength = 0;
      Helper.assertEqual(poolLength, await fairLaunch.poolLength());
      let stakeToken = tokens[0].address;
      currentBlockTime = await Helper.getCurrentBlockTime();
      let startTime = new BN(currentBlockTime).add(new BN(getSecondInMinute(1)));
      let duration = new BN(getSecondInMinute(10));
      let endTime = startTime.add(duration);
      let tokenName = 'KNC Generated Token';
      let tokenSymbol = 'KNCG';

      await fairLaunch.setBlockTime(currentBlockTime);

      let tx = await fairLaunch.addPool(
        stakeToken,
        startTime,
        endTime,
        totalRewards,
        tokenName,
        tokenSymbol,
        {from: admin}
      );
      expectEvent(tx, 'AddNewPool', {
        stakeToken: stakeToken,
        startTime: startTime,
        endTime: endTime
      });
      await kncToken.transfer(fairLaunch.address, rw1, {from: admin});
      await secondRewardToken.transfer(fairLaunch.address, rw2, {from: admin});

      await fairLaunch.deposit(0, '2000000000000000000', false, {from: user2});

      await fairLaunch.setBlockTime(endTime);

      let balance1Before = await kncToken.balanceOf(user2);
      let balance2Before = await secondRewardToken.balanceOf(user2);
      await fairLaunch.harvestMultiplePools([0], {from: user2});
      let balance1After = await kncToken.balanceOf(user2);
      let balance2After = await secondRewardToken.balanceOf(user2);
      let balance3After = await kncToken.balanceOf(fairLaunch.address);
      let balance4After = await secondRewardToken.balanceOf(fairLaunch.address);

      Helper.assertGreater(balance1After.sub(balance1Before), new BN(rw1).sub( new BN(1000000000) )); // sub 1 gwei because time auto increase
      Helper.assertGreater(balance2After.sub(balance2Before), new BN(rw2).sub( new BN(1000000000) )); // sub 1 gwei because time auto increase
      Helper.assertLesser(balance3After, 1000000000)
      Helper.assertLesser(balance4After, 1000000000)
    });

    it('correct data withdraw', async () => {
      let poolLength = 0;
      Helper.assertEqual(poolLength, await fairLaunch.poolLength());
      let stakeToken = tokens[0].address;
      currentBlockTime = await Helper.getCurrentBlockTime();
      let startTime = new BN(currentBlockTime).add(new BN(getSecondInMinute(1)));
      let duration = new BN(getSecondInMinute(10));
      let endTime = startTime.add(duration);
      let tokenName = 'KNC Generated Token';
      let tokenSymbol = 'KNCG';

      await fairLaunch.setBlockTime(currentBlockTime);

      let tx = await fairLaunch.addPool(
        stakeToken,
        startTime,
        endTime,
        totalRewards,
        tokenName,
        tokenSymbol,
        {from: admin}
      );
      expectEvent(tx, 'AddNewPool', {
        stakeToken: stakeToken,
        startTime: startTime,
        endTime: endTime
      });
      await kncToken.transfer(fairLaunch.address, rw1, {from: admin});
      await secondRewardToken.transfer(fairLaunch.address, rw2, {from: admin});

      await fairLaunch.deposit(0, '2000000000000000000', false, {from: user2});

      await fairLaunch.setBlockTime(endTime);

      let balance1Before = await kncToken.balanceOf(user2);
      let balance2Before = await secondRewardToken.balanceOf(user2);
      await fairLaunch.withdrawAll(0, {from: user2});
      let balance1After = await kncToken.balanceOf(user2);
      let balance2After = await secondRewardToken.balanceOf(user2);
      let balance3After = await kncToken.balanceOf(fairLaunch.address);
      let balance4After = await secondRewardToken.balanceOf(fairLaunch.address);

      Helper.assertGreater(balance1After.sub(balance1Before), new BN(rw1).sub( new BN(1000000000) )); // sub 1 gwei because time auto increase
      Helper.assertGreater(balance2After.sub(balance2Before), new BN(rw2).sub( new BN(1000000000) )); // sub 1 gwei because time auto increase
      Helper.assertLesser(balance3After, 1000000000)
      Helper.assertLesser(balance4After, 1000000000)
    });
  })
})

function getSecondInMinute(minute) {
  return minute * 60;
}

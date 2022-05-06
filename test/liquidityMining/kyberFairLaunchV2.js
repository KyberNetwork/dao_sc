const {expectEvent, expectRevert} = require('@openzeppelin/test-helpers');
const BN = web3.utils.BN;

const Token = artifacts.require('KyberNetworkTokenV2.sol');
const Token2 = artifacts.require('MockTokenWithDecimals.sol');
const KyberFairLaunch = artifacts.require('MockFairLaunchV2.sol');
const SimpleMockRewardLocker = artifacts.require('SimpleMockRewardLockerV2.sol');

const Helper = require('../helper.js');
const {precisionUnits, zeroAddress} = require('../helper.js');
const REWARD_PER_SHARE_PRECISION = new BN(10).pow(new BN(12));
const TOKEN_DECIMALS = 6;

let admin;
let kncToken;
let secondRewardToken;
let rewardLocker;

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

contract('KyberFairLaunchV2', function (accounts) {
  before('Global setup', async () => {
    admin = accounts[1];
    kncToken = await Token.new();
    secondRewardToken = await Token2.new(TOKEN_DECIMALS);
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
    rewardLocker = await SimpleMockRewardLocker.new();
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
    fairLaunch = await KyberFairLaunch.new(admin, addresses, rewardLocker.address);
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

  const addNewPool = async (startTime, endTime, vestingDuration, totalRewards, name, symbol) => {
    let tokenId = await fairLaunch.poolLength();
    let stakeToken = tokens[tokenId];
    await fairLaunch.addPool(stakeToken.address, startTime, endTime, vestingDuration, totalRewards, name, symbol, {
      from: admin,
    });
    let pid = (await fairLaunch.poolLength()).sub(new BN(1));
    poolInfo[pid] = {
      id: (await fairLaunch.poolLength()).sub(new BN(1)),
      stakeToken: stakeToken,
      startTime: startTime,
      endTime: endTime,
      vestingDuration: vestingDuration,
      lastRewardTime: startTime,
      accRewardPerShares: [],
      rewardPerSeconds: [],
      totalStake: new BN(0),
      tokenName: name,
      tokenSymbol: symbol,
    };
    for (let i = 0; i < rewardTokens.length; i++) {
      let rps = new BN(totalRewards[i]).mul(new BN(multipliers[i])).div(endTime.sub(startTime));
      poolInfo[pid].rewardPerSeconds.push(rps);
      poolInfo[pid].accRewardPerShares.push(new BN(0));
    }
    userInfo[user1][pid] = emptyUserInfo();
    userInfo[user2][pid] = emptyUserInfo();
    userInfo[user3][pid] = emptyUserInfo();
    userInfo[user4][pid] = emptyUserInfo();
    return pid;
  };

  describe('#add pools', async () => {
    beforeEach('deploy contracts', async () => {
      await deployContracts([kncToken, secondRewardToken]);
    });

    it('revert not admin', async () => {
      currentBlockTime = await Helper.getCurrentBlockTime();
      let startTime = new BN(currentBlockTime).add(new BN(getSecondInMinute(1)));
      let endTime = startTime.add(new BN(getSecondInMinute(1)));
      let vestDuration = new BN(getSecondInMinute(60));
      let tokenName = 'KNC Generated Token';
      let tokenSymbol = 'KNCG';
      await expectRevert(
        fairLaunch.addPool(
          tokens[0].address,
          startTime,
          endTime,
          vestDuration,
          [precisionUnits, precisionUnits],
          tokenName,
          tokenSymbol,
          {
            from: accounts[0],
          }
        ),
        'only admin'
      );
    });

    it('revert stake token is 0', async () => {
      currentBlockTime = await Helper.getCurrentBlockTime();
      let startTime = new BN(currentBlockTime).add(new BN(getSecondInMinute(1)));
      let endTime = startTime.add(new BN(getSecondInMinute(1)));
      let vestDuration = new BN(getSecondInMinute(60));
      let tokenName = 'KNC Generated Token';
      let tokenSymbol = 'KNCG';
      await expectRevert(
        fairLaunch.addPool(
          zeroAddress,
          startTime,
          endTime,
          vestDuration,
          [precisionUnits, precisionUnits],
          tokenName,
          tokenSymbol,
          {from: admin}
        ),
        'add: invalid stake token'
      );
    });

    it('revert invalid length', async () => {
      currentBlockTime = await Helper.getCurrentBlockTime();
      let startTime = new BN(currentBlockTime).add(new BN(getSecondInMinute(1)));
      let endTime = startTime.add(new BN(getSecondInMinute(1)));
      let vestDuration = new BN(getSecondInMinute(60));
      let tokenName = 'KNC Generated Token';
      let tokenSymbol = 'KNCG';
      await expectRevert(
        fairLaunch.addPool(
          tokens[0].address,
          startTime,
          endTime,
          vestDuration,
          [precisionUnits],
          tokenName,
          tokenSymbol,
          {from: admin}
        ),
        'add: invalid length'
      );
    });

    it('revert invalid times', async () => {
      currentBlockTime = await Helper.getCurrentBlockTime();
      let startTime = new BN(currentBlockTime).add(new BN(getSecondInMinute(1)));
      let endTime = startTime.add(new BN(getSecondInMinute(1)));
      let vestDuration = new BN(getSecondInMinute(60));
      let tokenName = 'KNC Generated Token';
      let tokenSymbol = 'KNCG';
      let totalRewards = [precisionUnits, precisionUnits];

      await fairLaunch.setBlockTime(startTime);

      // start in the past
      await expectRevert(
        fairLaunch.addPool(
          tokens[0].address,
          new BN(currentBlockTime),
          endTime,
          vestDuration,
          totalRewards,
          tokenName,
          tokenSymbol,
          {from: admin}
        ),
        'add: invalid times'
      );

      // end times <= start times
      await expectRevert(
        fairLaunch.addPool(tokens[0].address, endTime, endTime, vestDuration, totalRewards, tokenName, tokenSymbol, {
          from: admin,
        }),
        'add: invalid times'
      );
      currentBlockTime = await Helper.getCurrentBlockTime();
      await fairLaunch.addPool(
        tokens[0].address,
        new BN(currentBlockTime + getSecondInMinute(1)),
        new BN(currentBlockTime + getSecondInMinute(10)),
        vestDuration,
        totalRewards,
        tokenName,
        tokenSymbol,
        {
          from: admin,
        }
      );
    });

    it('revert duplicated pool', async () => {
      currentBlockTime = await Helper.getCurrentBlockTime();
      let startTime = new BN(currentBlockTime).add(new BN(getSecondInMinute(1)));
      let endTime = startTime.add(new BN(getSecondInMinute(1)));
      let vestDuration = new BN(getSecondInMinute(60));
      let tokenName = 'KNC Generated Token';
      let tokenSymbol = 'KNCG';
      let totalRewards = [precisionUnits, precisionUnits];
      await fairLaunch.addPool(
        tokens[0].address,
        startTime,
        endTime,
        vestDuration,
        totalRewards,
        tokenName,
        tokenSymbol,
        {from: admin}
      );
      await expectRevert(
        fairLaunch.addPool(tokens[0].address, startTime, endTime, vestDuration, totalRewards, tokenName, tokenSymbol, {
          from: admin,
        }),
        'add: duplicated pool'
      );
    });

    it('correct data and events 1', async () => {
      let poolLength = 0;
      Helper.assertEqual(poolLength, await fairLaunch.poolLength());
      for (let i = 0; i < 5; i++) {
        let stakeToken = tokens[i].address;
        currentBlockTime = await Helper.getCurrentBlockTime();
        let startTime = new BN(currentBlockTime).add(new BN(getSecondInMinute(1)));
        let duration = new BN(getSecondInMinute(10));
        let endTime = startTime.add(duration);
        let vestDuration = new BN(getSecondInMinute(60));
        let tokenName = 'KNC Generated Token';
        let tokenSymbol = 'KNCG';
        let totalRewards = generateTotalRewards();
        let tx = await fairLaunch.addPool(
          stakeToken,
          startTime,
          endTime,
          vestDuration,
          totalRewards,
          tokenName,
          tokenSymbol,
          {from: admin}
        );
        expectEvent(tx, 'AddNewPool', {
          stakeToken: stakeToken,
          startTime: startTime,
          endTime: endTime,
          vestingDuration: vestDuration,
        });
        poolLength++;
        Helper.assertEqual(poolLength, await fairLaunch.poolLength());
        poolInfo[i] = {
          id: i,
          stakeToken: tokens[i],
          startTime: startTime,
          endTime: endTime,
          vestingDuration: vestDuration,
          lastRewardTime: startTime,
          accRewardPerShares: [],
          rewardPerSeconds: [],
          totalStake: new BN(0),
        };
        for (let j = 0; j < rewardTokens.length; j++) {
          let rps = new BN(totalRewards[j]).mul(new BN(multipliers[j])).div(duration);
          poolInfo[i].rewardPerSeconds.push(rps);
          poolInfo[i].accRewardPerShares.push(new BN(0));
        }
        await verifyPoolInfo(poolInfo[i]);
      }
    });

    it('correct data and events with zero reward', async () => {
      let poolLength = 0;
      Helper.assertEqual(poolLength, await fairLaunch.poolLength());
      for (let i = 0; i < 5; i++) {
        let stakeToken = tokens[i].address;
        currentBlockTime = await Helper.getCurrentBlockTime();
        let startTime = new BN(currentBlockTime).add(new BN(getSecondInMinute(1)));
        let duration = new BN(getSecondInMinute(10));
        let endTime = startTime.add(duration);
        let vestDuration = new BN(getSecondInMinute(60));
        let tokenName = 'KNC Generated Token';
        let tokenSymbol = 'KNCG';
        let totalRewards = ["0", "0"];
        let tx = await fairLaunch.addPool(
          stakeToken,
          startTime,
          endTime,
          vestDuration,
          totalRewards,
          tokenName,
          tokenSymbol,
          {from: admin}
        );
        expectEvent(tx, 'AddNewPool', {
          stakeToken: stakeToken,
          startTime: startTime,
          endTime: endTime,
          vestingDuration: vestDuration,
        });
        poolLength++;
        Helper.assertEqual(poolLength, await fairLaunch.poolLength());
        poolInfo[i] = {
          id: i,
          stakeToken: tokens[i],
          startTime: startTime,
          endTime: endTime,
          vestingDuration: vestDuration,
          lastRewardTime: startTime,
          accRewardPerShares: [],
          rewardPerSeconds: [],
          totalStake: new BN(0),
        };
        for (let j = 0; j < rewardTokens.length; j++) {
          let rps = new BN(totalRewards[j]).mul(new BN(multipliers[j])).div(duration);
          poolInfo[i].rewardPerSeconds.push(rps);
          poolInfo[i].accRewardPerShares.push(new BN(0));
        }
        await verifyPoolInfo(poolInfo[i]);
      }
    });
  });

  describe('#update pools', async () => {
    beforeEach('deploy contracts', async () => {
      await deployContracts([kncToken, secondRewardToken]);
    });

    it('revert not admin', async () => {
      currentBlockTime = await Helper.getCurrentBlockTime();
      let startTime = new BN(currentBlockTime).add(new BN(getSecondInMinute(1)));
      let endTime = startTime.add(new BN(getSecondInMinute(10)));
      let vestDuration = new BN(getSecondInMinute(60));
      await expectRevert(
        fairLaunch.updatePool(1, endTime, vestDuration, [precisionUnits, precisionUnits], {from: accounts[0]}),
        'only admin'
      );
    });

    it('revert invalid pool id', async () => {
      currentBlockTime = await Helper.getCurrentBlockTime();
      let startTime = new BN(currentBlockTime).add(new BN(getSecondInMinute(1)));
      let endTime = startTime.add(new BN(getSecondInMinute(10)));
      let vestDuration = new BN(getSecondInMinute(60));
      await expectRevert(
        fairLaunch.updatePool(1, endTime, vestDuration, [precisionUnits, precisionUnits], {from: admin}),
        'invalid pool id'
      );
    });

    it('revert invalid length', async () => {
      currentBlockTime = await Helper.getCurrentBlockTime();
      let startTime = new BN(currentBlockTime).add(new BN(getSecondInMinute(1)));
      let endTime = startTime.add(new BN(getSecondInMinute(10)));
      let vestDuration = new BN(getSecondInMinute(60));
      let totalRewards = [precisionUnits, precisionUnits];
      let tokenName = 'KNC Generated Token';
      let tokenSymbol = 'KNCG';
      await fairLaunch.addPool(
        tokens[0].address,
        startTime,
        endTime,
        vestDuration,
        totalRewards,
        tokenName,
        tokenSymbol,
        {from: admin}
      );

      await expectRevert(
        fairLaunch.updatePool(0, endTime, vestDuration, [precisionUnits], {from: admin}),
        'update: invalid length'
      );
    });

    it('revert pool has ended', async () => {
      currentBlockTime = await Helper.getCurrentBlockTime();
      let startTime = new BN(currentBlockTime).add(new BN(getSecondInMinute(1)));
      let endTime = startTime.add(new BN(getSecondInMinute(2)));
      let vestDuration = new BN(getSecondInMinute(60));
      let totalRewards = [precisionUnits, precisionUnits];
      let tokenName = 'KNC Generated Token';
      let tokenSymbol = 'KNCG';
      await fairLaunch.addPool(
        tokens[0].address,
        startTime,
        endTime,
        vestDuration,
        totalRewards,
        tokenName,
        tokenSymbol,
        {from: admin}
      );
      await Helper.setNextBlockTimestamp(endTime);
      await fairLaunch.setBlockTime(endTime);

      await expectRevert(
        fairLaunch.updatePool(0, endTime, vestDuration, totalRewards, {from: admin}),
        'update: pool already ended'
      );
    });

    it('revert invalid time', async () => {
      currentBlockTime = await Helper.getCurrentBlockTime();
      let startTime = new BN(currentBlockTime).add(new BN(getSecondInMinute(1)));
      let endTime = startTime.add(new BN(getSecondInMinute(2)));
      let vestDuration = new BN(getSecondInMinute(60));
      let totalRewards = [precisionUnits, precisionUnits];
      let tokenName = 'KNC Generated Token';
      let tokenSymbol = 'KNCG';
      await fairLaunch.setBlockTime(currentBlockTime);

      await fairLaunch.addPool(
        tokens[0].address,
        startTime,
        endTime,
        vestDuration,
        totalRewards,
        tokenName,
        tokenSymbol,
        {from: admin}
      );
      // end time <= start time
      await expectRevert(
        fairLaunch.updatePool(0, startTime, vestDuration, totalRewards, {from: admin}),
        'update: invalid end time'
      );
      await expectRevert(
        fairLaunch.updatePool(0, startTime.sub(new BN(getSecondInMinute(1))), vestDuration, totalRewards, {
          from: admin,
        }),
        'update: invalid end time'
      );

      // end time <= current time
      await Helper.setNextBlockTimestamp(startTime);

      currentBlockTime = await Helper.getCurrentBlockTime();

      // next tx is executed at currenttime + 1
      await fairLaunch.setBlockTime(startTime.add(new BN(1)));
      await expectRevert(
        fairLaunch.updatePool(0, new BN(currentBlockTime).add(new BN(1)), vestDuration, totalRewards, {
          from: admin,
        }),
        'update: invalid end time'
      );
      currentBlockTime = await Helper.getCurrentBlockTime();
      await fairLaunch.setBlockTime(currentBlockTime);

      await expectRevert(
        fairLaunch.updatePool(0, new BN(currentBlockTime), vestDuration, totalRewards, {from: admin}),
        'update: invalid end time'
      );
    });

    it('correct data and events', async () => {
      currentBlockTime = await Helper.getCurrentBlockTime();
      let startTime = new BN(currentBlockTime).add(new BN(getSecondInMinute(1)));
      let endTime = startTime.add(new BN(getSecondInMinute(2)));
      let vestDuration = new BN(getSecondInMinute(60));
      let tokenName = 'KNC Generated Token';
      let tokenSymbol = 'KNCG';
      let totalRewards = generateTotalRewards();

      await fairLaunch.setBlockTime(currentBlockTime);
      let pid = await addNewPool(startTime, endTime, vestDuration, totalRewards, tokenName, tokenSymbol);
      await verifyPoolInfo(poolInfo[pid]);

      for (let i = 0; i < rewardTokens.length; i++) {
        await transferToken(rewardTokens[i], accounts[0], fairLaunch.address, precisionUnits.mul(new BN(200)));
      }

      // update pool before it starts
      endTime = startTime.add(new BN(getSecondInMinute(3)));
      totalRewards = generateTotalRewards();
      vestDuration = new BN(getSecondInMinute(10));
      let tx = await fairLaunch.updatePool(pid, endTime, vestDuration, totalRewards, {from: admin});
      expectEvent(tx, 'UpdatePool', {
        pid: pid,
        endTime: endTime,
        vestingDuration: vestDuration,
      });

      // not yet started, no need to call update pool rewards
      poolInfo[pid].endTime = endTime;
      poolInfo[pid].vestingDuration = vestDuration;
      poolInfo[pid].rewardPerSeconds = [];
      for (let i = 0; i < rewardTokens.length; i++) {
        let rps = new BN(totalRewards[i]).mul(new BN(multipliers[i])).div(endTime.sub(poolInfo[pid].startTime));
        poolInfo[pid].rewardPerSeconds.push(rps);
      }
      await verifyPoolInfo(poolInfo[pid]);

      let timeTo = currentBlockTime;
      let amount = precisionUnits.mul(new BN(2));
      await depositAndVerifyData(user1, pid, amount, false, timeTo);
      amount = precisionUnits.mul(new BN(2));
      await depositAndVerifyData(user2, pid, amount, true, timeTo);

      timeTo = poolInfo[pid].startTime;
      await Helper.setNextBlockTimestamp(timeTo);
      await fairLaunch.setBlockTime(timeTo);

      await harvestAndVerifyData(user1, pid, timeTo);

      // change reward per seconds
      totalRewards = generateTotalRewards();
      await fairLaunch.updatePool(pid, endTime, vestDuration, totalRewards, {from: admin});
      poolInfo[pid] = updatePoolReward(poolInfo[pid], timeTo);
      poolInfo[pid].rewardPerSeconds = [];
      for (let i = 0; i < rewardTokens.length; i++) {
        let rps = new BN(totalRewards[i]).mul(new BN(multipliers[i])).div(endTime.sub(poolInfo[pid].startTime));
        poolInfo[pid].rewardPerSeconds.push(rps);
      }
      await verifyPoolInfo(poolInfo[pid]);
      await harvestAndVerifyData(user1, pid, timeTo);
      await harvestAndVerifyData(user2, pid, timeTo);
      await withdrawAndVerifyData(user1, pid, amount.div(new BN(10)), false, timeTo);

      // change reward per seconds
      totalRewards = generateTotalRewards();
      await fairLaunch.updatePool(pid, endTime, vestDuration, totalRewards, {from: admin});
      //   currentBlockTime = await Helper.getCurrentBlockTime();
      poolInfo[pid] = updatePoolReward(poolInfo[pid], timeTo);
      poolInfo[pid].rewardPerSeconds = [];
      for (let i = 0; i < rewardTokens.length; i++) {
        let rps = new BN(totalRewards[i]).mul(new BN(multipliers[i])).div(endTime.sub(startTime));
        poolInfo[pid].rewardPerSeconds.push(rps);
      }
      await verifyPoolInfo(poolInfo[pid]);

      await depositAndVerifyData(user1, pid, amount, true, timeTo);
      await depositAndVerifyData(user2, pid, amount, true, timeTo);
    });

    it('correct data and events with zero reward', async () => {
      currentBlockTime = await Helper.getCurrentBlockTime();
      let startTime = new BN(currentBlockTime).add(new BN(getSecondInMinute(1)));
      let endTime = startTime.add(new BN(getSecondInMinute(2)));
      let vestDuration = new BN(getSecondInMinute(60));
      let tokenName = 'KNC Generated Token';
      let tokenSymbol = 'KNCG';
      let totalRewards = generateTotalRewards();

      await fairLaunch.setBlockTime(currentBlockTime);
      let pid = await addNewPool(startTime, endTime, vestDuration, totalRewards, tokenName, tokenSymbol);
      await verifyPoolInfo(poolInfo[pid]);

      for (let i = 0; i < rewardTokens.length; i++) {
        await transferToken(rewardTokens[i], accounts[0], fairLaunch.address, precisionUnits.mul(new BN(200)));
      }

      // update pool before it starts
      endTime = startTime.add(new BN(getSecondInMinute(3)));
      totalRewards = ["0", "0"];
      vestDuration = new BN(getSecondInMinute(10));
      let tx = await fairLaunch.updatePool(pid, endTime, vestDuration, totalRewards, {from: admin});
      expectEvent(tx, 'UpdatePool', {
        pid: pid,
        endTime: endTime,
        vestingDuration: vestDuration,
      });

      // not yet started, no need to call update pool rewards
      poolInfo[pid].endTime = endTime;
      poolInfo[pid].vestingDuration = vestDuration;
      poolInfo[pid].rewardPerSeconds = [];
      for (let i = 0; i < rewardTokens.length; i++) {
        let rps = new BN(totalRewards[i]).mul(new BN(multipliers[i])).div(endTime.sub(poolInfo[pid].startTime));
        poolInfo[pid].rewardPerSeconds.push(rps);
      }
      await verifyPoolInfo(poolInfo[pid]);

      let timeTo = currentBlockTime;
      let amount = precisionUnits.mul(new BN(2));
      await depositAndVerifyData(user1, pid, amount, false, timeTo);
      amount = precisionUnits.mul(new BN(2));
      await depositAndVerifyData(user2, pid, amount, true, timeTo);

      timeTo = poolInfo[pid].startTime;
      await Helper.setNextBlockTimestamp(timeTo);
      await fairLaunch.setBlockTime(timeTo);

      await harvestAndVerifyData(user1, pid, timeTo);

      // change reward per seconds
      totalRewards = generateTotalRewards();
      await fairLaunch.updatePool(pid, endTime, vestDuration, totalRewards, {from: admin});
      poolInfo[pid] = updatePoolReward(poolInfo[pid], timeTo);
      poolInfo[pid].rewardPerSeconds = [];
      for (let i = 0; i < rewardTokens.length; i++) {
        let rps = new BN(totalRewards[i]).mul(new BN(multipliers[i])).div(endTime.sub(poolInfo[pid].startTime));
        poolInfo[pid].rewardPerSeconds.push(rps);
      }
      await verifyPoolInfo(poolInfo[pid]);
      await harvestAndVerifyData(user1, pid, timeTo);
      await harvestAndVerifyData(user2, pid, timeTo);
      await withdrawAndVerifyData(user1, pid, amount.div(new BN(10)), false, timeTo);

      // change reward per seconds
      totalRewards = generateTotalRewards();
      await fairLaunch.updatePool(pid, endTime, vestDuration, totalRewards, {from: admin});
      //   currentBlockTime = await Helper.getCurrentBlockTime();
      poolInfo[pid] = updatePoolReward(poolInfo[pid], timeTo);
      poolInfo[pid].rewardPerSeconds = [];
      for (let i = 0; i < rewardTokens.length; i++) {
        let rps = new BN(totalRewards[i]).mul(new BN(multipliers[i])).div(endTime.sub(startTime));
        poolInfo[pid].rewardPerSeconds.push(rps);
      }
      await verifyPoolInfo(poolInfo[pid]);

      await depositAndVerifyData(user1, pid, amount, true, timeTo);
      await depositAndVerifyData(user2, pid, amount, true, timeTo);
    });
  });

  describe('#renew pools', async () => {
    beforeEach('deploy contracts', async () => {
      await deployContracts([kncToken, secondRewardToken]);
    });

    it('revert not admin', async () => {
      currentBlockTime = await Helper.getCurrentBlockTime();
      let startTime = new BN(currentBlockTime).add(new BN(getSecondInMinute(1)));
      let endTime = startTime.add(new BN(getSecondInMinute(2)));
      let vestDuration = new BN(getSecondInMinute(60));
      await expectRevert(
        fairLaunch.renewPool(1, startTime, endTime, vestDuration, [precisionUnits], {from: accounts[0]}),
        'only admin'
      );
    });

    it('revert invalid pool id', async () => {
      currentBlockTime = await Helper.getCurrentBlockTime();
      let startTime = new BN(currentBlockTime).add(new BN(getSecondInMinute(1)));
      let endTime = startTime.add(new BN(getSecondInMinute(2)));
      let vestDuration = new BN(getSecondInMinute(60));
      await expectRevert(
        fairLaunch.renewPool(1, startTime, endTime, vestDuration, [precisionUnits], {from: admin}),
        'invalid pool id'
      );
    });

    it('revert invalid length', async () => {
      currentBlockTime = await Helper.getCurrentBlockTime();
      let startTime = new BN(currentBlockTime).add(new BN(getSecondInMinute(1)));
      let endTime = startTime.add(new BN(getSecondInMinute(2)));
      let vestDuration = new BN(getSecondInMinute(60));
      let tokenName = 'KNC Generated Token';
      let tokenSymbol = 'KNCG';
      let totalRewards = [precisionUnits, precisionUnits];
      await fairLaunch.addPool(
        tokens[0].address,
        startTime,
        endTime,
        vestDuration,
        totalRewards,
        tokenName,
        tokenSymbol,
        {from: admin}
      );
      await expectRevert(
        fairLaunch.renewPool(0, startTime, endTime, vestDuration, [precisionUnits], {from: admin}),
        'renew: invalid length'
      );
    });

    it('revert pool is active', async () => {
      currentBlockTime = await Helper.getCurrentBlockTime();
      let startTime = new BN(currentBlockTime).add(new BN(getSecondInMinute(1)));
      let endTime = startTime.add(new BN(getSecondInMinute(2)));
      let vestDuration = new BN(getSecondInMinute(60));
      let tokenName = 'KNC Generated Token';
      let tokenSymbol = 'KNCG';
      let totalRewards = [precisionUnits, precisionUnits];

      await fairLaunch.addPool(
        tokens[0].address,
        startTime,
        endTime,
        vestDuration,
        totalRewards,
        tokenName,
        tokenSymbol,
        {from: admin}
      );

      await Helper.setNextBlockTimestamp(startTime);
      await fairLaunch.setBlockTime(startTime);

      await expectRevert(
        fairLaunch.renewPool(0, startTime, endTime, vestDuration, totalRewards, {from: admin}),
        'renew: invalid pool state to renew'
      );
    });

    it('revert invalid times', async () => {
      currentBlockTime = await Helper.getCurrentBlockTime();
      let startTime = new BN(currentBlockTime).add(new BN(getSecondInMinute(1)));
      let endTime = startTime.add(new BN(getSecondInMinute(2)));
      let vestDuration = new BN(getSecondInMinute(60));
      let tokenName = 'KNC Generated Token';
      let tokenSymbol = 'KNCG';
      let totalRewards = [precisionUnits, precisionUnits];
      await fairLaunch.setBlockTime(currentBlockTime);
      await fairLaunch.addPool(
        tokens[0].address,
        startTime,
        endTime,
        vestDuration,
        totalRewards,
        tokenName,
        tokenSymbol,
        {from: admin}
      );
      //   currentBlockTime = await Helper.getCurrentBlockTime();
      await expectRevert(
        fairLaunch.renewPool(
          0,
          currentBlockTime,
          new BN(currentBlockTime).add(new BN(getSecondInMinute(10))),
          vestDuration,
          totalRewards,
          {from: admin}
        ),
        'renew: invalid times'
      );
      await expectRevert(
        fairLaunch.renewPool(
          0,
          new BN(currentBlockTime).add(new BN(getSecondInMinute(10))),
          new BN(currentBlockTime).add(new BN(getSecondInMinute(10))),
          vestDuration,
          totalRewards,
          {from: admin}
        ),
        'renew: invalid times'
      );
    });

    it('correct data and events', async () => {
      currentBlockTime = await Helper.getCurrentBlockTime();
      let startTime = new BN(currentBlockTime).add(new BN(getSecondInMinute(10)));
      let endTime = startTime.add(new BN(getSecondInMinute(25)));
      let totalRewards = generateTotalRewards();
      let vestDuration = new BN(getSecondInMinute(60));
      let tokenName = 'KNC Generated Token';
      let tokenSymbol = 'KNCG';
      await fairLaunch.setBlockTime(currentBlockTime);
      let pid = await addNewPool(startTime, endTime, vestDuration, totalRewards, tokenName, tokenSymbol);
      await verifyPoolInfo(poolInfo[pid]);

      for (let i = 0; i < rewardTokens.length; i++) {
        await transferToken(rewardTokens[i], accounts[0], fairLaunch.address, precisionUnits.mul(new BN(200)));
      }

      let amount = precisionUnits.mul(new BN(10));
      let timeTo = new BN(currentBlockTime).add(new BN(getSecondInMinute(1)));
      await fairLaunch.setBlockTime(timeTo);

      await depositAndVerifyData(user1, pid, amount, true, timeTo);
      amount = precisionUnits.mul(new BN(2));
      await depositAndVerifyData(user2, pid, amount, true, timeTo);

      // renew when it has not started
      startTime = new BN(currentBlockTime).add(new BN(getSecondInMinute(15)));
      endTime = startTime.add(new BN(getSecondInMinute(30)));
      totalRewards = generateTotalRewards();
      vestDuration = new BN(getSecondInMinute(10));

      let tx = await fairLaunch.renewPool(pid, startTime, endTime, vestDuration, totalRewards, {from: admin});
      expectEvent(tx, 'RenewPool', {
        pid: pid,
        startTime: startTime,
        endTime: endTime,
        vestingDuration: vestDuration,
      });

      timeTo = new BN(currentBlockTime).add(new BN(getSecondInMinute(4)));
      await fairLaunch.setBlockTime(timeTo);

      poolInfo[pid] = updatePoolInfoOnRenew(poolInfo[pid], startTime, endTime, totalRewards, timeTo, vestDuration);
      await verifyPoolInfo(poolInfo[pid]);
      await verifyUserInfo(user1, pid, userInfo[user1][pid]);
      await verifyUserInfo(user2, pid, userInfo[user2][pid]);
      await verifyPendingRewards(pid, [user1, user2, user3], timeTo);

      timeTo = poolInfo[pid].endTime;
      await fairLaunch.setBlockTime(timeTo);

      // record pending rewards after the pool has ended
      let user1PendingRewards = await fairLaunch.pendingRewards(pid, user1);
      let user2PendingRewards = await fairLaunch.pendingRewards(pid, user2);

      timeTo = new BN(timeTo).add(new BN(getSecondInMinute(1)));
      await fairLaunch.setBlockTime(timeTo);

      startTime = new BN(poolInfo[pid].endTime).add(new BN(getSecondInMinute(12)));
      endTime = startTime.add(new BN(getSecondInMinute(10)));
      totalRewards = generateTotalRewards();
      vestDuration = new BN(getSecondInMinute(20));

      tx = await fairLaunch.renewPool(pid, startTime, endTime, vestDuration, totalRewards, {from: admin});
      expectEvent(tx, 'RenewPool', {
        pid: pid,
        startTime: startTime,
        endTime: endTime,
        vestingDuration: vestDuration,
      });

      timeTo = new BN(timeTo).add(new BN(getSecondInMinute(1)));
      await fairLaunch.setBlockTime(timeTo);

      poolInfo[pid] = updatePoolInfoOnRenew(poolInfo[pid], startTime, endTime, totalRewards, timeTo, vestDuration);
      await verifyPoolInfo(poolInfo[pid]);
      // user data shouldn't be changed
      await verifyUserInfo(user1, pid, userInfo[user1][pid]);
      await verifyUserInfo(user2, pid, userInfo[user2][pid]);
      await verifyPendingRewards(pid, [user1, user2, user3], timeTo);

      timeTo = new BN(timeTo).add(new BN(getSecondInMinute(1)));
      await fairLaunch.setBlockTime(timeTo);

      // deposit without claim
      await depositAndVerifyData(user1, pid, amount, false, timeTo);
      await depositAndVerifyData(user2, pid, amount, false, timeTo);
      // make deposit for user3 & user4, where amounts are the same as user1 & user2

      timeTo = new BN(timeTo).add(new BN(getSecondInMinute(1)));
      await fairLaunch.setBlockTime(timeTo);
      await depositAndVerifyData(user3, pid, userInfo[user1][pid].amount, true, timeTo);
      await depositAndVerifyData(user4, pid, userInfo[user2][pid].amount, true, timeTo);

      // pending reward shouldn't changed
      Helper.assertEqualArray(user1PendingRewards, await fairLaunch.pendingRewards(pid, user1));
      Helper.assertEqualArray(user2PendingRewards, await fairLaunch.pendingRewards(pid, user2));

      // harvest for user 1
      timeTo = new BN(timeTo).add(new BN(getSecondInMinute(3)));
      await fairLaunch.setBlockTime(timeTo);

      await harvestAndVerifyData(user1, pid, timeTo);
      Helper.assertEqual(new BN(0), await fairLaunch.pendingRewards(pid, user1));

      // delay to start of the pool
      timeTo = poolInfo[pid].startTime.add(new BN(getSecondInMinute(5)));
      await Helper.setNextBlockTimestamp(timeTo);
      await fairLaunch.setBlockTime(timeTo);

      //   now both users should start accumulating new rewards
      Helper.assertGreater(await fairLaunch.pendingRewards(pid, user1), new BN(0));
      // since user1's amount == user3's amount, reward should be the same
      Helper.assertEqual(await fairLaunch.pendingRewards(pid, user1), await fairLaunch.pendingRewards(pid, user3));
      // user4's amount = user2's amount, new reward should be the same
      let pendingRewards = await fairLaunch.pendingRewards(pid, user4);
      for (let i = 0; i < rewardTokens.length; i++) {
        user2PendingRewards[i] = user2PendingRewards[i].add(pendingRewards[i]);
      }
      Helper.assertEqualArray(await fairLaunch.pendingRewards(pid, user2), user2PendingRewards);

      //   check if withdrawable full amount from previous deposited
      await withdrawAndVerifyData(user1, pid, userInfo[user1][pid].amount, false, timeTo);
      await withdrawAndVerifyData(user2, pid, userInfo[user2][pid].amount, true, timeTo);
    });
  });

  describe('#deposit', async () => {
    beforeEach('deploy contracts', async () => {
      await deployContracts([kncToken, zeroAddress]);
    });

    it('revert invalid pool', async () => {
      await expectRevert(fairLaunch.deposit(1, 100, true, {from: user1}), 'invalid pool id');
    });

    it('revert not enough token', async () => {
      currentBlockTime = new BN(await Helper.getCurrentBlockTime());
      let totalRewards = [precisionUnits, precisionUnits];
      let vestDuration = new BN(getSecondInMinute(60));
      let tokenName = 'KNC Generated Token';
      let tokenSymbol = 'KNCG';
      let pid = await addNewPool(
        currentBlockTime.add(new BN(getSecondInMinute(1))),
        currentBlockTime.add(new BN(getSecondInMinute(2))),
        vestDuration,
        totalRewards,
        tokenName,
        tokenSymbol
      );
      await poolInfo[pid].stakeToken.approve(fairLaunch.address, new BN(0), {from: user1});
      await expectRevert.unspecified(fairLaunch.deposit(pid, precisionUnits, false, {from: user1}));
      await poolInfo[pid].stakeToken.approve(fairLaunch.address, new BN(2).pow(new BN(255)), {from: user1});
      let balance = await poolInfo[pid].stakeToken.balanceOf(user1);
      await expectRevert.unspecified(fairLaunch.deposit(pid, balance.add(new BN(1)), false, {from: user1}));
    });

    it('revert not enough reward token', async () => {
      currentBlockTime = new BN(await Helper.getCurrentBlockTime());
      let totalRewards = [precisionUnits, precisionUnits];
      let vestDuration = new BN(getSecondInMinute(60));
      let tokenName = 'KNC Generated Token';
      let tokenSymbol = 'KNCG';
      let pid = await addNewPool(
        currentBlockTime.add(new BN(getSecondInMinute(1))),
        currentBlockTime.add(new BN(getSecondInMinute(5))),
        vestDuration,
        totalRewards,
        tokenName,
        tokenSymbol
      );
      await fairLaunch.deposit(pid, precisionUnits, false, {from: user1});
      await Helper.setNextBlockTimestamp(poolInfo[pid].startTime.add(new BN(getSecondInMinute(1))));
      await fairLaunch.setBlockTime(poolInfo[pid].startTime.add(new BN(getSecondInMinute(1))));

      // deposit without harvesting, still ok
      await fairLaunch.deposit(pid, precisionUnits, false, {from: user1});
      // not enough token for reward
      await expectRevert.unspecified(fairLaunch.deposit(pid, precisionUnits, true, {from: user1}));
    });

    // 1. deposit when pool has not started, check reward is 0
    // 2. increase blocks, check rewards are accumulated for users that have staked previously
    // 3. deposit without harvesting, check data
    // 4. deposit with harvesting, check data
    // 5. deposit after pool has ended
    it('deposit and check rewards', async () => {
      currentBlockTime = new BN(await Helper.getCurrentBlockTime());
      let startTime = new BN(currentBlockTime).add(new BN(getSecondInMinute(1)));
      let endTime = startTime.add(new BN(getSecondInMinute(50)));
      let totalRewards = generateTotalRewards();
      let vestDuration = new BN(getSecondInMinute(60));
      let tokenName = 'KNC Generated Token';
      let tokenSymbol = 'KNCG';
      let pid = await addNewPool(startTime, endTime, vestDuration, totalRewards, tokenName, tokenSymbol);
      let amount = precisionUnits.mul(new BN(2));

      await fairLaunch.setBlockTime(currentBlockTime);
      await depositAndVerifyData(user1, pid, amount, false, currentBlockTime);

      amount = precisionUnits.mul(new BN(2));

      await depositAndVerifyData(user2, pid, amount, true, currentBlockTime);

      let timeTo = poolInfo[pid].startTime;
      await Helper.setNextBlockTimestamp(timeTo);
      await fairLaunch.setBlockTime(timeTo);

      await verifyPendingRewards(pid, [user1, user2, user3], timeTo);
      timeTo = poolInfo[pid].startTime.add(new BN(getSecondInMinute(4)));
      await fairLaunch.setBlockTime(timeTo);

      await verifyPendingRewards(pid, [user1, user2, user3], timeTo);
      // should have acc some rewards alr
      let pendinRewards = await fairLaunch.pendingRewards(pid, user1);
      for (let i = 0; i < rewardTokens.length; i++) {
        await Helper.assertGreater(pendinRewards[i], new BN(0));
      }
      pendinRewards = await fairLaunch.pendingRewards(pid, user3);
      for (let i = 0; i < rewardTokens.length; i++) {
        await Helper.assertEqual(pendinRewards[i], new BN(0));
      }

      //   deposit without harvesting
      amount = precisionUnits.mul(new BN(5));
      await depositAndVerifyData(user1, pid, amount, false, timeTo);

      timeTo = poolInfo[pid].startTime.add(new BN(getSecondInMinute(6)));
      await fairLaunch.setBlockTime(timeTo);

      for (let i = 0; i < rewardTokens.length; i++) {
        await transferToken(rewardTokens[i], accounts[0], fairLaunch.address, totalRewards[i].mul(new BN(10)));
      }

      amount = precisionUnits.mul(new BN(2));

      timeTo = poolInfo[pid].startTime.add(new BN(getSecondInMinute(7)));
      await fairLaunch.setBlockTime(timeTo);

      // deposit with harvesting
      await depositAndVerifyData(user2, pid, amount, true, timeTo);
      await depositAndVerifyData(user1, pid, amount, true, timeTo);

      // deposit when reward has been ended
      timeTo = poolInfo[pid].endTime;
      await fairLaunch.setBlockTime(timeTo);

      await depositAndVerifyData(user1, pid, amount, false, timeTo);
      await depositAndVerifyData(user2, pid, amount, true, timeTo);

      // extra verification
      let poolData = await fairLaunch.getPoolInfo(pid);
      let user1Data = await fairLaunch.getUserInfo(pid, user1);
      let user2Data = await fairLaunch.getUserInfo(pid, user2);

      await Helper.assertEqual(poolInfo[pid].endTime, poolData.lastRewardTime);
      await Helper.assertEqualArray(user1Data.lastRewardPerShares, poolData.accRewardPerShares);
      await Helper.assertEqualArray(user2Data.lastRewardPerShares, poolData.accRewardPerShares);
      for (let i = 0; i < rewardTokens.length; i++) {
        await Helper.assertEqual(new BN(0), user2Data.unclaimedRewards[i]);
        await Helper.assertGreater(user1Data.unclaimedRewards[i], new BN(0));
      }

      timeTo = poolInfo[pid].endTime.add(new BN(getSecondInMinute(2)));
      await fairLaunch.setBlockTime(timeTo);

      await depositAndVerifyData(user1, pid, new BN(0), true, timeTo);
      user1Data = await fairLaunch.getUserInfo(pid, user1);
      for (let i = 0; i < rewardTokens.length; i++) {
        await Helper.assertEqual(new BN(0), user1Data.unclaimedRewards[i]);
      }
    });
  });

  describe('#withdraw', async () => {
    beforeEach('deploy contracts', async () => {
      await deployContracts([kncToken, secondRewardToken]);
    });

    it('revert withdraw higher than deposited', async () => {
      currentBlockTime = new BN(await Helper.getCurrentBlockTime());
      let startTime = new BN(currentBlockTime).add(new BN(getSecondInMinute(1)));
      let endTime = startTime.add(new BN(getSecondInMinute(50)));
      let totalRewards = [precisionUnits, precisionUnits.div(new BN(3))];
      let vestDuration = new BN(getSecondInMinute(60));
      let tokenName = 'KNC Generated Token';
      let tokenSymbol = 'KNCG';
      let pid = await addNewPool(startTime, endTime, vestDuration, totalRewards, tokenName, tokenSymbol);

      await fairLaunch.deposit(pid, precisionUnits, false, {from: user1});
      await expectRevert(
        fairLaunch.withdraw(pid, precisionUnits.add(new BN(1)), {from: user1}),
        'withdraw: insufficient amount'
      );
      await fairLaunch.withdraw(pid, precisionUnits.div(new BN(2)), {from: user1});
      await fairLaunch.withdrawAll(pid, {from: user1});
    });

    it('revert withdraw not enough reward token', async () => {
      currentBlockTime = new BN(await Helper.getCurrentBlockTime());
      let startTime = new BN(currentBlockTime).add(new BN(getSecondInMinute(4)));
      let endTime = currentBlockTime.add(new BN(getSecondInMinute(20)));
      let totalRewards = [precisionUnits, precisionUnits.div(new BN(3))];
      let vestDuration = new BN(getSecondInMinute(60));
      let tokenName = 'KNC Generated Token';
      let tokenSymbol = 'KNCG';
      await fairLaunch.setBlockTime(currentBlockTime);

      let pid = await addNewPool(startTime, endTime, vestDuration, totalRewards, tokenName, tokenSymbol);
      await fairLaunch.deposit(pid, precisionUnits, false, {from: user1});

      let timeTo = poolInfo[pid].startTime.add(new BN(getSecondInMinute(1)));
      //   let timeTo = startTime;
      await fairLaunch.setBlockTime(timeTo);
      await expectRevert.unspecified(fairLaunch.withdraw(pid, precisionUnits, {from: user1}));
      await expectRevert.unspecified(fairLaunch.withdrawAll(pid, {from: user1}));
      for (let i = 0; i < rewardTokens.length; i++) {
        await transferToken(rewardTokens[i], accounts[0], fairLaunch.address, totalRewards[i].mul(new BN(10)));
      }
      await fairLaunch.withdraw(pid, precisionUnits.div(new BN(2)), {from: user1});
      await fairLaunch.withdrawAll(pid, {from: user1});
    });

    it('withdraw and check rewards', async () => {
      currentBlockTime = new BN(await Helper.getCurrentBlockTime());
      let startTime = new BN(currentBlockTime).add(new BN(getSecondInMinute(1)));
      let endTime = startTime.add(new BN(getSecondInMinute(50)));
      let totalRewards = [precisionUnits, precisionUnits.div(new BN(3))];
      let vestDuration = new BN(getSecondInMinute(60));
      let tokenName = 'KNC Generated Token';
      let tokenSymbol = 'KNCG';
      await fairLaunch.setBlockTime(currentBlockTime);
      let pid = await addNewPool(startTime, endTime, vestDuration, totalRewards, tokenName, tokenSymbol);
      let amount = precisionUnits.mul(new BN(2));
      await depositAndVerifyData(user1, pid, amount, false, currentBlockTime);
      await depositAndVerifyData(user2, pid, amount, true, currentBlockTime);
      // withdraw when not started yet, no reward claimed
      // Note: rewards have not been set to the fairlaunch yet, means it won't revert because reward is 0
      amount = precisionUnits.div(new BN(10));
      await withdrawAndVerifyData(user1, pid, amount, false, currentBlockTime);
      let timeTo = poolInfo[pid].startTime.add(new BN(getSecondInMinute(1)));
      await fairLaunch.setBlockTime(timeTo);

      for (let i = 0; i < rewardTokens.length; i++) {
        await transferToken(rewardTokens[i], accounts[0], fairLaunch.address, totalRewards[i].mul(new BN(10)));
      }
      // withdraw and harvest rewards
      amount = precisionUnits.div(new BN(5));

      await withdrawAndVerifyData(user1, pid, amount, false, timeTo);
      timeTo = poolInfo[pid].startTime.add(new BN(getSecondInMinute(3)));
      await fairLaunch.setBlockTime(timeTo);

      // await Helper.increaseBlockNumber(2);
      amount = precisionUnits.div(new BN(2));
      await withdrawAndVerifyData(user2, pid, amount, false, timeTo);
      await verifyPendingRewards(pid, [user1, user2, user3]);
      // withdraw when reward has been ended
      //   await Helper.setNextBlockTimestamp(poolInfo[pid].endTime);
      await fairLaunch.setBlockTime(poolInfo[pid].endTime);

      timeTo = poolInfo[pid].endTime;
      await withdrawAndVerifyData(user1, pid, amount, false, timeTo);
      await withdrawAndVerifyData(user2, pid, amount, false, timeTo);
      // withdraw all
      await withdrawAndVerifyData(user1, pid, userInfo[user1][pid].amount, true, timeTo);
      await withdrawAndVerifyData(user2, pid, userInfo[user2][pid].amount, true, timeTo);
      // extra verification
      let poolData = await fairLaunch.getPoolInfo(pid);
      let user1Data = await fairLaunch.getUserInfo(pid, user1);
      let user2Data = await fairLaunch.getUserInfo(pid, user2);
      await Helper.assertEqual(poolInfo[pid].endTime, poolData.lastRewardTime);
      await Helper.assertEqualArray(user1Data.lastRewardPerShares, poolData.accRewardPerShares);
      await Helper.assertEqualArray(user2Data.lastRewardPerShares, poolData.accRewardPerShares);
      for (let i = 0; i < rewardTokens.length; i++) {
        await Helper.assertEqual(0, user2Data.unclaimedRewards[i]);
        await Helper.assertEqual(0, user1Data.unclaimedRewards[i]);
      }
      await Helper.assertEqual(0, user1Data.amount);
      await Helper.assertEqual(0, user2Data.amount);
    });
  });

  describe('#harvest', async () => {
    beforeEach('deploy contracts', async () => {
      await deployContracts([kncToken, secondRewardToken]);
    });

    it('revert invalid pool', async () => {
      await expectRevert(fairLaunch.harvest(1, {from: user1}), 'invalid pool id');
      await expectRevert(fairLaunch.harvestMultiplePools([1], {from: user1}), 'invalid pool id');
    });

    it('revert harvest not enough reward token', async () => {
      currentBlockTime = new BN(await Helper.getCurrentBlockTime());
      let startTime = new BN(currentBlockTime).add(new BN(getSecondInMinute(1)));
      let endTime = startTime.add(new BN(getSecondInMinute(50)));
      let totalRewards = [precisionUnits, precisionUnits.div(new BN(3))];
      let vestDuration = new BN(getSecondInMinute(60));
      let tokenName = 'KNC Generated Token';
      let tokenSymbol = 'KNCG';
      await fairLaunch.setBlockTime(currentBlockTime);
      let pid = await addNewPool(startTime, endTime, vestDuration, totalRewards, tokenName, tokenSymbol);
      await fairLaunch.deposit(pid, precisionUnits, false, {from: user1});
      await fairLaunch.setBlockTime(poolInfo[pid].startTime.add(new BN(getSecondInMinute(1))));

      await expectRevert.unspecified(fairLaunch.harvest(pid, {from: user1}));
      for (let i = 0; i < rewardTokens.length; i++) {
        await transferToken(rewardTokens[i], accounts[0], fairLaunch.address, precisionUnits.mul(new BN(10)));
      }
      await fairLaunch.harvest(pid, {from: user1});
    });

    it('harvest and check rewards', async () => {
      currentBlockTime = new BN(await Helper.getCurrentBlockTime());
      let amount = precisionUnits.div(new BN(10));
      let startTime = new BN(currentBlockTime).add(new BN(getSecondInMinute(1)));
      let endTime = startTime.add(new BN(getSecondInMinute(50)));
      let totalRewards = generateTotalRewards();
      let vestDuration = new BN(getSecondInMinute(60));
      let tokenName = 'KNC Generated Token';
      let tokenSymbol = 'KNCG';
      await fairLaunch.setBlockTime(currentBlockTime);
      let pid = await addNewPool(startTime, endTime, vestDuration, totalRewards, tokenName, tokenSymbol);
      amount = precisionUnits.mul(new BN(2));
      await depositAndVerifyData(user1, pid, amount, false, currentBlockTime);
      await depositAndVerifyData(user2, pid, amount, true, currentBlockTime);

      // harvest when not started yet, no reward claimed
      // Note: rewards have not been set to the fairlaunch yet, means it won't revert because reward is 0
      let timeTo = currentBlockTime.add(new BN(getSecondInMinute(1)));
      await fairLaunch.setBlockTime(timeTo);

      await harvestAndVerifyData(user1, pid, timeTo);
      timeTo = startTime.add(new BN(getSecondInMinute(2)));
      await fairLaunch.setBlockTime(timeTo);

      for (let i = 0; i < rewardTokens.length; i++) {
        await transferToken(rewardTokens[i], accounts[0], fairLaunch.address, totalRewards[i].mul(new BN(10)));
      }

      timeTo = startTime.add(new BN(getSecondInMinute(3)));
      await fairLaunch.setBlockTime(timeTo);
      // harvest reward
      await harvestAndVerifyData(user1, pid, timeTo);

      timeTo = startTime.add(new BN(getSecondInMinute(4)));
      await fairLaunch.setBlockTime(timeTo);

      await harvestAndVerifyData(user2, pid, timeTo);
      // harvest user that has not depsited
      await harvestAndVerifyData(user3, pid, timeTo);

      await verifyPendingRewards(pid, [user1, user2, user3], timeTo);

      timeTo = startTime.add(new BN(getSecondInMinute(5)));
      await fairLaunch.setBlockTime(timeTo);
      // deposit and not harvest, then harvest
      await depositAndVerifyData(user1, pid, amount, false, timeTo);
      await harvestAndVerifyData(user1, pid, timeTo);
      // deposit and harvest, then call harvest
      await depositAndVerifyData(user2, pid, amount, true, timeTo);
      await harvestAndVerifyData(user2, pid, timeTo);

      // delay to end
      timeTo = poolInfo[pid].endTime;
      await fairLaunch.setBlockTime(timeTo);

      await harvestAndVerifyData(user1, pid, timeTo);
      await withdrawAndVerifyData(user2, pid, userInfo[user2][pid].amount, true, timeTo);
      await harvestAndVerifyData(user2, pid, timeTo);

      // extra verification
      let poolData = await fairLaunch.getPoolInfo(pid);
      let user1Data = await fairLaunch.getUserInfo(pid, user1);
      let user2Data = await fairLaunch.getUserInfo(pid, user2);

      await Helper.assertEqual(poolInfo[pid].endTime, poolData.lastRewardTime);
      await Helper.assertEqual(user1Data.lastRewardPerShares, poolData.accRewardPerShares);
      await Helper.assertEqual(user2Data.lastRewardPerShares, poolData.accRewardPerShares);
      for (let i = 0; i < rewardTokens.length; i++) {
        await Helper.assertEqual(new BN(0), user2Data.unclaimedRewards[i]);
        await Helper.assertEqual(user1Data.unclaimedRewards[i], new BN(0));
      }
    });

    it('harvest multiple pools in same vesting duration and check rewards', async () => {
      currentBlockTime = new BN(await Helper.getCurrentBlockTime());
      let startTime = new BN(currentBlockTime).add(new BN(getSecondInMinute(10)));
      let endTime = startTime.add(new BN(getSecondInMinute(25)));
      let totalRewards = generateTotalRewards();
      let vestDuration = new BN(getSecondInMinute(60));
      let tokenName = 'KNC Generated Token';
      let tokenSymbol = 'KNCG';

      let timeTo = currentBlockTime;
      await fairLaunch.setBlockTime(timeTo);

      let pid1 = await addNewPool(startTime, endTime, vestDuration, totalRewards, tokenName, tokenSymbol);
      totalRewards = generateTotalRewards();
      vestDuration = new BN(getSecondInMinute(60));
      let pid2 = await addNewPool(
        startTime,
        startTime.add(new BN(getSecondInMinute(20))),
        vestDuration,
        totalRewards,
        tokenName,
        tokenSymbol
      );
      let amount = precisionUnits.mul(new BN(2));

      await depositAndVerifyData(user1, pid1, amount, false, timeTo);
      await depositAndVerifyData(user2, pid1, amount.add(new BN(1)), true, timeTo);

      timeTo = currentBlockTime.add(new BN(getSecondInMinute(1)));
      await fairLaunch.setBlockTime(timeTo);
      amount = precisionUnits;
      await depositAndVerifyData(user1, pid1, amount, false, timeTo);
      await depositAndVerifyData(user2, pid1, amount.add(new BN(100)), true, timeTo);

      // harvest when not started yet, no reward claimed
      // Note: rewards have not been set to the fairlaunch yet, means it won't revert because reward is 0
      await harvestMultiplePoolsAndVerifyData(user1, [pid1, pid2], false, timeTo);

      timeTo = startTime.add(new BN(getSecondInMinute(3)));
      await fairLaunch.setBlockTime(timeTo);

      for (let i = 0; i < rewardTokens.length; i++) {
        await transferToken(rewardTokens[i], accounts[0], fairLaunch.address, totalRewards[i].mul(new BN(100)));
      }

      timeTo = startTime.add(new BN(getSecondInMinute(4)));
      await fairLaunch.setBlockTime(timeTo);

      await harvestMultiplePoolsAndVerifyData(user1, [pid1, pid2], false, timeTo);
      // harvest same pid
      await harvestMultiplePoolsAndVerifyData(user2, [pid1, pid1], false, timeTo);

      timeTo = startTime.add(new BN(getSecondInMinute(5)));
      await fairLaunch.setBlockTime(timeTo);
      await depositAndVerifyData(user1, pid1, amount, false, timeTo);
      await depositAndVerifyData(user2, pid2, amount, false, timeTo);

      timeTo = startTime.add(new BN(getSecondInMinute(6)));
      await fairLaunch.setBlockTime(timeTo);
      await harvestMultiplePoolsAndVerifyData(user1, [pid1], false, timeTo);
      await harvestMultiplePoolsAndVerifyData(user1, [pid2], false, timeTo);
      // harvest same pid
      timeTo = startTime.add(new BN(getSecondInMinute(8)));
      await fairLaunch.setBlockTime(timeTo);
      await harvestMultiplePoolsAndVerifyData(user2, [pid1, pid2], false, timeTo);

      timeTo = poolInfo[pid1].endTime;
      await fairLaunch.setBlockTime(timeTo);

      await harvestMultiplePoolsAndVerifyData(user1, [pid1, pid2], false, timeTo);
      await harvestMultiplePoolsAndVerifyData(user2, [pid1, pid2], false, timeTo);
      // extra verification
      let pids = [pid1, pid2];
      for (let i = 0; i < pids.length; i++) {
        let pid = pids[i];

        let poolData = await fairLaunch.getPoolInfo(pid);
        let user1Data = await fairLaunch.getUserInfo(pid, user1);
        let user2Data = await fairLaunch.getUserInfo(pid, user2);

        await Helper.assertEqual(poolInfo[pid].endTime, poolData.lastRewardTime);
        await Helper.assertEqual(user1Data.lastRewardPerShares, poolData.accRewardPerShares);
        await Helper.assertEqual(user2Data.lastRewardPerShares, poolData.accRewardPerShares);
        for (let i = 0; i < rewardTokens.length; i++) {
          await Helper.assertEqual(new BN(0), user2Data.unclaimedRewards[i]);
          await Helper.assertEqual(user1Data.unclaimedRewards[i], new BN(0));
        }
      }
    });

    it('harvest multiple pools in different vesting duration and check rewards', async () => {
      currentBlockTime = new BN(await Helper.getCurrentBlockTime());
      let startTime = new BN(currentBlockTime).add(new BN(getSecondInMinute(10)));
      let endTime = startTime.add(new BN(getSecondInMinute(22)));
      let totalRewards = generateTotalRewards();
      let vestDuration = new BN(getSecondInMinute(60));
      let tokenName = 'KNC Generated Token';
      let tokenSymbol = 'KNCG';
      let timeTo = currentBlockTime;
      await fairLaunch.setBlockTime(timeTo);

      let pid1 = await addNewPool(startTime, endTime, vestDuration, totalRewards, tokenName, tokenSymbol);
      totalRewards = generateTotalRewards();
      vestDuration = new BN(getSecondInMinute(40));
      tokenName = 'KNC Generated Token X';
      tokenSymbol = 'KNCG X';
      let pid2 = await addNewPool(
        startTime,
        startTime.add(new BN(getSecondInMinute(20))),
        vestDuration,
        totalRewards,
        tokenName,
        tokenSymbol
      );
      let amount = precisionUnits.mul(new BN(2));

      await depositAndVerifyData(user1, pid1, amount, false, timeTo);
      await depositAndVerifyData(user2, pid1, amount.add(new BN(1)), true, timeTo);

      timeTo = currentBlockTime.add(new BN(getSecondInMinute(1)));
      await fairLaunch.setBlockTime(timeTo);
      amount = precisionUnits;
      await depositAndVerifyData(user1, pid1, amount, false, timeTo);
      await depositAndVerifyData(user2, pid1, amount.add(new BN(100)), true, timeTo);

      // harvest when not started yet, no reward claimed
      // Note: rewards have not been set to the fairlaunch yet, means it won't revert because reward is 0
      await harvestMultiplePoolsAndVerifyData(user1, [pid1, pid2], true, timeTo);

      timeTo = startTime.add(new BN(getSecondInMinute(3)));
      await fairLaunch.setBlockTime(timeTo);

      for (let i = 0; i < rewardTokens.length; i++) {
        await transferToken(rewardTokens[i], accounts[0], fairLaunch.address, totalRewards[i].mul(new BN(10)));
      }

      timeTo = startTime.add(new BN(getSecondInMinute(4)));
      await fairLaunch.setBlockTime(timeTo);

      await harvestMultiplePoolsAndVerifyData(user1, [pid1, pid2], true, timeTo);
      // harvest same pid
      await harvestMultiplePoolsAndVerifyData(user2, [pid1, pid1], true, timeTo);

      timeTo = startTime.add(new BN(getSecondInMinute(5)));
      await fairLaunch.setBlockTime(timeTo);

      await depositAndVerifyData(user1, pid1, amount, false, timeTo);
      await depositAndVerifyData(user2, pid2, amount, false, timeTo);

      timeTo = startTime.add(new BN(getSecondInMinute(6)));
      await fairLaunch.setBlockTime(timeTo);

      await harvestMultiplePoolsAndVerifyData(user1, [pid1], true, timeTo);
      await harvestMultiplePoolsAndVerifyData(user1, [pid2], true, timeTo);
      // harvest same pid

      timeTo = startTime.add(new BN(getSecondInMinute(7)));
      await fairLaunch.setBlockTime(timeTo);

      await harvestMultiplePoolsAndVerifyData(user2, [pid1, pid2], true, timeTo);

      timeTo = poolInfo[pid1].endTime;
      await fairLaunch.setBlockTime(timeTo);

      await harvestMultiplePoolsAndVerifyData(user1, [pid1, pid2], true, timeTo);
      await harvestMultiplePoolsAndVerifyData(user2, [pid1, pid2], true, timeTo);

      //   extra verification
      let pids = [pid1, pid2];
      for (let i = 0; i < pids.length; i++) {
        let pid = pids[i];

        let poolData = await fairLaunch.getPoolInfo(pid);
        let user1Data = await fairLaunch.getUserInfo(pid, user1);
        let user2Data = await fairLaunch.getUserInfo(pid, user2);

        await Helper.assertEqual(poolInfo[pid].endTime, poolData.lastRewardTime);
        await Helper.assertEqual(user1Data.lastRewardPerShares, poolData.accRewardPerShares);
        await Helper.assertEqual(user2Data.lastRewardPerShares, poolData.accRewardPerShares);
        for (let i = 0; i < rewardTokens.length; i++) {
          await Helper.assertEqual(new BN(0), user2Data.unclaimedRewards[i]);
          await Helper.assertEqual(user1Data.unclaimedRewards[i], new BN(0));
        }
      }
    });

    it('harvest: exact amount of reward tokens in FairLaunch', async () => {
      currentBlockTime = new BN(await Helper.getCurrentBlockTime());
      let startTime = new BN(currentBlockTime).add(new BN(getSecondInMinute(1)));
      let duration = new BN(getSecondInMinute(6));
      let endTime = startTime.add(duration);
      let totalRewards = generateTotalRewards();
      let vestDuration = new BN(getSecondInMinute(60));
      let tokenName = 'KNC Generated Token';
      let tokenSymbol = 'KNCG';
      let timeTo = currentBlockTime;
      await fairLaunch.setBlockTime(timeTo);
      let pid = await addNewPool(startTime, endTime, vestDuration, totalRewards, tokenName, tokenSymbol);

      let totalAmount = precisionUnits;
      let amount1 = precisionUnits;
      await depositAndVerifyData(user1, pid, amount1, false, timeTo);
      let amount2 = precisionUnits.mul(new BN(2));
      totalAmount = totalAmount.add(amount2);
      await depositAndVerifyData(user2, pid, amount2, true, timeTo);

      // delay to end block
      timeTo = endTime.add(new BN(getSecondInMinute(1)));
      await fairLaunch.setBlockTime(timeTo);

      let user1Rewards = [];
      let user2Rewards = [];
      for (let i = 0; i < rewardTokens.length; i++) {
        let rewardPerSecond = totalRewards[i].mul(new BN(multipliers[i])).div(new BN(duration));
        let rewardPerShare = rewardPerSecond.mul(new BN(duration)).mul(REWARD_PER_SHARE_PRECISION).div(totalAmount);
        user1Rewards.push(rewardPerShare.mul(amount1).div(REWARD_PER_SHARE_PRECISION));
        user2Rewards.push(rewardPerShare.mul(amount2).div(REWARD_PER_SHARE_PRECISION));
      }

      let user1PendingRewards = getUserPendingRewards(user1, pid, timeTo);
      let user2PendingRewards = getUserPendingRewards(user2, pid, timeTo);
      for (let i = 0; i < rewardTokens.length; i++) {
        Helper.assertEqual(user1Rewards[i], user1PendingRewards[i]);
        Helper.assertEqual(user2Rewards[i], user2PendingRewards[i]);
        await transferToken(
          rewardTokens[i],
          accounts[0],
          fairLaunch.address,
          user1Rewards[i].div(new BN(multipliers[i])).add(user2Rewards[i].div(new BN(multipliers[i])))
        );
      }

      timeTo = endTime.add(new BN(getSecondInMinute(2)));
      await fairLaunch.setBlockTime(timeTo);

      await harvestAndVerifyData(user1, pid, timeTo);
      await harvestAndVerifyData(user2, pid, timeTo);
      for (let i = 0; i < rewardTokens.length; i++) {
        Helper.assertEqual(new BN(0), await balanceOf(rewardTokens[i], fairLaunch.address));
      }
    });
  });

  describe('#emergency withdraw', async () => {
    beforeEach('deploy contracts', async () => {
      await deployContracts([kncToken, secondRewardToken]);
    });

    // no reward has been transferred out, since there is no reward in the fairlaunch contract
    it('emergencyWithdraw and check data', async () => {
      currentBlockTime = new BN(await Helper.getCurrentBlockTime());
      let startTime = new BN(currentBlockTime).add(new BN(getSecondInMinute(10)));
      let endTime = startTime.add(new BN(getSecondInMinute(25)));
      let totalRewards = generateTotalRewards();
      let vestDuration = new BN(getSecondInMinute(60));
      let tokenName = 'KNC Generated Token';
      let tokenSymbol = 'KNCG';

      let timeTo = currentBlockTime;
      await fairLaunch.setBlockTime(timeTo);

      let pid1 = await addNewPool(startTime, endTime, vestDuration, totalRewards, tokenName, tokenSymbol);
      totalRewards = generateTotalRewards();
      endTime = startTime.add(new BN(getSecondInMinute(12)));

      timeTo = currentBlockTime.add(new BN(getSecondInMinute(1)));
      await fairLaunch.setBlockTime(timeTo);

      let pid2 = await addNewPool(startTime, endTime, vestDuration, totalRewards, tokenName, tokenSymbol);

      timeTo = currentBlockTime.add(new BN(getSecondInMinute(3)));
      await fairLaunch.setBlockTime(timeTo);

      let amount = precisionUnits.mul(new BN(2));
      await depositAndVerifyData(user1, pid1, amount, false, timeTo);

      timeTo = currentBlockTime.add(new BN(getSecondInMinute(4)));
      await fairLaunch.setBlockTime(timeTo);
      amount = precisionUnits.mul(new BN(5));
      await depositAndVerifyData(user2, pid1, amount, true, timeTo);
      await depositAndVerifyData(user1, pid2, amount, false, timeTo);

      timeTo = currentBlockTime.add(new BN(getSecondInMinute(5)));
      await fairLaunch.setBlockTime(timeTo);
      amount = precisionUnits.mul(new BN(3));
      await depositAndVerifyData(user1, pid2, amount, false, timeTo);

      timeTo = endTime;
      await fairLaunch.setBlockTime(timeTo);

      let users = [user1, user2, user3];
      let pids = [pid1, pid2];
      for (let u = 0; u < users.length; u++) {
        let user = users[u];
        for (let p = 0; p < pids.length; p++) {
          let pid = pids[p];
          let poolTokenBal = await poolInfo[pid].stakeToken.balanceOf(fairLaunch.address);
          let userTokenBal = await poolInfo[pid].stakeToken.balanceOf(user);

          let tx = await fairLaunch.emergencyWithdraw(pid, {from: user});
          expectEvent(tx, 'EmergencyWithdraw', {
            user: user,
            pid: pid,
            timestamp: new BN(timeTo),
            amount: userInfo[user][pid].amount,
          });

          Helper.assertEqual(
            poolTokenBal.sub(userInfo[user][pid].amount),
            await poolInfo[pid].stakeToken.balanceOf(fairLaunch.address)
          );
          Helper.assertEqual(
            userTokenBal.add(userInfo[user][pid].amount),
            await poolInfo[pid].stakeToken.balanceOf(user)
          );

          poolInfo[pid].totalStake.isub(userInfo[user][pid].amount);
          userInfo[user][pid] = emptyUserInfo();

          await verifyUserInfo(user, pid, userInfo[user][pid]);
          await verifyPoolInfo(poolInfo[pid]);
        }
      }
    });
  });

  describe('#admin claim reward', async () => {
    beforeEach('deploy contracts', async () => {
      // a normal token + a native token
      await deployContracts([kncToken, zeroAddress]);
    });

    it('revert not admin', async () => {
      await expectRevert(fairLaunch.adminWithdraw(0, precisionUnits, {from: accounts[0]}), 'only admin');
    });

    it('revert not enough token', async () => {
      await expectRevert.unspecified(fairLaunch.adminWithdraw(0, precisionUnits, {from: admin}));
    });

    it('correct data', async () => {
      for (let i = 0; i < rewardTokens.length; i++) {
        let token = rewardTokens[i];
        await transferToken(token, accounts[0], fairLaunch.address, precisionUnits.mul(new BN(10)));
        let poolBalance = await balanceOf(token, fairLaunch.address);
        let adminBalance = await balanceOf(token, admin);
        let amount = precisionUnits.div(new BN(100));
        await fairLaunch.adminWithdraw(i, amount, {from: admin, gasPrice: new BN(0)});
        Helper.assertEqual(poolBalance.sub(amount), await balanceOf(token, fairLaunch.address));
        Helper.assertEqual(adminBalance.add(amount), await balanceOf(token, admin));
      }
    });
  });

  let numberRuns = 0;
  const UserActions = {
    Deposit: 0,
    Withdraw: 1,
    WithdrawAll: 2,
    Harvest: 3,
  };
  const AdminActions = {
    AddPool: 0,
    UpdatePool: 1,
    RenewPool: 2,
  };
  let users = [];

  if (numberRuns > 0) {
    describe('#running simulation', async () => {
      beforeEach('deploy contracts', async () => {
        await deployContracts([kncToken, zeroAddress]);
        users = [user1, user2, user3, user4];
      });

      it(`simulate with ${numberRuns} runs`, async () => {
        let tokenName = 'KNC Generated Token';
        let tokenSymbol = 'KNCG';
        let poolLength = 0;
        for (let i = 0; i < numberRuns; i++) {
          let isUserAction = Helper.getRandomInt(0, 100) >= 10; // 90% user's actions
          let userAction = Helper.getRandomInt(0, 4);
          let adminAction = Helper.getRandomInt(0, 3);
          currentBlockTime = new BN(await Helper.getCurrentBlockTime());
          if (poolLength == 0 || (!isUserAction && adminAction == AdminActions.AddPool)) {
            let startTime = new BN(currentBlockTime.add(new BN(getSecondInMinute(Helper.getRandomInt(5, 10)))));
            let endTime = startTime.add(new BN(getSecondInMinute(Helper.getRandomInt(5, numberRuns - i + 5))));
            let vestDuration = new BN(getSecondInMinute(Helper.getRandomInt(30, 60)));
            let timeTo = new BN(await Helper.getCurrentBlockTime());
            await fairLaunch.setBlockTime(timeTo);
            let totalRewards = generateTotalRewards();
            if (poolLength == tokens.length) {
              // all tokens have been added, will get duplicated token
              console.log(`Loop ${i}: Expect add pool reverts`);
              await expectRevert(
                fairLaunch.addPool(
                  tokens[i % tokens.length].address,
                  startTime,
                  endTime,
                  vestDuration,
                  totalRewards,
                  tokenName,
                  tokenSymbol,
                  {
                    from: admin,
                  }
                ),
                'add: duplicated pool'
              );
              continue;
            }
            poolLength += 1;
            for (let r = 0; r < rewardTokens.length; r++) {
              await transferToken(rewardTokens[r], accounts[0], fairLaunch.address, totalRewards[r]);
            }
            console.log(
              `Loop ${i}: Add pool ${tokens[poolLength - 1].address} ${startTime.toString(10)} ${endTime.toString(10)}`
            );
            await addNewPool(startTime, endTime, vestDuration, totalRewards, tokenName, tokenSymbol);
          } else if (isUserAction) {
            let user = users[Helper.getRandomInt(0, users.length - 1)];
            let pid = Helper.getRandomInt(0, poolLength - 1);
            if (userAction == UserActions.Deposit) {
              let amount = precisionUnits.mul(new BN(10)).div(new BN(Helper.getRandomInt(1, 20)));
              let isHarvesting = Helper.getRandomInt(0, 100) <= 50;
              console.log(`Loop ${i}: Deposit: ${user} ${pid} ${amount.toString(10)} ${isHarvesting}`);

              let timeTo = new BN(await Helper.getCurrentBlockTime());
              await fairLaunch.setBlockTime(timeTo);
              await depositAndVerifyData(user, pid, amount, isHarvesting, timeTo);
            } else if (userAction == UserActions.Withdraw) {
              let amount = userInfo[user][pid].amount.div(new BN(Helper.getRandomInt(1, 20)));
              console.log(`Loop ${i}: Withdraw: ${user} ${pid} ${amount.toString(10)}`);

              let timeTo = new BN(await Helper.getCurrentBlockTime());
              await fairLaunch.setBlockTime(timeTo);
              await withdrawAndVerifyData(user, pid, amount, false, timeTo);
            } else if (userAction == UserActions.WithdrawAll) {
              console.log(`Loop ${i}: WithdrawAll: ${user} ${pid} ${userInfo[user][pid].amount.toString(10)}`);
              let timeTo = new BN(await Helper.getCurrentBlockTime());
              await fairLaunch.setBlockTime(timeTo);
              await withdrawAndVerifyData(user, pid, userInfo[user][pid].amount, true, timeTo);
            } else {
              let timeTo = new BN(await Helper.getCurrentBlockTime());
              await fairLaunch.setBlockTime(timeTo);
              console.log(`Loop ${i}: Harvest: ${user} ${pid}`);
              await harvestAndVerifyData(user, pid, timeTo);
            }
          } else {
            // admin action
            let totalRewards = generateTotalRewards();
            let pid = Helper.getRandomInt(0, poolLength - 1);
            let vestDuration = new BN(getSecondInMinute(Helper.getRandomInt(30, 60)));
            if (adminAction == AdminActions.UpdatePool) {
              let endTime = new BN(currentBlockTime).add(
                new BN(getSecondInMinute(Helper.getRandomInt(5, numberRuns - i + 5)))
              );

              if (new BN(currentBlockTime + 1).gt(poolInfo[pid].endTime)) {
                let timeTo = new BN(await Helper.getCurrentBlockTime());
                await fairLaunch.setBlockTime(timeTo);
                console.log(`Loop ${i}: Expect update pool reverts`);
                // already ended
                await expectRevert(
                  fairLaunch.updatePool(pid, endTime, vestDuration, totalRewards, {
                    from: admin,
                  }),
                  'update: pool already ended'
                );
              } else {
                console.log(`Loop ${i}: Update pool: ${pid} ${endTime.toString(10)}`);

                let timeTo = new BN(await Helper.getCurrentBlockTime());
                await fairLaunch.setBlockTime(timeTo.add(new BN(getSecondInMinute(3))));

                await fairLaunch.updatePool(pid, endTime, vestDuration, totalRewards, {from: admin});
                currentBlockTime = new BN(await Helper.getCurrentBlockTime());
                poolInfo[pid] = updatePoolReward(poolInfo[pid], currentBlockTime);
                poolInfo[pid].endTime = endTime;
                poolInfo[pid].totalRewards = totalRewards;
                for (let r = 0; r < rewardTokens.length; r++) {
                  await transferToken(rewardTokens[r], accounts[0], fairLaunch.address, totalRewards[r]);
                  let rps = new BN(totalRewards[r])
                    .mul(new BN(multipliers[r]))
                    .div(poolInfo[pid].endTime.sub(poolInfo[pid].startTime));

                  poolInfo[pid].rewardPerSeconds.push(rps);
                }
              }
            } else {
              // renew pool
              let startTime = new BN(currentBlockTime).add(new BN(getSecondInMinute(Helper.getRandomInt(5, 10))));
              let endTime = startTime.add(new BN(getSecondInMinute(Helper.getRandomInt(5, numberRuns - i + 5))));
              let totalRewards = generateTotalRewards();
              if (
                new BN(currentBlockTime + 1).gt(poolInfo[pid].endTime) ||
                new BN(currentBlockTime + 1).lt(poolInfo[pid].startTime)
              ) {
                let timeTo = new BN(await Helper.getCurrentBlockTime());
                await fairLaunch.setBlockTime(timeTo);

                await fairLaunch.renewPool(pid, startTime, endTime, vestDuration, totalRewards, {from: admin});
                console.log(`Loop ${i}: Renew pool: ${pid} ${startTime.toString(10)} ${endTime.toString(10)}`);
                currentBlockTime = await Helper.getCurrentBlockTime();
                poolInfo[pid] = updatePoolInfoOnRenew(
                  poolInfo[pid],
                  startTime,
                  endTime,
                  totalRewards,
                  currentBlockTime,
                  vestDuration
                );
                for (let r = 0; r < rewardTokens.length; r++) {
                  await transferToken(rewardTokens[r], accounts[0], fairLaunch.address, totalRewards[r]);
                }
              } else {
                console.log(`Loop ${i}: Expect renew pool reverts`);
                // // currently active
                await expectRevert(
                  fairLaunch.renewPool(pid, startTime, endBlock, vestDuration, totalRewards, {from: admin}),
                  'renew: invalid pool state to renew'
                );
              }
            }
          }
        }
      });
    });
  }
});
const depositAndVerifyData = async (user, pid, amount, isHarvesting, timestampNow) => {
  let poolData = poolInfo[pid];

  let userBalBefore = await poolData.stakeToken.balanceOf(user);
  let poolBalBefore = await poolData.stakeToken.balanceOf(fairLaunch.address);
  let poolRewardBalances = [];
  let lockerRewardBalances = [];
  for (let i = 0; i < rewardTokens.length; i++) {
    poolRewardBalances.push(await balanceOf(rewardTokens[i], fairLaunch.address));
    lockerRewardBalances.push(await balanceOf(rewardTokens[i], rewardLocker.address));
  }
  let tx = await fairLaunch.deposit(poolData.id, amount, isHarvesting, {from: user});
  expectEvent(tx, 'Deposit', {
    user: user,
    pid: poolData.id,
    timestamp: new BN(timestampNow),
    amount: amount,
  });
  Helper.assertEqual(userBalBefore.sub(amount), await poolData.stakeToken.balanceOf(user));
  Helper.assertEqual(poolBalBefore.add(amount), await poolData.stakeToken.balanceOf(fairLaunch.address));
  let claimedAmounts = [];
  [userInfo[user][pid], poolInfo[pid], claimedAmounts] = updateInfoOnDeposit(
    userInfo[user][pid],
    poolInfo[pid],
    amount,
    new BN(timestampNow),
    isHarvesting
  );

  for (let i = 0; i < claimedAmounts.length; i++) {
    userClaimData[user][i].iadd(claimedAmounts[i]);
  }

  await verifyContractData(tx, user, pid, poolRewardBalances, lockerRewardBalances, claimedAmounts, timestampNow);
};

// check withdraw an amount of token from pool with pid
// if isWithdrawlAll is true -> call withdraw all func, assume amount is the user's deposited amount
const withdrawAndVerifyData = async (user, pid, amount, isWithdrawAll, timestampNow) => {
  let poolData = poolInfo[pid];
  let userBalBefore = await poolData.stakeToken.balanceOf(user);
  let poolBalBefore = await poolData.stakeToken.balanceOf(fairLaunch.address);
  let poolRewardBalances = [];
  let lockerRewardBalances = [];
  for (let i = 0; i < rewardTokens.length; i++) {
    poolRewardBalances.push(await balanceOf(rewardTokens[i], fairLaunch.address));
    lockerRewardBalances.push(await balanceOf(rewardTokens[i], rewardLocker.address));
  }
  let tx;
  if (isWithdrawAll) {
    tx = await fairLaunch.withdrawAll(poolData.id, {from: user});
  } else {
    tx = await fairLaunch.withdraw(poolData.id, amount, {from: user});
  }
  expectEvent(tx, 'Withdraw', {
    user: user,
    pid: poolData.id,
    timestamp: new BN(timestampNow),
    amount: amount,
  });
  Helper.assertEqual(userBalBefore.add(amount), await poolData.stakeToken.balanceOf(user));
  Helper.assertEqual(poolBalBefore.sub(amount), await poolData.stakeToken.balanceOf(fairLaunch.address));
  let claimedAmounts = [];
  [userInfo[user][pid], poolInfo[pid], claimedAmounts] = updateInfoOnWithdraw(
    userInfo[user][pid],
    poolInfo[pid],
    amount,
    new BN(timestampNow)
  );
  for (let i = 0; i < rewardTokens.length; i++) {
    userClaimData[user][i].iadd(claimedAmounts[i]);
  }

  await verifyContractData(tx, user, pid, poolRewardBalances, lockerRewardBalances, claimedAmounts, timestampNow);
};

const harvestMultiplePoolsAndVerifyData = async (user, pids, diffVest, timestampNow) => {
  let poolRewardBalances = [];
  let lockerRewardBalances = [];
  for (let i = 0; i < rewardTokens.length; i++) {
    poolRewardBalances.push(await balanceOf(rewardTokens[i], fairLaunch.address));
    lockerRewardBalances.push(await balanceOf(rewardTokens[i], rewardLocker.address));
  }

  let tx = await fairLaunch.harvestMultiplePools(pids, {from: user});

  let totalClaimedAmounts = [];
  let totalClaimedAmountsDiff = [];
  for (let i = 0; i < rewardTokens.length; i++) {
    totalClaimedAmounts.push(new BN(0));
    totalClaimedAmountsDiff.push(new BN(0));
  }
  for (let i = 0; i < pids.length; i++) {
    let claimedAmounts = [];
    let pid = pids[i];
    [userInfo[user][pid], poolInfo[pid], claimedAmounts] = updateInfoOnHarvest(
      userInfo[user][pid],
      poolInfo[pid],
      new BN(timestampNow)
    );
    for (let j = 0; j < rewardTokens.length; j++) {
      totalClaimedAmounts[j].iadd(claimedAmounts[j]);
      totalClaimedAmountsDiff[j].iadd(claimedAmounts[j].div(multipliers[j]));
    }

    await verifyPoolInfo(poolInfo[pid]);
    await verifyUserInfo(user, pid, userInfo[user][pid]);

    for (let j = 0; j < rewardTokens.length; j++) {
      if (claimedAmounts[j].gt(new BN(0))) {
        expectEvent(tx, 'Harvest', {
          user: user,
          pid: pid,
          timestamp: new BN(timestampNow),
          lockedAmount: claimedAmounts[j].div(multipliers[j]),
        });
        if (diffVest) {
          await expectEvent.inTransaction(tx.tx, rewardTokens[j], 'Transfer', {
            from: fairLaunch.address,
            to: rewardLocker.address,
            value: claimedAmounts[j].div(multipliers[j]),
          });
        }
      }
    }
  }
  for (let i = 0; i < rewardTokens.length; i++) {
    totalClaimedAmounts[i] = totalClaimedAmounts[i].div(multipliers[i]);
    userClaimData[user][i].iadd(diffVest ? totalClaimedAmountsDiff[i] : totalClaimedAmounts[i]);
  }
  for (let i = 0; i < rewardTokens.length; i++) {
    if (totalClaimedAmounts[i].gt(new BN(0)) && rewardTokens[i] != zeroAddress) {
      // expect there is only 1 transfer happens
      if (!diffVest) {
        await expectEvent.inTransaction(tx.tx, rewardTokens[i], 'Transfer', {
          from: fairLaunch.address,
          to: rewardLocker.address,
          value: totalClaimedAmounts[i],
        });
      }
    }
    let rewardAddress = rewardTokens[i] == zeroAddress ? zeroAddress : rewardTokens[i].address;
    Helper.assertEqual(userClaimData[user][i], await rewardLocker.lockedAmounts(user, rewardAddress));
  }

  await verifyRewardData(
    user,
    poolRewardBalances,
    lockerRewardBalances,
    diffVest ? totalClaimedAmountsDiff : totalClaimedAmounts
  );
};

const harvestAndVerifyData = async (user, pid, timestampNow) => {
  let poolRewardBalances = [];
  let lockerRewardBalances = [];
  for (let i = 0; i < rewardTokens.length; i++) {
    poolRewardBalances.push(await balanceOf(rewardTokens[i], fairLaunch.address));
    lockerRewardBalances.push(await balanceOf(rewardTokens[i], rewardLocker.address));
  }

  let tx = await fairLaunch.harvest(pid, {from: user});

  let claimedAmounts = [];
  [userInfo[user][pid], poolInfo[pid], claimedAmounts] = updateInfoOnHarvest(
    userInfo[user][pid],
    poolInfo[pid],
    new BN(timestampNow)
  );
  for (let i = 0; i < rewardTokens.length; i++) {
    claimedAmounts[i] = claimedAmounts[i].div(multipliers[i]);
    userClaimData[user][i].iadd(claimedAmounts[i]);
  }

  await verifyContractData(tx, user, pid, poolRewardBalances, lockerRewardBalances, claimedAmounts, timestampNow);
};

const verifyContractData = async (
  tx,
  user,
  pid,
  poolRewardBalances,
  lockerRewardBalances,
  rewardClaimedAmounts,
  timestampNow
) => {
  for (let i = 0; i < rewardTokens.length; i++) {
    if (rewardClaimedAmounts[i].gt(new BN(0))) {
      expectEvent(tx, 'Harvest', {
        user: user,
        pid: new BN(pid),
        timestamp: new BN(timestampNow),
        lockedAmount: rewardClaimedAmounts[i],
      });
      if (rewardTokens[i] != zeroAddress) {
        await expectEvent.inTransaction(tx.tx, rewardTokens[i], 'Transfer', {
          from: fairLaunch.address,
          to: rewardLocker.address,
          value: rewardClaimedAmounts[i],
        });
      }
    }
  }

  await verifyPoolInfo(poolInfo[pid]);
  await verifyUserInfo(user, pid, userInfo[user][pid]);
  await verifyRewardData(user, poolRewardBalances, lockerRewardBalances, rewardClaimedAmounts);
};

const verifyPoolInfo = async (poolData) => {
  let onchainData = await fairLaunch.getPoolInfo(poolData.id);
  Helper.assertEqualArray(poolData.rewardPerSeconds, onchainData.rewardPerSeconds);
  //   Helper.assertEqual(poolData.rewardPerSeconds[0], new BN(onchainData.rewardPerSeconds[0]));
  //   Helper.assertEqual(poolData.rewardPerSeconds[1], new BN(onchainData.rewardPerSeconds[1]));
  Helper.assertEqualArray(poolData.accRewardPerShares, onchainData.accRewardPerShares);
  //   Helper.assertEqual(poolData.accRewardPerShares[0], new BN(onchainData.accRewardPerShares[0]));
  //   Helper.assertEqual(poolData.accRewardPerShares[1], new BN(onchainData.accRewardPerShares[1]));

  Helper.assertEqual(poolData.totalStake, onchainData.totalStake);
  Helper.assertEqual(poolData.stakeToken.address, onchainData.stakeToken);
  Helper.assertEqual(poolData.startTime, onchainData.startTime);
  Helper.assertEqual(poolData.endTime, onchainData.endTime);
  Helper.assertEqual(poolData.lastRewardTime, onchainData.lastRewardTime);
  Helper.assertEqual(poolData.vestingDuration, onchainData.vestingDuration);
};

const verifyUserInfo = async (user, pid, userData) => {
  let onchainData = await fairLaunch.getUserInfo(pid, user);
  Helper.assertEqual(userData.amount, onchainData.amount);
  Helper.assertEqual(userData.unclaimedRewards, onchainData.unclaimedRewards);
  Helper.assertEqual(userData.lastRewardPerShares, onchainData.lastRewardPerShares);
};

const verifyPendingRewards = async (pid, users, timestampNow) => {
  for (let i = 0; i < users.length; i++) {
    let pendingRewards = getUserPendingRewards(users[i], pid, timestampNow);
    Helper.assertEqualArray(pendingRewards, await fairLaunch.pendingRewards(pid, users[i]));
  }
};

const verifyRewardData = async (user, poolBalances, lockerBalances, rewardAmounts) => {
  for (let i = 0; i < rewardTokens.length; i++) {
    let rewardAddress = rewardTokens[i] == zeroAddress ? zeroAddress : rewardTokens[i].address;
    Helper.assertEqual(poolBalances[i].sub(rewardAmounts[i]), await balanceOf(rewardTokens[i], fairLaunch.address));
    Helper.assertEqual(
      lockerBalances[i].add(rewardAmounts[i]),
      await balanceOf(rewardTokens[i], rewardLocker.address)
    );
    Helper.assertEqual(userClaimData[user][i], await rewardLocker.lockedAmounts(user, rewardAddress));
  }
};

const transferToken = async (token, from, to, amount) => {
  if (token == zeroAddress) {
    await Helper.sendEtherWithPromise(from, to, amount);
  } else {
    await token.transfer(to, amount, {from: from});
  }
};

const balanceOf = async (token, account) => {
  if (token == zeroAddress) {
    return await Helper.getBalancePromise(account);
  }
  return await token.balanceOf(account);
};

function emptyUserInfo() {
  let info = {
    amount: new BN(0),
    unclaimedRewards: [],
    lastRewardPerShares: [],
  };
  for (let i = 0; i < rewardTokens.length; i++) {
    info.unclaimedRewards.push(new BN(0));
    info.lastRewardPerShares.push(new BN(0));
  }
  return info;
}

function generateTotalRewards() {
  let totalRewards = [];
  for (let i = 0; i < rewardTokens.length; i++) {
    let randomNum = rewardTokens[i] == zeroAddress ? Helper.getRandomInt(32, 100) : Helper.getRandomInt(1, 10);
    totalRewards.push(precisionUnits.div(multipliers[i]).mul(new BN(randomNum)));
  }
  return totalRewards;
}

function getUserPendingRewards(user, pid, currentBlockTime) {
  let poolData = updatePoolReward(poolInfo[pid], currentBlockTime);
  let userData = userInfo[user][pid];
  let rewards = [];
  for (let i = 0; i < rewardTokens.length; i++) {
    let newReward = poolData.accRewardPerShares[i]
      .sub(userData.lastRewardPerShares[i])
      .mul(userData.amount)
      .div(REWARD_PER_SHARE_PRECISION);
    rewards.push(newReward.add(userData.unclaimedRewards[i]));
  }
  return rewards;
}

// assume user doesn't harvest
function updateInfoOnDeposit(userData, poolData, amount, currentBlockTime, isHarvesting) {
  poolData = updatePoolReward(poolData, currentBlockTime);
  if (userData.amount.gt(new BN(0))) {
    // first time deposit
    for (let i = 0; i < rewardTokens.length; i++) {
      let newReward = userData.amount.mul(poolData.accRewardPerShares[i].sub(userData.lastRewardPerShares[i]));
      newReward = newReward.div(REWARD_PER_SHARE_PRECISION);
      userData.unclaimedRewards[i] = userData.unclaimedRewards[i].add(newReward);
    }
  }
  userData.amount = userData.amount.add(amount);
  poolData.totalStake = poolData.totalStake.add(amount);
  let claimedAmounts = [];
  for (let i = 0; i < rewardTokens.length; i++) {
    claimedAmounts.push(isHarvesting ? userData.unclaimedRewards[i].div(new BN(multipliers[i])) : new BN(0));
    if (isHarvesting) userData.unclaimedRewards[i] = new BN(0);
    userData.lastRewardPerShares[i] = poolData.accRewardPerShares[i];
  }

  return [userData, poolData, claimedAmounts];
}

function updateInfoOnWithdraw(userData, poolData, amount, currentBlockTime) {
  poolData = updatePoolReward(poolData, currentBlockTime);
  if (userData.amount.gt(new BN(0))) {
    for (let i = 0; i < rewardTokens.length; i++) {
      let newReward = userData.amount.mul(poolData.accRewardPerShares[i].sub(userData.lastRewardPerShares[i]));
      newReward = newReward.div(REWARD_PER_SHARE_PRECISION);
      userData.unclaimedRewards[i] = userData.unclaimedRewards[i].add(newReward);
    }
  }
  let claimedAmounts = [];
  for (let i = 0; i < rewardTokens.length; i++) {
    claimedAmounts.push(userData.unclaimedRewards[i].div(new BN(multipliers[i])));
    userData.unclaimedRewards[i] = new BN(0);
    userData.lastRewardPerShares[i] = poolData.accRewardPerShares[i];
  }
  userData.amount = userData.amount.sub(amount);
  poolData.totalStake = poolData.totalStake.sub(amount);
  return [userData, poolData, claimedAmounts];
}

function updateInfoOnHarvest(userData, poolData, currentBlockTime) {
  poolData = updatePoolReward(poolData, currentBlockTime);
  if (userData.amount.gt(new BN(0))) {
    for (let i = 0; i < rewardTokens.length; i++) {
      let newReward = userData.amount.mul(poolData.accRewardPerShares[i].sub(userData.lastRewardPerShares[i]));
      newReward = newReward.div(REWARD_PER_SHARE_PRECISION);
      userData.unclaimedRewards[i] = userData.unclaimedRewards[i].add(newReward);
    }
  }
  let claimedAmounts = [];
  for (let i = 0; i < rewardTokens.length; i++) {
    claimedAmounts.push(userData.unclaimedRewards[i]);
    userData.unclaimedRewards[i] = new BN(0);
    userData.lastRewardPerShares[i] = poolData.accRewardPerShares[i];
  }

  return [userData, poolData, claimedAmounts];
}

function updatePoolInfoOnRenew(poolData, startTime, endTime, totalRewards, currentBlockTime, vestingDuration) {
  poolData = updatePoolReward(poolData, currentBlockTime);
  poolData.startTime = startTime;
  poolData.endTime = endTime;
  poolData.rewardPerSeconds = [];
  for (let i = 0; i < rewardTokens.length; i++) {
    let rps = new BN(totalRewards[i]).mul(new BN(multipliers[i])).div(endTime.sub(startTime));
    poolData.rewardPerSeconds.push(rps);
  }
  poolData.totalRewards = totalRewards;
  poolData.lastRewardTime = startTime;
  poolData.vestingDuration = vestingDuration;
  return poolData;
}

function updatePoolReward(poolData, currentBlockTime) {
  let lastAccountedBlockTime = new BN(currentBlockTime);
  if (lastAccountedBlockTime.gt(poolData.endTime)) {
    lastAccountedBlockTime = poolData.endTime;
  }
  if (poolData.startTime.gt(lastAccountedBlockTime)) {
    return poolData;
  }
  if (poolData.lastRewardTime.gt(lastAccountedBlockTime)) return poolData;
  if (poolData.totalStake.eq(new BN(0))) {
    poolData.lastRewardTime = lastAccountedBlockTime;
    return poolData;
  }
  let numSeconds = lastAccountedBlockTime.sub(poolData.lastRewardTime);
  for (let i = 0; i < rewardTokens.length; i++) {
    let newReward = numSeconds.mul(poolData.rewardPerSeconds[i]);
    let increaseRewardPerShare = newReward.mul(REWARD_PER_SHARE_PRECISION).div(poolData.totalStake);
    poolData.accRewardPerShares[i] = poolData.accRewardPerShares[i].add(increaseRewardPerShare);
  }
  poolData.lastRewardTime = lastAccountedBlockTime;
  return poolData;
}

function getSecondInMinute(minute) {
  return minute * 60;
}

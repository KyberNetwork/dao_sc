const {expectEvent, expectRevert} = require('@openzeppelin/test-helpers');
const BN = web3.utils.BN;

const Token = artifacts.require('KyberNetworkTokenV2.sol');
const KyberFairLaunch = artifacts.require('KyberFairLaunchV2.sol');
const SimpleMockRewardLocker = artifacts.require('SimpleMockRewardLockerV2.sol');

const Helper = require('../helper.js');
const {precisionUnits, zeroAddress} = require('../helper.js');
const REWARD_PER_SHARE_PRECISION = new BN(10).pow(new BN(12));

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

let currentBlockTime;

contract('KyberFairLaunchV2', function (accounts) {
  before('Global setup', async () => {
    admin = accounts[1];
    kncToken = await Token.new();
    secondRewardToken = await Token.new();
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
    for (let i = 0; i < rewardTokens.length; i++) {
      if (rewardTokens[i] == zeroAddress) {
        addresses.push(zeroAddress);
      } else {
        addresses.push(rewardTokens[i].address);
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

  const addNewPool = async (startTime, endTime, vestingDuration, rewardPerSeconds, name, symbol) => {
    let tokenId = await fairLaunch.poolLength();
    let stakeToken = tokens[tokenId];
    await fairLaunch.addPool(stakeToken.address, startTime, endTime, vestingDuration, rewardPerSeconds, name, symbol, {
      from: admin,
    });
    let pid = (await fairLaunch.poolLength()).sub(new BN(1));
    poolInfo[pid] = {
      id: (await fairLaunch.poolLength()).sub(new BN(1)),
      stakeToken: stakeToken,
      startTime: startTime,
      endTime: endTime,
      vestingDuration: vestingDuration,
      rewardPerSeconds: rewardPerSeconds,
      lastRewardTime: startTime,
      accRewardPerShares: [],
      totalStake: new BN(0),
      tokenName: name,
      tokenSymbol: symbol,
    };
    for (let i = 0; i < rewardTokens.length; i++) {
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
      let rewardPerSeconds = [precisionUnits, precisionUnits];
      // start in the past
      await expectRevert(
        fairLaunch.addPool(
          tokens[0].address,
          new BN(currentBlockTime),
          endTime,
          vestDuration,
          rewardPerSeconds,
          tokenName,
          tokenSymbol,
          {from: admin}
        ),
        'add: invalid times'
      );
      currentBlockTime = await Helper.getCurrentBlockTime();

      // end times <= start times
      await expectRevert(
        fairLaunch.addPool(
          tokens[0].address,
          endTime,
          endTime,
          vestDuration,
          rewardPerSeconds,
          tokenName,
          tokenSymbol,
          {from: admin}
        ),
        'add: invalid times'
      );
      currentBlockTime = await Helper.getCurrentBlockTime();
      await fairLaunch.addPool(
        tokens[0].address,
        new BN(currentBlockTime + getSecondInMinute(1)),
        new BN(currentBlockTime + getSecondInMinute(10)),
        vestDuration,
        rewardPerSeconds,
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
      let rewardPerSeconds = [precisionUnits, precisionUnits];
      await fairLaunch.addPool(
        tokens[0].address,
        startTime,
        endTime,
        vestDuration,
        rewardPerSeconds,
        tokenName,
        tokenSymbol,
        {from: admin}
      );
      await expectRevert(
        fairLaunch.addPool(
          tokens[0].address,
          startTime,
          endTime,
          vestDuration,
          rewardPerSeconds,
          tokenName,
          tokenSymbol,
          {from: admin}
        ),
        'add: duplicated pool'
      );
    });

    it('correct data and events', async () => {
      let poolLength = 0;
      Helper.assertEqual(poolLength, await fairLaunch.poolLength());
      for (let i = 0; i < 5; i++) {
        let stakeToken = tokens[i].address;
        currentBlockTime = await Helper.getCurrentBlockTime();
        let startTime = new BN(currentBlockTime).add(new BN(getSecondInMinute(1)));
        let endTime = startTime.add(new BN(getSecondInMinute(10)));
        let vestDuration = new BN(getSecondInMinute(60));
        let tokenName = 'KNC Generated Token';
        let tokenSymbol = 'KNCG';
        let rewardPerSeconds = generateRewardPerSeconds();
        let tx = await fairLaunch.addPool(
          stakeToken,
          startTime,
          endTime,
          vestDuration,
          rewardPerSeconds,
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
          rewardPerSeconds: rewardPerSeconds,
          lastRewardTime: startTime,
          accRewardPerShares: [],
          totalStake: new BN(0),
        };
        for (let j = 0; j < rewardTokens.length; j++) {
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
      let rewardPerSeconds = [precisionUnits, precisionUnits];
      let tokenName = 'KNC Generated Token';
      let tokenSymbol = 'KNCG';
      await fairLaunch.addPool(
        tokens[0].address,
        startTime,
        endTime,
        vestDuration,
        rewardPerSeconds,
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
      let rewardPerSeconds = [precisionUnits, precisionUnits];
      let tokenName = 'KNC Generated Token';
      let tokenSymbol = 'KNCG';
      await fairLaunch.addPool(
        tokens[0].address,
        startTime,
        endTime,
        vestDuration,
        rewardPerSeconds,
        tokenName,
        tokenSymbol,
        {from: admin}
      );
      await Helper.setNextBlockTimestamp(endTime);

      await expectRevert(
        fairLaunch.updatePool(0, endTime, vestDuration, rewardPerSeconds, {from: admin}),
        'update: pool already ended'
      );
    });

    it('revert invalid time', async () => {
      currentBlockTime = await Helper.getCurrentBlockTime();
      let startTime = new BN(currentBlockTime).add(new BN(getSecondInMinute(1)));
      let endTime = startTime.add(new BN(getSecondInMinute(2)));
      let vestDuration = new BN(getSecondInMinute(60));
      let rewardPerSeconds = [precisionUnits, precisionUnits];
      let tokenName = 'KNC Generated Token';
      let tokenSymbol = 'KNCG';
      await fairLaunch.addPool(
        tokens[0].address,
        startTime,
        endTime,
        vestDuration,
        rewardPerSeconds,
        tokenName,
        tokenSymbol,
        {from: admin}
      );
      // end time <= start time
      await expectRevert(
        fairLaunch.updatePool(0, startTime, vestDuration, rewardPerSeconds, {from: admin}),
        'update: invalid end time'
      );
      await expectRevert(
        fairLaunch.updatePool(0, startTime.sub(new BN(getSecondInMinute(1))), vestDuration, rewardPerSeconds, {
          from: admin,
        }),
        'update: invalid end time'
      );

      // end time <= current time
      await Helper.setNextBlockTimestamp(startTime);
      currentBlockTime = await Helper.getCurrentBlockTime();

      // next tx is executed at currenttime + 1
      await expectRevert(
        fairLaunch.updatePool(0, new BN(currentBlockTime).add(new BN(1)), vestDuration, rewardPerSeconds, {
          from: admin,
        }),
        'update: invalid end time'
      );
      currentBlockTime = await Helper.getCurrentBlockTime();
      await expectRevert(
        fairLaunch.updatePool(0, new BN(currentBlockTime), vestDuration, rewardPerSeconds, {from: admin}),
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
      let rewardPerSeconds = generateRewardPerSeconds();
      let pid = await addNewPool(startTime, endTime, vestDuration, rewardPerSeconds, tokenName, tokenSymbol);
      await verifyPoolInfo(poolInfo[pid]);

      for (let i = 0; i < rewardTokens.length; i++) {
        await transferToken(rewardTokens[i], accounts[0], fairLaunch.address, precisionUnits.mul(new BN(200)));
      }

      // update pool before it starts
      endTime = startTime.add(new BN(getSecondInMinute(3)));
      rewardPerSeconds = generateRewardPerSeconds();
      vestDuration = new BN(getSecondInMinute(10));
      let tx = await fairLaunch.updatePool(pid, endTime, vestDuration, rewardPerSeconds, {from: admin});
      expectEvent(tx, 'UpdatePool', {
        pid: pid,
        endTime: endTime,
        vestingDuration: vestDuration,
      });

      currentBlockTime = await Helper.getCurrentBlockTime();
      // not yet started, no need to call update pool rewards
      // poolInfo[pid] = updatePoolReward(poolInfo[pid], currentBlock);
      poolInfo[pid].endTime = endTime;
      poolInfo[pid].rewardPerSeconds = rewardPerSeconds;
      poolInfo[pid].vestingDuration = vestDuration;
      await verifyPoolInfo(poolInfo[pid]);

      let amount = precisionUnits.mul(new BN(2));
      await depositAndVerifyData(user1, pid, amount, false);
      amount = precisionUnits.mul(new BN(2));
      await depositAndVerifyData(user2, pid, amount, true);

      await Helper.setNextBlockTimestamp(poolInfo[pid].startTime);
      await harvestAndVerifyData(user1, pid);

      // change reward per seconds
      rewardPerSeconds = generateRewardPerSeconds();
      await fairLaunch.updatePool(pid, endTime, vestDuration, rewardPerSeconds, {from: admin});
      currentBlockTime = await Helper.getCurrentBlockTime();
      poolInfo[pid] = updatePoolReward(poolInfo[pid], currentBlockTime);
      poolInfo[pid].rewardPerSeconds = rewardPerSeconds;
      await verifyPoolInfo(poolInfo[pid]);

      await harvestAndVerifyData(user1, pid);
      await harvestAndVerifyData(user2, pid);

      await withdrawAndVerifyData(user1, pid, amount.div(new BN(10)), false);

      // change reward per seconds
      rewardPerSeconds = generateRewardPerSeconds();
      await fairLaunch.updatePool(pid, endTime, vestDuration, rewardPerSeconds, {from: admin});
      currentBlockTime = await Helper.getCurrentBlockTime();
      poolInfo[pid] = updatePoolReward(poolInfo[pid], currentBlockTime);
      poolInfo[pid].rewardPerSeconds = rewardPerSeconds;
      await verifyPoolInfo(poolInfo[pid]);

      await depositAndVerifyData(user1, pid, amount, true);
      await depositAndVerifyData(user2, pid, amount, true);
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
      let rewardPerSeconds = [precisionUnits, precisionUnits];
      await fairLaunch.addPool(
        tokens[0].address,
        startTime,
        endTime,
        vestDuration,
        rewardPerSeconds,
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
      let rewardPerSeconds = [precisionUnits, precisionUnits];

      await fairLaunch.addPool(
        tokens[0].address,
        startTime,
        endTime,
        vestDuration,
        rewardPerSeconds,
        tokenName,
        tokenSymbol,
        {from: admin}
      );

      await Helper.setNextBlockTimestamp(startTime);

      await expectRevert(
        fairLaunch.renewPool(0, startTime, endTime, vestDuration, rewardPerSeconds, {from: admin}),
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
      let rewardPerSeconds = [precisionUnits, precisionUnits];
      await fairLaunch.addPool(
        tokens[0].address,
        startTime,
        endTime,
        vestDuration,
        rewardPerSeconds,
        tokenName,
        tokenSymbol,
        {from: admin}
      );
      currentBlockTime = await Helper.getCurrentBlockTime();
      await expectRevert(
        fairLaunch.renewPool(
          0,
          currentBlockTime,
          new BN(currentBlockTime).add(new BN(getSecondInMinute(10))),
          vestDuration,
          rewardPerSeconds,
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
          rewardPerSeconds,
          {from: admin}
        ),
        'renew: invalid times'
      );
    });

    it('correct data and events', async () => {
      currentBlockTime = await Helper.getCurrentBlockTime();
      let startTime = new BN(currentBlockTime).add(new BN(getSecondInMinute(1)));
      let endTime = startTime.add(new BN(getSecondInMinute(2)));
      let rewardPerSeconds = generateRewardPerSeconds();
      let vestDuration = new BN(getSecondInMinute(60));
      let tokenName = 'KNC Generated Token';
      let tokenSymbol = 'KNCG';
      let pid = await addNewPool(startTime, endTime, vestDuration, rewardPerSeconds, tokenName, tokenSymbol);
      await verifyPoolInfo(poolInfo[pid]);

      for (let i = 0; i < rewardTokens.length; i++) {
        await transferToken(rewardTokens[i], accounts[0], fairLaunch.address, precisionUnits.mul(new BN(200)));
      }

      let amount = precisionUnits.mul(new BN(10));
      await depositAndVerifyData(user1, pid, amount, true);
      amount = precisionUnits.mul(new BN(2));
      await depositAndVerifyData(user2, pid, amount, true);

      // renew when it has not started
      currentBlockTime = await Helper.getCurrentBlockTime();
      startTime = new BN(currentBlockTime).add(new BN(getSecondInMinute(2)));
      endTime = startTime.add(new BN(getSecondInMinute(3)));
      rewardPerSeconds = generateRewardPerSeconds();
      vestDuration = new BN(getSecondInMinute(10));

      let tx = await fairLaunch.renewPool(pid, startTime, endTime, vestDuration, rewardPerSeconds, {from: admin});
      expectEvent(tx, 'RenewPool', {
        pid: pid,
        startTime: startTime,
        endTime: endTime,
        vestingDuration: vestDuration,
      });
      currentBlockTime = await Helper.getCurrentBlockTime();
      poolInfo[pid] = updatePoolInfoOnRenew(
        poolInfo[pid],
        startTime,
        endTime,
        rewardPerSeconds,
        currentBlockTime,
        vestDuration
      );
      await verifyPoolInfo(poolInfo[pid]);
      await verifyUserInfo(user1, pid, userInfo[user1][pid]);
      await verifyUserInfo(user2, pid, userInfo[user2][pid]);
      await verifyPendingRewards(pid, [user1, user2, user3]);

      await Helper.setNextBlockTimestamp(poolInfo[pid].endTime);

      // record pending rewards after the pool has ended
      let user1PendingRewards = await fairLaunch.pendingRewards(pid, user1);
      let user2PendingRewards = await fairLaunch.pendingRewards(pid, user2);

      currentBlockTime = await Helper.getCurrentBlockTime();
      startTime = new BN(currentBlockTime).add(new BN(getSecondInMinute(2)));
      endTime = startTime.add(new BN(getSecondInMinute(3)));
      rewardPerSeconds = generateRewardPerSeconds();
      vestDuration = new BN(getSecondInMinute(20));

      tx = await fairLaunch.renewPool(pid, startTime, endTime, vestDuration, rewardPerSeconds, {from: admin});
      expectEvent(tx, 'RenewPool', {
        pid: pid,
        startTime: startTime,
        endTime: endTime,
        vestingDuration: vestDuration,
      });
      currentBlockTime = await Helper.getCurrentBlockTime();
      poolInfo[pid] = updatePoolInfoOnRenew(
        poolInfo[pid],
        startTime,
        endTime,
        rewardPerSeconds,
        currentBlockTime,
        vestDuration
      );
      await verifyPoolInfo(poolInfo[pid]);
      // user data shouldn't be changed
      await verifyUserInfo(user1, pid, userInfo[user1][pid]);
      await verifyUserInfo(user2, pid, userInfo[user2][pid]);
      await verifyPendingRewards(pid, [user1, user2, user3]);

      // deposit without claim
      await depositAndVerifyData(user1, pid, amount, false);
      await depositAndVerifyData(user2, pid, amount, false);
      // make deposit for user3 & user4, where amounts are the same as user1 & user2
      await depositAndVerifyData(user3, pid, userInfo[user1][pid].amount, true);
      await depositAndVerifyData(user4, pid, userInfo[user2][pid].amount, true);

      // pending reward shouldn't changed
      Helper.assertEqualArray(user1PendingRewards, await fairLaunch.pendingRewards(pid, user1));
      Helper.assertEqualArray(user2PendingRewards, await fairLaunch.pendingRewards(pid, user2));

      // harvest for user 1
      await harvestAndVerifyData(user1, pid);
      Helper.assertEqual(new BN(0), await fairLaunch.pendingRewards(pid, user1));

      // delay to start of the pool
      await Helper.setNextBlockTimestamp(poolInfo[pid].startTime.add(new BN(getSecondInMinute(5))));

      // now both users should start accumulating new rewards
      Helper.assertGreater(await fairLaunch.pendingRewards(pid, user1), new BN(0));
      // since user1's amount == user3's amount, reward should be the same
      Helper.assertEqual(await fairLaunch.pendingRewards(pid, user1), await fairLaunch.pendingRewards(pid, user3));
      // user4's amount = user2's amount, new reward should be the same
      let pendingRewards = await fairLaunch.pendingRewards(pid, user4);
      for (let i = 0; i < rewardTokens.length; i++) {
        user2PendingRewards[i] = user2PendingRewards[i].add(pendingRewards[i]);
      }
      Helper.assertEqualArray(await fairLaunch.pendingRewards(pid, user2), user2PendingRewards);

      // check if withdrawable full amount from previous deposited
      await withdrawAndVerifyData(user1, pid, userInfo[user1][pid].amount, false);
      await withdrawAndVerifyData(user2, pid, userInfo[user2][pid].amount, true);
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
      let rewardPerSeconds = [precisionUnits, precisionUnits];
      let vestDuration = new BN(getSecondInMinute(60));
      let tokenName = 'KNC Generated Token';
      let tokenSymbol = 'KNCG';
      let pid = await addNewPool(
        currentBlockTime.add(new BN(getSecondInMinute(1))),
        currentBlockTime.add(new BN(getSecondInMinute(2))),
        vestDuration,
        rewardPerSeconds,
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
      let rewardPerSeconds = [precisionUnits, precisionUnits];
      let vestDuration = new BN(getSecondInMinute(60));
      let tokenName = 'KNC Generated Token';
      let tokenSymbol = 'KNCG';
      let pid = await addNewPool(
        currentBlockTime.add(new BN(getSecondInMinute(1))),
        currentBlockTime.add(new BN(getSecondInMinute(5))),
        vestDuration,
        rewardPerSeconds,
        tokenName,
        tokenSymbol
      );
      await fairLaunch.deposit(pid, precisionUnits, false, {from: user1});
      await Helper.setNextBlockTimestamp(poolInfo[pid].startTime.add(new BN(getSecondInMinute(1))));

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
      let rewardPerSeconds = [precisionUnits, precisionUnits];
      let vestDuration = new BN(getSecondInMinute(60));
      let tokenName = 'KNC Generated Token';
      let tokenSymbol = 'KNCG';
      let pid = await addNewPool(startTime, endTime, vestDuration, rewardPerSeconds, tokenName, tokenSymbol);
      let amount = precisionUnits.mul(new BN(2));

      await depositAndVerifyData(user1, pid, amount, false);

      amount = precisionUnits.mul(new BN(2));

      await depositAndVerifyData(user2, pid, amount, true);
      await Helper.setNextBlockTimestamp(poolInfo[pid].startTime);
      await verifyPendingRewards(pid, [user1, user2, user3]);
      await Helper.increaseNextBlockTimestamp(getSecondInMinute(2));
      await verifyPendingRewards(pid, [user1, user2, user3]);
      // should have acc some rewards alr
      let pendinRewards = await fairLaunch.pendingRewards(pid, user1);
      for (let i = 0; i < rewardTokens.length; i++) {
        await Helper.assertGreater(pendinRewards[i], new BN(0));
      }
      pendinRewards = await fairLaunch.pendingRewards(pid, user3);
      for (let i = 0; i < rewardTokens.length; i++) {
        await Helper.assertEqual(pendinRewards[i], new BN(0));
      }

      // deposit without harvesting
      amount = precisionUnits.mul(new BN(5));
      await depositAndVerifyData(user1, pid, amount, false);
      await Helper.increaseNextBlockTimestamp(getSecondInMinute(2));

      for (let i = 0; i < rewardTokens.length; i++) {
        let amount = rewardPerSeconds[i].mul(endTime.sub(startTime)).mul(new BN(10));
        await transferToken(rewardTokens[i], accounts[0], fairLaunch.address, amount);
      }

      amount = precisionUnits.mul(new BN(2));

      // deposit with harvesting
      await depositAndVerifyData(user2, pid, amount, true);
      await depositAndVerifyData(user1, pid, amount, true);

      // deposit when reward has been ended
      await Helper.setNextBlockTimestamp(poolInfo[pid].endTime);

      await depositAndVerifyData(user1, pid, amount, false);
      await depositAndVerifyData(user2, pid, amount, true);

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

      await depositAndVerifyData(user1, pid, new BN(0), true);
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
      let rewardPerSeconds = [precisionUnits, precisionUnits.div(new BN(3))];
      let vestDuration = new BN(getSecondInMinute(60));
      let tokenName = 'KNC Generated Token';
      let tokenSymbol = 'KNCG';
      let pid = await addNewPool(startTime, endTime, vestDuration, rewardPerSeconds, tokenName, tokenSymbol);

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
      let startTime = new BN(currentBlockTime).add(new BN(getSecondInMinute(1)));
      let endTime = startTime.add(new BN(getSecondInMinute(50)));
      let rewardPerSeconds = [precisionUnits, precisionUnits.div(new BN(3))];
      let vestDuration = new BN(getSecondInMinute(60));
      let tokenName = 'KNC Generated Token';
      let tokenSymbol = 'KNCG';
      let pid = await addNewPool(startTime, endTime, vestDuration, rewardPerSeconds, tokenName, tokenSymbol);
      await fairLaunch.deposit(pid, precisionUnits, false, {from: user1});
      await Helper.setNextBlockTimestamp(poolInfo[pid].startTime);
      await expectRevert.unspecified(fairLaunch.withdraw(pid, precisionUnits, {from: user1}));
      await expectRevert.unspecified(fairLaunch.withdrawAll(pid, {from: user1}));
      for (let i = 0; i < rewardTokens.length; i++) {
        let amount = rewardPerSeconds[i].mul(endTime.sub(startTime)).mul(new BN(10));
        await transferToken(rewardTokens[i], accounts[0], fairLaunch.address, amount);
      }
      await fairLaunch.withdraw(pid, precisionUnits.div(new BN(2)), {from: user1});
      await fairLaunch.withdrawAll(pid, {from: user1});
    });
    it('withdraw and check rewards', async () => {
      currentBlockTime = new BN(await Helper.getCurrentBlockTime());
      let startTime = new BN(currentBlockTime).add(new BN(getSecondInMinute(1)));
      let endTime = startTime.add(new BN(getSecondInMinute(50)));
      let rewardPerSeconds = [precisionUnits, precisionUnits.div(new BN(3))];
      let vestDuration = new BN(getSecondInMinute(60));
      let tokenName = 'KNC Generated Token';
      let tokenSymbol = 'KNCG';
      let pid = await addNewPool(startTime, endTime, vestDuration, rewardPerSeconds, tokenName, tokenSymbol);
      let amount = precisionUnits.mul(new BN(2));
      await depositAndVerifyData(user1, pid, amount, false);
      await depositAndVerifyData(user2, pid, amount, true);
      // withdraw when not started yet, no reward claimed
      // Note: rewards have not been set to the fairlaunch yet, means it won't revert because reward is 0
      amount = precisionUnits.div(new BN(10));
      await withdrawAndVerifyData(user1, pid, amount, false);
      await Helper.setNextBlockTimestamp(poolInfo[pid].startTime.add(new BN(getSecondInMinute(1))));

      for (let i = 0; i < rewardTokens.length; i++) {
        let amount = rewardPerSeconds[i].mul(endTime.sub(startTime)).mul(new BN(10));
        await transferToken(rewardTokens[i], accounts[0], fairLaunch.address, amount);
      }
      // withdraw and harvest rewards
      amount = precisionUnits.div(new BN(5));
      await withdrawAndVerifyData(user1, pid, amount, false);
      await Helper.increaseNextBlockTimestamp(getSecondInMinute(2));
      //   await Helper.increaseBlockNumber(2);
      amount = precisionUnits.div(new BN(2));
      await withdrawAndVerifyData(user2, pid, amount, false);
      await verifyPendingRewards(pid, [user1, user2, user3]);
      // withdraw when reward has been ended
      await Helper.setNextBlockTimestamp(poolInfo[pid].endTime);

      await withdrawAndVerifyData(user1, pid, amount, false);
      await withdrawAndVerifyData(user2, pid, amount, false);
      // withdraw all
      await withdrawAndVerifyData(user1, pid, userInfo[user1][pid].amount, true);
      await withdrawAndVerifyData(user2, pid, userInfo[user2][pid].amount, true);
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
      let rewardPerSeconds = [precisionUnits, precisionUnits.div(new BN(3))];
      let vestDuration = new BN(getSecondInMinute(60));
      let tokenName = 'KNC Generated Token';
      let tokenSymbol = 'KNCG';
      let pid = await addNewPool(startTime, endTime, vestDuration, rewardPerSeconds, tokenName, tokenSymbol);
      await fairLaunch.deposit(pid, precisionUnits, false, {from: user1});
      await Helper.setNextBlockTimestamp(poolInfo[pid].startTime);

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
      let rewardPerSeconds = generateRewardPerSeconds();
      let vestDuration = new BN(getSecondInMinute(60));
      let tokenName = 'KNC Generated Token';
      let tokenSymbol = 'KNCG';
      let pid = await addNewPool(startTime, endTime, vestDuration, rewardPerSeconds, tokenName, tokenSymbol);

      amount = precisionUnits.mul(new BN(2));
      await depositAndVerifyData(user1, pid, amount, false);
      await depositAndVerifyData(user2, pid, amount, true);

      // harvest when not started yet, no reward claimed
      // Note: rewards have not been set to the fairlaunch yet, means it won't revert because reward is 0
      await harvestAndVerifyData(user1, pid);
      await Helper.setNextBlockTimestamp(startTime.add(new BN(getSecondInMinute(2))));

      for (let i = 0; i < rewardTokens.length; i++) {
        let amount = rewardPerSeconds[i].mul(endTime.sub(startTime)).mul(new BN(10));
        await transferToken(rewardTokens[i], accounts[0], fairLaunch.address, amount);
      }

      // harvest reward
      await harvestAndVerifyData(user1, pid);
      await Helper.increaseNextBlockTimestamp(getSecondInMinute(2));

      await harvestAndVerifyData(user2, pid);
      // harvest user that has not depsited
      await harvestAndVerifyData(user3, pid);

      await verifyPendingRewards(pid, [user1, user2, user3]);

      // deposit and not harvest, then harvest
      await depositAndVerifyData(user1, pid, amount, false);
      await harvestAndVerifyData(user1, pid);
      // deposit and harvest, then call harvest
      await depositAndVerifyData(user2, pid, amount, true);
      await harvestAndVerifyData(user2, pid);

      // delay to end
      await Helper.setNextBlockTimestamp(poolInfo[pid].endTime);

      await harvestAndVerifyData(user1, pid);
      await withdrawAndVerifyData(user2, pid, userInfo[user2][pid].amount, true);
      await harvestAndVerifyData(user2, pid);

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
      let endTime = startTime.add(new BN(getSecondInMinute(22)));
      let rewardPerSeconds = generateRewardPerSeconds();
      let vestDuration = new BN(getSecondInMinute(60));
      let tokenName = 'KNC Generated Token';
      let tokenSymbol = 'KNCG';
      let pid1 = await addNewPool(startTime, endTime, vestDuration, rewardPerSeconds, tokenName, tokenSymbol);
      rewardPerSeconds = generateRewardPerSeconds();
      vestDuration = new BN(getSecondInMinute(60));
      let pid2 = await addNewPool(
        startTime,
        startTime.add(new BN(getSecondInMinute(20))),
        vestDuration,
        rewardPerSeconds,
        tokenName,
        tokenSymbol
      );
      let amount = precisionUnits.mul(new BN(2));

      await depositAndVerifyData(user1, pid1, amount, false);
      await depositAndVerifyData(user2, pid1, amount.add(new BN(1)), true);

      amount = precisionUnits;
      await depositAndVerifyData(user1, pid1, amount, false);
      await depositAndVerifyData(user2, pid1, amount.add(new BN(100)), true);

      // harvest when not started yet, no reward claimed
      // Note: rewards have not been set to the fairlaunch yet, means it won't revert because reward is 0
      await harvestMultiplePoolsAndVerifyData(user1, [pid1, pid2], false);
      await Helper.setNextBlockTimestamp(startTime.add(new BN(getSecondInMinute(2))));

      for (let i = 0; i < rewardTokens.length; i++) {
        let amount = rewardPerSeconds[i].mul(endTime.sub(startTime)).mul(new BN(10));
        await transferToken(rewardTokens[i], accounts[0], fairLaunch.address, amount);
      }

      await harvestMultiplePoolsAndVerifyData(user1, [pid1, pid2], false);
      // harvest same pid
      await harvestMultiplePoolsAndVerifyData(user2, [pid1, pid1], false);

      await depositAndVerifyData(user1, pid1, amount, false);
      await depositAndVerifyData(user2, pid2, amount, false);

      await harvestMultiplePoolsAndVerifyData(user1, [pid1], false);
      await harvestMultiplePoolsAndVerifyData(user1, [pid2], false);
      // harvest same pid
      await harvestMultiplePoolsAndVerifyData(user2, [pid1, pid2], false);

      await Helper.setNextBlockTimestamp(poolInfo[pid1].endTime);

      await harvestMultiplePoolsAndVerifyData(user1, [pid1, pid2], false);
      await harvestMultiplePoolsAndVerifyData(user2, [pid1, pid2], false);
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
      let rewardPerSeconds = generateRewardPerSeconds();
      let vestDuration = new BN(getSecondInMinute(60));
      let tokenName = 'KNC Generated Token';
      let tokenSymbol = 'KNCG';
      let pid1 = await addNewPool(startTime, endTime, vestDuration, rewardPerSeconds, tokenName, tokenSymbol);
      rewardPerSeconds = generateRewardPerSeconds();
      vestDuration = new BN(getSecondInMinute(40));
      tokenName = 'KNC Generated Token X';
      tokenSymbol = 'KNCG X';
      let pid2 = await addNewPool(
        startTime,
        startTime.add(new BN(getSecondInMinute(20))),
        vestDuration,
        rewardPerSeconds,
        tokenName,
        tokenSymbol
      );
      let amount = precisionUnits.mul(new BN(2));

      await depositAndVerifyData(user1, pid1, amount, false);
      await depositAndVerifyData(user2, pid1, amount.add(new BN(1)), true);

      amount = precisionUnits;
      await depositAndVerifyData(user1, pid1, amount, false);
      await depositAndVerifyData(user2, pid1, amount.add(new BN(100)), true);

      // harvest when not started yet, no reward claimed
      // Note: rewards have not been set to the fairlaunch yet, means it won't revert because reward is 0
      await harvestMultiplePoolsAndVerifyData(user1, [pid1, pid2], true);
      await Helper.setNextBlockTimestamp(startTime.add(new BN(getSecondInMinute(2))));

      for (let i = 0; i < rewardTokens.length; i++) {
        let amount = rewardPerSeconds[i].mul(endTime.sub(startTime)).mul(new BN(10));
        await transferToken(rewardTokens[i], accounts[0], fairLaunch.address, amount);
      }

      await harvestMultiplePoolsAndVerifyData(user1, [pid1, pid2], true);
      // harvest same pid
      await harvestMultiplePoolsAndVerifyData(user2, [pid1, pid1], true);

      await depositAndVerifyData(user1, pid1, amount, false);
      await depositAndVerifyData(user2, pid2, amount, false);

      await harvestMultiplePoolsAndVerifyData(user1, [pid1], true);
      await harvestMultiplePoolsAndVerifyData(user1, [pid2], true);
      // harvest same pid
      await harvestMultiplePoolsAndVerifyData(user2, [pid1, pid2], true);

      await Helper.setNextBlockTimestamp(poolInfo[pid1].endTime);

      await harvestMultiplePoolsAndVerifyData(user1, [pid1, pid2], true);
      await harvestMultiplePoolsAndVerifyData(user2, [pid1, pid2], true);

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
      let rewardPerSeconds = generateRewardPerSeconds();
      let vestDuration = new BN(getSecondInMinute(60));
      let tokenName = 'KNC Generated Token';
      let tokenSymbol = 'KNCG';
      let pid = await addNewPool(startTime, endTime, vestDuration, rewardPerSeconds, tokenName, tokenSymbol);

      let totalAmount = precisionUnits;
      let amount1 = precisionUnits;
      await depositAndVerifyData(user1, pid, amount1, false);
      let amount2 = precisionUnits.mul(new BN(2));
      totalAmount = totalAmount.add(amount2);
      await depositAndVerifyData(user2, pid, amount2, true);

      // delay to end block
      await Helper.setNextBlockTimestamp(endTime.add(new BN(getSecondInMinute(1))));

      let user1Rewards = [];
      let user2Rewards = [];
      for (let i = 0; i < rewardTokens.length; i++) {
        let rewardPerShare = duration.mul(rewardPerSeconds[i]).mul(REWARD_PER_SHARE_PRECISION).div(totalAmount);
        user1Rewards.push(rewardPerShare.mul(amount1).div(REWARD_PER_SHARE_PRECISION));
        user2Rewards.push(rewardPerShare.mul(amount2).div(REWARD_PER_SHARE_PRECISION));
      }

      currentBlockTime = await Helper.getCurrentBlockTime();
      let user1PendingRewards = getUserPendingRewards(user1, pid, currentBlockTime);
      let user2PendingRewards = getUserPendingRewards(user2, pid, currentBlockTime);
      for (let i = 0; i < rewardTokens.length; i++) {
        Helper.assertEqual(user1Rewards[i], user1PendingRewards[i]);
        Helper.assertEqual(user2Rewards[i], user2PendingRewards[i]);
        await transferToken(rewardTokens[i], accounts[0], fairLaunch.address, user1Rewards[i].add(user2Rewards[i]));
      }
      await harvestAndVerifyData(user1, pid);
      await harvestAndVerifyData(user2, pid);
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
      let startTime = new BN(currentBlockTime).add(new BN(getSecondInMinute(1)));
      let endTime = startTime.add(new BN(getSecondInMinute(6)));
      let rewardPerSeconds = generateRewardPerSeconds();
      let vestDuration = new BN(getSecondInMinute(60));
      let tokenName = 'KNC Generated Token';
      let tokenSymbol = 'KNCG';
      let pid1 = await addNewPool(startTime, endTime, vestDuration, rewardPerSeconds, tokenName, tokenSymbol);
      rewardPerSeconds = generateRewardPerSeconds();
      endTime = startTime.add(new BN(getSecondInMinute(12)));
      let pid2 = await addNewPool(startTime, endTime, vestDuration, rewardPerSeconds, tokenName, tokenSymbol);

      let amount = precisionUnits.mul(new BN(2));
      await depositAndVerifyData(user1, pid1, amount, false);
      amount = precisionUnits.mul(new BN(5));
      await depositAndVerifyData(user2, pid1, amount, true);
      await depositAndVerifyData(user1, pid2, amount, false);
      amount = precisionUnits.mul(new BN(3));
      await depositAndVerifyData(user1, pid2, amount, false);

      await Helper.setNextBlockTimestamp(endTime);

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
            timestamp: new BN(await Helper.getCurrentBlockTime()),
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

            let rewardPerSeconds = generateRewardPerSeconds();
            if (poolLength == tokens.length) {
              // all tokens have been added, will get duplicated token
              console.log(`Loop ${i}: Expect add pool reverts`);
              await expectRevert(
                fairLaunch.addPool(
                  tokens[i % tokens.length].address,
                  startTime,
                  endTime,
                  vestDuration,
                  rewardPerSeconds,
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
              await transferToken(
                rewardTokens[r],
                accounts[0],
                fairLaunch.address,
                rewardPerSeconds[r].mul(endTime.sub(startTime))
              );
            }
            console.log(
              `Loop ${i}: Add pool ${tokens[poolLength - 1].address} ${startTime.toString(10)} ${endTime.toString(10)}`
            );
            await addNewPool(startTime, endTime, vestDuration, rewardPerSeconds, tokenName, tokenSymbol);
          } else if (isUserAction) {
            let user = users[Helper.getRandomInt(0, users.length - 1)];
            let pid = Helper.getRandomInt(0, poolLength - 1);
            if (userAction == UserActions.Deposit) {
              let amount = precisionUnits.mul(new BN(10)).div(new BN(Helper.getRandomInt(1, 20)));
              let isHarvesting = Helper.getRandomInt(0, 100) <= 50;
              console.log(`Loop ${i}: Deposit: ${user} ${pid} ${amount.toString(10)} ${isHarvesting}`);
              await depositAndVerifyData(user, pid, amount, isHarvesting);
            } else if (userAction == UserActions.Withdraw) {
              let amount = userInfo[user][pid].amount.div(new BN(Helper.getRandomInt(1, 20)));
              console.log(`Loop ${i}: Withdraw: ${user} ${pid} ${amount.toString(10)}`);
              await withdrawAndVerifyData(user, pid, amount, false);
            } else if (userAction == UserActions.WithdrawAll) {
              console.log(`Loop ${i}: WithdrawAll: ${user} ${pid} ${userInfo[user][pid].amount.toString(10)}`);
              await withdrawAndVerifyData(user, pid, userInfo[user][pid].amount, true);
            } else {
              console.log(`Loop ${i}: Harvest: ${user} ${pid}`);
              await harvestAndVerifyData(user, pid);
            }
          } else {
            // admin action
            let rewardPerSeconds = generateRewardPerSeconds();
            let pid = Helper.getRandomInt(0, poolLength - 1);
            let vestDuration = new BN(getSecondInMinute(Helper.getRandomInt(30, 60)));
            if (adminAction == AdminActions.UpdatePool) {
              let endTime = new BN(currentBlockTime).add(
                new BN(getSecondInMinute(Helper.getRandomInt(5, numberRuns - i + 5)))
              );

              if (new BN(currentBlockTime + 1).gt(poolInfo[pid].endTime)) {
                console.log(`Loop ${i}: Expect update pool reverts`);
                // already ended
                await expectRevert(
                  fairLaunch.updatePool(pid, endTime, vestDuration, rewardPerSeconds, tokenName, tokenSymbol, {
                    from: admin,
                  }),
                  'update: pool already ended'
                );
              } else {
                console.log(`Loop ${i}: Update pool: ${pid} ${endTime.toString(10)}`);
                await fairLaunch.updatePool(pid, endTime, rewardPerSeconds, {from: admin});
                currentBlockTime = new BN(await Helper.getCurrentBlockTime());
                poolInfo[pid] = updatePoolReward(poolInfo[pid], currentBlockTime);
                poolInfo[pid].endTime = endTime;
                poolInfo[pid].rewardPerSeconds = rewardPerSeconds;
                for (let r = 0; r < rewardTokens.length; r++) {
                  await transferToken(
                    rewardTokens[r],
                    accounts[0],
                    fairLaunch.address,
                    rewardPerSeconds[r].mul(endTime.sub(new BN(currentBlockTime)))
                  );
                }
              }
            } else {
              // renew pool
              let startTime = new BN(currentBlockTime).add(new BN(getSecondInMinute(Helper.getRandomInt(5, 10))));
              let endTime = startTime.add(new BN(getSecondInMinute(Helper.getRandomInt(5, numberRuns - i + 5))));
              let rewardPerSeconds = generateRewardPerSeconds();
              if (
                new BN(currentBlockTime + 1).gt(poolInfo[pid].endTime) ||
                new BN(currentBlockTime + 1).lt(poolInfo[pid].startTime)
              ) {
                await fairLaunch.renewPool(pid, startTime, endTime, vestDuration, rewardPerSeconds, {from: admin});
                console.log(`Loop ${i}: Renew pool: ${pid} ${startTime.toString(10)} ${endTime.toString(10)}`);
                currentBlockTime = await Helper.getCurrentBlockTime();
                poolInfo[pid] = updatePoolInfoOnRenew(
                  poolInfo[pid],
                  startTime,
                  endTime,
                  rewardPerSeconds,
                  currentBlockTime,
                  vestDuration
                );
                for (let r = 0; r < rewardTokens.length; r++) {
                  await transferToken(
                    rewardTokens[r],
                    accounts[0],
                    fairLaunch.address,
                    rewardPerSeconds[r].mul(endTime.sub(startTime))
                  );
                }
              } else {
                console.log(`Loop ${i}: Expect renew pool reverts`);
                // // currently active
                await expectRevert(
                  fairLaunch.renewPool(pid, startTime, endBlock, vestDuration, rewardPerSeconds, {from: admin}),
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
const depositAndVerifyData = async (user, pid, amount, isHarvesting) => {
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
    timestamp: new BN(await Helper.getCurrentBlockTime()),
    amount: amount,
  });
  Helper.assertEqual(userBalBefore.sub(amount), await poolData.stakeToken.balanceOf(user));
  Helper.assertEqual(poolBalBefore.add(amount), await poolData.stakeToken.balanceOf(fairLaunch.address));
  let currentBlockTime = await Helper.getCurrentBlockTime();
  let claimedAmounts = [];
  [userInfo[user][pid], poolInfo[pid], claimedAmounts] = updateInfoOnDeposit(
    userInfo[user][pid],
    poolInfo[pid],
    amount,
    currentBlockTime,
    isHarvesting
  );

  for (let i = 0; i < claimedAmounts.length; i++) {
    userClaimData[user][i].iadd(claimedAmounts[i]);
  }

  await verifyContractData(tx, user, pid, poolRewardBalances, lockerRewardBalances, claimedAmounts);
};

// check withdraw an amount of token from pool with pid
// if isWithdrawlAll is true -> call withdraw all func, assume amount is the user's deposited amount
const withdrawAndVerifyData = async (user, pid, amount, isWithdrawAll) => {
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
  currentBlockTime = await Helper.getCurrentBlockTime();
  expectEvent(tx, 'Withdraw', {
    user: user,
    pid: poolData.id,
    timestamp: new BN(currentBlockTime),
    amount: amount,
  });
  Helper.assertEqual(userBalBefore.add(amount), await poolData.stakeToken.balanceOf(user));
  Helper.assertEqual(poolBalBefore.sub(amount), await poolData.stakeToken.balanceOf(fairLaunch.address));
  let claimedAmounts = [];
  [userInfo[user][pid], poolInfo[pid], claimedAmounts] = updateInfoOnWithdraw(
    userInfo[user][pid],
    poolInfo[pid],
    amount,
    currentBlockTime
  );
  for (let i = 0; i < rewardTokens.length; i++) {
    userClaimData[user][i].iadd(claimedAmounts[i]);
  }

  await verifyContractData(tx, user, pid, poolRewardBalances, lockerRewardBalances, claimedAmounts);
};

const harvestMultiplePoolsAndVerifyData = async (user, pids, diffVest) => {
  let poolRewardBalances = [];
  let lockerRewardBalances = [];
  for (let i = 0; i < rewardTokens.length; i++) {
    poolRewardBalances.push(await balanceOf(rewardTokens[i], fairLaunch.address));
    lockerRewardBalances.push(await balanceOf(rewardTokens[i], rewardLocker.address));
  }

  let tx = await fairLaunch.harvestMultiplePools(pids, {from: user});

  currentBlockTime = await Helper.getCurrentBlockTime();
  let totalClaimedAmounts = [];
  for (let i = 0; i < rewardTokens.length; i++) {
    totalClaimedAmounts.push(new BN(0));
  }
  for (let i = 0; i < pids.length; i++) {
    let claimedAmounts = [];
    let pid = pids[i];
    [userInfo[user][pid], poolInfo[pid], claimedAmounts] = updateInfoOnHarvest(
      userInfo[user][pid],
      poolInfo[pid],
      currentBlockTime
    );
    for (let j = 0; j < rewardTokens.length; j++) {
      userClaimData[user][j].iadd(claimedAmounts[j]);
      totalClaimedAmounts[j].iadd(claimedAmounts[j]);
    }

    await verifyPoolInfo(poolInfo[pid]);
    await verifyUserInfo(user, pid, userInfo[user][pid]);

    for (let j = 0; j < rewardTokens.length; j++) {
      if (claimedAmounts[j].gt(new BN(0))) {
        expectEvent(tx, 'Harvest', {
          user: user,
          pid: pid,
          timestamp: new BN(currentBlockTime),
          lockedAmount: claimedAmounts[j],
        });
        if (diffVest) {
          await expectEvent.inTransaction(tx.tx, rewardTokens[j], 'Transfer', {
            from: fairLaunch.address,
            to: rewardLocker.address,
            value: claimedAmounts[j],
          });
        }
      }
    }
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

  await verifyRewardData(user, poolRewardBalances, lockerRewardBalances, totalClaimedAmounts);
};

const harvestAndVerifyData = async (user, pid) => {
  let poolRewardBalances = [];
  let lockerRewardBalances = [];
  for (let i = 0; i < rewardTokens.length; i++) {
    poolRewardBalances.push(await balanceOf(rewardTokens[i], fairLaunch.address));
    lockerRewardBalances.push(await balanceOf(rewardTokens[i], rewardLocker.address));
  }

  let tx = await fairLaunch.harvest(pid, {from: user});

  currentBlockTime = await Helper.getCurrentBlockTime();
  let claimedAmounts = [];
  [userInfo[user][pid], poolInfo[pid], claimedAmounts] = updateInfoOnHarvest(
    userInfo[user][pid],
    poolInfo[pid],
    currentBlockTime
  );
  for (let i = 0; i < rewardTokens.length; i++) {
    userClaimData[user][i].iadd(claimedAmounts[i]);
  }

  await verifyContractData(tx, user, pid, poolRewardBalances, lockerRewardBalances, claimedAmounts);
};

const verifyContractData = async (tx, user, pid, poolRewardBalances, lockerRewardBalances, rewardClaimedAmounts) => {
  currentBlockTime = await Helper.getCurrentBlockTime();
  for (let i = 0; i < rewardTokens.length; i++) {
    if (rewardClaimedAmounts[i].gt(new BN(0))) {
      expectEvent(tx, 'Harvest', {
        user: user,
        pid: new BN(pid),
        timestamp: new BN(currentBlockTime),
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
  Helper.assertEqualArray(poolData.accRewardPerShares, onchainData.accRewardPerShares);
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

const verifyPendingRewards = async (pid, users) => {
  currentBlockTime = await Helper.getCurrentBlockTime();
  for (let i = 0; i < users.length; i++) {
    let pendingRewards = getUserPendingRewards(users[i], pid, currentBlockTime);
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

function generateRewardPerSeconds() {
  let rewardPerSeconds = [];
  for (let i = 0; i < rewardTokens.length; i++) {
    let randomNum = rewardTokens[i] == zeroAddress ? Helper.getRandomInt(32, 100) : Helper.getRandomInt(1, 10);
    rewardPerSeconds.push(precisionUnits.div(new BN(randomNum)));
  }
  return rewardPerSeconds;
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
    claimedAmounts.push(isHarvesting ? userData.unclaimedRewards[i] : new BN(0));
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
    claimedAmounts.push(userData.unclaimedRewards[i]);
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

function updatePoolInfoOnRenew(poolData, startTime, endTime, rewardPerSeconds, currentBlockTime, vestingDuration) {
  poolData = updatePoolReward(poolData, currentBlockTime);
  poolData.startTime = startTime;
  poolData.endTime = endTime;
  poolData.rewardPerSeconds = rewardPerSeconds;
  poolData.lastRewardTime = startTime;
  poolData.vestingDuration = vestingDuration;
  return poolData;
}

function updatePoolReward(poolData, currentBlockTime) {
  let lastAccountedBlockTime = new BN(currentBlockTime);
  if (lastAccountedBlockTime.gt(poolData.endTime)) {
    lastAccountedBlockTime = poolData.endTime;
  }
  if (poolData.startTime.gt(lastAccountedBlockTime)) return poolData;
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

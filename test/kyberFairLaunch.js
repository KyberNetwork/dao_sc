const {expectEvent, expectRevert} = require('@openzeppelin/test-helpers');
const BN = web3.utils.BN;

const Token = artifacts.require('KyberNetworkTokenV2.sol');
const KyberFairLaunch = artifacts.require('KyberFairLaunch.sol');
const SimpleMockRewardLocker = artifacts.require('SimpleMockRewardLocker.sol');

const Helper = require('./helper.js');
const { precisionUnits } = require('./helper.js');

const REWARD_PER_SHARE_PRECISION = new BN(10).pow(new BN(12));

let admin;
let kncToken;
let rewardLocker;

let fairLaunch;

let user1;
let user2;
let user3;

let tokens = [];

let userInfo = {};
let userClaimData = {};
let poolInfo = {};

let currentBlock;

contract('KyberFairLaunch', function (accounts) {
  before('Global setup', async () => {
    admin = accounts[1];
    kncToken = await Token.new();
    user1 = accounts[2];
    user2 = accounts[5];
    user3 = accounts[6];
    for(let i = 0; i < 10; i++) {
      let token = await Token.new();
      await token.transfer(user1, precisionUnits.mul(new BN(1000000)));
      await token.transfer(user2, precisionUnits.mul(new BN(1000000)));
      await token.transfer(user2, precisionUnits.mul(new BN(1000000)));
      tokens.push(token);
    }
  });

  const deployContracts = async () => {
    rewardLocker = await SimpleMockRewardLocker.new();
    fairLaunch = await KyberFairLaunch.new(
      admin, kncToken.address, rewardLocker.address
    );
    for(let i = 0; i < tokens.length; i++) {
      await tokens[i].approve(fairLaunch.address, new BN(2).pow(new BN(255)), { from: user1 });
      await tokens[i].approve(fairLaunch.address, new BN(2).pow(new BN(255)), { from: user2 });
      await tokens[i].approve(fairLaunch.address, new BN(2).pow(new BN(255)), { from: user3 });
    }
    userInfo[user1] = {};
    userInfo[user2] = {};
    userInfo[user3] = {};
    userClaimData[user1] = new BN(0);
    userClaimData[user2] = new BN(0);
    userClaimData[user3] = new BN(0);
  }

  const addNewPool = async (startBlock, endBlock, rewardPerBlock) => {
    let tokenId = await fairLaunch.poolLength();
    let stakeToken = tokens[tokenId];
    await fairLaunch.addPool(stakeToken.address, startBlock, endBlock, rewardPerBlock, { from: admin });
    let pid = (await fairLaunch.poolLength()).sub(new BN(1));
    poolInfo[pid] = {
      id: (await fairLaunch.poolLength()).sub(new BN(1)),
      stakeToken: stakeToken,
      startBlock: startBlock,
      endBlock: endBlock,
      rewardPerBlock: rewardPerBlock,
      lastRewardBlock: startBlock,
      accRewardPerShare: new BN(0),
      totalStake: new BN(0)
    };
    userInfo[user1][pid] = emptyUserInfo();
    userInfo[user2][pid] = emptyUserInfo();
    userInfo[user3][pid] = emptyUserInfo();
    return pid;
  }

  describe('#constructor', async () => {
  });

  describe('#add pools', async () => {
  });

  describe('#update pools', async () => {
  });

  describe('#deposit', async () => {
    beforeEach('deploy contracts', async() => {
      await deployContracts();
    });

    it('revert invalid pool', async() => {
      await expectRevert(
        fairLaunch.deposit(1, 100, true, { from: user1 }),
        'invalid pool id'
      );
    });

    it('revert not enough token', async() => {
      currentBlock = new BN(await Helper.getCurrentBlock());
      let pid = await addNewPool(
        currentBlock.add(new BN(10)), currentBlock.add(new BN(20)), precisionUnits
      );
      await poolInfo[pid].stakeToken.approve(fairLaunch.address, new BN(0), { from: user1 });
      await expectRevert.unspecified(
        fairLaunch.deposit(
          pid, precisionUnits, false, { from: user1 }
        )
      );
      await poolInfo[pid].stakeToken.approve(fairLaunch.address, new BN(2).pow(new BN(255)), { from: user1 });
      let balance = await poolInfo[pid].stakeToken.balanceOf(user1);
      await expectRevert.unspecified(
        fairLaunch.deposit(
          pid, balance.add(new BN(1)), false, { from: user1 }
        )
      );
    });

    it('revert not enough reward token', async() => {
      currentBlock = new BN(await Helper.getCurrentBlock());
      let pid = await addNewPool(
        currentBlock.add(new BN(10)), currentBlock.add(new BN(20)), precisionUnits
      );
      await fairLaunch.deposit(pid, precisionUnits, false, { from: user1 });
      await Helper.increaseBlockNumberTo(poolInfo[pid].startBlock.add(new BN(1)));
      // deposit without harvesting, still ok
      await fairLaunch.deposit(pid, precisionUnits, false, { from: user1 });
      // not enough token for reward
      await expectRevert.unspecified(
        fairLaunch.deposit(pid, precisionUnits, true, { from: user1 })
      );
    });

    // 1. deposit when pool has not started, check reward is 0
    // 2. increase blocks, check rewards are accumulated for users that have staked previously
    // 3. deposit without harvesting, check data
    // 4. deposit with harvesting, check data
    // 5. deposit after pool has ended
    it('deposit and check rewards', async() => {
      currentBlock = new BN(await Helper.getCurrentBlock());
      let startBlock = currentBlock.add(new BN(16));
      let pid = await addNewPool(
        startBlock, startBlock.add(new BN(10)), precisionUnits
      );
      let amount = precisionUnits.mul(new BN(2));

      await depositAndVerifyData(user1, pid, amount, false);

      amount = precisionUnits.mul(new BN(2));

      await depositAndVerifyData(user2, pid, amount, true);

      await Helper.increaseBlockNumberTo(startBlock);
      await verifyPendingRewards(pid, [user1, user2, user3]);
      await Helper.increaseBlockNumber(2);
      await verifyPendingRewards(pid, [user1, user2, user3]);
      // should have acc some rewards alr
      await Helper.assertGreater(await fairLaunch.pendingReward(pid, user1), new BN(0));
      await Helper.assertEqual(await fairLaunch.pendingReward(pid, user3), new BN(0));

      // deposit without harvesting
      amount = precisionUnits.mul(new BN(5));
      await depositAndVerifyData(user1, pid, amount, false);
      await Helper.increaseBlockNumber(2);
      // transfer some knc to the fairlaunch
      await kncToken.transfer(fairLaunch.address, precisionUnits.mul(new BN(200)));
      amount = precisionUnits.mul(new BN(2));

      // deposit with harvesting
      await depositAndVerifyData(user2, pid, amount, true);
      await depositAndVerifyData(user1, pid, amount, true);

      // deposit when reward has been ended
      await Helper.increaseBlockNumberTo(poolInfo[pid].endBlock);
      await depositAndVerifyData(user1, pid, amount, false);
      await depositAndVerifyData(user2, pid, amount, true);

      // extra verification
      let poolData = await fairLaunch.poolInfo(pid);
      let user1Data = await fairLaunch.userInfo(pid, user1);
      let user2Data = await fairLaunch.userInfo(pid, user2);

      await Helper.assertEqual(poolInfo[pid].endBlock, poolData.lastRewardBlock);
      await Helper.assertEqual(user1Data.lastRewardPerShare, poolData.accRewardPerShare);
      await Helper.assertEqual(user2Data.lastRewardPerShare, poolData.accRewardPerShare);
      await Helper.assertEqual(new BN(0), user2Data.unclaimedReward);
      await Helper.assertGreater(user1Data.unclaimedReward, new BN(0));

      await depositAndVerifyData(user1, pid, new BN(0), true);
      user1Data = await fairLaunch.userInfo(pid, user1);
      await Helper.assertEqual(new BN(0), user1Data.unclaimedReward);
    });
  });

  describe('#withdraw', async () => {
    beforeEach('deploy contracts', async() => {
      await deployContracts();
    });

    it('revert invalid pool', async() => {
      await expectRevert(
        fairLaunch.withdraw(1, 100, { from: user1 }),
        'invalid pool id'
      );
    });

    it('revert withdraw higher than deposited', async() => {
      currentBlock = new BN(await Helper.getCurrentBlock());
      let pid = await addNewPool(
        currentBlock.add(new BN(10)), currentBlock.add(new BN(20)), precisionUnits
      );
      await fairLaunch.deposit(pid, precisionUnits, false, { from: user1 });
      await expectRevert(
        fairLaunch.withdraw(pid, precisionUnits.add(new BN(1)), { from: user1 }),
        'withdraw: insufficient amount'
      );
      await fairLaunch.withdraw(pid, precisionUnits.div(new BN(2)), { from: user1 });
      await fairLaunch.withdrawAll(pid, { from: user1 });
    });

    it('revert withdraw not enough reward token', async() => {
      currentBlock = new BN(await Helper.getCurrentBlock());
      let pid = await addNewPool(
        currentBlock.add(new BN(10)), currentBlock.add(new BN(20)), precisionUnits
      );
      await fairLaunch.deposit(pid, precisionUnits, false, { from: user1 });
      await Helper.increaseBlockNumberTo(poolInfo[pid].startBlock);
      await expectRevert.unspecified(
        fairLaunch.withdraw(pid, precisionUnits, { from: user1 })
      );
      await expectRevert.unspecified(
        fairLaunch.withdrawAll(pid, { from: user1 })
      );
      await kncToken.transfer(fairLaunch.address, precisionUnits.mul(new BN(10)));
      await fairLaunch.withdraw(pid, precisionUnits.div(new BN(2)), { from: user1 });
      await fairLaunch.withdrawAll(pid, { from: user1 });
    });

    it('withdraw and check rewards', async() => {
      currentBlock = new BN(await Helper.getCurrentBlock());
      let startBlock = currentBlock.add(new BN(16));
      let pid = await addNewPool(
        startBlock, startBlock.add(new BN(10)), precisionUnits
      );
      let amount = precisionUnits.mul(new BN(2));
      await depositAndVerifyData(user1, pid, amount, false);
      await depositAndVerifyData(user2, pid, amount, true);

      // withdraw when not started yet, no reward claimed
      // Note: KNC has not been set to the fairlaunch yet, means it won't revert because reward is 0
      amount = precisionUnits.div(new BN(10));
      await withdrawAndVerifyData(user1, pid, amount, false);

      await Helper.increaseBlockNumberTo(startBlock.add(new BN(2)));

      await kncToken.transfer(fairLaunch.address, precisionUnits.mul(new BN(200)));

      // withdraw and harvest rewards
      amount = precisionUnits.div(new BN(5));
      await withdrawAndVerifyData(user1, pid, amount, false);
      await Helper.increaseBlockNumber(2);
      amount = precisionUnits.div(new BN(2));
      await withdrawAndVerifyData(user2, pid, amount, false);

      await verifyPendingRewards(pid, [user1, user2, user3]);

      // withdraw when reward has been ended
      await Helper.increaseBlockNumberTo(poolInfo[pid].endBlock);
      await withdrawAndVerifyData(user1, pid, amount, false);
      await withdrawAndVerifyData(user2, pid, amount, false);

      // withdraw all
      await withdrawAndVerifyData(user1, pid, userInfo[user1][pid].amount, true);
      await withdrawAndVerifyData(user2, pid, userInfo[user2][pid].amount, true);

      // extra verification
      let poolData = await fairLaunch.poolInfo(pid);
      let user1Data = await fairLaunch.userInfo(pid, user1);
      let user2Data = await fairLaunch.userInfo(pid, user2);

      await Helper.assertEqual(poolInfo[pid].endBlock, poolData.lastRewardBlock);
      await Helper.assertEqual(user1Data.lastRewardPerShare, poolData.accRewardPerShare);
      await Helper.assertEqual(user2Data.lastRewardPerShare, poolData.accRewardPerShare);
      await Helper.assertEqual(0, user2Data.unclaimedReward);
      await Helper.assertEqual(0, user1Data.unclaimedReward);
      await Helper.assertEqual(0, user1Data.amount);
      await Helper.assertEqual(0, user2Data.amount);
    });
  });

  const depositAndVerifyData = async (user, pid, amount, isHarvesting) => {
    let poolData = poolInfo[pid];
    let userBalBefore = await poolData.stakeToken.balanceOf(user);
    let poolBalBefore = await poolData.stakeToken.balanceOf(fairLaunch.address);
    let poolKncBalance = await kncToken.balanceOf(fairLaunch.address);
    let lockerKncBalance = await kncToken.balanceOf(rewardLocker.address);
    let tx = await fairLaunch.deposit(poolData.id, amount, isHarvesting, { from: user });
    expectEvent(tx, 'Deposit', {
      user: user,
      pid: poolData.id,
      blockNumber: new BN(await Helper.getCurrentBlock()),
      amount: amount
    });
    Helper.assertEqual(
      userBalBefore.sub(amount), await poolData.stakeToken.balanceOf(user)
    );
    Helper.assertEqual(
      poolBalBefore.add(amount), await poolData.stakeToken.balanceOf(fairLaunch.address)
    );
    let currentBlock = await Helper.getCurrentBlock();
    let claimedAmount = new BN(0);
    [userInfo[user][pid], poolInfo[pid], claimedAmount] = updateInfoOnDeposit(
      userInfo[user][pid], poolInfo[pid], amount, currentBlock, isHarvesting
    );

    userClaimData[user].iadd(claimedAmount);

    await verifyContractData(tx, user, pid, poolKncBalance, lockerKncBalance, claimedAmount);
  }

  // check withdraw an amount of token from pool with pid
  // if isWithdrawlAll is true -> call withdraw all func, assume amount is the user's deposited amount
  const withdrawAndVerifyData = async (user, pid, amount, isWithdrawAll) => {
    let poolData = poolInfo[pid];
    let userBalBefore = await poolData.stakeToken.balanceOf(user);
    let poolBalBefore = await poolData.stakeToken.balanceOf(fairLaunch.address);
    let poolKncBalance = await kncToken.balanceOf(fairLaunch.address);
    let lockerKncBalance = await kncToken.balanceOf(rewardLocker.address);
    let tx;
    if (isWithdrawAll) {
      tx = await fairLaunch.withdrawAll(poolData.id, { from: user });
    } else {
      tx = await fairLaunch.withdraw(poolData.id, amount, { from: user });
    }
    currentBlock = await Helper.getCurrentBlock();
    expectEvent(tx, 'Withdraw', {
      user: user,
      pid: poolData.id,
      blockNumber: new BN(currentBlock),
      amount: userInfo[user][pid].amount.sub(amount)
    });
    Helper.assertEqual(
      userBalBefore.add(amount), await poolData.stakeToken.balanceOf(user)
    );
    Helper.assertEqual(
      poolBalBefore.sub(amount), await poolData.stakeToken.balanceOf(fairLaunch.address)
    );
    let claimedAmount = new BN(0);
    [userInfo[user][pid], poolInfo[pid], claimedAmount] = updateInfoOnWithdraw(
      userInfo[user][pid], poolInfo[pid], amount, currentBlock
    );
    userClaimData[user].iadd(claimedAmount);

    await verifyContractData(tx, user, pid, poolKncBalance, lockerKncBalance, claimedAmount);
  }

  const harvestAndVerifyData = async (user, pid, amount) => {
    let poolKncBalance = await kncToken.balanceOf(fairLaunch.address);
    let lockerKncBalance = await kncToken.balanceOf(rewardLocker.address);

    let claimedAmount = new BN(0);
    [userInfo[user][pid], poolInfo[pid], claimedAmount] = updateInfoOnWithdraw(userInfo[user][pid], poolInfo[pid], amount, currentBlock);
    userClaimData[user].iadd(claimedAmount);

    await verifyContractData(tx, user, pid, poolKncBalance, lockerKncBalance, claimedAmount);
  }

  const verifyContractData = async (tx, user, pid, poolKncBalance, lockerKncBalance, rewardClaimedAmount) => {
    currentBlock = await Helper.getCurrentBlock();
    if (rewardClaimedAmount.gt(new BN(0))) {
      expectEvent(tx, 'Harvest', {
        user: user,
        pid: pid,
        blockNumber: new BN(currentBlock),
        lockedAmount: rewardClaimedAmount
      });
    }
    Helper.assertEqual(
      userClaimData[user], await rewardLocker.lockedAmounts(user, kncToken.address)
    );

    await verifyPoolInfo(poolInfo[pid]);
    await verifyUserInfo(user, pid, userInfo[user][pid]);
    await verifyRewardData(user, poolKncBalance, lockerKncBalance, rewardClaimedAmount);
  }

  const verifyPoolInfo = async (poolData) => {
    let onchainData = await fairLaunch.poolInfo(poolData.id);
    Helper.assertEqual(poolData.rewardPerBlock, onchainData.rewardPerBlock);
    Helper.assertEqual(poolData.accRewardPerShare, onchainData.accRewardPerShare);
    Helper.assertEqual(poolData.totalStake, onchainData.totalStake);
    Helper.assertEqual(poolData.stakeToken.address, onchainData.stakeToken);
    Helper.assertEqual(poolData.startBlock, onchainData.startBlock);
    Helper.assertEqual(poolData.endBlock, onchainData.endBlock);
    Helper.assertEqual(poolData.lastRewardBlock, onchainData.lastRewardBlock);
  }

  const verifyUserInfo = async (user, pid, userData) => {
    let onchainData = await fairLaunch.userInfo(pid, user);
    Helper.assertEqual(userData.amount, onchainData.amount);
    Helper.assertEqual(userData.unclaimedReward, onchainData.unclaimedReward);
    Helper.assertEqual(userData.lastRewardPerShare, onchainData.lastRewardPerShare);
  }

  const verifyPendingRewards = async (pid, users) => {
    currentBlock = await Helper.getCurrentBlock();
    for(let i = 0; i < users.length; i++) {
      let pendingReward = getUserPendingReward(users[i], pid, currentBlock);
      Helper.assertEqual(pendingReward, await fairLaunch.pendingReward(pid, users[i]))
      if ((new BN(currentBlock)).gt(poolInfo[pid].startBlock) == false) {
        // not started yet
        Helper.assertEqual(new BN(0), pendingReward);
      }
    }
  }

  const verifyRewardData = async (user, poolBalance, lockerBalance, rewardAmount) => {
    Helper.assertEqual(
      poolBalance.sub(rewardAmount), await kncToken.balanceOf(fairLaunch.address)
    );
    Helper.assertEqual(
      lockerBalance.add(rewardAmount), await kncToken.balanceOf(rewardLocker.address)
    );
    Helper.assertEqual(
      userClaimData[user], await rewardLocker.lockedAmounts(user, kncToken.address)
    );
  }
});

function emptyUserInfo() {
  return {
    amount: new BN(0),
    unclaimedReward: new BN(0),
    lastRewardPerShare: new BN(0)
  }
}

function getUserPendingReward(user, pid, currentBlock) {
  let poolData = updatePoolReward(poolInfo[pid], currentBlock);
  let userData = userInfo[user][pid];
  let newReward = (poolData.accRewardPerShare.sub(userData.lastRewardPerShare)).mul(userData.amount).div(REWARD_PER_SHARE_PRECISION);
  return newReward.add(userData.unclaimedReward);
}

// assume user doesn't harvest
function updateInfoOnDeposit(userData, poolData, amount, currentBlock, isHarvesting) {
  poolData = updatePoolReward(poolData, currentBlock);
  if (userData.amount.gt(new BN(0))) {
    // first time deposit
    let newReward = userData.amount.mul(poolData.accRewardPerShare.sub(userData.lastRewardPerShare));
    newReward = newReward.div(REWARD_PER_SHARE_PRECISION);
    userData.unclaimedReward = userData.unclaimedReward.add(newReward);
  }
  userData.lastRewardPerShare = poolData.accRewardPerShare;
  userData.amount = userData.amount.add(amount);
  poolData.totalStake = poolData.totalStake.add(amount);
  let claimedAmount = isHarvesting ? userData.unclaimedReward : new BN(0);
  if (isHarvesting) userData.unclaimedReward = new BN(0);
  return [userData, poolData, claimedAmount]
}

function updateInfoOnWithdraw(userData, poolData, amount, currentBlock) {
  poolData = updatePoolReward(poolData, currentBlock);
  let claimedAmount = new BN(0);
  if (userData.amount.gt(new BN(0))) {
    // first time deposit
    let newReward = userData.amount.mul(poolData.accRewardPerShare.sub(userData.lastRewardPerShare));
    newReward = newReward.div(REWARD_PER_SHARE_PRECISION);
    claimedAmount = userData.unclaimedReward.add(newReward);
  }
  userData.unclaimedReward = new BN(0);
  userData.lastRewardPerShare = poolData.accRewardPerShare;
  userData.amount = userData.amount.sub(amount);
  poolData.totalStake = poolData.totalStake.sub(amount);
  return [userData, poolData, claimedAmount]
}

function updateInfoOnHarvest(userData, poolData, currentBlock) {
  poolData = updatePoolReward(poolData, currentBlock);
  let claimedAmount = new BN(0);
  if (userData.amount.gt(new BN(0))) {
    let newReward = userData.amount.mul(poolData.accRewardPerShare.sub(userData.lastRewardPerShare));
    newReward = newReward.div(REWARD_PER_SHARE_PRECISION);
    claimedAmount = userData.unclaimedReward.add(newReward);
  }
  userData.unclaimedReward = new BN(0);
  userData.lastRewardPerShare = poolData.accRewardPerShare;
  return [userData, poolData, claimedAmount]
}

function updatePoolReward(poolData, currentBlock) {
  let lastAccountedBlock = new BN(currentBlock);
  if (lastAccountedBlock.gt(poolData.endBlock)) {
    lastAccountedBlock = poolData.endBlock;
  }
  if (poolData.startBlock.gt(lastAccountedBlock)) return poolData;
  if (poolData.lastRewardBlock.gt(lastAccountedBlock)) return poolData;
  if (poolData.totalStake.eq(new BN(0))) {
    poolData.lastRewardBlock = lastAccountedBlock;
    return poolData;
  }
  let newReward = lastAccountedBlock.sub(poolData.lastRewardBlock).mul(poolData.rewardPerBlock);
  let increaseRewardPerShare = newReward.mul(REWARD_PER_SHARE_PRECISION).div(poolData.totalStake);
  poolData.accRewardPerShare = poolData.accRewardPerShare.add(increaseRewardPerShare);
  poolData.lastRewardBlock = lastAccountedBlock;
  return poolData;
}

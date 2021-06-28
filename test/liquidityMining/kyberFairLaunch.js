const {expectEvent, expectRevert} = require('@openzeppelin/test-helpers');
const BN = web3.utils.BN;

const Token = artifacts.require('KyberNetworkTokenV2.sol');
const KyberFairLaunch = artifacts.require('KyberFairLaunch.sol');
const SimpleMockRewardLocker = artifacts.require('SimpleMockRewardLocker.sol');

const Helper = require('../helper.js');
const { precisionUnits, zeroAddress } = require('../helper.js');

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

let currentBlock;

contract('KyberFairLaunch', function (accounts) {
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
    for(let i = 0; i < rewardTokens.length; i++) {
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
    for(let i = 0; i < rewardTokens.length; i++) {
      userClaimData[user1].push(new BN(0));
      userClaimData[user2].push(new BN(0));
      userClaimData[user3].push(new BN(0));
      userClaimData[user4].push(new BN(0));
    }
  };

  const addNewPool = async (startBlock, endBlock, rewardPerBlocks) => {
    let tokenId = await fairLaunch.poolLength();
    let stakeToken = tokens[tokenId];
    await fairLaunch.addPool(stakeToken.address, startBlock, endBlock, rewardPerBlocks, {from: admin});
    let pid = (await fairLaunch.poolLength()).sub(new BN(1));
    poolInfo[pid] = {
      id: (await fairLaunch.poolLength()).sub(new BN(1)),
      stakeToken: stakeToken,
      startBlock: startBlock,
      endBlock: endBlock,
      rewardPerBlocks: rewardPerBlocks,
      lastRewardBlock: startBlock,
      accRewardPerShares: [],
      totalStake: new BN(0),
    };
    for(let i = 0; i < rewardTokens.length; i++) {
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
      currentBlock = await Helper.getCurrentBlock();
      let startBlock = new BN(currentBlock).add(new BN(10));
      let endBlock = startBlock.add(new BN(10));
      await expectRevert(
        fairLaunch.addPool(tokens[0].address, startBlock, endBlock, [precisionUnits, precisionUnits], {from: accounts[0]}),
        'only admin'
      );
    });

    it('revert stake token is 0', async () => {
      currentBlock = await Helper.getCurrentBlock();
      let startBlock = new BN(currentBlock).add(new BN(10));
      let endBlock = startBlock.add(new BN(10));
      await expectRevert(
        fairLaunch.addPool(zeroAddress, startBlock, endBlock, [precisionUnits, precisionUnits], {from: admin}),
        'add: invalid stake token'
      );
    });

    it('revert invalid length', async () => {
      currentBlock = await Helper.getCurrentBlock();
      let startBlock = new BN(currentBlock).add(new BN(10));
      let endBlock = startBlock.add(new BN(10));
      await expectRevert(
        fairLaunch.addPool(tokens[0].address, startBlock, endBlock, [precisionUnits], {from: admin}),
        'add: invalid length'
      );
    });

    it('revert invalid blocks', async () => {
      currentBlock = await Helper.getCurrentBlock();
      let startBlock = new BN(currentBlock).add(new BN(10));
      let endBlock = startBlock.add(new BN(10));
      let rewardPerBlocks = [precisionUnits, precisionUnits];
      // start in the past
      await expectRevert(
        fairLaunch.addPool(tokens[0].address, new BN(currentBlock), endBlock, rewardPerBlocks, {from: admin}),
        'add: invalid blocks'
      );
      currentBlock = await Helper.getCurrentBlock();
      // start at the executed tx block number
      await expectRevert(
        fairLaunch.addPool(tokens[0].address, new BN(currentBlock + 1), endBlock, rewardPerBlocks, {from: admin}),
        'add: invalid blocks'
      );
      // end block <= start block
      await expectRevert(
        fairLaunch.addPool(tokens[0].address, endBlock, endBlock, rewardPerBlocks, {from: admin}),
        'add: invalid blocks'
      );
      currentBlock = await Helper.getCurrentBlock();
      await fairLaunch.addPool(tokens[0].address, new BN(currentBlock + 2), new BN(currentBlock + 3), rewardPerBlocks, {
        from: admin,
      });
    });

    it('revert duplicated pool', async () => {
      currentBlock = await Helper.getCurrentBlock();
      let startBlock = new BN(currentBlock + 10);
      let endBlock = startBlock.add(new BN(10));
      let rewardPerBlocks = [precisionUnits, precisionUnits];
      await fairLaunch.addPool(tokens[0].address, startBlock, endBlock, rewardPerBlocks, {from: admin});
      await expectRevert(
        fairLaunch.addPool(tokens[0].address, startBlock, endBlock, rewardPerBlocks, {from: admin}),
        'add: duplicated pool'
      );
    });

    it('correct data and events', async () => {
      let poolLength = 0;
      Helper.assertEqual(poolLength, await fairLaunch.poolLength());
      for (let i = 0; i < 5; i++) {
        let stakeToken = tokens[i].address;
        currentBlock = await Helper.getCurrentBlock();
        let startBlock = new BN(currentBlock + 10);
        let endBlock = new BN(currentBlock + 20);
        let rewardPerBlocks = generateRewardPerBlocks();
        let tx = await fairLaunch.addPool(stakeToken, startBlock, endBlock, rewardPerBlocks, {from: admin});
        expectEvent(tx, 'AddNewPool', {
          stakeToken: stakeToken,
          startBlock: startBlock,
          endBlock: endBlock
        });
        poolLength++;
        Helper.assertEqual(poolLength, await fairLaunch.poolLength());
        poolInfo[i] = {
          id: i,
          stakeToken: tokens[i],
          startBlock: startBlock,
          endBlock: endBlock,
          rewardPerBlocks: rewardPerBlocks,
          lastRewardBlock: startBlock,
          accRewardPerShares: [],
          totalStake: new BN(0),
        };
        for (let j = 0; j < rewardTokens.length; j++) {
          poolInfo[i].accRewardPerShares.push(new BN(0))
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
      currentBlock = await Helper.getCurrentBlock();
      let startBlock = new BN(currentBlock).add(new BN(10));
      let endBlock = startBlock.add(new BN(10));
      await expectRevert(fairLaunch.updatePool(1, endBlock, [precisionUnits, precisionUnits], {from: accounts[0]}), 'only admin');
    });

    it('revert invalid pool id', async () => {
      currentBlock = await Helper.getCurrentBlock();
      let startBlock = new BN(currentBlock).add(new BN(10));
      let endBlock = startBlock.add(new BN(10));
      await expectRevert(fairLaunch.updatePool(1, endBlock, [precisionUnits, precisionUnits], {from: admin}), 'invalid pool id');
    });

    it('revert invalid length', async () => {
      currentBlock = await Helper.getCurrentBlock();
      let startBlock = new BN(currentBlock).add(new BN(2));
      let endBlock = startBlock.add(new BN(10));
      let rewardPerBlocks = [precisionUnits, precisionUnits];
      await fairLaunch.addPool(tokens[0].address, startBlock, endBlock, rewardPerBlocks, {from: admin});

      await expectRevert(
        fairLaunch.updatePool(0, endBlock, [precisionUnits], {from: admin}),
        'update: invalid length'
      );
    });

    it('revert pool has ended', async () => {
      currentBlock = await Helper.getCurrentBlock();
      let startBlock = new BN(currentBlock).add(new BN(2));
      let endBlock = startBlock.add(new BN(3));
      let rewardPerBlocks = [precisionUnits, precisionUnits];
      await fairLaunch.addPool(tokens[0].address, startBlock, endBlock, rewardPerBlocks, {from: admin});
      await Helper.increaseBlockNumberTo(endBlock.sub(new BN(1)));
      // next tx will be executed in endBlock
      await expectRevert(
        fairLaunch.updatePool(0, endBlock, rewardPerBlocks, {from: admin}),
        'update: pool already ended'
      );
      // next tx will be executed after endblock
      await expectRevert(
        fairLaunch.updatePool(0, endBlock, rewardPerBlocks, {from: admin}),
        'update: pool already ended'
      );
    });

    it('revert invalid block', async () => {
      currentBlock = await Helper.getCurrentBlock();
      let startBlock = new BN(currentBlock).add(new BN(5));
      let endBlock = startBlock.add(new BN(10));
      let rewardPerBlocks = [precisionUnits, precisionUnits];
      await fairLaunch.addPool(tokens[0].address, startBlock, endBlock, rewardPerBlocks, {from: admin});
      // end block <= start block
      await expectRevert(
        fairLaunch.updatePool(0, startBlock, rewardPerBlocks, {from: admin}),
        'update: invalid end block'
      );
      await expectRevert(
        fairLaunch.updatePool(0, startBlock.sub(new BN(1)), rewardPerBlocks, {from: admin}),
        'update: invalid end block'
      );
      // end block <= current block
      await Helper.increaseBlockNumber(5);
      currentBlock = await Helper.getCurrentBlock();
      // next tx is executed at currentBlock + 1
      await expectRevert(
        fairLaunch.updatePool(0, new BN(currentBlock + 1), rewardPerBlocks, {from: admin}),
        'update: invalid end block'
      );
      currentBlock = await Helper.getCurrentBlock();
      await expectRevert(
        fairLaunch.updatePool(0, new BN(currentBlock), rewardPerBlocks, {from: admin}),
        'update: invalid end block'
      );
    });

    it('correct data and events', async () => {
      currentBlock = new BN(await Helper.getCurrentBlock());
      let startBlock = currentBlock.add(new BN(16));
      let endBlock = startBlock.add(new BN(10));
      let rewardPerBlocks = generateRewardPerBlocks();
      let pid = await addNewPool(startBlock, endBlock, rewardPerBlocks);
      await verifyPoolInfo(poolInfo[pid]);

      for(let i = 0; i < rewardTokens.length; i++) {
        await transferToken(rewardTokens[i], accounts[0], fairLaunch.address, precisionUnits.mul(new BN(200)));
      }

      // update pool before it starts
      endBlock = startBlock.add(new BN(20));
      rewardPerBlocks = generateRewardPerBlocks();

      let tx = await fairLaunch.updatePool(pid, endBlock, rewardPerBlocks, {from: admin});
      expectEvent(tx, 'UpdatePool', {
        pid: pid,
        endBlock: endBlock
      });
      currentBlock = await Helper.getCurrentBlock();
      // not yet started, no need to call update pool rewards
      // poolInfo[pid] = updatePoolReward(poolInfo[pid], currentBlock);
      poolInfo[pid].endBlock = endBlock;
      poolInfo[pid].rewardPerBlocks = rewardPerBlocks;
      await verifyPoolInfo(poolInfo[pid]);

      let amount = precisionUnits.mul(new BN(2));
      await depositAndVerifyData(user1, pid, amount, false);
      amount = precisionUnits.mul(new BN(2));
      await depositAndVerifyData(user2, pid, amount, true);

      await Helper.increaseBlockNumberTo(poolInfo[pid].startBlock);
      await harvestAndVerifyData(user1, pid);

      // change reward per block
      rewardPerBlocks = generateRewardPerBlocks();
      await fairLaunch.updatePool(pid, endBlock, rewardPerBlocks, {from: admin});
      currentBlock = await Helper.getCurrentBlock();
      poolInfo[pid] = updatePoolReward(poolInfo[pid], currentBlock);
      poolInfo[pid].rewardPerBlocks = rewardPerBlocks;
      await verifyPoolInfo(poolInfo[pid]);

      await harvestAndVerifyData(user1, pid);
      await harvestAndVerifyData(user2, pid);

      await withdrawAndVerifyData(user1, pid, amount.div(new BN(10)), false);

      // change reward per block
      rewardPerBlocks = generateRewardPerBlocks();
      await fairLaunch.updatePool(pid, endBlock, rewardPerBlocks, {from: admin});
      currentBlock = await Helper.getCurrentBlock();
      poolInfo[pid] = updatePoolReward(poolInfo[pid], currentBlock);
      poolInfo[pid].rewardPerBlocks = rewardPerBlocks;
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
      currentBlock = await Helper.getCurrentBlock();
      let startBlock = new BN(currentBlock).add(new BN(10));
      let endBlock = startBlock.add(new BN(10));
      await expectRevert(
        fairLaunch.renewPool(1, startBlock, endBlock, [precisionUnits], {from: accounts[0]}),
        'only admin'
      );
    });

    it('revert invalid pool id', async () => {
      currentBlock = await Helper.getCurrentBlock();
      let startBlock = new BN(currentBlock).add(new BN(10));
      let endBlock = startBlock.add(new BN(10));
      await expectRevert(
        fairLaunch.renewPool(1, startBlock, endBlock, [precisionUnits], {from: admin}),
        'invalid pool id'
      );
    });

    it('revert invalid length', async () => {
      currentBlock = await Helper.getCurrentBlock();
      let startBlock = new BN(currentBlock).add(new BN(10));
      let endBlock = startBlock.add(new BN(10));
      let rewardPerBlocks = [precisionUnits, precisionUnits];
      await fairLaunch.addPool(tokens[0].address, startBlock, endBlock, rewardPerBlocks, {from: admin});
      await expectRevert(
        fairLaunch.renewPool(0, startBlock, endBlock, [precisionUnits], {from: admin}),
        'renew: invalid length'
      );
    });

    it('revert pool is active', async () => {
      currentBlock = await Helper.getCurrentBlock();
      let startBlock = new BN(currentBlock).add(new BN(5));
      let endBlock = startBlock.add(new BN(10));
      let rewardPerBlocks = [precisionUnits, precisionUnits];
      await fairLaunch.addPool(tokens[0].address, startBlock, endBlock, rewardPerBlocks, {from: admin});

      await Helper.increaseBlockNumberTo(startBlock.sub(new BN(1)));

      await expectRevert(
        fairLaunch.renewPool(0, startBlock, endBlock, rewardPerBlocks, {from: admin}),
        'renew: invalid pool state to renew'
      );
    });

    it('revert invalid block', async () => {
      currentBlock = await Helper.getCurrentBlock();
      let startBlock = new BN(currentBlock).add(new BN(16));
      let endBlock = startBlock.add(new BN(10));
      let rewardPerBlocks = [precisionUnits, precisionUnits];
      await fairLaunch.addPool(tokens[0].address, startBlock, endBlock, rewardPerBlocks, {from: admin});
      currentBlock = await Helper.getCurrentBlock();
      await expectRevert(
        fairLaunch.renewPool(0, new BN(currentBlock + 1), new BN(currentBlock + 10), rewardPerBlocks, {from: admin}),
        'renew: invalid blocks'
      );
      await expectRevert(
        fairLaunch.renewPool(0, new BN(currentBlock + 10), new BN(currentBlock + 10), rewardPerBlocks, {from: admin}),
        'renew: invalid blocks'
      );
    });

    it('correct data and events', async () => {
      currentBlock = await Helper.getCurrentBlock();
      let startBlock = new BN(currentBlock).add(new BN(16));
      let endBlock = startBlock.add(new BN(10));
      let rewardPerBlocks = generateRewardPerBlocks();
      let pid = await addNewPool(startBlock, endBlock, rewardPerBlocks);
      await verifyPoolInfo(poolInfo[pid]);

      for(let i = 0; i < rewardTokens.length; i++) {
        await transferToken(rewardTokens[i], accounts[0], fairLaunch.address, precisionUnits.mul(new BN(200)));
      }

      let amount = precisionUnits.mul(new BN(10));
      await depositAndVerifyData(user1, pid, amount, true);
      amount = precisionUnits.mul(new BN(2));
      await depositAndVerifyData(user2, pid, amount, true);

      // renew when it has not started
      currentBlock = await Helper.getCurrentBlock();
      startBlock = new BN(currentBlock).add(new BN(12));
      endBlock = startBlock.add(new BN(10));
      rewardPerBlocks = generateRewardPerBlocks();
      let tx = await fairLaunch.renewPool(pid, startBlock, endBlock, rewardPerBlocks, {from: admin});
      expectEvent(tx, 'RenewPool', {
        pid: pid,
        startBlock: startBlock,
        endBlock: endBlock,
      });
      currentBlock = await Helper.getCurrentBlock();
      poolInfo[pid] = updatePoolInfoOnRenew(poolInfo[pid], startBlock, endBlock, rewardPerBlocks, currentBlock);
      await verifyPoolInfo(poolInfo[pid]);
      await verifyUserInfo(user1, pid, userInfo[user1][pid]);
      await verifyUserInfo(user2, pid, userInfo[user2][pid]);
      await verifyPendingRewards(pid, [user1, user2, user3]);

      await Helper.increaseBlockNumberTo(poolInfo[pid].endBlock);

      // record pending rewards after the pool has ended
      let user1PendingRewards = await fairLaunch.pendingRewards(pid, user1);
      let user2PendingRewards = await fairLaunch.pendingRewards(pid, user2);

      currentBlock = await Helper.getCurrentBlock();
      startBlock = new BN(currentBlock).add(new BN(12));
      endBlock = startBlock.add(new BN(10));
      rewardPerBlocks = generateRewardPerBlocks();

      tx = await fairLaunch.renewPool(pid, startBlock, endBlock, rewardPerBlocks, {from: admin});
      expectEvent(tx, 'RenewPool', {
        pid: pid,
        startBlock: startBlock,
        endBlock: endBlock
      });
      currentBlock = await Helper.getCurrentBlock();
      poolInfo[pid] = updatePoolInfoOnRenew(poolInfo[pid], startBlock, endBlock, rewardPerBlocks, currentBlock);
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
      await Helper.increaseBlockNumberTo(poolInfo[pid].startBlock.add(new BN(1)));

      // now both users should start accumulating new rewards
      Helper.assertGreater(await fairLaunch.pendingRewards(pid, user1), new BN(0));
      // since user1's amount == user3's amount, reward should be the same
      Helper.assertEqual(await fairLaunch.pendingRewards(pid, user1), await fairLaunch.pendingRewards(pid, user3));
      // user4's amount = user2's amount, new reward should be the same
      let pendingRewards = await fairLaunch.pendingRewards(pid, user4);
      for(let i = 0; i < rewardTokens.length; i++) {
        user2PendingRewards[i] = user2PendingRewards[i].add(pendingRewards[i]);
      }
      Helper.assertEqualArray(
        await fairLaunch.pendingRewards(pid, user2),
        user2PendingRewards
      );

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
      currentBlock = new BN(await Helper.getCurrentBlock());
      let rewardPerBlocks = [precisionUnits, precisionUnits];
      let pid = await addNewPool(currentBlock.add(new BN(10)), currentBlock.add(new BN(20)), rewardPerBlocks);
      await poolInfo[pid].stakeToken.approve(fairLaunch.address, new BN(0), {from: user1});
      await expectRevert.unspecified(fairLaunch.deposit(pid, precisionUnits, false, {from: user1}));
      await poolInfo[pid].stakeToken.approve(fairLaunch.address, new BN(2).pow(new BN(255)), {from: user1});
      let balance = await poolInfo[pid].stakeToken.balanceOf(user1);
      await expectRevert.unspecified(fairLaunch.deposit(pid, balance.add(new BN(1)), false, {from: user1}));
    });

    it('revert not enough reward token', async () => {
      currentBlock = new BN(await Helper.getCurrentBlock());
      let rewardPerBlocks = [precisionUnits, precisionUnits];
      let pid = await addNewPool(currentBlock.add(new BN(3)), currentBlock.add(new BN(20)), rewardPerBlocks);
      await fairLaunch.deposit(pid, precisionUnits, false, {from: user1});
      await Helper.increaseBlockNumberTo(poolInfo[pid].startBlock.add(new BN(1)));
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
      currentBlock = new BN(await Helper.getCurrentBlock());
      let startBlock = currentBlock.add(new BN(6));
      let endBlock = startBlock.add(new BN(10));
      let rewardPerBlocks = generateRewardPerBlocks();
      let pid = await addNewPool(startBlock, endBlock, rewardPerBlocks);
      let amount = precisionUnits.mul(new BN(2));

      await depositAndVerifyData(user1, pid, amount, false);

      amount = precisionUnits.mul(new BN(2));

      await depositAndVerifyData(user2, pid, amount, true);

      await Helper.increaseBlockNumberTo(startBlock);
      await verifyPendingRewards(pid, [user1, user2, user3]);
      await Helper.increaseBlockNumber(2);
      await verifyPendingRewards(pid, [user1, user2, user3]);
      // should have acc some rewards alr
      let pendinRewards = await fairLaunch.pendingRewards(pid, user1);
      for(let i = 0; i < rewardTokens.length; i++) {
        await Helper.assertGreater(pendinRewards[i], new BN(0));
      }
      pendinRewards = await fairLaunch.pendingRewards(pid, user3);
      for(let i = 0; i < rewardTokens.length; i++) {
        await Helper.assertEqual(pendinRewards[i], new BN(0));
      }

      // deposit without harvesting
      amount = precisionUnits.mul(new BN(5));
      await depositAndVerifyData(user1, pid, amount, false);
      await Helper.increaseBlockNumber(2);

      for(let i = 0; i < rewardTokens.length; i++) {
        let amount = rewardPerBlocks[i].mul(endBlock.sub(startBlock)).mul(new BN(10));
        await transferToken(rewardTokens[i], accounts[0], fairLaunch.address, amount);
      }

      amount = precisionUnits.mul(new BN(2));

      // deposit with harvesting
      await depositAndVerifyData(user2, pid, amount, true);
      await depositAndVerifyData(user1, pid, amount, true);

      // deposit when reward has been ended
      await Helper.increaseBlockNumberTo(poolInfo[pid].endBlock);
      await depositAndVerifyData(user1, pid, amount, false);
      await depositAndVerifyData(user2, pid, amount, true);

      // extra verification
      let poolData = await fairLaunch.getPoolInfo(pid);
      let user1Data = await fairLaunch.getUserInfo(pid, user1);
      let user2Data = await fairLaunch.getUserInfo(pid, user2);

      await Helper.assertEqual(poolInfo[pid].endBlock, poolData.lastRewardBlock);
      await Helper.assertEqualArray(user1Data.lastRewardPerShares, poolData.accRewardPerShares);
      await Helper.assertEqualArray(user2Data.lastRewardPerShares, poolData.accRewardPerShares);
      for(let i = 0; i < rewardTokens.length; i++) {
        await Helper.assertEqual(new BN(0), user2Data.unclaimedRewards[i]);
        await Helper.assertGreater(user1Data.unclaimedRewards[i], new BN(0));
      }

      await depositAndVerifyData(user1, pid, new BN(0), true);
      user1Data = await fairLaunch.getUserInfo(pid, user1);
      for(let i = 0; i < rewardTokens.length; i++) {
        await Helper.assertEqual(new BN(0), user1Data.unclaimedRewards[i]);
      }
    });
  });

  describe('#withdraw', async () => {
    beforeEach('deploy contracts', async () => {
      await deployContracts([kncToken, secondRewardToken]);
    });

    it('revert withdraw higher than deposited', async () => {
      currentBlock = new BN(await Helper.getCurrentBlock());
      let rewardPerBlocks = [
        precisionUnits, precisionUnits.div(new BN(3))
      ];
      let pid = await addNewPool(currentBlock.add(new BN(10)), currentBlock.add(new BN(20)), rewardPerBlocks);
      await fairLaunch.deposit(pid, precisionUnits, false, {from: user1});
      await expectRevert(
        fairLaunch.withdraw(pid, precisionUnits.add(new BN(1)), {from: user1}),
        'withdraw: insufficient amount'
      );
      await fairLaunch.withdraw(pid, precisionUnits.div(new BN(2)), {from: user1});
      await fairLaunch.withdrawAll(pid, {from: user1});
    });

    it('revert withdraw not enough reward token', async () => {
      currentBlock = new BN(await Helper.getCurrentBlock());
      let rewardPerBlocks = [
        precisionUnits, precisionUnits.div(new BN(3))
      ];
      let startBlock = currentBlock.add(new BN(4));
      let endBlock = currentBlock.add(new BN(20));
      let pid = await addNewPool(startBlock, endBlock, rewardPerBlocks);
      await fairLaunch.deposit(pid, precisionUnits, false, {from: user1});
      await Helper.increaseBlockNumberTo(poolInfo[pid].startBlock);
      await expectRevert.unspecified(fairLaunch.withdraw(pid, precisionUnits, {from: user1}));
      await expectRevert.unspecified(fairLaunch.withdrawAll(pid, {from: user1}));
      for(let i = 0; i < rewardTokens.length; i++) {
        let amount = rewardPerBlocks[i].mul(endBlock.sub(startBlock)).mul(new BN(10));
        await transferToken(rewardTokens[i], accounts[0], fairLaunch.address, amount);
      }
      await fairLaunch.withdraw(pid, precisionUnits.div(new BN(2)), {from: user1});
      await fairLaunch.withdrawAll(pid, {from: user1});
    });

    it('withdraw and check rewards', async () => {
      currentBlock = new BN(await Helper.getCurrentBlock());
      let startBlock = currentBlock.add(new BN(6));
      let endBlock = startBlock.add(new BN(10));
      let rewardPerBlocks = generateRewardPerBlocks();
      let pid = await addNewPool(startBlock, endBlock, rewardPerBlocks);
      let amount = precisionUnits.mul(new BN(2));
      await depositAndVerifyData(user1, pid, amount, false);
      await depositAndVerifyData(user2, pid, amount, true);

      // withdraw when not started yet, no reward claimed
      // Note: rewards have not been set to the fairlaunch yet, means it won't revert because reward is 0
      amount = precisionUnits.div(new BN(10));
      await withdrawAndVerifyData(user1, pid, amount, false);

      await Helper.increaseBlockNumberTo(startBlock.add(new BN(1)));

      for(let i = 0; i < rewardTokens.length; i++) {
        let amount = rewardPerBlocks[i].mul(endBlock.sub(startBlock)).mul(new BN(10));
        await transferToken(rewardTokens[i], accounts[0], fairLaunch.address, amount);
      }

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
      let poolData = await fairLaunch.getPoolInfo(pid);
      let user1Data = await fairLaunch.getUserInfo(pid, user1);
      let user2Data = await fairLaunch.getUserInfo(pid, user2);

      await Helper.assertEqual(poolInfo[pid].endBlock, poolData.lastRewardBlock);
      await Helper.assertEqualArray(user1Data.lastRewardPerShares, poolData.accRewardPerShares);
      await Helper.assertEqualArray(user2Data.lastRewardPerShares, poolData.accRewardPerShares);
      for(let i = 0; i < rewardTokens.length; i++) {
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
      currentBlock = new BN(await Helper.getCurrentBlock());
      let rewardPerBlocks = [
        precisionUnits, precisionUnits.div(new BN(3))
      ];
      let pid = await addNewPool(currentBlock.add(new BN(4)), currentBlock.add(new BN(20)), rewardPerBlocks);
      await fairLaunch.deposit(pid, precisionUnits, false, {from: user1});
      await Helper.increaseBlockNumberTo(poolInfo[pid].startBlock);
      await expectRevert.unspecified(fairLaunch.harvest(pid, {from: user1}));
      for(let i = 0; i < rewardTokens.length; i++) {
        await transferToken(rewardTokens[i], accounts[0], fairLaunch.address, precisionUnits.mul(new BN(10)));
      }
      await fairLaunch.harvest(pid, {from: user1});
    });

    it('harvest and check rewards', async () => {
      let amount = precisionUnits.div(new BN(10));
      currentBlock = new BN(await Helper.getCurrentBlock());
      let startBlock = currentBlock.add(new BN(6));
      let endBlock = startBlock.add(new BN(20));
      let rewardPerBlocks = generateRewardPerBlocks();
      let pid = await addNewPool(startBlock, endBlock, rewardPerBlocks);

      amount = precisionUnits.mul(new BN(2));
      await depositAndVerifyData(user1, pid, amount, false);
      await depositAndVerifyData(user2, pid, amount, true);

      // harvest when not started yet, no reward claimed
      // Note: rewards have not been set to the fairlaunch yet, means it won't revert because reward is 0
      await harvestAndVerifyData(user1, pid);

      await Helper.increaseBlockNumberTo(startBlock.add(new BN(2)));

      for(let i = 0; i < rewardTokens.length; i++) {
        let amount = rewardPerBlocks[i].mul(endBlock.sub(startBlock)).mul(new BN(10));
        await transferToken(rewardTokens[i], accounts[0], fairLaunch.address, amount);
      }

      // harvest reward
      await harvestAndVerifyData(user1, pid);
      await Helper.increaseBlockNumber(2);
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
      await Helper.increaseBlockNumberTo(poolInfo[pid].endBlock);

      await harvestAndVerifyData(user1, pid);
      await withdrawAndVerifyData(user2, pid, userInfo[user2][pid].amount, true);
      await harvestAndVerifyData(user2, pid);

      // extra verification
      let poolData = await fairLaunch.getPoolInfo(pid);
      let user1Data = await fairLaunch.getUserInfo(pid, user1);
      let user2Data = await fairLaunch.getUserInfo(pid, user2);

      await Helper.assertEqual(poolInfo[pid].endBlock, poolData.lastRewardBlock);
      await Helper.assertEqual(user1Data.lastRewardPerShares, poolData.accRewardPerShares);
      await Helper.assertEqual(user2Data.lastRewardPerShares, poolData.accRewardPerShares);
      for(let i = 0; i < rewardTokens.length; i++) {
        await Helper.assertEqual(new BN(0), user2Data.unclaimedRewards[i]);
        await Helper.assertEqual(user1Data.unclaimedRewards[i], new BN(0));
      }
    });

    it('harvest multiple pools and check rewards', async () => {
      currentBlock = new BN(await Helper.getCurrentBlock());
      let startBlock = currentBlock.add(new BN(10));
      let endBlock = startBlock.add(new BN(22));
      let rewardPerBlocks = generateRewardPerBlocks();
      let pid1 = await addNewPool(startBlock, endBlock, rewardPerBlocks);
      rewardPerBlocks = generateRewardPerBlocks();
      let pid2 = await addNewPool(startBlock, startBlock.add(new BN(20)), rewardPerBlocks);
      let amount = precisionUnits.mul(new BN(2));
      await depositAndVerifyData(user1, pid1, amount, false);
      await depositAndVerifyData(user2, pid1, amount.add(new BN(1)), true);

      amount = precisionUnits;
      await depositAndVerifyData(user1, pid1, amount, false);
      await depositAndVerifyData(user2, pid1, amount.add(new BN(100)), true);

      // harvest when not started yet, no reward claimed
      // Note: rewards have not been set to the fairlaunch yet, means it won't revert because reward is 0
      await harvestMultiplePoolsAndVerifyData(user1, [pid1, pid2]);
      await Helper.increaseBlockNumberTo(startBlock.add(new BN(2)));

      for(let i = 0; i < rewardTokens.length; i++) {
        let amount = rewardPerBlocks[i].mul(endBlock.sub(startBlock)).mul(new BN(10));
        await transferToken(rewardTokens[i], accounts[0], fairLaunch.address, amount);
      }

      await harvestMultiplePoolsAndVerifyData(user1, [pid1, pid2]);
      // harvest same pid
      await harvestMultiplePoolsAndVerifyData(user2, [pid1, pid1]);

      await depositAndVerifyData(user1, pid1, amount, false);
      await depositAndVerifyData(user2, pid2, amount, false);

      await harvestMultiplePoolsAndVerifyData(user1, [pid1]);
      await harvestMultiplePoolsAndVerifyData(user1, [pid2]);
      // harvest same pid
      await harvestMultiplePoolsAndVerifyData(user2, [pid1, pid2]);

      await Helper.increaseBlockNumberTo(poolInfo[pid1].endBlock);

      await harvestMultiplePoolsAndVerifyData(user1, [pid1, pid2]);
      await harvestMultiplePoolsAndVerifyData(user2, [pid1, pid2]);
      // extra verification
      let pids = [pid1, pid2];
      for (let i = 0; i < pids.length; i++) {
        let pid = pids[i];

        let poolData = await fairLaunch.getPoolInfo(pid);
        let user1Data = await fairLaunch.getUserInfo(pid, user1);
        let user2Data = await fairLaunch.getUserInfo(pid, user2);

        await Helper.assertEqual(poolInfo[pid].endBlock, poolData.lastRewardBlock);
        await Helper.assertEqual(user1Data.lastRewardPerShares, poolData.accRewardPerShares);
        await Helper.assertEqual(user2Data.lastRewardPerShares, poolData.accRewardPerShares);
        for(let i = 0; i < rewardTokens.length; i++) {
          await Helper.assertEqual(new BN(0), user2Data.unclaimedRewards[i]);
          await Helper.assertEqual(user1Data.unclaimedRewards[i], new BN(0));
        }
      }
    });

    it('harvest: exact amount of reward tokens in FairLaunch', async () => {
      currentBlock = new BN(await Helper.getCurrentBlock());
      let startBlock = currentBlock.add(new BN(6));
      let duration = new BN(6);
      let endBlock = startBlock.add(duration);
      let rewardPerBlocks = generateRewardPerBlocks();
      let pid = await addNewPool(startBlock, endBlock, rewardPerBlocks);

      let totalAmount = precisionUnits;
      let amount1 = precisionUnits;
      await depositAndVerifyData(user1, pid, amount1, false);
      let amount2 = precisionUnits.mul(new BN(2));
      totalAmount = totalAmount.add(amount2);
      await depositAndVerifyData(user2, pid, amount2, true);

      // delay to end block
      await Helper.increaseBlockNumberTo(endBlock.add(new BN(1)));

      
      let user1Rewards = [];
      let user2Rewards = [];
      for(let i = 0; i < rewardTokens.length; i++) {
        let rewardPerShare = duration.mul(rewardPerBlocks[i]).mul(REWARD_PER_SHARE_PRECISION).div(totalAmount);
        user1Rewards.push(rewardPerShare.mul(amount1).div(REWARD_PER_SHARE_PRECISION));
        user2Rewards.push(rewardPerShare.mul(amount2).div(REWARD_PER_SHARE_PRECISION));
      }

      currentBlock = await Helper.getCurrentBlock();
      let user1PendingRewards = getUserPendingRewards(user1, pid, currentBlock);
      let user2PendingRewards = getUserPendingRewards(user2, pid, currentBlock);
      for(let i = 0; i < rewardTokens.length; i++) {
        Helper.assertEqual(user1Rewards[i], user1PendingRewards[i]);
        Helper.assertEqual(user2Rewards[i], user2PendingRewards[i]);
        await transferToken(rewardTokens[i], accounts[0], fairLaunch.address, user1Rewards[i].add(user2Rewards[i]));
      }
      await harvestAndVerifyData(user1, pid);
      await harvestAndVerifyData(user2, pid);
      for(let i = 0; i < rewardTokens.length; i++) {
        Helper.assertEqual(
          new BN(0), await balanceOf(rewardTokens[i], fairLaunch.address)
        )
      }
    });
  });

  describe('#emergency withdraw', async () => {
    beforeEach('deploy contracts', async () => {
      await deployContracts([kncToken, secondRewardToken]);
    });

    // no reward has been transferred out, since there is no reward in the fairlaunch contract
    it('emergencyWithdraw and check data', async () => {
      currentBlock = new BN(await Helper.getCurrentBlock());
      let startBlock = currentBlock.add(new BN(16));
      let rewardPerBlocks = generateRewardPerBlocks();
      let pid1 = await addNewPool(startBlock, startBlock.add(new BN(6)), rewardPerBlocks);
      let pid2 = await addNewPool(startBlock, startBlock.add(new BN(12)), rewardPerBlocks);
      let amount = precisionUnits.mul(new BN(2));
      await depositAndVerifyData(user1, pid1, amount, false);
      amount = precisionUnits.mul(new BN(5));
      await depositAndVerifyData(user2, pid1, amount, true);
      await depositAndVerifyData(user1, pid2, amount, false);
      amount = precisionUnits.mul(new BN(3));
      await depositAndVerifyData(user1, pid2, amount, false);

      await Helper.increaseBlockNumber(startBlock.add(new BN(12)));

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
            blockNumber: new BN(await Helper.getCurrentBlock()),
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
      for(let i = 0; i < rewardTokens.length; i++) {
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
        let poolLength = 0;
        for (let i = 0; i < numberRuns; i++) {
          let isUserAction = Helper.getRandomInt(0, 100) >= 10; // 90% user's actions
          let userAction = Helper.getRandomInt(0, 4);
          let adminAction = Helper.getRandomInt(0, 3);
          currentBlock = await Helper.getCurrentBlock();
          if (poolLength == 0 || (!isUserAction && adminAction == AdminActions.AddPool)) {
            let startBlock = new BN(currentBlock + Helper.getRandomInt(5, 10));
            let endBlock = startBlock.add(new BN(Helper.getRandomInt(5, numberRuns - i + 5)));
            let rewardPerBlocks = generateRewardPerBlocks();
            if (poolLength == tokens.length) {
              // all tokens have been added, will get duplicated token
              console.log(`Loop ${i}: Expect add pool reverts`);
              await expectRevert(
                fairLaunch.addPool(tokens[i % tokens.length].address, startBlock, endBlock, rewardPerBlocks, {
                  from: admin,
                }),
                'add: duplicated pool'
              );
              continue;
            }
            poolLength += 1;
            for(let r = 0; r < rewardTokens.length; r++) {
              await transferToken(rewardTokens[r], accounts[0], fairLaunch.address, rewardPerBlocks[r].mul(endBlock.sub(startBlock)));
            }
            console.log(
              `Loop ${i}: Add pool ${tokens[poolLength - 1].address} ${startBlock.toString(10)} ${endBlock.toString(
                10
              )}`
            );
            await addNewPool(startBlock, endBlock, rewardPerBlocks);
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
            let rewardPerBlocks = generateRewardPerBlocks();
            let pid = Helper.getRandomInt(0, poolLength - 1);
            if (adminAction == AdminActions.UpdatePool) {
              let endBlock = new BN(currentBlock + Helper.getRandomInt(5, numberRuns - i + 5));
              if (new BN(currentBlock + 1).gt(poolInfo[pid].endBlock)) {
                console.log(`Loop ${i}: Expect update pool reverts`);
                // already ended
                await expectRevert(
                  fairLaunch.updatePool(pid, endBlock, rewardPerBlocks, {from: admin}),
                  'update: pool already ended'
                );
              } else {
                console.log(`Loop ${i}: Update pool: ${pid} ${endBlock.toString(10)}`);
                await fairLaunch.updatePool(pid, endBlock, rewardPerBlocks, {from: admin});
                currentBlock = await Helper.getCurrentBlock();
                poolInfo[pid] = updatePoolReward(poolInfo[pid], currentBlock);
                poolInfo[pid].endBlock = endBlock;
                poolInfo[pid].rewardPerBlocks = rewardPerBlocks;
                for(let r = 0; r < rewardTokens.length; r++) {
                  await transferToken(rewardTokens[r], accounts[0], fairLaunch.address, rewardPerBlocks[r].mul(endBlock.sub(new BN(currentBlock))));
                }
              }
            } else {
              // renew pool
              let startBlock = new BN(currentBlock + Helper.getRandomInt(5, 10));
              let endBlock = startBlock.add(new BN(Helper.getRandomInt(5, numberRuns - i + 5)));
              let rewardPerBlocks = generateRewardPerBlocks();
              if (
                new BN(currentBlock + 1).gt(poolInfo[pid].endBlock) ||
                new BN(currentBlock + 1).lt(poolInfo[pid].startBlock)
              ) {
                await fairLaunch.renewPool(pid, startBlock, endBlock, rewardPerBlocks, {from: admin});
                console.log(
                  `Loop ${i}: Renew pool: ${pid} ${startBlock.toString(10)} ${endBlock.toString(
                    10
                  )}`
                );
                currentBlock = await Helper.getCurrentBlock();
                poolInfo[pid] = updatePoolInfoOnRenew(
                  poolInfo[pid],
                  startBlock,
                  endBlock,
                  rewardPerBlocks,
                  currentBlock
                );
                for(let r = 0; r < rewardTokens.length; r++) {
                  await transferToken(rewardTokens[r], accounts[0], fairLaunch.address, rewardPerBlocks[r].mul(endBlock.sub(startBlock)));
                }
              } else {
                console.log(`Loop ${i}: Expect renew pool reverts`);
                // // currently active
                await expectRevert(
                  fairLaunch.renewPool(pid, startBlock, endBlock, rewardPerBlocks, {from: admin}),
                  'renew: invalid pool state to renew'
                );
              }
            }
          }
        }
      });
    });
  }

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
      blockNumber: new BN(await Helper.getCurrentBlock()),
      amount: amount,
    });
    Helper.assertEqual(userBalBefore.sub(amount), await poolData.stakeToken.balanceOf(user));
    Helper.assertEqual(poolBalBefore.add(amount), await poolData.stakeToken.balanceOf(fairLaunch.address));
    let currentBlock = await Helper.getCurrentBlock();
    let claimedAmounts = [];
    [userInfo[user][pid], poolInfo[pid], claimedAmounts] = updateInfoOnDeposit(
      userInfo[user][pid],
      poolInfo[pid],
      amount,
      currentBlock,
      isHarvesting
    );

    for(let i = 0; i < claimedAmounts.length; i++) {
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
    currentBlock = await Helper.getCurrentBlock();
    expectEvent(tx, 'Withdraw', {
      user: user,
      pid: poolData.id,
      blockNumber: new BN(currentBlock),
      amount: amount
    });
    Helper.assertEqual(userBalBefore.add(amount), await poolData.stakeToken.balanceOf(user));
    Helper.assertEqual(poolBalBefore.sub(amount), await poolData.stakeToken.balanceOf(fairLaunch.address));
    let claimedAmounts = [];
    [userInfo[user][pid], poolInfo[pid], claimedAmounts] = updateInfoOnWithdraw(
      userInfo[user][pid],
      poolInfo[pid],
      amount,
      currentBlock
    );
    for(let i = 0; i < rewardTokens.length; i++) {
      userClaimData[user][i].iadd(claimedAmounts[i]);
    }

    await verifyContractData(tx, user, pid, poolRewardBalances, lockerRewardBalances, claimedAmounts);
  };

  const harvestMultiplePoolsAndVerifyData = async (user, pids) => {
    let poolRewardBalances = [];
    let lockerRewardBalances = [];
    for (let i = 0; i < rewardTokens.length; i++) {
      poolRewardBalances.push(await balanceOf(rewardTokens[i], fairLaunch.address));
      lockerRewardBalances.push(await balanceOf(rewardTokens[i], rewardLocker.address));
    }

    let tx = await fairLaunch.harvestMultiplePools(pids, {from: user});

    currentBlock = await Helper.getCurrentBlock();
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
        currentBlock
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
            blockNumber: new BN(currentBlock),
            lockedAmount: claimedAmounts[j],
          });
        }
      }
    }
    for (let i = 0; i < rewardTokens.length; i++) {
      if (totalClaimedAmounts[i].gt(new BN(0)) && rewardTokens[i] != zeroAddress) {
        // expect there is only 1 transfer happens
        await expectEvent.inTransaction(tx.tx, rewardTokens[i], 'Transfer', {
          from: fairLaunch.address,
          to: rewardLocker.address,
          value: totalClaimedAmounts[i],
        });
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

    currentBlock = await Helper.getCurrentBlock();
    let claimedAmounts = [];
    [userInfo[user][pid], poolInfo[pid], claimedAmounts] = updateInfoOnHarvest(
      userInfo[user][pid],
      poolInfo[pid],
      currentBlock
    );
    for(let i = 0; i < rewardTokens.length; i++) {
      userClaimData[user][i].iadd(claimedAmounts[i]);
    }

    await verifyContractData(tx, user, pid, poolRewardBalances, lockerRewardBalances, claimedAmounts);
  };

  const verifyContractData = async (tx, user, pid, poolRewardBalances, lockerRewardBalances, rewardClaimedAmounts) => {
    currentBlock = await Helper.getCurrentBlock();
    for(let i = 0; i < rewardTokens.length; i++) {
      if (rewardClaimedAmounts[i].gt(new BN(0))) {
        expectEvent(tx, 'Harvest', {
          user: user,
          pid: new BN(pid),
          blockNumber: new BN(currentBlock),
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
    Helper.assertEqualArray(poolData.rewardPerBlocks, onchainData.rewardPerBlocks);
    Helper.assertEqualArray(poolData.accRewardPerShares, onchainData.accRewardPerShares);
    Helper.assertEqual(poolData.totalStake, onchainData.totalStake);
    Helper.assertEqual(poolData.stakeToken.address, onchainData.stakeToken);
    Helper.assertEqual(poolData.startBlock, onchainData.startBlock);
    Helper.assertEqual(poolData.endBlock, onchainData.endBlock);
    Helper.assertEqual(poolData.lastRewardBlock, onchainData.lastRewardBlock);
  };

  const verifyUserInfo = async (user, pid, userData) => {
    let onchainData = await fairLaunch.getUserInfo(pid, user);
    Helper.assertEqual(userData.amount, onchainData.amount);
    Helper.assertEqual(userData.unclaimedRewards, onchainData.unclaimedRewards);
    Helper.assertEqual(userData.lastRewardPerShares, onchainData.lastRewardPerShares);
  };

  const verifyPendingRewards = async (pid, users) => {
    currentBlock = await Helper.getCurrentBlock();
    for (let i = 0; i < users.length; i++) {
      let pendingRewards = getUserPendingRewards(users[i], pid, currentBlock);
      Helper.assertEqualArray(pendingRewards, await fairLaunch.pendingRewards(pid, users[i]));
    }
  };

  const verifyRewardData = async (user, poolBalances, lockerBalances, rewardAmounts) => {
    for (let i = 0; i < rewardTokens.length; i++) {
      let rewardAddress = rewardTokens[i] == zeroAddress ? zeroAddress : rewardTokens[i].address;
      Helper.assertEqual(poolBalances[i].sub(rewardAmounts[i]), await balanceOf(rewardTokens[i], fairLaunch.address));
      Helper.assertEqual(lockerBalances[i].add(rewardAmounts[i]), await balanceOf(rewardTokens[i], rewardLocker.address));
      Helper.assertEqual(userClaimData[user][i], await rewardLocker.lockedAmounts(user, rewardAddress));
    }
  };

  const transferToken = async (token, from, to, amount) => {
    if (token == zeroAddress) {
      await Helper.sendEtherWithPromise(from, to, amount);
    } else {
      await token.transfer(to, amount, { from: from});
    }
  }

  const balanceOf = async (token, account) => {
    if (token == zeroAddress) {
      return await Helper.getBalancePromise(account);
    }
    return await token.balanceOf(account);
  }
});

function emptyUserInfo() {
  let info = {
    amount: new BN(0),
    unclaimedRewards: [],
    lastRewardPerShares: [],
  };
  for(let i = 0; i < rewardTokens.length; i++) {
    info.unclaimedRewards.push(new BN(0));
    info.lastRewardPerShares.push(new BN(0));
  }
  return info;
}

function generateRewardPerBlocks() {
  let rewardPerBlocks = [];
  for(let i = 0; i < rewardTokens.length; i++) {
    let randomNum = rewardTokens[i] == zeroAddress ? Helper.getRandomInt(32, 100) : Helper.getRandomInt(1, 10);;
    rewardPerBlocks.push(precisionUnits.div(new BN(randomNum)));
  }
  return rewardPerBlocks;
}

function getUserPendingRewards(user, pid, currentBlock) {
  let poolData = updatePoolReward(poolInfo[pid], currentBlock);
  let userData = userInfo[user][pid];
  let rewards = [];
  for(let i = 0; i < rewardTokens.length; i++) {
    let newReward = poolData.accRewardPerShares[i]
      .sub(userData.lastRewardPerShares[i])
      .mul(userData.amount)
      .div(REWARD_PER_SHARE_PRECISION);
    rewards.push(newReward.add(userData.unclaimedRewards[i]));
  }
  return rewards;
}

// assume user doesn't harvest
function updateInfoOnDeposit(userData, poolData, amount, currentBlock, isHarvesting) {
  poolData = updatePoolReward(poolData, currentBlock);
  if (userData.amount.gt(new BN(0))) {
    // first time deposit
    for(let i = 0; i < rewardTokens.length; i++) {
      let newReward = userData.amount.mul(poolData.accRewardPerShares[i].sub(userData.lastRewardPerShares[i]));
      newReward = newReward.div(REWARD_PER_SHARE_PRECISION);
      userData.unclaimedRewards[i] = userData.unclaimedRewards[i].add(newReward);
    }
  }
  userData.amount = userData.amount.add(amount);
  poolData.totalStake = poolData.totalStake.add(amount);
  let claimedAmounts = [];
  for(let i = 0; i < rewardTokens.length; i++) {
    claimedAmounts.push(
      isHarvesting ? userData.unclaimedRewards[i] : new BN(0)
    );
    if (isHarvesting) userData.unclaimedRewards[i] = new BN(0);
    userData.lastRewardPerShares[i] = poolData.accRewardPerShares[i];
  }

  return [userData, poolData, claimedAmounts];
}

function updateInfoOnWithdraw(userData, poolData, amount, currentBlock) {
  poolData = updatePoolReward(poolData, currentBlock);
  if (userData.amount.gt(new BN(0))) {
    for(let i = 0; i < rewardTokens.length; i++) {
      let newReward = userData.amount.mul(poolData.accRewardPerShares[i].sub(userData.lastRewardPerShares[i]));
      newReward = newReward.div(REWARD_PER_SHARE_PRECISION);
      userData.unclaimedRewards[i] = userData.unclaimedRewards[i].add(newReward);
    }
  }
  let claimedAmounts = [];
  for(let i = 0; i < rewardTokens.length; i++) {
    claimedAmounts.push(userData.unclaimedRewards[i]);
    userData.unclaimedRewards[i] = new BN(0);
    userData.lastRewardPerShares[i] = poolData.accRewardPerShares[i];
  }
  userData.amount = userData.amount.sub(amount);
  poolData.totalStake = poolData.totalStake.sub(amount);
  return [userData, poolData, claimedAmounts];
}

function updateInfoOnHarvest(userData, poolData, currentBlock) {
  poolData = updatePoolReward(poolData, currentBlock);
  if (userData.amount.gt(new BN(0))) {
    for(let i = 0; i < rewardTokens.length; i++) {
      let newReward = userData.amount.mul(poolData.accRewardPerShares[i].sub(userData.lastRewardPerShares[i]));
      newReward = newReward.div(REWARD_PER_SHARE_PRECISION);
      userData.unclaimedRewards[i] = userData.unclaimedRewards[i].add(newReward);
    }
  }
  let claimedAmounts = [];
  for(let i = 0; i < rewardTokens.length; i++) {
    claimedAmounts.push(userData.unclaimedRewards[i]);
    userData.unclaimedRewards[i] = new BN(0);
    userData.lastRewardPerShares[i] = poolData.accRewardPerShares[i];
  }

  return [userData, poolData, claimedAmounts];
}

function updatePoolInfoOnRenew(poolData, startBlock, endBlock, rewardPerBlocks, currentBlock) {
  poolData = updatePoolReward(poolData, currentBlock);
  poolData.startBlock = startBlock;
  poolData.endBlock = endBlock;
  poolData.rewardPerBlocks = rewardPerBlocks;
  poolData.lastRewardBlock = startBlock;
  return poolData;
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
  let numBlocks = lastAccountedBlock.sub(poolData.lastRewardBlock);
  for(let i = 0; i < rewardTokens.length; i++) {
    let newReward = numBlocks.mul(poolData.rewardPerBlocks[i]);
    let increaseRewardPerShare = newReward.mul(REWARD_PER_SHARE_PRECISION).div(poolData.totalStake);
    poolData.accRewardPerShares[i] = poolData.accRewardPerShares[i].add(increaseRewardPerShare);
  }
  poolData.lastRewardBlock = lastAccountedBlock;
  return poolData;
}

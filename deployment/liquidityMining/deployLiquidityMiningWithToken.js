require('@nomiclabs/hardhat-ethers');
const fs = require('fs');
const path = require('path');

let gasPrice;
async function setContractForRewardToken(locker, token, fairLaunch) {
  let addresses = await locker.getRewardContractsPerToken(token);
  for (let i = 0; i < addresses.length; i++) {
    if (addresses[i] == fairLaunch) return;
  }
  console.log(`Add reward contract ${fairLaunch} for ${token}`)
  await locker.addRewardsContract(token, fairLaunch, { gasPrice: gasPrice });
}

async function verifyContract(hre, contractAddress, ctorArgs) {
  await hre.run('verify:verify', {
    address: contractAddress,
    constructorArguments: ctorArgs,
  });
}

let deployerAddress;
let lockerAddress;
let lockerDuration;
let fairLaunchConfigs = [];
let outputFilename;

task('deployLiquidityMiningWithToken', 'deploy liquidity mining contracts')
  .addParam('input', 'The input file')
  .addParam('gasprice', 'The gas price (in gwei) for all transactions')
  .setAction(async (taskArgs, hre) => {
    const configPath = path.join(__dirname, `./${taskArgs.input}`);
    const configParams = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    parseInput(configParams);

    const BN = ethers.BigNumber;
    const [deployer] = await ethers.getSigners();
    deployerAddress = await deployer.getAddress();
    console.log(`Deployer address: ${deployerAddress}`)

    let outputData = {};
    gasPrice = new BN.from(10**9 * taskArgs.gasprice);
    console.log(`Deploy gas price: ${gasPrice.toString(10)} (${taskArgs.gasprice} gweis)`);

    const KyberRewardLocker = await ethers.getContractFactory('KyberRewardLocker');
    let rewardLocker;
    if (lockerAddress == undefined) {
        rewardLocker = await KyberRewardLocker.deploy(deployerAddress, { gasPrice: gasPrice });
        await rewardLocker.deployed();
        lockerAddress = rewardLocker.address;
    } else {
        rewardLocker = await KyberRewardLocker.attach(lockerAddress);
    }
    console.log(`RewardLocker address: ${rewardLocker.address}`);
    outputData["RewardLocker"] = rewardLocker.address;
    outputData["LockDuration"] = lockerDuration;

    for (let i = 0; i < fairLaunchConfigs.length; i++) {
      if (fairLaunchConfigs[i].address != undefined) {
        console.log(`FairLaunch ${i}: ${fairLaunchConfigs[i].address}`);
        continue;
      }
      const KyberFairLaunch = await ethers.getContractFactory('KyberFairLaunch');
      let fairLaunch;
      fairLaunch = await KyberFairLaunch.deploy(
        deployerAddress, fairLaunchConfigs[i].rewardTokens, rewardLocker.address,
        { gasPrice: gasPrice }
      )
      await fairLaunch.deployed();
      fairLaunchConfigs[i].address = fairLaunch.address;
      console.log(`FairLaunch ${i}: ${fairLaunch.address}`);
    }

    outputData["FairLaunches"] = fairLaunchConfigs;

    for (let i = 0; i < fairLaunchConfigs.length; i++) {
      let contractData = fairLaunchConfigs[i];
      const KyberFairLaunch = await ethers.getContractFactory('KyberFairLaunch');
      let fairLaunch = await KyberFairLaunch.attach(contractData.address);

      console.log(`Add FairLaunch to RewardLocker`);
      for(let j = 0; j < contractData.rewardTokens.length; j++) {
        await setContractForRewardToken(
          rewardLocker,
          contractData.rewardTokens[j],
          fairLaunch.address
        );
        await rewardLocker.setVestingDuration(
          contractData.rewardTokens[j], lockerDuration,
          { gasPrice: gasPrice }
        );
      }

      console.log(`Add Pools to FairLaunch`);
      let precision = new BN.from(10).pow(new BN.from(18));
      for (let j = 0; j < contractData.poolInfos.length; j++) {
        let poolData = contractData.poolInfos[j];
        let poolExist = await fairLaunch.poolExists(poolData.stakeToken);
        let numBlocks = new BN.from(poolData.endBlock - poolData.startBlock);
        let rewardPerBlocks = [];
        for (let k = 0; k < poolData.totalRewards.length; k++) {
          let reward = new BN.from(poolData.totalRewards[k]).mul(precision)
          rewardPerBlocks.push(reward.div(numBlocks))
        }
        if (poolExist == false) {
          await fairLaunch.addPool(
            poolData.stakeToken,
            poolData.startBlock,
            poolData.endBlock,
            rewardPerBlocks,
            { gasPrice: gasPrice }
          );
          console.log(`Add pool with stakeToken: ${poolData.stakeToken} startBlock: ${poolData.startBlock} endBlock: ${poolData.endBlock}`);
        }
      }
    }

    // console.log(`Verify reward locker at: ${rewardLocker.address}`);
    // await verifyContract(hre, rewardLocker.address, [deployerAddress]);
    for (let i = 0; i < fairLaunchConfigs.length; i++) {
      console.log(`Verify fairlaunch  at: ${fairLaunchConfigs[i].address}`);
      await verifyContract(
        hre, fairLaunchConfigs[i].address,
        [deployerAddress, fairLaunchConfigs[i].rewardTokens, rewardLocker.address]
      );
    }

    exportAddresses(outputData);
    console.log('setup completed');
    process.exit(0);
  }
);

function parseInput(jsonInput) {
  lockerAddress = jsonInput["RewardLocker"];
  lockerDuration = jsonInput["LockerDuration"];
  fairLaunchConfigs = [];
  let configs = jsonInput["FairLaunchConfigs"];
  if (configs == undefined) configs = [];
  for (let i = 0; i < configs.length; i++) {
    let data = {
      address: configs[i]["address"],
      rewardTokens: configs[i]["rewardTokens"],
      poolInfos: [],
    };
    let poolInfoData = configs[i]["poolInfo"];
    if (poolInfoData != undefined) {
      for (let j = 0; j < poolInfoData.length; j++) {
        let poolData = poolInfoData[j];
        data.poolInfos.push({
          stakeToken: poolData["stakeToken"],
          startBlock: poolData["startBlock"],
          endBlock: poolData["endBlock"],
          totalRewards: poolData["totalRewards"]
        });
      }
    }
    fairLaunchConfigs.push(data);
  }
  outputFilename = jsonInput["outputFilename"];
}

function exportAddresses(dictOutput) {
  let json = JSON.stringify(dictOutput, null, 2);
  fs.writeFileSync(path.join(__dirname, outputFilename), json);
}

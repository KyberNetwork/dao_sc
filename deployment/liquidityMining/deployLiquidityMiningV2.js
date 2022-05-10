require('@nomiclabs/hardhat-ethers');
const fs = require('fs');
const path = require('path');

let gasPrice;
async function setContractForRewardToken(locker, token, fairLaunch) {
  let addresses = await locker.getRewardContractsPerToken(token);
  for (let i = 0; i < addresses.length; i++) {
    if (addresses[i] == fairLaunch) return;
  }
  console.log(`Add reward contract ${fairLaunch} for ${token}`);
  await locker.addRewardsContract(token, fairLaunch, {gasPrice: gasPrice});
}

async function verifyContract(hre, contractAddress, ctorArgs) {
  await hre.run('verify:verify', {
    address: contractAddress,
    constructorArguments: ctorArgs,
  });
}

let deployerAddress;
let lockerAddress;
let fairLaunchConfigs = [];
let outputFilename;

task('deployLiquidityMiningV2', 'deploy liquidity mining V2 contracts')
  .addParam('input', 'The input file')
  .addParam('gasprice', 'The gas price (in gwei) for all transactions')
  .setAction(async (taskArgs, hre) => {
    const configPath = path.join(__dirname, `./${taskArgs.input}`);
    const configParams = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    parseInput(configParams);

    const BN = ethers.BigNumber;
    const [deployer] = await ethers.getSigners();
    deployerAddress = await deployer.getAddress();
    console.log(`Deployer address: ${deployerAddress}`);

    let outputData = {};
    gasPrice = new BN.from(10 ** 9 * taskArgs.gasprice);
    console.log(`Deploy gas price: ${gasPrice.toString()} (${taskArgs.gasprice} gweis)`);

    const KyberRewardLockerV2 = await ethers.getContractFactory('KyberRewardLockerV2');
    let rewardLocker;

    if (lockerAddress == undefined) {
      console.log('deploy new ');
      rewardLocker = await KyberRewardLockerV2.deploy(deployerAddress, {gasPrice: gasPrice});
      await rewardLocker.deployed();
      lockerAddress = rewardLocker.address;
    } else {
      console.log('use old ');
      rewardLocker = await KyberRewardLockerV2.attach(lockerAddress);
    }
    console.log(`RewardLockerV2 address: ${rewardLocker.address}`);
    outputData['RewardLockerV2'] = rewardLocker.address;

    // // FOR TESTING LOCALLY
    // // let MockToken = await ethers.getContractFactory('MockToken');
    // // let rewardToken = await MockToken.deploy('R', 'R', new BN.from(1_000_000));
    // // END

    for (let i = 0; i < fairLaunchConfigs.length; i++) {
      // FOR TESTING LOCALLY
      // fairLaunchConfigs[i].rewardTokens = [rewardToken.address];
      // END
      if (fairLaunchConfigs[i].address != undefined) {
        console.log(`FairLaunch ${i}: ${fairLaunchConfigs[i].address}`);
        continue;
      }
      const KyberFairLaunch = await ethers.getContractFactory('KyberFairLaunchV2');
      let fairLaunch;
      
      fairLaunch = await KyberFairLaunch.deploy(
          deployerAddress,
          fairLaunchConfigs[i].rewardTokens,
          rewardLocker.address,
          {gasPrice: gasPrice}
          );
          await fairLaunch.deployed();
          fairLaunchConfigs[i].address = fairLaunch.address;
          console.log(`FairLaunch ${i}: ${fairLaunch.address}`);
    }

    outputData['FairLaunches'] = fairLaunchConfigs;

    for (let i = 0; i < fairLaunchConfigs.length; i++) {
      let contractData = fairLaunchConfigs[i];
      const KyberFairLaunch = await ethers.getContractFactory('KyberFairLaunchV2');
      let fairLaunch = await KyberFairLaunch.attach(contractData.address);

      console.log(`Add FairLaunch to RewardLocker`);
      for (let j = 0; j < contractData.rewardTokens.length; j++) {
        await setContractForRewardToken(rewardLocker, contractData.rewardTokens[j], fairLaunch.address);
      }

      console.log(`Add Pools to FairLaunch`);

      for (let j = 0; j < contractData.poolInfos.length; j++) {
        let poolData = contractData.poolInfos[j];
        let poolExist = await fairLaunch.poolExists(poolData.stakeToken);
        
        if (poolExist == false) {
          await fairLaunch.addPool(
            poolData.stakeToken,
            poolData.startTime,
            poolData.endTime,
            poolData.vestingDuration,
            poolData.totalRewards,
            poolData.name,
            poolData.symbol,
            {gasPrice: gasPrice}
          );
          console.log(
            `Add pool with stakeToken: ${poolData.stakeToken} startTime: ${poolData.startTime} endTime: ${poolData.endTime}`
          );
        }
      }
    }

    try {
      console.log(`Verify reward locker at: ${rewardLocker.address}`);
      await verifyContract(hre, rewardLocker.address, [deployerAddress]);
    } catch (e) {
      console.log(`Error in verify reward locker, continue...`);
    }

    try {
      for (let i = 0; i < fairLaunchConfigs.length; i++) {
        console.log(`Verify fairlaunch at: ${fairLaunchConfigs[i].address}`);
        await verifyContract(hre, fairLaunchConfigs[i].address, [
          deployerAddress,
          fairLaunchConfigs[i].rewardTokens,
          rewardLocker.address,
        ]);
      }
    } catch (e) {
      console.log(`Error in verify fair launch, continue...`);
    }

    exportAddresses(outputData);
    console.log('setup completed');
    process.exit(0);
  });

function parseInput(jsonInput) {
  lockerAddress = jsonInput['RewardLockerV2'];
  fairLaunchConfigs = [];
  let configs = jsonInput['FairLaunches'];
  if (configs == undefined) configs = [];
  for (let i = 0; i < configs.length; i++) {
    let data = {
      address: configs[i]['address'],
      rewardTokens: configs[i]['rewardTokens'],
      poolInfos: [],
    };
    let poolInfoData = configs[i]['poolInfo'];
    if (poolInfoData != undefined) {
      for (let j = 0; j < poolInfoData.length; j++) {
        let poolData = poolInfoData[j];
        data.poolInfos.push({
          stakeToken: poolData['stakeToken'],
          startTime: poolData['startTime'],
          endTime: poolData['endTime'],
          totalRewards: poolData['totalRewards'],
          vestingDuration: poolData['vestingDuration'],
          name: poolData['tokenName'],
          symbol: poolData['tokenSymbol'],
        });
      }
    }
    fairLaunchConfigs.push(data);
  }
  outputFilename = jsonInput['outputFilename'];
}

function exportAddresses(dictOutput) {
  let json = JSON.stringify(dictOutput, null, 2);
  fs.writeFileSync(path.join(__dirname, outputFilename), json);
}

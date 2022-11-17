require('@nomiclabs/hardhat-ethers');
const fs = require('fs');
const path = require('path');
const Helper = require('../../helpers/hardhatHelper');

let deployerAddress;
let admin;
let lockerAddress;
let outputFilename;

task('deployRewardLockerV2', 'deploy reward locker V2 contracts')
  .addParam('input', 'The input file')
  .addParam('gasprice', 'The gas price (in gwei) for all transactions')
  .setAction(async (taskArgs, hre) => {
    const configPath = path.join(__dirname, `./${taskArgs.input}`);
    const configParams = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    parseInput(configParams);

    const [deployer] = await ethers.getSigners();
    deployerAddress = await deployer.getAddress();
    console.log(`Deployer address: ${deployerAddress}`);

    let outputData = {};
    const GAS_PRICE = parseInt(process.env.GAS_PRICE);

    const KyberRewardLockerV2 = await ethers.getContractFactory('KyberRewardLockerV2');
    let rewardLocker;

    if (lockerAddress == undefined) {
      console.log('deploy new ');
      rewardLocker = await KyberRewardLockerV2.deploy(admin, {gasPrice: GAS_PRICE});
      await rewardLocker.deployed();
      lockerAddress = rewardLocker.address;
    } else {
      console.log('use old ');
      rewardLocker = await KyberRewardLockerV2.attach(lockerAddress);
    }
    console.log(`RewardLockerV2 address: ${rewardLocker.address}`);
    outputData['RewardLockerV2'] = rewardLocker.address;

    try {
      console.log(`Verify reward locker at: ${rewardLocker.address}`);
      await Helper.verifyContract(hre, rewardLocker.address, [admin]);
    } catch (e) {
      console.log(`Error in verify reward locker, continue...`);
    }

    exportAddresses(outputData);
    console.log('setup completed');
    process.exit(0);
  });

function parseInput(jsonInput) {
  lockerAddress = jsonInput['lockerAddress'];
  admin = jsonInput['admin'];
  if (lockerAddress.length == 0 || admin.length == 0) {
    console.log('Empty address');
    process.exit();
  }
  outputFilename = jsonInput['outputFilename'];
}

function exportAddresses(dictOutput) {
  let json = JSON.stringify(dictOutput, null, 2);
  fs.writeFileSync(path.join(__dirname, outputFilename), json);
}

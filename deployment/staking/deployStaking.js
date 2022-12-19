require('@nomiclabs/hardhat-ethers');
const fs = require('fs');
const path = require('path');
const Helper = require('../../helpers/hardhatHelper');

let adminAddress;
let kncAddress;
let stakingSc;
let outputFilename;

task('deployStaking', 'deploy script')
  .addParam('input', 'The input file')
  .setAction(async (taskArgs, hre) => {
    const configPath = path.join(__dirname, `./${taskArgs.input}`);
    const configParams = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    parseInput(configParams);

    const [deployer] = await hre.ethers.getSigners();
    let deployerAddress = await deployer.getAddress();

    console.log('Deployed by ', deployerAddress);

    const EPOCH = 28800; // 8h
    const START_TIME = 1668664800; // 13h Nov 11, 22
    const GAS_PRICE = parseInt(process.env.GAS_PRICE);

    let StakingSC = await hre.ethers.getContractFactory('KyberStaking');

    let outputData = {};
    if (stakingSc == undefined) {
      console.log('deploy new ');
      stakingSc = await StakingSC.deploy(adminAddress, kncAddress, EPOCH, START_TIME, {gasPrice: GAS_PRICE});
      await stakingSc.deployed();
    } else {
      console.log('use old staking');
      stakingSc = await StakingSC.attach(stakingSc);
    }

    console.log('Staking deployed to:', stakingSc.address);
    stakingSc = stakingSc.address;
    outputData['Staking SC'] = stakingSc;

    try {
      console.log(`Verify staking at: ${stakingSc}`);
      await Helper.verifyContract(hre, stakingSc, [adminAddress, kncAddress, EPOCH, START_TIME]);
    } catch (e) {
      console.log(`Error in verify staking, continue...`);
    }

    exportAddresses(outputData);
    console.log('setup completed');
    process.exit(0);
  });

function parseInput(jsonInput) {
  adminAddress = jsonInput['adminAddress'];
  kncAddress = jsonInput['kncAddress'];
  if (adminAddress.length == 0 || kncAddress.length == 0) {
    console.log('Empty address');
    process.exit();
  }
  outputFilename = jsonInput['outputFilename'];
}

function exportAddresses(dictOutput) {
  let json = JSON.stringify(dictOutput, null, 2);
  fs.writeFileSync(path.join(__dirname, outputFilename), json);
}

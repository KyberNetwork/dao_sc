require('@nomiclabs/hardhat-ethers');
const fs = require('fs');
const path = require('path');
const Helper = require('../../helpers/hardhatHelper');

let adminAddress;
let exeSc;
let outputFilename;

task('deployExe', 'deploy script')
  .addParam('input', 'The input file')
  .setAction(async (taskArgs, hre) => {
    const configPath = path.join(__dirname, `./${taskArgs.input}`);
    const configParams = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    parseInput(configParams);
    const [deployer] = await hre.ethers.getSigners();
    let deployerAddress = await deployer.getAddress();
    console.log('Deployed by ', deployerAddress);
    const GAS_PRICE = parseInt(process.env.GAS_PRICE);

    let ExecutorSC = await hre.ethers.getContractFactory('DefaultExecutor');
    let outputData = {};

    let delay = 60;
    let gracePeriod = 1200;
    let minimumDelay = 0;
    let maximumDelay = 604800;
    let minVoteDuration = 0;
    let maxVotingOptions = 8;
    let voteDifferential = 1;
    let minimumQuorum = 2;

    if (exeSc == undefined) {
      console.log('deploy new ');
      exeSc = await ExecutorSC.deploy(
        adminAddress,
        delay,
        gracePeriod,
        minimumDelay,
        maximumDelay,
        minVoteDuration,
        maxVotingOptions,
        voteDifferential,
        minimumQuorum,
        {gasPrice: GAS_PRICE}
      );
      await exeSc.deployed();
    } else {
      console.log('use old exeSc');
      exeSc = await ExecutorSC.attach(exeSc);
    }

    console.log('exeSc deployed to:', exeSc.address);
    exeSc = exeSc.address;
    outputData['Executor SC'] = exeSc;

    try {
      console.log(`Verify exeSc at: ${exeSc}`);
      await Helper.verifyContract(hre, exeSc, [
        adminAddress,
        delay,
        gracePeriod,
        minimumDelay,
        maximumDelay,
        minVoteDuration,
        maxVotingOptions,
        voteDifferential,
        minimumQuorum,
      ]);
    } catch (e) {
      console.log(`Error in verify exeSc, continue...`);
    }

    exportAddresses(outputData);
    console.log('setup completed');
    process.exit(0);
  });

function parseInput(jsonInput) {
  adminAddress = jsonInput['adminAddress'];
  if (adminAddress.length == 0) {
    console.log('Empty address');
    process.exit();
  }
  outputFilename = jsonInput['outputFilename'];
}

function exportAddresses(dictOutput) {
  let json = JSON.stringify(dictOutput, null, 2);
  fs.writeFileSync(path.join(__dirname, outputFilename), json);
}

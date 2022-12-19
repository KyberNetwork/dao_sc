require('@nomiclabs/hardhat-ethers');
const fs = require('fs');
const path = require('path');
const Helper = require('../../helpers/hardhatHelper');

let adminAddress;
let daoOperator;
let executorAddress;
let votingPow;

let govSc;
let outputFilename;

task('deployGov', 'deploy script')
  .addParam('input', 'The input file')
  .setAction(async (taskArgs, hre) => {
    const configPath = path.join(__dirname, `./${taskArgs.input}`);
    const configParams = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    parseInput(configParams);
    const [deployer] = await hre.ethers.getSigners();
    let deployerAddress = await deployer.getAddress();
    console.log('Deployed by ', deployerAddress);
    const GAS_PRICE = parseInt(process.env.GAS_PRICE);

    let GovSc = await hre.ethers.getContractFactory('KyberGovernance');

    let outputData = {};
    if (govSc == undefined) {
      console.log('deploy new ');
      govSc = await GovSc.deploy(adminAddress, daoOperator, [executorAddress], [], {gasPrice: GAS_PRICE});
      await govSc.deployed();
    } else {
      console.log('use old voting');
      govSc = await GovSc.attach(govSc);
    }

    console.log('Gov deployed to:', govSc.address);
    govSc = govSc.address;
    outputData['Gov SC'] = govSc;

    try {
      console.log(`Verify Gov at: ${govSc}`);
      await Helper.verifyContract(hre, govSc, [adminAddress, daoOperator, [executorAddress], [votingPow]]);
    } catch (e) {
      console.log(`Error in verify gov, continue...`);
    }

    exportAddresses(outputData);
    console.log('setup completed');
    process.exit(0);
  });

function parseInput(jsonInput) {
  adminAddress = jsonInput['adminAddress'];
  daoOperator = jsonInput['daoOperator'];
  executorAddress = jsonInput['executorAddress'];
  // votingPow = jsonInput['votingPow'];
  if (adminAddress.length == 0 || daoOperator.length == 0 || executorAddress.length == 0) {
    console.log('Empty address');
    process.exit();
  }
  outputFilename = jsonInput['outputFilename'];
}

function exportAddresses(dictOutput) {
  let json = JSON.stringify(dictOutput, null, 2);
  fs.writeFileSync(path.join(__dirname, outputFilename), json);
}

require('@nomiclabs/hardhat-ethers');
const fs = require('fs');
const path = require('path');
const Helper = require('../../helpers/hardhatHelper');

let govAddress;
let stakingAddress;
let votingSc;
let outputFilename;

task('deployVoting', 'deploy script')
  .addParam('input', 'The input file')
  .setAction(async (taskArgs, hre) => {
    const configPath = path.join(__dirname, `./${taskArgs.input}`);
    const configParams = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    parseInput(configParams);
    const [deployer] = await hre.ethers.getSigners();
    let deployerAddress = await deployer.getAddress();
    console.log('Deployed by ', deployerAddress);
    const GAS_PRICE = process.env.GAS_PRICE;

    let VotingSC = await hre.ethers.getContractFactory('EpochVotingPowerStrategy');

    let outputData = {};
    if (votingSc == undefined) {
      console.log('deploy new ');
      votingSc = await VotingSC.deploy(govAddress, stakingAddress, {gasPrice: GAS_PRICE});
      await votingSc.deployed();
    } else {
      console.log('use old voting');
      votingSc = await VotingSC.attach(stakingSc);
    }

    console.log('Staking deployed to:', votingSc.address);
    votingSc = votingSc.address;
    outputData['Staking SC'] = votingSc;

    try {
      console.log(`Verify voting at: ${votingSc}`);
      await Helper.verifyContract(hre, votingSc, [govAddress, stakingAddress]);
    } catch (e) {
      console.log(`Error in verify voting, continue...`);
    }

    exportAddresses(outputData);
    console.log('setup completed');
    process.exit(0);
  });

function parseInput(jsonInput) {
  govAddress = jsonInput['govAddress'];
  stakingAddress = jsonInput['stakingAddress'];
  if (govAddress.length == 0 || stakingAddress.length == 0) {
    console.log('Empty address');
    process.exit();
  }
  outputFilename = jsonInput['outputFilename'];
}

function exportAddresses(dictOutput) {
  let json = JSON.stringify(dictOutput, null, 2);
  fs.writeFileSync(path.join(__dirname, outputFilename), json);
}

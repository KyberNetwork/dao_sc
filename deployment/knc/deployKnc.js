require('@nomiclabs/hardhat-ethers');
const fs = require('fs');
const path = require('path');
const Helper = require('../../helpers/hardhatHelper');

let adminAddress;
let kncAddress;
let oldKnc;
let outputFilename;

task('deployKNC', 'deploy script')
  .addParam('input', 'The input file')
  .setAction(async (taskArgs, hre) => {
    const configPath = path.join(__dirname, `./${taskArgs.input}`);
    const configParams = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    parseInput(configParams);

    const [deployer] = await hre.ethers.getSigners();
    let deployerAddress = await deployer.getAddress();

    console.log('Deployed by ', deployerAddress);

    let Token = await hre.ethers.getContractFactory('KyberNetworkTokenV2');
    let NewKNC = await hre.ethers.getContractFactory('MockKyberTokenV2');

    const GAS_PRICE = parseInt(process.env.GAS_PRICE);
    if (oldKnc == undefined) {
      console.log('deploy new ');
      oldKnc = await Token.deploy({gasPrice: GAS_PRICE});
      await oldKnc.deployed();
    } else {
      console.log('use old knc');
      oldKnc = await Token.attach(oldKnc);
    }

    let outputData = {};
    let newKnc = await upgrades.deployProxy(NewKNC, [oldKnc.address, adminAddress], {gasPrice: GAS_PRICE});
    await newKnc.deployed();

    console.log('KNC deployed to:', newKnc.address);
    kncAddress = newKnc.address;
    outputData['Old KNC'] = oldKnc.address;
    outputData['New KNC'] = newKnc.address;

    try {
      console.log(`Verify knc at: ${kncAddress}`);
      await Helper.verifyContract(hre, kncAddress, [oldKnc.address, adminAddress]);
    } catch (e) {
      console.log(`Error in verify knc, continue...`);
    }

    exportAddresses(outputData);
    console.log('setup completed');
    process.exit(0);
  });

function parseInput(jsonInput) {
  adminAddress = jsonInput['adminAddress'];
  oldKnc = jsonInput['oldKnc'];
  if (adminAddress.length == 0 || oldKnc.length == 0) {
    console.log('Empty address');
    process.exit();
  }
  outputFilename = jsonInput['outputFilename'];
}

function exportAddresses(dictOutput) {
  let json = JSON.stringify(dictOutput, null, 2);
  fs.writeFileSync(path.join(__dirname, outputFilename), json);
}

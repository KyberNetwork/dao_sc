require('@nomiclabs/hardhat-ethers');
const fs = require('fs');
const path = require('path');
const Helper = require('../../helpers/hardhatHelper');

let adminAddress;
let rdSC;
let outputFilename;

task('deployRd', 'deploy script')
  .addParam('input', 'The input file')
  .setAction(async (taskArgs, hre) => {
    const configPath = path.join(__dirname, `./${taskArgs.input}`);
    const configParams = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    parseInput(configParams);
    const [deployer] = await hre.ethers.getSigners();
    let deployerAddress = await deployer.getAddress();
    console.log('Deployed by ', deployerAddress);
    const GAS_PRICE = parseInt(process.env.GAS_PRICE);

    let RDSC = await hre.ethers.getContractFactory('RewardsDistributor');

    let outputData = {};
    if (rdSC == undefined) {
      console.log('deploy new ');
      rdSC = await RDSC.deploy(adminAddress, {gasPrice: GAS_PRICE});
      await rdSC.deployed();
    } else {
      console.log('use old voting');
      rdSC = await RDSC.attach(stakingSc);
    }

    console.log('RD deployed to:', rdSC.address);
    rdSC = rdSC.address;
    outputData['RD SC'] = rdSC;

    try {
      console.log(`Verify rd at: ${rdSC}`);
      await Helper.verifyContract(hre, rdSC, [adminAddress]);
    } catch (e) {
      console.log(`Error in verify rd, continue...`);
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

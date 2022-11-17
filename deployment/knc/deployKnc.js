require('@nomiclabs/hardhat-ethers');
const fs = require('fs');
const path = require('path');

let adminAddress;
let kncAddress;
let oldKnc;
let outputFilename;

async function verifyContract(hre, contractAddress, ctorArgs) {
  await hre.run('verify:verify', {
    address: contractAddress,
    constructorArguments: ctorArgs,
  });
}

task('deployKNC', 'deploy script')
  .addParam('input', 'The input file')
  .setAction(async (taskArgs, hre) => {
    const configPath = path.join(__dirname, `./${taskArgs.input}`);
    const configParams = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    parseInput(configParams);

    const [deployer] = await hre.ethers.getSigners();
    let deployerAddress = await deployer.getAddress();

    console.log("Deployed by ",deployerAddress );

    let Token = await hre.ethers.getContractFactory('KyberNetworkTokenV2');
    let NewKNC = await hre.ethers.getContractFactory('MockKyberTokenV2');

    const GAS_PRICE = 80000000000; // 80 gweis
    if (oldKnc == undefined) {
      console.log("deploy new ");
      oldKnc = await Token.deploy({gasPrice: GAS_PRICE});
      await oldKnc.deployed();
    } else {
      console.log("use old knc");
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
      await verifyContract(hre, kncAddress, [oldKnc.address, adminAddress]);
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
    outputFilename = jsonInput['outputFilename'];
  }
  
  function exportAddresses(dictOutput) {
    let json = JSON.stringify(dictOutput, null, 2);
    fs.writeFileSync(path.join(__dirname, outputFilename), json);
  }
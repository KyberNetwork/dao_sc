require('@nomiclabs/hardhat-ethers');
const fs = require('fs');
const path = require('path');


let gasPrice;

async function verifyContract(hre, contractAddress, ctorArgs) {
  await hre.run('verify:verify', {
    address: contractAddress,
    constructorArguments: ctorArgs,
  });
}

let deployerAddress;
let contractAddress;
let admin;
let recipient;
let dmmRouter;
let tokenConfigs;
let destToken;
let liquidateTokens;
let tradeTokens;
let outputFilename;

function verifyArrays(arr1, arr2) {
  if (arr1.length != arr2.length) return false;
  for (let i = 0; i < arr1.length; i++) {
    if (arr1[i].toLowerCase() != arr2[i].toLowerCase()) return false;
  }
  return true;
}

task('deployLiquidateFeeWithKyberDMM', 'deploy liquidity mining contracts')
  .addParam('gasprice', 'The gas price (in gwei) for all transactions')
  .addParam('input', 'Input file')
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

    const MockToken = await ethers.getContractFactory('KyberNetworkTokenV2');

    const LiquidateFeeWithKyberDMM = await ethers.getContractFactory('LiquidateFeeWithKyberDMM');
    let liquidateFee;
    if (contractAddress == undefined) {
        liquidateFee = await LiquidateFeeWithKyberDMM.deploy(admin, recipient, dmmRouter, { gasPrice: gasPrice });
        await liquidateFee.deployed();
        contractAddress = liquidateFee.address;
        await liquidateFee.addOperator(deployerAddress, { gasPrice: gasPrice });
    } else {
        liquidateFee = await LiquidateFeeWithKyberDMM.attach(contractAddress);
    }
    console.log(`LiquidateFeeWithKyberDMM address: ${liquidateFee.address}`);
    outputData["contractAddress"] = liquidateFee.address;

    outputData["tokenConfigs"] = tokenConfigs;
    for (let i = 0; i < tokenConfigs.length; i++) {
      let data = await liquidateFee.getTradePath(tokenConfigs[i].token, destToken);
      if (verifyArrays(data._tokenPath, tokenConfigs[i].tokenPath) && verifyArrays(data._poolPath, tokenConfigs[i].poolPath)) {
        continue;
      }
      console.log(`Set trade path for token: ${tokenConfigs[i].token}`);
      console.log(`   token path: ${tokenConfigs[i].tokenPath}`);
      console.log(`   pool path: ${tokenConfigs[i].poolPath}`);
      await liquidateFee.setTradePath(
        tokenConfigs[i].token, destToken, tokenConfigs[i].tokenPath, tokenConfigs[i].poolPath
      );
    }

    outputData["liquidateTokens"] = liquidateTokens;
    let shouldLiquidate = true;
    let amountsIn = [];
    let pools = [];
    if (liquidateTokens != undefined && liquidateTokens.length > 0) {
      for (let i = 0; i < liquidateTokens.length; i++) {
        let token = await MockToken.attach(liquidateTokens[i]);
        let allowance = await token.allowance(recipient, liquidateFee.address);
        let balance = await token.balanceOf(recipient);
        if (allowance.gt(balance) && balance.gt(BN.from(1))) {
          amountsIn.push(balance.sub(1));
          pools.push(liquidateTokens[i]);
          console.log(`Token ${liquidateTokens[i]} balance: ${balance.toString()}`);
        }
      }
    } else {
      shouldLiquidate = false;
    }

    if (shouldLiquidate && pools.length > 0) {
      let minAmountOut = await liquidateFee.estimateReturns(pools, amountsIn, destToken);
      minAmountOut = minAmountOut.mul(BN.from(95)).div(BN.from(100)); // 5% off
      console.log(`Liquidating ${pools.length} lp tokens`);
      let dest = await MockToken.attach(destToken);
      let destBalanceBefore = await dest.balanceOf(recipient);
      await liquidateFee.liquidate(recipient, pools, amountsIn, destToken, tradeTokens, minAmountOut, { gasPrice: gasPrice });
      let destBalanceAfter = await dest.balanceOf(recipient);
      console.log(`Liquidated, received amount: ${destBalanceAfter.sub(destBalanceBefore).toString()}`);
    }

    exportAddresses(outputData);
    console.log('setup completed');
    process.exit(0);
  }
);

function parseInput(jsonInput) {
  admin = jsonInput["admin"];
  contractAddress = jsonInput["contractAddress"];
  recipient = jsonInput["recipient"];
  dmmRouter = jsonInput["dmmRouter"];
  destToken = jsonInput["destToken"];
  tokenConfigs = [];
  let configs = jsonInput["tokenConfigs"];
  if (configs != undefined && configs.length > 0) {
    for (let i = 0; i < configs.length; i++) {
      let data = {
        token: configs[i]["token"],
        poolPath: configs[i]["poolPath"],
        tokenPath: configs[i]["tokenPath"]
      };
      tokenConfigs.push(data);
    }
  }
  liquidateTokens = jsonInput["liquidateTokens"];
  tradeTokens = jsonInput["tradeTokens"];
  outputFilename = jsonInput["outputFilename"];
}

function exportAddresses(dictOutput) {
  let json = JSON.stringify(dictOutput, null, 2);
  fs.writeFileSync(path.join(__dirname, outputFilename), json);
}

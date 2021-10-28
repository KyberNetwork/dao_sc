require('@nomiclabs/hardhat-ethers');
const inquirer = require('inquirer');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const GnosisWalletABI = require('./externalArtifacts/GnosisWalletABI');
const ETHERSCAN_KEY = process.env.ETHERSCAN_KEY;
const chainIdToEtherscanURL = {
  1: '',
  3: '-ropsten',
  4: '-rinkeby',
  5: '-goerli',
  42: '-kovan',
};

let chainId;

let kyberGovernance;
let gnosisWallet;

let kyberGovernanceAddress;
let gnosisWalletAddress;
let executorAddress;
let votingPowerStrategyAddress;
let contractsToCall;
let outputFilename;

let startTimestamp;
let endTimestamp;
let link;

async function inquireForContractCalls(ethers) {
  let result = {targets: contractsToCall, weiValues: [], signatures: [], calldatas: [], withDelegatecalls: []};
  for (let contractAddress of contractsToCall) {
    let contract = await instantiateContract(ethers, contractAddress);

    // try to see if there is implementation() function
    // prompt user for implementation contract address
    // due to permissioned controls in reading it directly
    for (let funcName of Object.keys(contract.interface.functions)) {
      if (funcName == 'implementation()') {
        contract = await instantiateContract(ethers, contractAddress, true);
      }
    }

    let functionList = getWriteFunctionsList(contract.interface.functions);
    let functionData = await getFunctionOptionAndData(contract, functionList);
    result.weiValues.push(functionData.weiValue);
    result.signatures.push(functionData.name);
    result.withDelegatecalls.push(functionData.delegateCall);
    let functionName = contract.interface.functions[functionData.name].name;
    functionData = await contract.populateTransaction[functionName](...functionData.inputArgs);
    result.calldatas.push(`0x` + functionData.data.substring(10));
  }
  return result;
}

async function instantiateContract(ethers, address, askImplementation = false) {
  if (askImplementation) {
    let question = [
      {
        type: 'input',
        name: 'address',
        message: `Implementation address of ${address} for function list`,
      },
    ];
    address = (await inquirer.prompt(question)).address;
  }
  let abi = await pullABIFromEtherscan(address);
  return new ethers.Contract(address, abi);
}

async function pullABIFromEtherscan(address) {
  if (ETHERSCAN_KEY == undefined) {
    console.log('Require etherscan key, exiting...');
    process.exit(1);
  } else if (chainIdToEtherscanURL[chainId] == undefined) {
    console.log(`Bad chain ID`);
    process.exit(1);
  } else {
    let abiRequest = await fetch(
      `https://api${chainIdToEtherscanURL[chainId]}.etherscan.io/api?module=contract&action=getabi` +
        `&address=${address}` +
        `&apikey=${ETHERSCAN_KEY}`
    );
    let abi = await abiRequest.json();
    if (abi.status == '0') {
      console.log(abi.result);
      process.exit(1);
    }
    return abi.result;
  }
}

function getWriteFunctionsList(allFunctions) {
  let result = [];
  for (let [funcName, funcFrag] of Object.entries(allFunctions)) {
    if (!funcFrag.constant) result.push(funcName);
  }
  return result;
}

async function getFunctionOptionAndData(contract, functionList) {
  let question = [
    {
      type: 'list',
      name: 'functionName',
      message: `Select function for contract ${contract.address}`,
      choices: functionList,
    },
  ];
  let selectedFunction = (await inquirer.prompt(question)).functionName;
  let inputList = contract.interface.functions[selectedFunction].inputs;
  question = inputList.map((paramType) => {
    let inputType = paramType.type.includes('int') ? 'number' : 'input';
    return {type: inputType, name: paramType.name, message: paramType.name};
  });
  let functionInputArgs = await inquirer.prompt(question);
  let functionInputValues = inputList.map((paramType) => {
    return functionInputArgs[paramType.name];
  });
  functionInputValues = convertInputValues(functionInputValues);
  let weiValue = '0';
  // check if payable
  if (contract.interface.functions[selectedFunction].payable) {
    question = [
      {
        type: 'number',
        name: 'weiValue',
        message: `Ether wei value`,
      },
    ];
    weiValue = (await inquirer.prompt(question)).weiValue;
  }
  // check delegatecall
  question = [
    {
      type: 'confirm',
      name: 'delegatecall',
      message: `Use delegate call?`,
    },
  ];
  let delegateCall = (await inquirer.prompt(question)).delegateCall;
  return {
    name: selectedFunction,
    inputArgs: functionInputValues,
    weiValue: weiValue,
    delegateCall: delegateCall,
  };
}

function convertInputValues(inputValues) {
  return inputValues.map((inputValue) => {
    if (typeof inputValue == 'number') {
      let BN = ethers.BigNumber;
      // use X.314159 to indicate X as the exact number to be used
      if ((inputValue + "").split(".")[1] == "314159") return new BN.from(Math.trunc(inputValue));
      // otherwise will multiply X by 1e18
      let numDecimals = countDecimals(inputValue);
      if (numDecimals == 0) return new BN.from(inputValue).mul(ethers.constants.WeiPerEther);
      inputValue = inputValue * 10 ** numDecimals;
      inputValue = new BN.from(inputValue)
        .mul(ethers.constants.WeiPerEther)
        .div(new BN.from(10).pow(new BN.from(numDecimals)))
        .toHexString();
      return inputValue;
    }
    // for array, do mapping
    try {
      inputValue = JSON.parse(inputValue);
      return inputValue;
    } catch (e) {
      return inputValue;
    }
  });
}

task('createBinaryProposal', 'create binary proposal')
  .addParam('f', 'JSON file for settings and addresses')
  .addOptionalParam('s', 'Send tx to multisig wallet', false, types.boolean)
  .setAction(async (taskArgs) => {
    const addressPath = path.join(__dirname, taskArgs.f);
    const addressParams = JSON.parse(fs.readFileSync(addressPath, 'utf8'));
    parseValidateInput(addressParams);
    const [sender] = await ethers.getSigners();
    console.log(`Signing txns with ${await sender.getAddress()}`);
    chainId = await sender.getChainId();

    kyberGovernance = await ethers.getContractAt('KyberGovernance', kyberGovernanceAddress);
    gnosisWallet = new ethers.Contract(gnosisWalletAddress, GnosisWalletABI, sender);
    let binaryCallData = await inquireForContractCalls(ethers);

    let txData = (
      await kyberGovernance.populateTransaction.createBinaryProposal(
        executorAddress,
        votingPowerStrategyAddress,
        {
          targets: binaryCallData.targets,
          weiValues: binaryCallData.weiValues,
          signatures: binaryCallData.signatures,
          calldatas: binaryCallData.calldatas,
          withDelegatecalls: binaryCallData.withDelegatecalls,
        },
        startTimestamp,
        endTimestamp,
        link
      )
    ).data;

    addressParams['txData'] = txData;
    let json = JSON.stringify(addressParams, null, 2);
    fs.writeFileSync(path.join(__dirname, outputFilename), json);

    if ((await gnosisWallet.isOwner(sender.address)) && taskArgs.s) {
      console.log(`Sending tx to gnosisWallet ${gnosisWalletAddress}`);
      await gnosisWallet.submitTransaction(kyberGovernanceAddress, 0, txData, {gasLimit: 2000000});
    }
    process.exit(0);
  });

function parseValidateInput(jsonInput) {
  gnosisWalletAddress = jsonInput['gnosisWallet'];
  kyberGovernanceAddress = jsonInput['governance'];
  executorAddress = jsonInput['executor'];
  votingPowerStrategyAddress = jsonInput['votingPowerStrategy'];
  contractsToCall = jsonInput['contractsToCall'];
  startTimestamp = jsonInput['startTimestamp'];
  endTimestamp = jsonInput['endTimestamp'];
  link = jsonInput['link'];
  outputFilename = jsonInput['outputFilename'];

  // check start and timestamps
  let now = Math.floor(new Date().getTime() / 1000);
  if (startTimestamp < now) {
    console.error(`Bad start timestamp, use value > ${now}`);
    process.exit(1);
  } else if (endTimestamp <= startTimestamp) {
    console.error(`Bad start and end timestamps`);
    process.exit(1);
  }
}

function countDecimals(value) {
  if (Math.floor(value) !== value) return value.toString().split('.')[1].length || 0;
  return 0;
}

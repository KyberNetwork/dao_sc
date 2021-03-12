require('@nomiclabs/hardhat-ethers');
const inquirer = require('inquirer');
const fs = require('fs');
const path = require('path');
const configPath = path.join(__dirname, './katana_input.json');
const configParams = JSON.parse(fs.readFileSync(configPath, 'utf8'));

let gasPrice;
async function fetchNextGasPrice(BN, message) {
  let question = [
    {
      type: 'input',
      name: 'gas',
      message: `Next gas price to use (in gwei) for ${message}`,
    },
  ];

  gasPrice = (await inquirer.prompt(question)).gas;
  gasPrice = new BN.from(gasPrice).mul(new BN.from(10).pow(new BN.from(9)));
}

async function verifyContract(hre, contractAddress, ctorArgs) {
  await hre.run('verify:verify', {
    address: contractAddress,
    constructorArguments: ctorArgs,
  });
}

let kncAddress;
let deployerAddress;
let epochPeriod;
let starttime;
let shortExecutorConfig;
let longExecutorConfig;
let daoOperator;
let outputFilename;

task('deployGovInfra', 'deploys staking, governance, voting power strategy and executors').setAction(
  async (taskArgs, hre) => {
    parseInput(configParams);
    const BN = ethers.BigNumber;
    const [deployer] = await ethers.getSigners();
    deployerAddress = await deployer.getAddress();

    // contract deployment
    await fetchNextGasPrice(BN, 'staking deployment');
    const KyberStaking = await ethers.getContractFactory('KyberStaking');
    const kyberStaking = await KyberStaking.deploy(deployerAddress, kncAddress, epochPeriod, starttime, {
      gasPrice: gasPrice,
    });
    await kyberStaking.deployed();
    console.log(`staking address: ${kyberStaking.address}`);

    await fetchNextGasPrice(BN, 'governance deployment');
    const KyberGovernance = await ethers.getContractFactory('KyberGovernance');
    const kyberGovernance = await KyberGovernance.deploy(deployerAddress, daoOperator, [], [], {gasPrice: gasPrice});
    await kyberGovernance.deployed();
    console.log(`governance address: ${kyberGovernance.address}`);

    await fetchNextGasPrice(BN, 'short executor deployment');
    const Executor = await ethers.getContractFactory('DefaultExecutor');
    const shortExecutor = await Executor.deploy(
      kyberGovernance.address,
      shortExecutorConfig.delay,
      shortExecutorConfig.gracePeriod,
      shortExecutorConfig.minimumDelay,
      shortExecutorConfig.maximumDelay,
      shortExecutorConfig.minVoteDuration,
      shortExecutorConfig.maxVotingOptions,
      shortExecutorConfig.voteDifferential,
      shortExecutorConfig.minimumQuorum,
      {gasPrice: gasPrice}
    );
    await shortExecutor.deployed();
    console.log(`shortExecutor address: ${shortExecutor.address}`);

    await fetchNextGasPrice(BN, 'long executor deployment');
    const longExecutor = await Executor.deploy(
      kyberGovernance.address,
      longExecutorConfig.delay,
      longExecutorConfig.gracePeriod,
      longExecutorConfig.minimumDelay,
      longExecutorConfig.maximumDelay,
      longExecutorConfig.minVoteDuration,
      longExecutorConfig.maxVotingOptions,
      longExecutorConfig.voteDifferential,
      longExecutorConfig.minimumQuorum,
      {gasPrice: gasPrice}
    );
    await longExecutor.deployed();
    console.log(`longExecutor address: ${longExecutor.address}`);

    await fetchNextGasPrice(BN, 'voting power strategy deployment');
    const VotingPowerStrategy = await ethers.getContractFactory('EpochVotingPowerStrategy');
    const votingPowerStrategy = await VotingPowerStrategy.deploy(kyberGovernance.address, kyberStaking.address, {
      gasPrice: gasPrice,
    });
    await votingPowerStrategy.deployed();
    console.log(`votingPowerStrategy address: ${votingPowerStrategy.address}`);

    // export addresses
    exportAddresses({
      staking: kyberStaking.address,
      governance: kyberGovernance.address,
      shortExecutor: shortExecutor.address,
      longExecutor: longExecutor.address,
      votingPowerStrategy: votingPowerStrategy.address,
    });

    // verify addresses
    await verifyContract(hre, kyberStaking.address, [deployerAddress, kncAddress, epochPeriod, starttime]);
    await verifyContract(hre, kyberGovernance.address, deployerAddress, daoOperator, [], []);
    await verifyContract(hre, shortExecutor.address, [
      kyberGovernance.address,
      shortExecutorConfig.delay,
      shortExecutorConfig.gracePeriod,
      shortExecutorConfig.minimumDelay,
      shortExecutorConfig.maximumDelay,
      shortExecutorConfig.minVoteDuration,
      shortExecutorConfig.maxVotingOptions,
      shortExecutorConfig.voteDifferential,
      shortExecutorConfig.minimumQuorum,
    ]);
    await verifyContract(hre, longExecutor.address, [
      kyberGovernance.address,
      longExecutorConfig.delay,
      longExecutorConfig.gracePeriod,
      longExecutorConfig.minimumDelay,
      longExecutorConfig.maximumDelay,
      longExecutorConfig.minVoteDuration,
      longExecutorConfig.maxVotingOptions,
      longExecutorConfig.voteDifferential,
      longExecutorConfig.minimumQuorum,
    ]);
    await verifyContract(hre, votingPowerStrategy.address, [kyberGovernance.address, kyberStaking.address]);

    // set executors and voting power strategy in governance
    await fetchNextGasPrice(BN, 'authorizing executors in governance');
    await kyberGovernance.authorizeExecutors([shortExecutor.address, longExecutor.address], {gasPrice: gasPrice});
    await fetchNextGasPrice(BN, 'authorizing voting power strategy in governance');
    await kyberGovernance.authorizeVotingPowerStrategies([votingPowerStrategy.address], {gasPrice: gasPrice});

    // update withdrawHandler in staking
    await fetchNextGasPrice(BN, 'setting voting power strategy in staking');
    await kyberStaking.updateWithdrawHandler(votingPowerStrategy.address, {gasPrice: gasPrice});

    // transfer admin to governance
    await fetchNextGasPrice(BN, 'transferring staking admin to long executor');
    await kyberStaking.transferAdminQuickly(longExecutor.address, {gasPrice: gasPrice});
    await fetchNextGasPrice(BN, 'transferring governance admin to long executor');
    await kyberGovernance.transferAdminQuickly(longExecutor.address, {gasPrice: gasPrice});
    console.log('setup completed!');
    process.exit(0);
  }
);

function parseInput(jsonInput) {
  kncAddress = jsonInput['knc'];
  epochPeriod = jsonInput['epochPeriod'];
  starttime = jsonInput['starttime'];
  shortExecutorConfig = jsonInput['shortExecutor'];
  longExecutorConfig = jsonInput['longExecutor'];
  daoOperator = jsonInput['daoOperator'];
  outputFilename = jsonInput['outputFilename'];
}

function exportAddresses(dictOutput) {
  let json = JSON.stringify(dictOutput, null, 2);
  fs.writeFileSync(path.join(__dirname, outputFilename), json);
}

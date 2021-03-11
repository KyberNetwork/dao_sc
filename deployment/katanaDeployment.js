require('@nomiclabs/hardhat-ethers');
const fs = require('fs');
const path = require('path');
const configPath = path.join(__dirname, './katana_input.json');
const configParams = JSON.parse(fs.readFileSync(configPath, 'utf8'));

const keypress = async () => {
  process.stdin.setRawMode(true);
  return new Promise((resolve) =>
    process.stdin.once('data', (data) => {
      const byteArray = [...data];
      if (byteArray.length > 0 && byteArray[0] === 3) {
        console.log('^C');
        process.exit(1);
      }
      process.stdin.setRawMode(false);
      resolve();
    })
  );
};

async function pressToContinue() {
    console.log("Checkpoint... Press any key to continue!");
    await keypress();
  }

let kncAddress;
let deployerAddress;
let epochPeriod;
let starttime;
let shortExecutorConfig;
let longExecutorConfig;
let daoOperator;
let outputFilename;

task('deployGovInfra', 'deploys staking, governance, voting power strategy and executors').setAction(async () => {
  parseInput(configParams);
  const [deployer] = await ethers.getSigners();
  deployerAddress = await deployer.getAddress();

  // contract deployment
  console.log('deploying staking contract...');
  const KyberStaking = await ethers.getContractFactory('KyberStaking');
  const kyberStaking = await KyberStaking.deploy(deployerAddress, kncAddress, epochPeriod, starttime);
  await kyberStaking.deployed();
  console.log(`staking address: ${kyberStaking.address}`);
  await pressToContinue();

  console.log('deploying governance contract...');
  const KyberGovernance = await ethers.getContractFactory('KyberGovernance');
  const kyberGovernance = await KyberGovernance.deploy(deployerAddress, daoOperator, [], []);
  await kyberGovernance.deployed();
  console.log(`governance address: ${kyberGovernance.address}`);
  await pressToContinue();

  console.log('deploying short executor...');
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
    shortExecutorConfig.minimumQuorum
  );
  await shortExecutor.deployed();
  console.log(`shortExecutor address: ${shortExecutor.address}`);
  await pressToContinue();

  console.log('deploying long executor...');
  const longExecutor = await Executor.deploy(
    kyberGovernance.address,
    longExecutorConfig.delay,
    longExecutorConfig.gracePeriod,
    longExecutorConfig.minimumDelay,
    longExecutorConfig.maximumDelay,
    longExecutorConfig.minVoteDuration,
    longExecutorConfig.maxVotingOptions,
    longExecutorConfig.voteDifferential,
    longExecutorConfig.minimumQuorum
  );
  await longExecutor.deployed();
  console.log(`longExecutor address: ${longExecutor.address}`);
  await pressToContinue();

  console.log('deploying voting power strat...');
  const VotingPowerStrategy = await ethers.getContractFactory('EpochVotingPowerStrategy');
  const votingPowerStrategy = await VotingPowerStrategy.deploy(
    kyberGovernance.address,
    kyberStaking.address
  );
  await votingPowerStrategy.deployed();
  console.log(`votingPowerStrategy address: ${votingPowerStrategy.address}`);
  await pressToContinue();

  exportAddresses({
      'staking': kyberStaking.address,
      'governance': kyberGovernance.address,
      'shortExecutor': shortExecutor.address,
      'longExecutor': longExecutor.address,
      'votingPowerStrategy': votingPowerStrategy.address
  });

  // set executors and voting power strategy in governance
  console.log(`authorize executors...`);
  await kyberGovernance.authorizeExecutors([shortExecutor.address, longExecutor.address]);
  console.log(`authorize voting power strategy...`);
  await kyberGovernance.authorizeVotingPowerStrategies([votingPowerStrategy.address]);

  // transfer admin to governance
  console.log('transfer staking admin rights to governance...');
  await kyberStaking.transferAdminQuickly(kyberGovernance.address);
  console.log('transfer governance admin rights to itself...');
  await kyberGovernance.transferAdminQuickly(kyberGovernance.address);
  console.log('setup completed!');
  process.exit(0);
});

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

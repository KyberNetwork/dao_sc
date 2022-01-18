require('@nomiclabs/hardhat-ethers');
const {assert} = require('chai');
const Helper = require('../test/testHelpers/hardhat');

let kyberGov;

let forkParams = {};
let admin;
let kyberGovAddress;
let executorAddress;
let voterAddresses = [
  '0xf977814e90da44bfa03b6295a0616a897441acec',
  '0x3Be35d6C5FFeAe62CB3f6CB8a23653b6501A060d',
  '0x0bfEc35a1A3550Deed3F6fC76Dde7FC412729a91',
  '0x06890D4c65A4cB75be73D7CCb4a8ee7962819E81',
  '0xE80499e88B89898a22Be5b9dbba5c632Fa27F89a',
  '0x9db3207E49595F65B59B7E6669cEFfbbE45A7a7f',
];
const chainIdToGovAddress = {
  1: '0x7ec8fcc26be7e9e85b57e73083e5fe0550d8a7fe',
  3: '0xef5a1404E312078cd16B7139a2257eD3bb42F787',
  31337: '0x7ec8fcc26be7e9e85b57e73083e5fe0550d8a7fe',
};
const PENDING = 0;
const CANCELED = 1;
const ACTIVE = 2;
const FAILED = 3;
const SUCCEEDED = 4;
const QUEUED = 5;
const EXPIRED = 6;
const EXECUTED = 7;
const FINALIZED = 8;

let startTimestamp;
let endTimestamp;
let proposalId;
let proposalState;
let proposalCurrentState;

task('simProposalExecution', 'simulate execution of an existing binary / generic proposal')
  .addParam('id', 'Proposal ID')
  .setAction(async (taskArgs) => {
    getForkParams();
    proposalId = taskArgs.id;

    // attempt mainnet forking
    await network.provider.request({
      method: 'hardhat_reset',
      params: [forkParams],
    });

    [admin] = await ethers.getSigners();
    kyberGovAddress = chainIdToGovAddress[await admin.getChainId()];
    kyberGov = await ethers.getContractAt('KyberGovernance', kyberGovAddress);

    console.log('Fetching proposal details...');
    // get proposal details
    await getProposalDetails();

    switch (proposalState) {
      case CANCELED:
        console.log(`Proposal was canceled`);
        process.exit(0);
      case FAILED:
        console.log(`Proposal already failed`);
        process.exit(0);
      case EXPIRED:
        console.log(`Proposal has expired`);
        process.exit(0);
      case EXECUTED:
        console.log(`Proposal already executed`);
        process.exit(0);
      case FINALIZED:
        console.log(`Generic proposal already finalized`);
        process.exit(0);
    }

    // fast forward time for pending proposal
    if (proposalState == PENDING) await Helper.mineNewBlockAt(network, startTimestamp + 1);
    if (proposalState <= ACTIVE) {
      console.log(`Voting for proposal...`);
      for (let i = 0; i < voterAddresses.length; i++) {
        let voter = await Helper.impersonateAcc(network, ethers.provider, voterAddresses[i], admin);
        await kyberGov.connect(voter).submitVote(proposalId, 1);
      }
      // forward time to end of proposal
      await Helper.mineNewBlockAt(network, endTimestamp + 1);
      proposalCurrentState = await kyberGov.getProposalState(proposalId);
      if (proposalCurrentState == FINALIZED) {
        console.log(`generic proposal finalized`);
        process.exit(0);
      }
      assert(proposalCurrentState == SUCCEEDED, 'proposal failed to pass');
    }

    if (proposalState < QUEUED) {
      console.log(`Queueing proposal...`);
      try {
        await kyberGov.connect(admin).queue(proposalId);
      } catch (e) {
        console.log(e);
        process.exit(1);
      }
    }

    console.log(`Execute proposal...`);
    let executor = await ethers.getContractAt('DefaultExecutorWithTimelock', executorAddress);
    let timeDelay = await executor.getDelay();
    await Helper.mineNewBlockAt(network, endTimestamp + timeDelay.toNumber() + 1);
    try {
      await kyberGov.connect(admin).execute(proposalId);
    } catch (e) {
      console.log(e);
      process.exit(1);
    }
    proposalCurrentState = await kyberGov.getProposalState(proposalId);
    assert(proposalCurrentState == EXECUTED, 'proposal state != EXECUTED');
  });

function getForkParams() {
  if (process.env.NODE_URL == undefined) {
    console.log(`Missing NODE_URL in .env`);
    process.exit(1);
  }
  forkParams['forking'] = {jsonRpcUrl: process.env.NODE_URL};
  if (process.env.FORK_BLOCK) forkParams['forking']['blockNumber'] = Number(process.env.FORK_BLOCK);
}

async function getProposalDetails() {
  let result = await kyberGov.getProposalById(proposalId);
  executorAddress = result.executor;
  startTimestamp = result.startTime.toNumber();
  endTimestamp = result.endTime.toNumber();
  proposalState = await kyberGov.getProposalState(proposalId);
}

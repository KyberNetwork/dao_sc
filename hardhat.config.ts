import '@nomiclabs/hardhat-truffle5';
import '@nomiclabs/hardhat-waffle';
import '@nomiclabs/hardhat-web3';
import '@nomiclabs/hardhat-etherscan';
import 'hardhat-gas-reporter';
import 'solidity-coverage';
import '@openzeppelin/hardhat-upgrades';
import 'hardhat-typechain';
import { HardhatUserConfig } from 'hardhat/types';
import * as dotenv from 'dotenv';

dotenv.config();

import './deployment/katanaDeployment.js';
import './deployment/deployInternalGovernance.js';
import './deployment/liquidityMining/deployLiquidityMining.js';
import { accounts } from './test-wallets';

if (process.env.ETH_NODE_URL == undefined || process.env.FORK_BLOCK == undefined) {
  throw 'ETH_NODE_URL and FORK_BLOCK are required in .env file';
}

const config: HardhatUserConfig = {
  defaultNetwork: 'hardhat',

  gasReporter: {
    currency: 'USD',
    gasPrice: 100,
  },

  networks: {
    develop: {
      url: 'http://127.0.0.1:8545',
      gas: 6000000,
      timeout: 20000,
    },
    hardhat: {
      forking: {
        url: process.env.ETH_NODE_URL,
        blockNumber: parseInt(process.env.FORK_BLOCK!)
      },
      accounts: accounts,
    },
  },

  solidity: {
    compilers: [
      {
        version: '0.7.6',
        settings: {
          optimizer: {
            enabled: true,
            runs: 1000,
          },
        },
      },
    ],
  },

  paths: {
    sources: './contracts',
    tests: './test',
  },

  mocha: {
    timeout: 0,
  },

  typechain: {
    target: 'ethers-v5'
  }
};

const INFURA_API_KEY: string = process.env.INFURA_API_KEY || '';
const PRIVATE_KEY: string = process.env.PRIVATE_KEY || '';
const ETHERSCAN_KEY: string = process.env.ETHERSCAN_KEY || '';
const POLYGONSCAN_KEY: string = process.env.POLYGONSCAN_KEY || '';

if (INFURA_API_KEY != '' && PRIVATE_KEY != '') {
  config.networks!.kovan = {
    url: `https://kovan.infura.io/v3/${INFURA_API_KEY}`,
    accounts: [PRIVATE_KEY],
    timeout: 20000,
  };

  config.networks!.rinkeby = {
    url: `https://rinkeby.infura.io/v3/${INFURA_API_KEY}`,
    accounts: [PRIVATE_KEY],
    timeout: 20000,
  };

  config.networks!.ropsten = {
    url: `https://ropsten.infura.io/v3/${INFURA_API_KEY}`,
    accounts: [PRIVATE_KEY],
    timeout: 20000,
  };

  config.networks!.mainnet = {
    url: `https://mainnet.infura.io/v3/${INFURA_API_KEY}`,
    accounts: [PRIVATE_KEY],
    timeout: 20000,
  };

  config.networks!.polygon = {
    url: `https://rpc-mainnet.maticvigil.com/`,
    accounts: [PRIVATE_KEY],
    timeout: 20000,
  };

  config.networks!.mumbai = {
    url: `https://rpc-mumbai.maticvigil.com/`,
    accounts: [PRIVATE_KEY],
    timeout: 20000,
  };
}

if (ETHERSCAN_KEY != '' || POLYGONSCAN_KEY != '') {
  config.etherscan = {
    apiKey: ETHERSCAN_KEY == '' ? POLYGONSCAN_KEY : ETHERSCAN_KEY,
  };
}

export default config;

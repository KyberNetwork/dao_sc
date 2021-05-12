require("@nomiclabs/hardhat-truffle5");
require("@nomiclabs/hardhat-web3");
require("@nomiclabs/hardhat-etherscan");
require("hardhat-gas-reporter");
require('solidity-coverage');
require('@openzeppelin/hardhat-upgrades');

require('dotenv').config();

require('./deployment/katanaDeployment.js');
require('./deployment/deployInternalGovernance.js');
require('./deployment/deployLiquidityMining.js');
const {accounts} = require('./test-wallets.js');

module.exports = {
  defaultNetwork: 'hardhat',

  gasReporter: {
    currency: 'USD',
    gasPrice: 100
  },

  networks: {
    develop: {
      url: 'http://127.0.0.1:8545',
      gas: 6000000,
      timeout: 20000,
    },
    hardhat: {
      accounts: accounts,
    },
  },

  solidity: {
    compilers: [
      {
        version: "0.7.6",
        settings: {
          optimizer: {
            enabled: true,
            runs: 1000
          }
        }
      },
    ]
  },

  paths: {
    sources: './contracts',
    tests: './test',
  },

  mocha: {
    timeout: 0
  }
};

const INFURA_API_KEY = process.env.INFURA_API_KEY;
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const ETHERSCAN_KEY = process.env.ETHERSCAN_KEY;

if (INFURA_API_KEY != undefined && PRIVATE_KEY != undefined) {
  module.exports.networks.kovan = {
    url: `https://kovan.infura.io/v3/${INFURA_API_KEY}`,
    accounts: [PRIVATE_KEY],
    timeout: 20000
  };

  module.exports.networks.rinkeby = {
    url: `https://rinkeby.infura.io/v3/${INFURA_API_KEY}`,
    accounts: [PRIVATE_KEY],
    timeout: 20000
  };

  module.exports.networks.ropsten = {
    url: `https://ropsten.infura.io/v3/${INFURA_API_KEY}`,
    accounts: [PRIVATE_KEY],
    timeout: 20000
  };

  module.exports.networks.mainnet = {
    url: `https://mainnet.infura.io/v3/${INFURA_API_KEY}`,
    accounts: [PRIVATE_KEY],
    timeout: 20000
  };
}

if (ETHERSCAN_KEY != undefined) {
  module.exports.etherscan = {
    apiKey: ETHERSCAN_KEY
  };
}

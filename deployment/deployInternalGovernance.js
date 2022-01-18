require('@nomiclabs/hardhat-ethers');

let gasPrice;

async function verifyContract(hre, contractAddress, ctorArgs) {
  await hre.run('verify:verify', {
    address: contractAddress,
    constructorArguments: ctorArgs,
  });
}

const operators = [];

const admin = '0x3eb01b3391ea15ce752d01cf3d3f09dec596f650';

const rewardRecipient = '0x43ec6ecffc1e9faab5627341c2186b08d4acdfc2';
const governance = '0x7Ec8FcC26bE7e9E85B57E73083E5Fe0550d8A7fE';
const rewardDistributor = '0x5EC0DcF4f6F55f28550c70B854082993fdc0D3B2';

task('deployInternalGov', 'deploy internal governance for Kyber').setAction(async (taskArgs, hre) => {
  const BN = ethers.BigNumber;
  const [deployer] = await ethers.getSigners();
  deployerAddress = await deployer.getAddress();
  console.log(`Deployer address: ${deployerAddress}`);

  // contract deployment
  gasPrice = new BN.from(32).mul(new BN.from(10).pow(new BN.from(9)));
  const KyberInternalGovernance = await ethers.getContractFactory('KyberInternalGovernance');
  let addresses = [];
  for (let i = 0; i < operators.length; i++) {
    let contract = await KyberInternalGovernance.deploy(
      admin,
      rewardRecipient,
      governance,
      rewardDistributor,
      operators[i],
      {
        gasPrice: gasPrice,
      }
    );
    await contract.deployed();
    console.log(`Internal governance for ${operators[i]} address: ${contract.address}`);
    addresses.push(contract.address);
  }

  for (let i = 0; i < addresses.length; i++) {
    console.log(`Verifying contracts ${addresses[i]}`);
    // verify addresses
    await verifyContract(hre, addresses[i], [admin, rewardRecipient, governance, rewardDistributor, operators[i]]);
  }
  console.log('setup completed');
  process.exit(0);
});

require('@nomiclabs/hardhat-ethers');

let gasPrice;

async function verifyContract(hre, contractAddress, ctorArgs) {
  await hre.run('verify:verify', {
    address: contractAddress,
    constructorArguments: ctorArgs,
  });
}

const kncAddress = "";
let lockerAddress;
let fairLaunchAddress;

const lockDuration = 86400;
const difference = 1800;


task('deployLiquidityMining', 'deploy Liquidity Mining contracts').setAction(
  async (taskArgs, hre) => {
    const BN = ethers.BigNumber;
    const [deployer] = await ethers.getSigners();
    deployerAddress = await deployer.getAddress();
    console.log(`Deployer address: ${deployerAddress}`)

    // contract deployment
     gasPrice = new BN.from(32).mul(new BN.from(10).pow(new BN.from(9)));
    const KyberRewardLocker = await ethers.getContractFactory('KyberRewardLocker');
    let rewardLocker;
    let needVerifyRewardLocker = false;
    if (lockerAddress == undefined) {
        rewardLocker = await KyberRewardLocker.deploy(deployerAddress, { gasPrice: gasPrice  });
        lockerAddress = rewardLocker.address;
        await rewardLocker.deployed();
        needVerifyRewardLocker = true;
    } else {
        rewardLocker = await KyberRewardLocker.attach(lockerAddress);
    }
    console.log(`Reward locker address: ${rewardLocker.address}`);

    const KyberFairLaunch = await ethers.getContractFactory('KyberFairLaunch');
    let fairLaunch;
    let needVerifyFairLaucnh = false;
    if (fairLaunchAddress == undefined) {
        fairLaunch = await KyberFairLaunch.deploy(deployerAddress, kncAddress, rewardLocker.address, { gasPrice: gasPrice });
        fairLaunchAddress = fairLaunch.address;
        await fairLaunch.deployed();
        needVerifyFairLaucnh = true;
    } else {
        fairLaunch = await KyberFairLaunch.attach(fairLaunchAddress);
    }
    console.log(`FairLaunch address: ${fairLaunch.address}`);

    if (needVerifyRewardLocker) {
        console.log(`Verifying contracts RewardLocker`);
        await verifyContract(hre, rewardLocker.address, [deployerAddress]);
    }
    if (needVerifyFairLaucnh) {
        console.log(`Verifying contracts FairLaunch`);
        await verifyContract(hre, fairLaunch.address, [deployerAddress, kncAddress, rewardLocker.address]);
    }

    await rewardLocker.addRewardsContract(kncAddress, fairLaunch.address, { gasPrice: gasPrice });
    console.log(`Added fairlaunch as reward contract in reward locker`);
    await rewardLocker.setVestingConfig(kncAddress, lockDuration, difference, { gasPrice: gasPrice });
    console.log(`Set vesting schedule for KNC`);

    const pools = []
    const startBlocks = [];
    const endBlocks = []
    const rewardPerBlocks = []

    for(let i = 0; i < pools.length; i++) {
        console.log(`Adding pool: ${pools[i]}`);
        await fairLaunch.addPool(i, startBlocks[i], endBlocks[i], rewardPerBlocks[i], { gasPrice: gasPrice });
        console.log(`Added pool: ${pools[i]}`)
    }

    console.log('setup completed');
    process.exit(0);
  }
);

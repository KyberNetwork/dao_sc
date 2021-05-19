const {expectRevert} = require('@openzeppelin/test-helpers');
const Helper = require('./helper');
const {ethAddress} = require('./helper.js');
let setupFailed = true;

let dmmLiquidationStrategy;
let dmmRouter;
let admin;
let operator;

let MAX_UINT;
let ZERO;
let oneEth;

let treasuryAddress = '0x0E590bB5F02A0c38888bFFb45DeE050b8fB60Bda';
let wethAddress = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
let kncAddress = '0xdeFA4e8a7bcBA345F687a2f1456F5Edd9CE97202';
let usdcAddress = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
let usdtAddress = '0xdac17f958d2ee523a2206206994597c13d831ec7';
let usdcUsdtLpAddress = '0x1822456FC778419420cEe4ef48aB1fA3FC5120fc';
let ethUsdtLpAddress = '0xf8467EF9de03E83B5a778Ac858EA5c2d1FC47188';

let knc;
let usdc;
let usdt;
let usdcUsdtLp;
let ethUsdtLp;

contract('BasicDMMLiquidationStrategy', function () {
  if (process.env.ALCHEMY_KEY) {
    before(`turn on mainnet forking and deploy `, async () => {
      try {
        await network.provider.request({
          method: 'hardhat_reset',
          params: [
            {
              forking: {
                jsonRpcUrl: `https://eth-mainnet.alchemyapi.io/v2/${process.env.ALCHEMY_KEY}`,
                blockNumber: 12456700,
              },
            },
          ],
        });

        [operator, admin] = await ethers.getSigners();
        MAX_UINT = ethers.constants.MaxUint256;
        ZERO = ethers.constants.Zero;
        oneEth = ethers.constants.WeiPerEther;
        // deploy dmm liquidation strategy
        let DMMLiquidation = await ethers.getContractFactory('DMMLiquidationStrategy');
        dmmRouter = await ethers.getContractAt('IDMMRouter02', '0x1c87257f5e8609940bc751a07bb085bb7f8cdbe6');
        usdc = await ethers.getContractAt('IERC20', usdcAddress);
        usdt = await ethers.getContractAt('IERC20', usdtAddress);
        knc = await ethers.getContractAt('IERC20', kncAddress);
        usdcUsdtLp = await ethers.getContractAt('IERC20', usdcUsdtLpAddress);
        ethUsdtLp = await ethers.getContractAt('IERC20', ethUsdtLpAddress);
        dmmLiquidationStrategy = await DMMLiquidation.deploy(
          admin.address,
          treasuryAddress,
          '0xD2D0a0557E5B78E29542d440eC968F9253Daa2e2',
          Helper.getCurrentBlockTime(),
          1209600, // 2 weeks
          345600, // 4 days
          admin.address, // random address for now
          10,
          [ethAddress, '0xdeFA4e8a7bcBA345F687a2f1456F5Edd9CE97202'],
          dmmRouter.address
        );
        setupFailed = false;
      } catch (e) {
        console.log(e);
        setupFailed = true;
      }
    });

    it('should have token approvals set by admin only', async () => {
      if (setupFailed) this.skip();
      await expectRevert(
        dmmLiquidationStrategy.connect(operator).setTokenApprovalsOnRouter([usdcAddress, kncAddress], true),
        'only admin'
      );
      await dmmLiquidationStrategy.connect(admin).setTokenApprovalsOnRouter([usdcAddress, kncAddress], true);
      Helper.assertEqual(
        (await usdc.allowance(dmmLiquidationStrategy.address, dmmRouter.address)).toString(),
        MAX_UINT.toString()
      );
      Helper.assertEqual(
        (await knc.allowance(dmmLiquidationStrategy.address, dmmRouter.address)).toString(),
        MAX_UINT.toString()
      );
      await dmmLiquidationStrategy.connect(admin).setTokenApprovalsOnRouter([usdcAddress, kncAddress], false);
      Helper.assertEqual(
        (await usdc.allowance(dmmLiquidationStrategy.address, dmmRouter.address)).toString(),
        ZERO.toString()
      );
      Helper.assertEqual(
        (await knc.allowance(dmmLiquidationStrategy.address, dmmRouter.address)).toString(),
        ZERO.toString()
      );
    });

    it('should not be able to break down LP tokens if liquidator is not whitelisted', async () => {
      if (setupFailed) this.skip();
      await dmmLiquidationStrategy.connect(admin).updateWhitelistedLiquidators([admin.address], true);
      await dmmLiquidationStrategy.connect(admin).enableWhitelistedLiquidators();
      await expectRevert(
        dmmLiquidationStrategy
          .connect(operator)
          .removeLiquidity([usdc.address], [usdc.address], [usdc.address], [0], [0], [0]),
        'only whitelisted liquidator'
      );

      await expectRevert(
        dmmLiquidationStrategy.connect(operator).removeLiquidityETH([usdc.address], [usdc.address], [0], [0], [0]),
        'only whitelisted liquidator'
      );
    });

    it('should revert for bad input lengths', async () => {
      if (setupFailed) this.skip();
      await dmmLiquidationStrategy.connect(admin).updateWhitelistedLiquidators([admin.address], true);
      await dmmLiquidationStrategy.connect(admin).enableWhitelistedLiquidators();

      // removeLiquidity
      await expectRevert(
        dmmLiquidationStrategy
          .connect(admin)
          .removeLiquidity([usdc.address, knc.address], [usdc.address], [usdc.address], [0], [0], [0]),
        'bad input length'
      );

      await expectRevert(
        dmmLiquidationStrategy
          .connect(admin)
          .removeLiquidity([usdc.address], [usdc.address, knc.address], [usdc.address], [0], [0], [0]),
        'bad input length'
      );

      await expectRevert(
        dmmLiquidationStrategy
          .connect(admin)
          .removeLiquidity([usdc.address], [usdc.address], [usdc.address, knc.address], [0], [0], [0]),
        'bad input length'
      );

      await expectRevert(
        dmmLiquidationStrategy
          .connect(admin)
          .removeLiquidity([usdc.address], [usdc.address], [usdc.address], [0, 0], [0], [0]),
        'bad input length'
      );

      await expectRevert(
        dmmLiquidationStrategy
          .connect(admin)
          .removeLiquidity([usdc.address], [usdc.address], [usdc.address], [0], [0, 0], [0]),
        'bad input length'
      );

      await expectRevert(
        dmmLiquidationStrategy
          .connect(admin)
          .removeLiquidity([usdc.address], [usdc.address], [usdc.address], [0], [0], [0, 0]),
        'bad input length'
      );

      // removeLiquidityETH
      await expectRevert(
        dmmLiquidationStrategy
          .connect(admin)
          .removeLiquidityETH([usdc.address, knc.address], [usdc.address], [0], [0], [0]),
        'bad input length'
      );

      await expectRevert(
        dmmLiquidationStrategy
          .connect(admin)
          .removeLiquidityETH([usdc.address], [usdc.address, knc.address], [0], [0], [0]),
        'bad input length'
      );

      await expectRevert(
        dmmLiquidationStrategy.connect(admin).removeLiquidityETH([usdc.address], [usdc.address], [0, 0], [0], [0]),
        'bad input length'
      );

      await expectRevert(
        dmmLiquidationStrategy.connect(admin).removeLiquidityETH([usdc.address], [usdc.address], [0], [0, 0], [0]),
        'bad input length'
      );

      await expectRevert(
        dmmLiquidationStrategy.connect(admin).removeLiquidityETH([usdc.address], [usdc.address], [0], [0], [0, 0]),
        'bad input length'
      );
    });

    it('should be able to remove LP tokens and send tokens to treasury', async () => {
      if (setupFailed) this.skip();
      // get admin of treasury pool to impersonate it
      let treasuryPool = await ethers.getContractAt('TreasuryPool', treasuryAddress);
      let treasuryAdminAddress = await treasuryPool.admin();
      // impersonate treasury admin
      await network.provider.request({
        method: 'hardhat_impersonateAccount',
        params: [treasuryAdminAddress],
      });
      treasuryAdmin = await ethers.provider.getSigner(treasuryAdminAddress);
      // fund treasury admin
      await admin.sendTransaction({
        to: treasuryAdminAddress,
        gasLimit: 80000,
        value: oneEth,
      });
      await treasuryPool.connect(treasuryAdmin).authorizeStrategies([dmmLiquidationStrategy.address]);

      let uniswapRouter = await ethers.getContractAt(
        'IUniswapV2Router02',
        '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D'
      );
      // swap some ETH for USDC and USDT
      await uniswapRouter.swapExactETHForTokens(0, [wethAddress, usdcAddress], admin.address, MAX_UINT, {
        value: oneEth,
      });
      await uniswapRouter.swapExactETHForTokens(0, [wethAddress, usdtAddress], admin.address, MAX_UINT, {
        value: oneEth,
      });

      // give token approvals to dmm router
      await usdc.connect(admin).approve(dmmRouter.address, MAX_UINT);
      await usdt.connect(admin).approve(dmmRouter.address, MAX_UINT);

      // create USDC-USDT and ETH-USDT LP tokens, sent to treasury
      await dmmRouter
        .connect(admin)
        .addLiquidity(
          usdcAddress,
          usdtAddress,
          usdcUsdtLpAddress,
          await usdc.balanceOf(admin.address),
          await usdt.balanceOf(admin.address),
          0,
          0,
          [0, MAX_UINT],
          treasuryAddress,
          MAX_UINT
        );

      await dmmRouter
        .connect(admin)
        .addLiquidityETH(
          usdtAddress,
          ethUsdtLpAddress,
          await usdt.balanceOf(admin.address),
          0,
          0,
          [0, MAX_UINT],
          treasuryAddress,
          MAX_UINT,
          {value: oneEth}
        );

      // admin give LP token approvals to dmmRouter
      await dmmLiquidationStrategy
        .connect(admin)
        .setTokenApprovalsOnRouter([usdcUsdtLpAddress, ethUsdtLpAddress], true);

      // get initial token balances
      let usdcBal = await usdc.balanceOf(treasuryAddress);
      let usdtBal = await usdt.balanceOf(treasuryAddress);
      // attempt liquidity removal
      await dmmLiquidationStrategy
        .connect(admin)
        .removeLiquidity(
          [usdcAddress],
          [usdtAddress],
          [usdcUsdtLpAddress],
          [await usdcUsdtLp.balanceOf(treasuryAddress)],
          [0],
          [0]
        );
      // check balances change
      Helper.assertGreater((await usdc.balanceOf(treasuryAddress)).toString(), usdcBal.toString());
      Helper.assertGreater((await usdt.balanceOf(treasuryAddress)).toString(), usdtBal.toString());
      Helper.assertEqual((await usdcUsdtLp.balanceOf(treasuryAddress)).toString(), ZERO.toString());

      // get initial balances
      usdtBal = await usdt.balanceOf(treasuryAddress);
      ethBal = await ethers.provider.getBalance(treasuryAddress);
      // attempt liquidity removal
      await dmmLiquidationStrategy
        .connect(admin)
        .removeLiquidityETH([usdtAddress], [ethUsdtLpAddress], [await ethUsdtLp.balanceOf(treasuryAddress)], [0], [0]);
      // check balances change
      Helper.assertGreater((await usdt.balanceOf(treasuryAddress)).toString(), usdtBal.toString());
      Helper.assertGreater((await ethers.provider.getBalance(treasuryAddress)).toString(), ethBal.toString());
      Helper.assertEqual((await ethUsdtLp.balanceOf(treasuryAddress)).toString(), ZERO.toString());
    });

    after('disable mainnet fork', async () => {
      await network.provider.request({
        method: 'hardhat_reset',
        params: [],
      });
    });
  }
});

// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import '@openzeppelin/contracts/math/SafeMath.sol';
import {IERC20Ext} from '@kyber.network/utils-sc/contracts/IERC20Ext.sol';
import '@openzeppelin/contracts/token/ERC20/ERC20Burnable.sol';
import '@openzeppelin/contracts/token/ERC20/SafeERC20.sol';
import {ReentrancyGuard} from '@openzeppelin/contracts/utils/ReentrancyGuard.sol';
import {PermissionAdmin} from '@kyber.network/utils-sc/contracts/PermissionAdmin.sol';

import {IKyberStaking} from '../interfaces/staking/IKyberStaking.sol';
import {IRewardsDistributor} from '../interfaces/rewardDistribution/IRewardsDistributor.sol';
import {IKyberGovernance} from '../interfaces/governance/IKyberGovernance.sol';

interface INewKNC {
  function mintWithOldKnc(uint256 amount) external;
  function oldKNC() external view returns (address);
}

interface IKyberNetworkProxy {
  function swapEtherToToken(IERC20Ext token, uint256 minConversionRate)
    external
    payable
    returns (uint256 destAmount);

  function swapTokenToToken(
    IERC20Ext src,
    uint256 srcAmount,
    IERC20Ext dest,
    uint256 minConversionRate
  ) external returns (uint256 destAmount);
}

contract PoolMaster is PermissionAdmin, ReentrancyGuard, ERC20Burnable {
  using SafeMath for uint256;
  using SafeERC20 for IERC20Ext;

  IERC20Ext internal constant ETH_ADDRESS = IERC20Ext(0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE);
  uint256 internal constant PRECISION = (10**18);
  uint256 internal constant BPS = 10000;
  uint256 internal constant INITIAL_SUPPLY_MULTIPLIER = 10;
  uint256 internal constant MAX_UINT = 2**256 - 1;
  uint256 public adminFeeBps;
  uint256 public withdrawableAdminFees;

  mapping(address => bool) internal operators;

  IKyberNetworkProxy public kyberProxy;
  IKyberStaking public immutable kyberStaking;
  IRewardsDistributor public rewardsDistributor;
  IKyberGovernance public kyberGovernance;
  IERC20Ext public immutable newKnc;
  IERC20Ext private immutable oldKnc;

  modifier onlyAdminOrOperator() {
    require(msg.sender == admin || isOperator(msg.sender), 'only admin or operator');
    _;
  }

  constructor(
    string memory _name,
    string memory _symbol,
    IKyberNetworkProxy _kyberProxy,
    IKyberStaking _kyberStaking,
    IKyberGovernance _kyberGovernance,
    IRewardsDistributor _rewardsDistributor,
    IERC20Ext _newKnc,
    uint256 _adminFeeBps
  ) ERC20(_name, _symbol) PermissionAdmin(msg.sender) {
    kyberProxy = _kyberProxy;
    kyberStaking = _kyberStaking;
    kyberGovernance = _kyberGovernance;
    rewardsDistributor = _rewardsDistributor;
    newKnc = _newKnc;
    oldKnc = INewKNC(_newKnc).oldKNC();
    oldKnc.safeApprove(address(_newKnc), MAX_UINT);
    _newKnc.safeApprove(address(_kyberStaking), MAX_UINT);
    _changeAdminFee(_adminFeeBps);
  }

  function changeKyberProxy(IKyberNetworkProxy _kyberProxy) external onlyAdmin {
    kyberProxy = _kyberProxy;
  }

  function changeRewardsDistributor(IRewardsDistributor _rewardsDistributor) external onlyAdmin {
    rewardsDistributor = _rewardsDistributor;
  }

  function changeGovernance(IKyberGovernance _kyberGovernance) external onlyAdmin {
    kyberGovernance = _kyberGovernance;
  }

  function changeAdminFee(uint256 _adminFeeBps) external onlyAdmin {
    _changeAdminFee(_adminFeeBps);
  }

  function addOperator(address newOperator) external onlyAdmin {
    operators[newOperator] = true;
  }

  function removeOperator(address newOperator) external onlyAdmin {
    operators[newOperator] = false;
  }

  function depositWithOldKnc(uint256 tokenWei) external {
    oldKnc.safeTransferFrom(msg.sender, address(this), tokenWei);
    INewKNC(newKnc).mintWithOldKnc(tokenWei);
    _deposit();
  }

  function depositWithNewKnc(uint256 tokenWei) external {
    newKnc.safeTransferFrom(msg.sender, address(this), tokenWei);
    _deposit();
  }

  /*
   * @notice Called by users burning their token
   * @dev Calculates pro rata KNC and redeems from staking contract
   * @param tokensToRedeem
   */
  function withdraw(uint256 tokensToRedeemTwei) external nonReentrant {
    require(balanceOf(msg.sender) >= tokensToRedeemTwei, 'insufficient balance');

    uint256 proRataKnc = getLatestStake().mul(tokensToRedeemTwei).div(totalSupply());
    _unstake(proRataKnc);
    super._burn(msg.sender, tokensToRedeemTwei);

    newKnc.safeTransfer(msg.sender, proRataKnc);
  }

  /*
   * @notice Vote on KyberDAO campaigns
   * @dev Admin calls with relevant params for each campaign in an epoch
   * @param proposalId: DAO proposalId
   * @param optionBitMask: voting option
   */
  function vote(uint256 proposalId, uint256 optionBitMask) external onlyAdminOrOperator {
    kyberGovernance.submitVote(proposalId, optionBitMask);
  }

  /*
   * @notice Claim accumulated reward thus far
   * @notice Will apply admin fee to KNC token.
   * Admin fee for other tokens applied after liquidation to KNC
   * @dev Admin or operator calls with relevant params
   * @param cycle - sourced from Kyber API
   * @param index - sourced from Kyber API
   * @param tokens - ERC20 fee tokens
   * @param merkleProof - sourced from Kyber API
   */
  function claimReward(
    uint256 cycle,
    uint256 index,
    IERC20Ext[] calldata tokens,
    uint256[] calldata cumulativeAmounts,
    bytes32[] calldata merkleProof
  ) external onlyAdminOrOperator {
    ewardsDistributor.claim(
      cycle,
      index,
      address(this),
      tokens,
      cumulativeAmounts,
      merkleProof
    );

    for (uint256 i = 0; i < tokens.length; i++) {
      if (tokens[i] == newKnc) {
        uint256 availableKnc = _administerAdminFee(getAvailableNewKncBalanceTwei());
        _stake(availableKnc);
      }
    }
  }

  /*
   * @notice Will liquidate ETH or ERC20 tokens to KNC
   * @notice Will apply admin fee after liquidations
   * @dev Admin or operator calls with relevant params
   * @param tokens - ETH / ERC20 tokens to be liquidated to KNC
   * @param minRates - kyberProxy.getExpectedRate(eth/token => knc)
  */
  function liquidateTokensToKnc(IERC20Ext[] calldata tokens, uint256[] calldata minRates)
    external
    onlyAdminOrOperator
  {
    require(tokens.length == minRates.length, 'unequal lengths');
    for (uint256 i = 0; i < tokens.length; i++) {
      if (tokens[i] == ETH_ADDRESS) {
        kyberProxy.swapEtherToToken{value: address(this).balance}(newKnc, minRates[i]);
      } else if (tokens[i] != newKnc) {
        kyberProxy.swapTokenToToken(
          tokens[i],
          tokens[i].balanceOf(address(this)),
          newKnc,
          minRates[i]
        );
      }
    }
    uint256 availableKnc = _administerAdminFee(getAvailableNewKncBalanceTwei());
    _stake(availableKnc);
  }

  /*
   * @notice Called by admin on deployment for KNC
   * @dev Approves Kyber Proxy contract to trade KNC
   * @param Token to approve on proxy contract
   * @param Pass _reset as true if resetting allowance to zero
   */
  function approveKyberProxyContract(IERC20Ext token, bool reset) external onlyAdminOrOperator {
    uint256 amount = reset ? 0 : MAX_UINT;
    token.safeApprove(address(kyberProxy), amount);
  }

  function withdrawAdminFee() external onlyAdminOrOperator {
    uint256 fee = withdrawableAdminFees;
    withdrawableAdminFees = 0;
    newKnc.safeTransfer(admin, fee);
  }

  /*
   * @notice Returns KNC balance staked to the DAO
   */
  function getLatestStake() public view returns (uint256 latestStake) {
    (latestStake, , ) = kyberStaking.getLatestStakerData(address(this));
  }

  /*
   * @notice Returns KNC balance available to stake
   */
  function getAvailableNewKncBalanceTwei() public view returns (uint256) {
    return newKnc.balanceOf(address(this)).sub(withdrawableAdminFees);
  }

  function isOperator(address operator) public view returns (bool) {
    return operators[operator];
  }

  function _changeAdminFee(uint256 _adminFeeBps) internal {
    require(_adminFeeBps <= BPS, 'exceed 100%');
    adminFeeBps = _adminFeeBps;
  }

  /*
   * @notice returns the collective reward amount to be re-staked
   */
  function _administerAdminFee(uint256 rewardAmount) internal returns (uint256) {
    uint256 adminFeeToDeduct = rewardAmount.mul(BPS - adminFeeBps).div(BPS);
    withdrawableAdminFees = withdrawableAdminFees.add(adminFeeToDeduct);
    return rewardAmount.sub(adminFeeToDeduct);
  }

  /*
   * @notice Calculate and stake new KNC to staking contract
   * then mints appropriate amount to user
  */
  function _deposit() internal {
    uint256 balanceBefore = getLatestStake();

    _stake(getAvailableNewKncBalanceTwei());

    uint256 mintAmount = _calculateMintAmount(balanceBefore);

    return super._mint(msg.sender, mintAmount);
  }

  /*
   * @notice KyberDAO deposit
   */
  function _stake(uint256 amount) private {
    kyberStaking.deposit(amount);
  }

  /*
   * @notice KyberDAO withdraw
   */
  function _unstake(uint256 amount) private {
    kyberStaking.withdraw(amount);
  }

  /*
   * @notice Calculates proportional issuance according to KNC contribution
   * @notice Fund starts at ratio of INITIAL_SUPPLY_MULTIPLIER/1 == token supply/ KNC balance
   * and approaches 1/1 as rewards accrue in KNC
   * @param kncBalanceBefore used to determine ratio of incremental to current KNC
   */
  function _calculateMintAmount(uint256 kncBalanceBefore)
    private
    view
    returns (uint256 mintAmount)
  {
    uint256 kncBalanceAfter = getLatestStake();
    if (totalSupply() == 0) return kncBalanceAfter.mul(INITIAL_SUPPLY_MULTIPLIER);

    mintAmount = (kncBalanceAfter.sub(kncBalanceBefore)).mul(totalSupply()).div(kncBalanceBefore);
  }
}

const BalanceTree = require('./balanceTree').BalanceTree;
const ethers = require('ethers');
const BigNumber = ethers.BigNumber;

module.exports.parseRewards = function (rewardInfo) {
  const cycle = rewardInfo.cycle;
  const userRewards = rewardInfo.userRewards;
  const mappedInfo = Object.keys(userRewards).reduce((memo, account) => {
    if (!ethers.utils.isAddress(account)) {
      throw new Error(`Found invalid address: ${account}`);
    }
    const parsedAddress = ethers.utils.getAddress(account);
    if (memo[parsedAddress]) throw new Error(`Duplicate address: ${parsed}`);
    const parsedTokenAmounts = userRewards[account].cumulativeAmounts.map((amt) => BigNumber.from(amt));
    memo[parsedAddress] = {
      tokens: userRewards[account].tokens,
      cumulativeAmounts: parsedTokenAmounts,
    };
    return memo;
  }, {});

  const treeElements = Object.keys(mappedInfo).map((account) => ({
    account,
    tokens: mappedInfo[account].tokens,
    cumulativeAmounts: mappedInfo[account].cumulativeAmounts,
  }));

  const tree = new BalanceTree(cycle, treeElements);
  const userRewardsWithProof = treeElements.reduce((memo, {account}, index) => {
    tokens = mappedInfo[account].tokens;
    cumulativeAmounts = mappedInfo[account].cumulativeAmounts.map((amt) => amt.toHexString());

    memo[account] = {
      index,
      tokens,
      cumulativeAmounts,
      proof: tree.getProof(cycle, index, account, tokens, cumulativeAmounts)
    };
    return memo;
  }, {});

  return {
    cycle: cycle,
    merkleRoot: tree.getHexRoot(),
    userRewards: userRewardsWithProof,
  };
};

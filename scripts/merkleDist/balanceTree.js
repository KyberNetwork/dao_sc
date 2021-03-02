const MerkleTree = require('./merkleTree').MerkleTree;
const solidityKeccak256 = require('ethers').utils.solidityKeccak256;
const BN = require('ethers').BigNumber;

module.exports.BalanceTree = class BalanceTree {
  constructor(cycle, userRewards) {
    this.tree = new MerkleTree(
      userRewards.map(({ account, tokens, cumulativeAmounts }, index) => {
        return BalanceTree.toNode(cycle, index, account, tokens, cumulativeAmounts)
      })
    );
  }

   static verifyProof(
    cycle,
    index,
    account,
    tokens,
    cumulativeAmounts,
    proof,
    root
    )
  {
    let pair = BalanceTree.toNode(cycle, index, account, tokens, cumulativeAmounts);
    for (const item of proof) {
      pair = MerkleTree.combinedHash(pair, item);
    }

    return pair.equals(root);
  }

  static toNode(cycle, index, account, tokens, cumulativeAmounts) {
    cycle = new BN.from(cycle.toString());
    cumulativeAmounts.map((amt) => new BN.from(amt.toString()));
    return Buffer.from(
      solidityKeccak256(
        ['uint256','uint256','address','address[]','uint256[]'],
        [cycle, index, account, tokens, cumulativeAmounts]
      ).substr(2),
      'hex'
    );
  }

  getHexRoot() {
    return this.tree.getHexRoot();
  }

  // returns the hex bytes32 values of the proof
  getProof(cycle, index, account, tokens, cumulativeAmounts) {
    return this.tree.getHexProof(BalanceTree.toNode(cycle, index, account, tokens, cumulativeAmounts));
  }
}

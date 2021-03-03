// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.7.6;


import {TreasuryPool} from "../treasury/TreasuryPool.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import {Utils} from "@kyber.network/utils-sc/contracts/Utils.sol";


contract FeePool is TreasuryPool {

  constructor(address _admin, address[] memory _strategies)
    TreasuryPool(_admin, _strategies) {}
}

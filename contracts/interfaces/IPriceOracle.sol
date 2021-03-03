// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.7.6;


interface IPriceOracle {
  function conversionRate(
    address src,
    address dest,
    uint256 amount
  ) external view returns(uint256 rate);
}

// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.7.6;


/**
* Get conversion rate from price oracles and returns
* If token is not supported, it should return 0 as conversion rate
*/
interface IPriceOracle {
  function conversionRate(
    address src,
    address dest,
    uint256 amount
  ) external view returns(uint256 rate);
}

#!/bin/sh
export NODE_OPTIONS=--max-old-space-size=4096
yarn hardhat compile &&
ts-node contractSizeReport.js

#!/bin/sh
while getopts "f:" arg; do
  case $arg in
    f) FILE=$OPTARG;;
  esac
done

export NODE_OPTIONS=--max-old-space-size=4096

yarn hardhat clean 
yarn hardhat compile
if [ -n "$FILE" ]
then
    yarn hardhat coverage --testfiles test/liquidityMining/rewardLocker.spec.ts --solcoverjs ".solcover.js" --temp ""
else
    yarn hardhat coverage --testfiles "" --solcoverjs ".solcover.js" --temp ""
fi

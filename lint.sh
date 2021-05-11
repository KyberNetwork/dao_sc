#!/bin/bash
yarn solhint 'contracts/**/*.sol'
if [ ! -z "$(find test/ -name "*.js")" ];
then yarn prettier -c 'test/**/*.ts'
fi

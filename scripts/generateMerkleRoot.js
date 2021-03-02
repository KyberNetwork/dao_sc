const path = require('path');
const fs = require('fs');
const argv = require('yargs/yargs')(process.argv.slice(2)).argv;
const parseRewards = require('./merkleDist/parseRewards').parseRewards;

const configPath = argv.f;
const json = JSON.parse(fs.readFileSync(path.join(__dirname, configPath), { encoding: 'utf8' }))
if (typeof json !== 'object') throw new Error('Invalid JSON');
console.log(JSON.stringify(parseRewards(json)));

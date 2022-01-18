const fs = require('fs');
const path = require('path');

module.exports.exportRewardData = function (filename, cycle, userRewards) {
  let output = {};
  output['cycle'] = cycle;
  output['rewards'] = userRewards;
  output = JSON.stringify(output, null, 2);
  fs.writeFileSync(path.join(__dirname, filename), json);
};

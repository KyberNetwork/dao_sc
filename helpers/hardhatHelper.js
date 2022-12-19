
module.exports.verifyContract = async (hre, contractAddress, ctorArgs) =>{
  await hre.run('verify:verify', {
    address: contractAddress,
    constructorArguments: ctorArgs,
  });
}

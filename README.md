# KyberDao Katana

## Architecture

![kyber-gov-architecture](./kyber-gov-architecture.png)

### General Information
The overall architecture is based off Aave's governance model with some notable modifications:
- enabling the creation and voting on multi-option (generic) proposals
- pulling voting power from the KyberStaking contract instead of a token contract
- permissioned roles like `owner` & `guardian` have been replaced by `admin` and `daoOperator` with new authorization scopes
- block timestamps utilised instead of block numbers

### KyberGovernance
Handles the queueing, creation, cancellation and vote submissions for binary and generic proposals.
- executors whitelisted: Executor (short) and Executor (long)
- admin (able to authorize/unauthorize executors and voting strategies): Executor (long)
- daoOperator (able to create and cancel proposals): Kyber multisig

### Executor (short)
- admin (the only address enable to interact with this executor): KyberGovernance
- delay (time between a proposals passes and its actions get executed): TBD
- grace period (time after the delay during which the proposal can be executed): TBD
- proposition threshold: TBD
- voting duration: TBD
- vote differential: TBD
- quorum: TBD

### Executor (long)
Controls upgradeability of the new KNC token contract, and any change in key parameters of KyberGoverance or itself
- admin: KyberGovernance
- delay: TBD
- grace period: TBD
- proposition threshold: TBD
- voting duration: TBD
- vote differential: TBD
- quorum: TBD

### KyberVotingPowerStrategy
Calculates voting power from KNC stakes in KyberStaking. Also handles epoch validation checks for proposal creations. Will call KyberGovernance to modify vote counts due to KNC staking withdrawals.
- maxVotingPower: total KNC supply at time of proposal creation

### ProposalValidator (inherited by executors)
Validates the creation and cancellation of proposals. Also determines resolutions to binary proposals.
## Setup
1. Clone this repo
2. `yarn install`

## Compilation
`yarn c` to compile contracts for all solidity versions.

## Contract Deployment / Interactions

For interactions or contract deployments on public testnets / mainnet, create a `.env` file specifying your private key and infura api key, with the following format:

```
PRIVATE_KEY=0x****************************************************************
INFURA_API_KEY=********************************
```

## Testing with Hardhat
1. If contracts have not been compiled, run `yarn c`. This step can be skipped subsequently.
2. Run `yarn test`
3. Use `./tst.sh -f` for running a specific test file.

### Example Commands
- `yarn test` (Runs all tests)
- `./tst.sh -f ./test/kyberGovernance.js` (Test only kyberGovernance.js)

### Example
`yarn hardhat test ./test/kyberGovernance.js`

## Coverage
`yarn coverage` (Runs coverage for all applicable files)

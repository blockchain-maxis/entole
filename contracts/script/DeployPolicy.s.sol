// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {EntolePolicy} from "../src/EntolePolicy.sol";

/// @notice Redeploys only `EntolePolicy`, without touching the demo token or
/// the vault that `Deploy.s.sol` also creates on testnet. This is the script
/// for shipping the version with `executeFor` and the `createAllowance`
/// hardening; the old policy stays where it is, and nothing custodies funds in
/// either, so there is nothing to migrate except the address in config.
///
/// Usage:
///   forge script script/DeployPolicy.s.sol --rpc-url monad_testnet \
///     --private-key $DEPLOYER_PRIVATE_KEY --broadcast
///
/// Afterwards: read the deployment block from broadcast/DeployPolicy.s.sol/10143/run-latest.json,
/// then put the printed address in `NEXT_PUBLIC_ENTOLE_POLICY_ADDRESS`
/// (apps/web/.env) and `extra.entole.contractAddress` (apps/mobile/app.json),
/// and the address and block in indexer/config.yaml. Allowances created on the
/// old policy do not exist on the new one: people create theirs again.
contract DeployPolicy is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");

        vm.startBroadcast(deployerKey);
        EntolePolicy policy = new EntolePolicy();
        vm.stopBroadcast();

        console.log("EntolePolicy deployed:", address(policy));
    }
}

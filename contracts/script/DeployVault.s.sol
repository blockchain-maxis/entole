// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {GrowthVault} from "../src/GrowthVault.sol";

/// @notice Deploys `GrowthVault` against Agora AUSD on Monad testnet. The vault
/// holds deposits 1:1 and pays no yield — accrual is display-only until a real
/// yield source exists (see docs/BACKLOG.md).
///
/// Usage:
///   forge script script/DeployVault.s.sol --rpc-url monad_testnet --broadcast
contract DeployVault is Script {
    address constant AUSD_TESTNET = 0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC;

    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        vm.startBroadcast(deployerKey);
        GrowthVault vault = new GrowthVault(AUSD_TESTNET);
        vm.stopBroadcast();
        console.log("GrowthVault deployed:", address(vault));
    }
}

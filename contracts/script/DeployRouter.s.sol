// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {EntoleRouter} from "../src/EntoleRouter.sol";

/// @notice Deploys `EntoleRouter` against Agora AUSD. Fee: 0.5%, minimum
/// 0.10 AUSD, maximum 2.50 AUSD. The treasury defaults to the deployer.
///
/// Usage:
///   forge script script/DeployRouter.s.sol --rpc-url monad_testnet --broadcast
contract DeployRouter is Script {
    // Agora AUSD on Monad testnet. Mainnet: 0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a.
    address constant AUSD_TESTNET = 0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC;

    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address treasury = vm.addr(deployerKey);

        vm.startBroadcast(deployerKey);
        EntoleRouter router = new EntoleRouter(AUSD_TESTNET, treasury, 50, 100_000, 2_500_000);
        vm.stopBroadcast();

        console.log("EntoleRouter deployed:", address(router));
        console.log("Treasury:", treasury);
    }
}

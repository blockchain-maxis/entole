// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {EntoleRouter} from "../src/EntoleRouter.sol";

/// @notice Deploys `EntoleRouter` against Agora AUSD on whichever Monad network
/// the script is pointed at. Fee: 0.5%, minimum 0.10 AUSD, maximum 2.50 AUSD.
///
/// The treasury is where every fee lands, for good: the router has no way to
/// change it. It defaults to the deployer, which is fine on the test network.
/// On mainnet set `TREASURY_ADDRESS` to an account that is properly kept.
///
/// Usage:
///   forge script script/DeployRouter.s.sol --rpc-url monad_testnet --broadcast
///   TREASURY_ADDRESS=0x... forge script script/DeployRouter.s.sol --rpc-url monad_mainnet --broadcast
contract DeployRouter is Script {
    address constant AUSD_TESTNET = 0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC;
    address constant AUSD_MAINNET = 0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a;

    error UnknownNetwork(uint256 chainId);

    function ausd() public view returns (address) {
        if (block.chainid == 143) return AUSD_MAINNET;
        if (block.chainid == 10143) return AUSD_TESTNET;
        revert UnknownNetwork(block.chainid);
    }

    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address treasury = vm.envOr("TREASURY_ADDRESS", vm.addr(deployerKey));
        address token = ausd();

        vm.startBroadcast(deployerKey);
        EntoleRouter router = new EntoleRouter(token, treasury, 50, 100_000, 2_500_000);
        vm.stopBroadcast();

        console.log("Network:", block.chainid);
        console.log("EntoleRouter deployed:", address(router));
        console.log("Settles in:", token);
        console.log("Treasury:", treasury);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {EntolePolicy} from "../src/EntolePolicy.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";

/// @notice Deploys the policy contract and, on a non-production chain, a
/// demo settlement token to mint test balances against. Swapping the demo
/// token for the real settlement asset (Agora AUSD, USDC fallback) is a
/// deploy-script change, not a contract change — `EntolePolicy` only ever
/// sees an ERC20 address.
///
/// Usage:
///   forge script script/Deploy.s.sol --rpc-url monad_testnet \
///     --private-key $DEPLOYER_PRIVATE_KEY --broadcast --verify
contract Deploy is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        vm.startBroadcast(deployerKey);

        EntolePolicy policy = new EntolePolicy();
        console.log("EntolePolicy deployed:", address(policy));

        if (block.chainid == 10143) {
            MockERC20 demoToken = new MockERC20();
            demoToken.mint(deployer, 10_000_000e6);
            console.log("MockERC20 (demo settlement token) deployed:", address(demoToken));
            console.log("Minted 10,000,000 eUSD to deployer:", deployer);
        }

        vm.stopBroadcast();
    }
}

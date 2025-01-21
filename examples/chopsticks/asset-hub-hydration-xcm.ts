// polkadot-asset-hub-transfers.ts
import { setupNetworks, testingPairs } from '@acala-network/chopsticks-testing';
import { NetworkContext } from '@acala-network/chopsticks-utils';
import { AssetTransferApi } from '@substrate/asset-transfer-api';
import fs from 'fs';
import path from 'path';

// Move logging function to top level
function createLogger(sessionId: string) {
    const logFile = path.join(__dirname, `transfer-session-${sessionId}.log`);
    return function log(message: string) {
        const timestamp = new Date().toISOString();
        const logMessage = `[${timestamp}] ${message}\n`;
        fs.appendFileSync(logFile, logMessage);
        console.log(message);
    }
}

async function main() {
    const sessionId = new Date().toISOString().replace(/[:.]/g, '-');
    const log = createLogger(sessionId);

    // Setup networks
    let polkadotAssetHub: NetworkContext;
    let hydration: NetworkContext;

    log(' ### setupNetworks ###');
    const { hydration1, polkadotAssetHub1 } = await setupNetworks({
        hydration1: {
            endpoint: 'wss://hydration.dotters.network',
            port: 8006,
            runtimeLogLevel: 5,
        },
        polkadotAssetHub1: {
            endpoint: 'wss://polkadot-asset-hub-rpc.polkadot.io',
            port: 8007,
            runtimeLogLevel: 5,
        },
    });

    hydration = hydration1;
    polkadotAssetHub = polkadotAssetHub1;

    const { alice , bob} = testingPairs();

    try {
        // Example 3: Cross-chain DOT Transfer (Hydration to AssetHub)
        await executeCrossChainDOTTransfer(hydration, polkadotAssetHub, alice, bob, log);
        log(' ### executed all tests ###');
    } catch (error) {
        console.error('Error during execution:', error);
    } finally {
        // Cleanup
        await polkadotAssetHub.teardown();
    }
}

async function executeCrossChainDOTTransfer(hydration: any, polkadotAssetHub: any, alice: any, bob: any, log: (message: string) => void) {
    // Initial balance checks
    const aliceInitialBalance = await polkadotAssetHub.api.query.system.account(alice.address);
    const bobInitialBalanceHydration = await hydration.api.query.tokens.accounts(bob.address, 5);
    
    log(`=== Initial Balances ===`);
    log(`Alice (AssetHub): ${(aliceInitialBalance.data.free.toNumber() / 1e10).toFixed(4)} DOT`);
    log(`Bob (Hydration): ${(bobInitialBalanceHydration.free.toNumber() / 1e10).toFixed(4)} DOT`);

    // Set Alice's initial balance
    await polkadotAssetHub.dev.setStorage({
        System: {
            Account: [
                [[alice.address], { providers: 1, data: { free: 10 * 1e12 } }],
            ],
        },
    });

    log(`\n=== First Transfer: Alice -> Bob (AssetHub to Hydration) ===`);
    log(`Sending 1 DOT from Alice to Bob`);

    // First transfer execution
    const assetTransferApi = new AssetTransferApi(polkadotAssetHub.api, 'asset-hub-polkadot', 4);
    const tx = await assetTransferApi.createTransferTransaction('2034', bob.address, ['DOT'], ['1000000000000'], {
        format: 'payload',
        xcmVersion: 4,
        sendersAddr: alice.address,
    });
    
    const extrinsic = assetTransferApi.api.registry.createType('Extrinsic', { method: tx.tx.method }, { version: 4 });
    await polkadotAssetHub.api.tx(extrinsic).signAndSend(alice);
    await polkadotAssetHub.dev.newBlock();
    await hydration.dev.newBlock();

    // Check intermediate balances
    const aliceMiddleBalance = await polkadotAssetHub.api.query.system.account(alice.address);
    const bobMiddleBalance = await hydration.api.query.tokens.accounts(bob.address, 5);
    
    log(`\n=== After First Transfer ===`);
    log(`Alice (AssetHub): ${(aliceMiddleBalance.data.free.toNumber() / 1e10).toFixed(4)} DOT`);
    log(`Bob (Hydration): ${(bobMiddleBalance.free.toNumber() / 1e10).toFixed(4)} DOT`);

    // Return transfer
    log(`\n=== Return Transfer: Bob -> Alice (Hydration to AssetHub) ===`);
    log(`Sending 0.9 DOT from Bob to Alice`);
    
    const assetTransferApiHydration = new AssetTransferApi(hydration.api, 'hydradx', 4);
    const returnTx = await assetTransferApiHydration.createTransferTransaction(
        '1000',
        alice.address,
        ['DOT'],
        ['900000000000'],
        {
            format: 'payload',
            xcmVersion: 4,
            sendersAddr: bob.address,
        }
    );

    const returnExtrinsic = assetTransferApiHydration.api.registry.createType(
        'Extrinsic',
        { method: returnTx.tx.method },
        { version: 4 }
    );

    await hydration.api.tx(returnExtrinsic).signAndSend(bob);
    await hydration.dev.newBlock();
    await polkadotAssetHub.dev.newBlock();

    // Final balance checks
    const aliceFinalBalance = await polkadotAssetHub.api.query.system.account(alice.address);
    const bobFinalBalance = await hydration.api.query.tokens.accounts(bob.address, 5);
    
    log(`\n=== Final Balances ===`);
    log(`Alice (AssetHub): ${(aliceFinalBalance.data.free.toNumber() / 1e10).toFixed(4)} DOT`);
    log(`Bob (Hydration): ${(bobFinalBalance.free.toNumber() / 1e10).toFixed(4)} DOT`);
    
    log(`\n=== Balance Changes ===`);
    log(`Alice (AssetHub): ${((aliceFinalBalance.data.free.toNumber() - aliceInitialBalance.data.free.toNumber()) / 1e10).toFixed(4)} DOT`);
    log(`Bob (Hydration): ${((bobFinalBalance.free.toNumber() - bobInitialBalanceHydration.free.toNumber()) / 1e10).toFixed(4)} DOT`);
}


// Run the script
main()
    .catch(console.error)
    .finally(() => process.exit());
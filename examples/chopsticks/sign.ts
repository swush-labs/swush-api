import { sr25519CreateDerive } from "@polkadot-labs/hdkd"
import {
  DEV_PHRASE,
  entropyToMiniSecret,
  mnemonicToEntropy,
  ss58Decode,
  ss58Encode
} from "@polkadot-labs/hdkd-helpers"
import { getPolkadotSigner } from "polkadot-api/signer"
import { RPC_URL, TEST_RPC, TEST_RPC_ASSET_HUB, TEST_RPC_PARACHAIN_HYDRATION } from "../../services/constants"
import { connectPapi } from "../../services/network/types"
import { MultiAddress } from "@polkadot-api/descriptors"
import WebSocket from 'ws';
import { transferFromAssetHubToPara } from "./xcmApi"
import { InvalidTxError, TransactionValidityError } from "polkadot-api"

// Constants
const TRANSFER_AMOUNT = 100_000_000_000_000n // 0.1 DOT in planck units
const BLOCK_PRODUCTION_COUNT = 2
const TRANSACTION_WAIT_TIME = 5000 // 5 seconds

// Initialize signers
const initSigners = () => {
    const miniSecret = entropyToMiniSecret(mnemonicToEntropy(DEV_PHRASE))
    const derive = sr25519CreateDerive(miniSecret)
    
    const aliceKeyPair = derive("//Alice")
    const bobKeyPair = derive("//Bob")
    
    const alice = getPolkadotSigner(
        aliceKeyPair.publicKey,
        "Sr25519",
        aliceKeyPair.sign,
    )

    return {
        alice,
        aliceKeyPair,
        bobKeyPair
    }
}

// WebSocket connection manager
class WSManager {
    private connections: Map<string, WebSocket> = new Map()

    connect(endpoint: string, name: string) {
        const ws = new WebSocket(endpoint)
        ws.on('open', () => {
            console.log(`Connected to ${name} WebSocket`)
        })
        this.connections.set(name, ws)
        return ws
    }

    sendCommand(method: string, params: any) {
        const message = JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method,
            params,
        })
        
        this.connections.forEach((ws, name) => {
            console.log(`Sending command to ${name}`)
            ws.send(message)
        })
    }

    close() {
        this.connections.forEach(ws => ws.close())
    }
}

// Transaction helper with simplified error handling
const submitAndWaitForTx = (tx: any, signer: any) => {
    return new Promise((resolve, reject) => {
        let hasErrored = false;

        tx.call.signSubmitAndWatch(signer).subscribe({
            next: (event: any) => {
                console.log("XCM Tx event:", event.type)
                
                if ((event.type === "finalized" || event.type === "txBestBlocksState") && !hasErrored) {
                    if (!event.ok) {
                        hasErrored = true;
                        reject(event.dispatchError); // Pass the raw error up
                        return;
                    }
                    console.log("XCM transfer included in block:", event.txHash);
                    resolve(event);
                }
            },
            error: (err: any) => {
                if (!hasErrored) {
                    hasErrored = true;
                    reject(err); // Pass the raw error up
                }
            }
        });
    });
}

async function main() {
    const wsManager = new WSManager()
    const RPC = TEST_RPC_ASSET_HUB
    wsManager.connect(RPC, 'AssetHub')

    const { alice, aliceKeyPair, bobKeyPair } = initSigners()
    const { api, client } = await connectPapi(RPC)
    
    try {
        const ALICE = ss58Encode(aliceKeyPair.publicKey, 0)
        const BOB = ss58Encode(bobKeyPair.publicKey, 63)

        console.log("Alice address:", ALICE)
        console.log("Bob address:", BOB)

        const initialBalance = await api.query.System.Account.getValue(ALICE)
        console.log(`Initial balance of Alice: ${initialBalance.data.free} planck (${Number(initialBalance.data.free) / 1e10} DOT)`)

        const xcmTx = transferFromAssetHubToPara(api, 2034111, BOB, TRANSFER_AMOUNT)
        const estimatedFees = await xcmTx.call.getEstimatedFees(ALICE)
        console.log(`Estimated fees: ${Number(estimatedFees) / 1e10} DOT`)

        console.log("Submitting XCM transfer transaction...")
        await submitAndWaitForTx(xcmTx, alice)
            .catch(error => {
                // Handle XCM specific errors
                if (error?.type === "Module" && 
                    (error.value.type === "XcmPallet" || error.value.type === "PolkadotXcm")) {
                    console.error("XCM Error:", error.value);
                } 
                // Handle transaction validity errors
                else if (error instanceof InvalidTxError) {
                    console.error("Invalid Transaction:", error.error);
                }
                // Handle other errors
                else {
                    console.error("Transaction failed:", error);
                }
                throw error; // Re-throw to stop execution
            });

        // Only runs if transaction succeeds
        wsManager.sendCommand('dev_newBlock', [{ count: BLOCK_PRODUCTION_COUNT }]);
        await new Promise(resolve => setTimeout(resolve, TRANSACTION_WAIT_TIME));

        const finalBalance = await api.query.System.Account.getValue(ALICE)
        console.log(`Final balance of Alice: ${finalBalance.data.free} planck (${Number(finalBalance.data.free) / 1e10} DOT)`)
        console.log(`Amount deducted: ${Number(initialBalance.data.free - finalBalance.data.free) / 1e10} DOT`)

    } catch (error) {
       // console.error("Operation failed:", error);
    } finally {
        client.destroy()
        wsManager.close()
    }
}

main().catch(console.error)
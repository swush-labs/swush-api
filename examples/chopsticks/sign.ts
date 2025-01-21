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

// Transaction helper
const submitAndWaitForTx = (tx: any, signer: any) => {
    return new Promise((resolve, reject) => {
        tx.call.signSubmitAndWatch(signer).subscribe({
            next: (event: any) => {
                console.log("XCM Tx event: ", event.type)
                if (event.type === "txBestBlocksState") {
                    console.log("XCM transfer in block:", event.txHash)
                    resolve(event)
                }
            },
            error: (err: any) => {
                console.error("XCM transfer failed:", err)
                reject(err)
            }
        })
    })
}

async function main() {
    // Initialize WebSocket manager
    const wsManager = new WSManager()
    const RPC = TEST_RPC_ASSET_HUB
    wsManager.connect(RPC, 'AssetHub')
    // Uncomment to enable Hydration chain
    wsManager.connect(TEST_RPC_PARACHAIN_HYDRATION, 'Hydration')

    // Initialize signers
    const { alice, aliceKeyPair, bobKeyPair } = initSigners()

    // Connect to API
    const { api, client } = await connectPapi(RPC)
    
    try {
        // Setup addresses
        const ALICE = ss58Encode(aliceKeyPair.publicKey, 0)
        const BOB = ss58Encode(bobKeyPair.publicKey, 63) // 7Lpe5LRa2Ntx9KGDk77xzoBPYTCAvj7QqaBx4Nz2TFqL3sLw

        console.log("Alice address:", ALICE)
        console.log("Bob address:", BOB)

        // Check initial balance
        const initialBalance = await api.query.System.Account.getValue(ALICE)
        console.log(`Initial balance of Alice: ${initialBalance.data.free} planck (${Number(initialBalance.data.free) / 1e10} DOT)`)

        console.log(`Sending ${Number(TRANSFER_AMOUNT) / 1e10} DOT from Asset Hub to Hydration (ParaID 2034)`)
        
        // Create and submit XCM transfer
        const xcmTx = transferFromAssetHubToPara(api, 2034, BOB, TRANSFER_AMOUNT)
        console.log("Created XCM transfer transaction")
        
        await submitAndWaitForTx(xcmTx, alice)
        console.log("XCM transfer submitted and included in block")

        // Produce blocks
        wsManager.sendCommand('dev_newBlock', [{ count: BLOCK_PRODUCTION_COUNT }])

        // Wait for processing
        await new Promise(resolve => setTimeout(resolve, TRANSACTION_WAIT_TIME))

        // Check final balance
        const finalBalance = await api.query.System.Account.getValue(ALICE)
        console.log(`Final balance of Alice: ${finalBalance.data.free} planck (${Number(finalBalance.data.free) / 1e10} DOT)`)
        console.log(`Amount deducted: ${Number(initialBalance.data.free - finalBalance.data.free) / 1e10} DOT`)

    } catch (error) {
        console.error("Error in main:", error)
    } finally {
        // Cleanup
        client.destroy()
        wsManager.close()
    }
}

main().catch(console.error)
import { sr25519CreateDerive } from "@polkadot-labs/hdkd"
import {
  DEV_PHRASE,
  entropyToMiniSecret,
  mnemonicToEntropy,
  ss58Decode,
  ss58Encode
} from "@polkadot-labs/hdkd-helpers"
import { getPolkadotSigner } from "polkadot-api/signer"
import {  TEST_RPC_PARACHAIN_HYDRATION } from "../../../services/constants"
import WebSocket from 'ws';
import { TransactionService } from '../../../services/network/TransactionService';
import { connectPapi } from "../../../services/network/types";
import { transferParaToAssetHub } from "../xcmApi";

// Constants
const TRANSFER_AMOUNT = 100_000_000_000_000n // 0.1 HDX in planck units
const HDX_ASSET_ID = 0 // HDX token ID in Hydration
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

async function main() {
    const wsManager = new WSManager()
    const RPC = TEST_RPC_PARACHAIN_HYDRATION
    wsManager.connect(RPC, 'Hydration')

    const { alice, aliceKeyPair, bobKeyPair } = initSigners()
    const { api, client } = await connectPapi(RPC, 'hydration')

    try {
        const ALICE = ss58Encode(aliceKeyPair.publicKey, 63) // Hydration address format
        const BOB = ss58Encode(bobKeyPair.publicKey, 0)      // Asset Hub address format

        console.log("Alice address (Hydration):", ALICE)
        console.log("Bob address (Asset Hub):", BOB)

        // Debug the available pallets
        console.log('Available pallets:', Object.keys(api.query))

        // Check HDX token balance using tokens (lowercase)
        const initialBalance = await api.query.Tokens.Accounts.getValue(ALICE, HDX_ASSET_ID)
        console.log(`Initial HDX balance of Alice: ${initialBalance.free} planck (${Number(initialBalance.free) / 1e12} HDX)`)

        // Create XCM transfer from Hydration to Asset Hub
        const xcmTx = transferParaToAssetHub(api, 1000, BOB, TRANSFER_AMOUNT)

        console.log("Submitting XCM transfer transaction...")
        await TransactionService.submitAndWatch(xcmTx.call, alice, {
            onSuccess: (status) => {
                console.log(`Transaction successful in block ${status.blockNumber}`);
            },
            onError: (error) => {
                console.error('Transaction failed:', error);
            },
            onStatusChange: (status) => {
                console.log('Transaction status:', status);
            }
        });

        // Only runs if transaction succeeds
        wsManager.sendCommand('dev_newBlock', [{ count: BLOCK_PRODUCTION_COUNT }]);
        await new Promise(resolve => setTimeout(resolve, TRANSACTION_WAIT_TIME));

        // Check final HDX balance
        const finalBalance = await api.query.Tokens.Accounts.getValue(ALICE, HDX_ASSET_ID)
        console.log(`Final HDX balance of Alice: ${finalBalance.free} planck (${Number(finalBalance.free) / 1e12} HDX)`)
        console.log(`Amount deducted: ${Number(initialBalance.free - finalBalance.free) / 1e12} HDX`)

    } catch (error) {
        console.error('Transaction error:', error);
    } finally {
        client.destroy()
        wsManager.close()
    }
}

main().catch(console.error)
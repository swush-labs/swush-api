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
const TRANSFER_AMOUNT = 100_000_000_000_000n // 1 DOT in planck units
const HDX_ASSET_ID = 0 // HDX token ID in Hydration
const BLOCK_PRODUCTION_COUNT = 2
const TRANSACTION_WAIT_TIME = 5000 // 5 seconds
const DOT_ASSET_ID = 5

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

//FIX: used DOT instead of HDX
async function main() {
    const wsManager = new WSManager()
    const RPC = TEST_RPC_PARACHAIN_HYDRATION
    wsManager.connect(RPC, 'Hydration')

    const { alice, aliceKeyPair, bobKeyPair } = initSigners()
    const { api, client } = await connectPapi(RPC, 'hydration')

    try {
        const ALICE = ss58Encode(aliceKeyPair.publicKey, 63)
        const BOB = ss58Encode(bobKeyPair.publicKey, 0)

        console.log("Alice address (Hydration):", ALICE)
        console.log("Bob address (Asset Hub):", BOB)

        // Check HDX token balance with more detailed logging
        const initialBalance = await api.query.Tokens.Accounts.getValue(ALICE, DOT_ASSET_ID)
        const dotBalance = Number(initialBalance.free) / 1e10
        
        console.log('Transfer details:')
        console.log(`- Amount to transfer: ${Number(TRANSFER_AMOUNT) / 1e10} DOT (${TRANSFER_AMOUNT} planck)`)
        console.log(`- Available balance: ${dotBalance} DOT (${initialBalance.free} planck)`)
        // console.log(`- Reserved balance: ${Number(initialBalance.reserved) / 1e10} HDX`)
        // console.log(`- Frozen balance: ${Number(initialBalance.frozen) / 1e10} HDX`)

        // Query existential deposit if available
        try {
            const existentialDeposit = 1000000000000
            console.log(`Existential deposit: ${Number(existentialDeposit) / 1e10} DOT`)
        } catch (e) {
            console.log('No existential deposit found')
        }

        // Check if we have enough balance
        if (initialBalance.free < TRANSFER_AMOUNT) {
            throw new Error(`Insufficient balance. Have ${dotBalance} DOT, trying to transfer ${Number(TRANSFER_AMOUNT) / 1e10} DOT`)
        }

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
        const finalBalance = await api.query.Tokens.Accounts.getValue(ALICE, DOT_ASSET_ID)
        console.log(`Final DOT balance of Alice: ${finalBalance.free} planck (${Number(finalBalance.free) / 1e10} DOT)`)
        console.log(`Amount deducted: ${Number(initialBalance.free - finalBalance.free) / 1e10} DOT`)

    } catch (error) {
        console.error('Transaction error:', error);
    } finally {
        client.destroy()
        wsManager.close()
    }
}

main().catch(console.error)
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
import RpcConnection from "../../services/network/RpcConnection"

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

async function main() {
    const wsManager = new WSManager()
    const RPC = TEST_RPC_ASSET_HUB
    wsManager.connect(RPC, 'AssetHub')

    // Initialize RPC connection first
    const rpcConnection = RpcConnection.getInstance('papi');
    const { alice, aliceKeyPair, bobKeyPair } = initSigners()
    rpcConnection.setSigner(alice);

    // Define submitTransaction after rpcConnection is initialized
    const submitTransaction = async (tx: any, userId: string) => {
        return new Promise((resolve, reject) => {
            const subscriptionId = rpcConnection.subscribeTx(userId, tx, {
                onSuccess: (status) => {
                    console.log(`Transaction finalized: ${status.txHash}`);
                    resolve(status);
                },
                onError: (error) => {
                    console.error('Transaction failed:', error);
                    reject(error);
                },
                onStatusChange: (status) => {
                    console.log('Transaction status:', status);
                }
            });
        });
    };

    const { api, client } = await connectPapi(RPC)
    
    try {
        const ALICE = ss58Encode(aliceKeyPair.publicKey, 0)
        const BOB = ss58Encode(bobKeyPair.publicKey, 63)

        console.log("Alice address:", ALICE)
        console.log("Bob address:", BOB)

        const initialBalance = await api.query.System.Account.getValue(ALICE)
        console.log(`Initial balance of Alice: ${initialBalance.data.free} planck (${Number(initialBalance.data.free) / 1e10} DOT)`)

        const xcmTx = transferFromAssetHubToPara(api, 203423, BOB, TRANSFER_AMOUNT)
        const estimatedFees = await xcmTx.call.getEstimatedFees(ALICE)
        console.log(`Estimated fees: ${Number(estimatedFees) / 1e10} DOT`)

        console.log("Submitting XCM transfer transaction...")
        const userId = `user-${ALICE}`;
        await submitTransaction(xcmTx, userId);

        // Only runs if transaction succeeds
        wsManager.sendCommand('dev_newBlock', [{ count: BLOCK_PRODUCTION_COUNT }]);
        await new Promise(resolve => setTimeout(resolve, TRANSACTION_WAIT_TIME));

        const finalBalance = await api.query.System.Account.getValue(ALICE)
        console.log(`Final balance of Alice: ${finalBalance.data.free} planck (${Number(finalBalance.data.free) / 1e10} DOT)`)
        console.log(`Amount deducted: ${Number(initialBalance.data.free - finalBalance.data.free) / 1e10} DOT`)

    } catch (error) {
        console.error('Transaction error:', error);
    } finally {
        client.destroy()
        wsManager.close()
    }
}

main().catch(console.error)
import { sr25519CreateDerive } from "@polkadot-labs/hdkd"
import {
  DEV_PHRASE,
  entropyToMiniSecret,
  mnemonicToEntropy,
  ss58Encode
} from "@polkadot-labs/hdkd-helpers"
import { getPolkadotSigner } from "polkadot-api/signer"
import { RPC_URL, TEST_RPC, TEST_RPC_ASSET_HUB, TEST_RPC_PARACHAIN_HYDRATION } from "../../services/constants"
import { connectPapi } from "../../services/network/types"
import { MultiAddress } from "@polkadot-api/descriptors"
import WebSocket from 'ws';
import { teleportRelayToPara } from "./xcmApi"
// let's create Alice signer
const miniSecret = entropyToMiniSecret(mnemonicToEntropy(DEV_PHRASE))
const derive = sr25519CreateDerive(miniSecret)
const aliceKeyPair = derive("//Alice")
const bobKeyPair = derive("//Bob")
const alice = getPolkadotSigner(
  aliceKeyPair.publicKey,
  "Sr25519",
  aliceKeyPair.sign,
)

// Connect to relay chain for block production

// const wsHydration = new WebSocket(TEST_RPC_PARACHAIN_HYDRATION);
// wsHydration.on('open', () => {
//     console.log('Connected to Hydration Chain WebSocket');
// });

const wsAssetHub = new WebSocket(TEST_RPC_ASSET_HUB);
wsAssetHub.on('open', () => {
    console.log('Connected to Asset Hub WebSocket');
});

const sendCommand = (method: string, params: any) => {
    const message = JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: method,
        params: params,
    });
//    wsHydration.send(message);  // Send to relay chain
    wsAssetHub.send(message); // Send to asset hub
}

const setStorage = (key: string, value: string) => {
    sendCommand('state_setStorage', [key, value]);
}


async function main() {
    const { api, client } = await connectPapi(TEST_RPC_ASSET_HUB);
    const ALICE = ss58Encode(aliceKeyPair.publicKey, 0)
    
    // Check initial balance
    const initialBalance = await api.query.System.Account.getValue(ALICE)
    console.log(`Initial balance of Alice: ${initialBalance.data.free} planck (${Number(initialBalance.data.free) / 1e10} DOT)`)

    // Set a clear transfer amount - 100 DOT
    const transferAmount = 100_000_000_000n // 100 DOT in planck units (100 * 10^10)
    
    console.log("Sending XCM transfer to Asset Hub (ParaID 1000)")
    // Initiate XCM transfer to Asset Hub (ParaID 1000)
    const BOB = ss58Encode(bobKeyPair.publicKey, 0)
    // await teleportRelayToPara(api, 2034, BOB, transferAmount)
    await sendToBob(api, transferAmount)
    // Produce new blocks to process the XCM (one for relay chain, one for parachain)
    sendCommand('dev_newBlock',[{ count: 2}])

    // Wait a bit for the transfer to process
    await new Promise(resolve => setTimeout(resolve, 10000))

    // Check final balance
    const finalBalance = await api.query.System.Account.getValue(ALICE)
    console.log(`Final balance of Alice: ${finalBalance.data.free} planck (${Number(finalBalance.data.free) / 1e10} DOT)`)
    console.log(`Amount deducted: ${Number(initialBalance.data.free - finalBalance.data.free) / 1e10} DOT`)

    client.destroy()
}

async function sendToBob(api: any, transferAmount: bigint) {

    const BOB = "5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty"
    const transfer = api.tx.Balances.transfer_allow_death({
        dest: MultiAddress.Id(BOB),
        value: transferAmount,
    })

    // sign and submit the transaction
    transfer.signSubmitAndWatch(alice).subscribe({
        next: (event) => {
            console.log("Tx event: ", event.type)
            if (event.type === "txBestBlocksState") {
                console.log("The tx is now in a best block, check it out:")
                console.log(`TxHash : ${event.txHash}`)
            }
        },
        error: console.error
    })

}

main().catch(console.error);
import { sr25519CreateDerive } from "@polkadot-labs/hdkd"
import {
  DEV_PHRASE,
  entropyToMiniSecret,
  mnemonicToEntropy,
  ss58Encode
} from "@polkadot-labs/hdkd-helpers"
import { getPolkadotSigner } from "polkadot-api/signer"
import { RPC_URL, TEST_RPC } from "../../services/constants"
import { connectPapi } from "../../services/network/types"
import { MultiAddress } from "@polkadot-api/descriptors"
import WebSocket from 'ws';

// let's create Alice signer
const miniSecret = entropyToMiniSecret(mnemonicToEntropy(DEV_PHRASE))
const derive = sr25519CreateDerive(miniSecret)
const aliceKeyPair = derive("//Alice")
const alice = getPolkadotSigner(
  aliceKeyPair.publicKey,
  "Sr25519",
  aliceKeyPair.sign,
)
 
// // create the client with smoldot
// const smoldot = start()
// const client = createClient(getSmProvider(smoldot.addChain({ chainSpec })))
 
// get the safely typed API
// const api = client.getTypedApi(wnd)


const ws = new WebSocket(TEST_RPC);

ws.on('open', () => {
    console.log('Connected to Chopsticks WebSocket');
});

const sendCommand = (method: string, params: any) => {
    const message = JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: method,
        params: params,
    });
    ws.send(message);
};

const setStorage = (key: string, value: string) => {
    sendCommand('state_setStorage', [key, value]);
}


async function main() {
    const { api, client } = await connectPapi(TEST_RPC);

    // create the transaction sending Bob some assets
    const BOB = "5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty"
    const transfer = api.tx.Balances.transfer_allow_death({
        dest: MultiAddress.Id(BOB),
        value: 12345n,
    })

    // initiate a XCM transfer to the parachain hydration
    const x = api.tx.PolkadotXcm.send({
        message: {
            call: transfer.toHex(),
            origin_type: "Native",
            origin: "Root",
        },
        max_weight: 100000000n,
        max_height: 100000000n,
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
        error: console.error,
        complete() {
            client.destroy()
        },
    })
}

main().catch(console.error);
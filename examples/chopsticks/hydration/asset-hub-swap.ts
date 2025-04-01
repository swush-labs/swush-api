import { sr25519CreateDerive } from "@polkadot-labs/hdkd"
import {
    DEV_PHRASE,
    entropyToMiniSecret,
    mnemonicToEntropy,
    ss58Decode,
    ss58Encode
} from "@polkadot-labs/hdkd-helpers"
import { getPolkadotSigner } from "polkadot-api/signer"
import { TEST_RPC_ASSET_HUB } from "../../../services/constants"
import { TransactionService } from '../../../services/network/TransactionService';
import { connectPapi } from "../../../services/network/types";
import { 
    XcmVersionedXcm,
    XcmV3Junctions,
    XcmV3Junction,
    XcmV3Instruction,
    XcmV2OriginKind,
    XcmV3WeightLimit
} from "@polkadot-api/descriptors";

interface Weight {
    ref_time: bigint;
    proof_size: bigint;
}

// Constants
const AMOUNT_IN = 1_000_000_000_000n // Amount of first asset to swap
const MIN_AMOUNT_OUT = 900_000_000_000n // Minimum amount of second asset to receive (with 10% slippage)
const KEEP_ALIVE = true // Keep the account alive after the swap

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

/**
 * Example of using AssetConversion.swap_exact_tokens_for_tokens to swap assets
 * and then executing it via XCM
 */
async function main() {
    const { alice, aliceKeyPair } = initSigners()
    
    // Connect to Asset Hub
    const { api: assetHubApi, client: assetHubClient } = await connectPapi(TEST_RPC_ASSET_HUB, 'asset-hub')

    try {
        const ALICE = ss58Encode(aliceKeyPair.publicKey, 0) // Asset Hub SS58 format
        console.log("Alice address (Asset Hub):", ALICE)

        // Define the swap path (example: USDT -> DOT)
        const path = [
            {
                parents: 0,
                interior: XcmV3Junctions.X2([
                    XcmV3Junction.PalletInstance(50), // Assets pallet
                    XcmV3Junction.GeneralIndex(1984n) // USDT asset ID (example)
                ])
            },
            {
                parents: 1,
                interior: XcmV3Junctions.Here() // DOT (native relay chain asset)
            }
        ]

        // Create the swap transaction
        const swapTx = assetHubApi.tx.AssetConversion.swap_exact_tokens_for_tokens({
            amount_in: AMOUNT_IN,
            amount_out_min: MIN_AMOUNT_OUT,
            keep_alive: KEEP_ALIVE,
            path: path,
            send_to: ALICE
        });

        //print swapTx weights get estimated fees and info
        const estimatedFees = await swapTx.getEstimatedFees(ALICE)
        console.log('Estimated fees:', estimatedFees)


        // Get the encoded call data
        const encodedSwapCall = await swapTx.getEncodedData()

        // Get the payment info to determine required weights
        const paymentInfo = await swapTx.getPaymentInfo(ALICE)
        console.log('Payment info:', paymentInfo)

         // Create the XCM message to execute the swap
        const xcmMessage = XcmVersionedXcm.V3([
            XcmV3Instruction.Transact({
                origin_kind: XcmV2OriginKind.SovereignAccount(),
                require_weight_at_most: {
                    ref_time: paymentInfo.weight.ref_time,
                    proof_size: paymentInfo.weight.proof_size
                },
                call: encodedSwapCall
            })
        ])

        // Query the XCM weight from the API
        const xcmWeight = await assetHubApi.apis.XcmPaymentApi.query_xcm_weight(xcmMessage)

        if (xcmWeight.success) {
            const weight = xcmWeight.value
            // Execute the XCM message with the queried weights
            const executeTx = assetHubApi.tx.PolkadotXcm.execute({
                message: xcmMessage,
                max_weight: {
                    ref_time: weight.ref_time,
                    proof_size: weight.proof_size
                }
            })

            console.log("XCM weights:", {
                ref_time: weight.ref_time.toString(),
                proof_size: weight.proof_size.toString()
            })

            console.log("Submitting XCM execute transaction for asset swap...")
            await TransactionService.submitAndWatch(executeTx, alice, {
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

            // Wait a bit for the transaction to be processed
            await new Promise(resolve => setTimeout(resolve, 5000));

            // Query balances after swap
            // Note: You'll need to implement balance checking based on your specific assets

        } else {
            throw new Error(`Failed to compute XCM weights: ${Object.keys(xcmWeight)[0]}`)
        }

    } catch (error) {
        console.error('Transaction error:', error);
    } finally {
        assetHubClient.destroy()
    }
}

main().catch(console.error) 
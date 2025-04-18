import { sr25519CreateDerive } from "@polkadot-labs/hdkd"
import {
    DEV_PHRASE,
    entropyToMiniSecret,
    mnemonicToEntropy,
    ss58Decode,
    ss58Encode
} from "@polkadot-labs/hdkd-helpers"
import { getPolkadotSigner } from "polkadot-api/signer"
import { TEST_RPC_ASSET_HUB, TEST_RPC_PARACHAIN_HYDRATION } from "../../../services/constants"
import { TransactionService } from '../../../services/network/TransactionService';
import { connectPapi } from "../../../services/network/types";
import { Enum } from "polkadot-api";
import {
    XcmVersionedLocation,
    XcmVersionedAssets,
    XcmVersionedAssetId,
    XcmV3WeightLimit,
    XcmV3Junction,
    XcmV3Junctions,
    XcmV3MultiassetAssetId,
    XcmV3MultiassetFungibility,
    XcmVersionedXcm,
    XcmV3Instruction,
    XcmV2OriginKind
} from "@polkadot-api/descriptors";

// Constants
const TRANSFER_AMOUNT = 100_000_000_000_000n // 1 DOT in planck units
const HDX_ASSET_ID = 0 // HDX token ID in HydraDX
const DOT_ASSET_ID = 5 // DOT token ID in HydraDX (example, adjust as needed)
const TO_SWAP_ASSET_ID = 1000 // Asset ID of the asset to swap into
const HYDRADX_PARA_ID = 2034 // HydraDX parachain ID
const SLIPPAGE_TOLERANCE = 5 // 5% slippage tolerance

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
 * Example of using transfer_assets_using_type_and_then to transfer assets 
 * from Asset Hub to HydraDX and execute an Omnipool swap
 */
async function main() {
    const { alice, aliceKeyPair, bobKeyPair } = initSigners()

    // Connect to Asset Hub
    const { api: assetHubApi, client: assetHubClient } = await connectPapi(TEST_RPC_ASSET_HUB, 'asset-hub')

    // Connect to HydraDX
    const { api: hydraDxApi, client: hydraDxClient } = await connectPapi(TEST_RPC_PARACHAIN_HYDRATION, 'hydration')

    try {
        const ALICE = ss58Encode(aliceKeyPair.publicKey, 0) // Asset Hub SS58 format
        const BOB = ss58Encode(bobKeyPair.publicKey, 63) // HydraDX SS58 format

        console.log("Alice address (Asset Hub):", ALICE)
        console.log("Bob address (HydraDX):", BOB)

        // Check DOT balance on Asset Hub
        const initialBalance = await assetHubApi.query.System.Account.getValue(ALICE)
        const dotBalance = Number(initialBalance.data.free) / 1e10

        console.log('Transfer details:')
        console.log(`- Amount to transfer: ${Number(TRANSFER_AMOUNT) / 1e10} DOT (${TRANSFER_AMOUNT} planck)`)
        console.log(`- Available balance: ${dotBalance} DOT (${initialBalance.data.free} planck)`)

        // Check if we have enough balance
        if (initialBalance.data.free < TRANSFER_AMOUNT) {
            throw new Error(`Insufficient balance. Have ${dotBalance} DOT, trying to transfer ${Number(TRANSFER_AMOUNT) / 1e10} DOT`)
        }

        // Calculate minimum amount out with slippage tolerance
        const minBuyAmount = TRANSFER_AMOUNT * BigInt(100 - SLIPPAGE_TOLERANCE) / 100n

        // Get the encoded Omnipool.sell call
        const omnipoolSell = await hydraDxApi.tx.Omnipool.sell({
            asset_in: DOT_ASSET_ID,
            asset_out: HDX_ASSET_ID,
            amount: TRANSFER_AMOUNT,
            min_buy_amount: minBuyAmount
        });

        const encodedOmnipoolSellHex = await omnipoolSell.getEncodedData();

        //print the encoded omnipool sell hex
        console.log("Encoded Omnipool Sell Hex:", encodedOmnipoolSellHex.asHex)

        const omnipool_weight = await omnipoolSell.getPaymentInfo(ALICE);
        console.log("Omnipool weight:", omnipool_weight)

        // Create the remote fees asset ID (using the same asset for fees)
        const dotAssetId = XcmVersionedAssetId.V3(
            XcmV3MultiassetAssetId.Concrete({
                parents: 1, // 1 for relay chain DOT, 0 for local asset
                interior: XcmV3Junctions.Here(),
            })
        );
        // Create the assets array with a single asset
        const assets = XcmVersionedAssets.V3([{
            id: XcmV3MultiassetAssetId.Concrete({
                parents: 1, // 1 for relay chain DOT, 0 for local asset
                interior: XcmV3Junctions.Here(),
            }),
            fun: XcmV3MultiassetFungibility.Fungible(TRANSFER_AMOUNT)
        }]);

        // Define the destination (HydraDX parachain)
        const destination = XcmVersionedLocation.V3({
            parents: 1,
            interior: XcmV3Junctions.X1(
                XcmV3Junction.Parachain(HYDRADX_PARA_ID)
            )
        });



        const customXcmOnDest = XcmVersionedXcm.V3(
            [
                XcmV3Instruction.Transact({
                    origin_kind: XcmV2OriginKind.Xcm(),
                    require_weight_at_most: {
                        ref_time: omnipool_weight.weight.ref_time,
                        proof_size: omnipool_weight.weight.proof_size
                    },
                    call: encodedOmnipoolSellHex
                })
            ]
        )

        const xcmWeight = await assetHubApi.apis.XcmPaymentApi.query_xcm_weight(customXcmOnDest)

        if (xcmWeight.success) {
            // Create the transaction
            const tx = assetHubApi.tx.PolkadotXcm.transfer_assets_using_type_and_then({
                assets,
                assets_transfer_type: Enum("LocalReserve"),
                custom_xcm_on_dest: customXcmOnDest,
                dest: destination,
                fees_transfer_type: Enum("LocalReserve"),
                remote_fees_id: dotAssetId,
                weight_limit: XcmV3WeightLimit.Unlimited()
            });

            console.log("Submitting XCM transfer with Omnipool swap transaction...")
            await TransactionService.submitAndWatch(tx, alice, {
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

        }

        // console.log("Submitting XCM transfer with Omnipool swap transaction...")
        // await TransactionService.submitAndWatch(tx, alice, {
        //     onSuccess: (status) => {
        //         console.log(`Transaction successful in block ${status.blockNumber}`);
        //     },
        //     onError: (error) => {
        //         console.error('Transaction failed:', error);
        //     },
        //     onStatusChange: (status) => {
        //         console.log('Transaction status:', status);
        //     }
        // });

        // Wait a bit for the transaction to be processed
        await new Promise(resolve => setTimeout(resolve, 5000));

        // Check final DOT balance on Asset Hub
        const finalBalance = await assetHubApi.query.System.Account.getValue(ALICE)
        console.log(`Final DOT balance of Alice: ${finalBalance.data.free} planck (${Number(finalBalance.data.free) / 1e10} DOT)`)
        console.log(`Amount deducted: ${Number(initialBalance.data.free - finalBalance.data.free) / 1e10} DOT`)

        // Check HDX balance on HydraDX
        try {
            const hdxBalance = await hydraDxApi.query.Tokens.Accounts.getValue(BOB, HDX_ASSET_ID)
            console.log(`HDX balance of Bob: ${hdxBalance.free} planck (${Number(hdxBalance.free) / 1e12} HDX)`)
        } catch (error) {
            console.error('Error checking HDX balance:', error)
        }

    } catch (error) {
        console.error('Transaction error:', error);
    } finally {
        assetHubClient.destroy()
        hydraDxClient.destroy()
    }
}

main().catch(console.error) 
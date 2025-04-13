import { sr25519CreateDerive } from "@polkadot-labs/hdkd"
import {
    DEV_PHRASE,
    entropyToMiniSecret,
    KeyPair,
    mnemonicToEntropy,
    ss58Decode,
    ss58Encode
} from "@polkadot-labs/hdkd-helpers"
import { getPolkadotSigner } from "polkadot-api/signer"
import { TEST_RPC_ASSET_HUB, TEST_RPC_PARACHAIN_HYDRATION, XCM_RPC_ASSET_HUB, XCM_RPC_HYDRATION } from "../../../services/constants"
import { TransactionService } from '../../../services/network/TransactionService'
import { connectPapi } from "../../../services/network/types"
import { Enum, Binary } from "polkadot-api"
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
    XcmV4Instruction,
    XcmV2OriginKind,
    XcmV4AssetAssetFilter,
    XcmPalletOrigin,
    PolkadotRuntimeOriginCaller,
    XcmV4AssetWildAsset,
    XcmV2MultiassetWildFungibility,
    XcmV3MultiassetMultiAssetFilter,
    XcmV3Instruction,
    XcmV3MultiassetWildMultiAsset
} from "@polkadot-api/descriptors"
import { serializeKey } from "@/assets/utils"
import { saveToFile } from "@/utils"

// Constants
const TRANSFER_AMOUNT = 200_000_000_000n // 20 DOT in planck units
const HDX_ASSET_ID = 0 // HDX token ID in HydraDX
const DOT_ASSET_ID = 5 // DOT token ID in HydraDX
const HYDRADX_PARA_ID = 2034 // HydraDX parachain ID
const ASSET_HUB_PARA_ID = 1000 // Asset Hub parachain ID
const SLIPPAGE_TOLERANCE = 5 // 5% slippage tolerance
const MAX_ASSETS = 1 // Maximum number of assets to transfer
const BUFFER_PERCENTAGE = 120n // 20% buffer for fees

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
 * Example of XCM asset transfer from Asset Hub to HydraDX with swap and dynamic fee calculation
 * Implementation follows the pattern:
 * 1. Calculate weights and fees for each execution context
 * 2. WithdrawAsset - withdraws assets from Asset Hub (including calculated fees)
 * 3. DepositReserveAsset - sends assets to HydraDX with instructions:
 *    a. BuyExecution - pays for execution on HydraDX with calculated fees
 *    b. ExchangeAsset - swaps DOT for HDX
 *    c. DepositReserveAsset - sends swapped assets back to Asset Hub with instructions:
 *       i. BuyExecution - pays for execution on Asset Hub with calculated fees
 *       ii. DepositAsset - deposits received HDX to the beneficiary account
 */
async function main() {
    const { alice, aliceKeyPair, bobKeyPair } = initSigners()

    // Connect to Asset Hub
    const { api: assetHubApi, client: assetHubClient } = await connectPapi(TEST_RPC_ASSET_HUB, 'asset-hub')

    // Connect to HydraDX
    const { api: hydraDxApi, client: hydraDxClient } = await connectPapi(TEST_RPC_PARACHAIN_HYDRATION, 'hydration')

    const ALICE = ss58Encode(aliceKeyPair.publicKey, 0) // Asset Hub SS58 format
    const BOB = ss58Encode(bobKeyPair.publicKey, 63) // HydraDX SS58 format


    try {
        // Define the origin
        const origin = XcmVersionedLocation.V3({
            parents: 1,
            interior: XcmV3Junctions.Here(),
        });

        // Define a xcm message comming from the Paseo relay chain to Asset Hub to Teleport some tokens
        const xcm = XcmVersionedXcm.V3([
            XcmV3Instruction.ReceiveTeleportedAsset([
                {
                    id: XcmV3MultiassetAssetId.Concrete({
                        parents: 1,
                        interior: XcmV3Junctions.Here(),
                    }),
                    fun: XcmV3MultiassetFungibility.Fungible(10000000n),
                },
            ]),
            XcmV3Instruction.ClearOrigin(),
            XcmV3Instruction.BuyExecution({
                fees: {
                    id: XcmV3MultiassetAssetId.Concrete({
                        parents: 1,
                        interior: XcmV3Junctions.Here(),
                    }),
                    fun: XcmV3MultiassetFungibility.Fungible(BigInt(10000000n)),
                },
                weight_limit: XcmV3WeightLimit.Unlimited(),
            }),
            XcmV3Instruction.DepositAsset({
                assets: XcmV3MultiassetMultiAssetFilter.Wild(
                    XcmV3MultiassetWildMultiAsset.All(),
                ),
                beneficiary: {
                    parents: 0,
                    interior: XcmV3Junctions.X1(
                        XcmV3Junction.AccountId32({
                            network: undefined,
                            id: Binary.fromBytes(aliceKeyPair.publicKey)
                        }),
                    ),
                },
            }),
        ]);

        // Execute dry run xcm
        const dryRunResult = await assetHubApi.apis.DryRunApi.dry_run_xcm(
            XcmVersionedLocation.V4({
                parents: 1,
                interior: XcmV3Junctions.Here(),
            }),
            xcm
        );

        // Print the results
        console.dir(dryRunResult.value, { depth: null });

        //pretty print and save into a file using serializeKey
        const fs = require('fs');
        fs.writeFileSync("v2-dryRunResult.json", serializeKey(dryRunResult));

        console.log("\nPrint local execution fees");
        const xcmWeight = await assetHubApi.apis.XcmPaymentApi.query_xcm_weight(xcm);
        if (!xcmWeight.success) {
            throw new Error("Failed to calculate total XCM weight");
        } else {
            console.log("XCM weight:", xcmWeight);
        }
 /*        const dotAssetId = XcmVersionedAssetId.V4({
            parents: 1,
            interior: XcmV3Junctions.Here()
        });
        const xcmFee = await assetHubApi.apis.XcmPaymentApi.query_weight_to_asset_fee(
            xcmWeight.value,
            dotAssetId
        );
        //dry_run_call
        const tx = assetHubApi.tx.PolkadotXcm.execute({
            message: xcm,
            max_weight: {
                ref_time: xcmWeight.value.ref_time,
                proof_size: xcmWeight.value.proof_size
            }
        });

        console.log("\nPrint delivery fees");
        const dryRun = await assetHubApi.apis.DryRunApi.dry_run_call(
            PolkadotRuntimeOriginCaller.system({
                type: "Signed",
                value: ALICE
            }),
            tx.decodedCall,
            {}
        );

        if (dryRun.success) {
            //pretty print and save into a file using serializeKey
            console.log("Dry run successful");
            fs.writeFileSync("v2-dryRunCallResult.json", serializeKey(dryRun));
        } else {
            console.error('Dry run failed');
        } */


    } catch (error) {
        console.error('Transaction error:', error);
    } finally {
        assetHubClient.destroy();
        hydraDxClient.destroy();
    }
}

main().catch(console.error); 
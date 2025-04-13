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
    XcmV2MultiassetWildFungibility
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

    try {
        const ALICE = ss58Encode(aliceKeyPair.publicKey, 0) // Asset Hub SS58 format
        const BOB = ss58Encode(bobKeyPair.publicKey, 63) // HydraDX SS58 format
        const ALICE_HYDRATION = ss58Encode(aliceKeyPair.publicKey, 63) // HydraDX SS58 format
        const BOB_ASSET_HUB = ss58Encode(bobKeyPair.publicKey, 0) // Asset Hub SS58 format
        console.log("Alice address (Asset Hub):", ALICE)
        console.log("Bob address (HydraDX):", BOB)

        // Check DOT balance on Asset Hub
        const initialBalance = await assetHubApi.query.System.Account.getValue(ALICE)
        const dotBalance = Number(initialBalance.data.free) / 1e10

        // Check initial balances on HydraDX
        const initialHydraDxDotBalance = await hydraDxApi.query.Tokens.Accounts.getValue(BOB, DOT_ASSET_ID)
        const initialHydraDxHdxBalance = await hydraDxApi.query.System.Account.getValue(BOB)

        console.log('\nInitial Balances:')
        console.log('Asset Hub:')
        console.log(`- Alice DOT: ${dotBalance} DOT (${initialBalance.data.free} planck)`)
        console.log('\nHydraDX:')
        console.log(`- Bob DOT: ${initialHydraDxDotBalance?.free || 0n} planck`)
        console.log(`- Bob HDX: ${initialHydraDxHdxBalance.data.free || 0n} planck`)

        // Check if we have enough balance
        if (initialBalance.data.free < TRANSFER_AMOUNT) {
            throw new Error(`Insufficient balance. Have ${dotBalance} DOT, trying to transfer ${Number(TRANSFER_AMOUNT) / 1e10} DOT`)
        }

        // Create locations and asset definitions
        const beneficiary = (keypair: KeyPair) => ({
            parents: 0,
            interior: XcmV3Junctions.X1(
                XcmV3Junction.AccountId32({
                    network: undefined,
                    id: Binary.fromBytes(keypair.publicKey)
                })
            )
        });

        const hydradxDest = {
            parents: 1,
            interior: XcmV3Junctions.X1(
                XcmV3Junction.Parachain(HYDRADX_PARA_ID)
            )
        };

        const assetHubAddress = {
            parents: 1,
            interior: XcmV3Junctions.X1(
                XcmV3Junction.Parachain(ASSET_HUB_PARA_ID)
            )
        };

        const usdtAsset = {
            id: {
                parents: 1,
                interior: XcmV3Junctions.X3([
                    XcmV3Junction.Parachain(ASSET_HUB_PARA_ID),
                    XcmV3Junction.PalletInstance(50),
                    XcmV3Junction.GeneralIndex(BigInt(1984))
                ])
            },
            fun: XcmV3MultiassetFungibility.Fungible(BigInt(5000000))
        };


        const dotAssetId = XcmVersionedAssetId.V4({
            parents: 1,
            interior: XcmV3Junctions.Here()
        });

        // Create the complete XCM message with calculated fees
        const message = XcmVersionedXcm.V4([
            // 1. Withdraw DOT from Asset Hub (including fees)
            XcmV4Instruction.WithdrawAsset([{
                id: {
                    parents: 1,
                    interior: XcmV3Junctions.Here()
                },
                fun: XcmV3MultiassetFungibility.Fungible(TRANSFER_AMOUNT)
            }]),

            // 2. Send to HydraDX with instructions
            XcmV4Instruction.DepositReserveAsset({
                assets: XcmV4AssetAssetFilter.Definite([{
                    id: {
                        parents: 1,
                        interior: XcmV3Junctions.Here()
                    },
                    fun: XcmV3MultiassetFungibility.Fungible(TRANSFER_AMOUNT)
                }]),
                dest: hydradxDest,
                xcm: [
                    // 2a. Pay for HydraDX execution with calculated fee
                    XcmV4Instruction.BuyExecution({
                        fees: {
                            id: {
                                parents: 1,
                                interior: XcmV3Junctions.Here()
                            },
                            fun: XcmV3MultiassetFungibility.Fungible(TRANSFER_AMOUNT)
                        },
                        // weight_limit: XcmV3WeightLimit.Limited(hydraDxWeight.value)
                        weight_limit: XcmV3WeightLimit.Unlimited()
                    }),

                    // 2b. Exchange DOT for HDX
                    XcmV4Instruction.ExchangeAsset({
                        give: XcmV4AssetAssetFilter.Definite([{
                            id: {
                                parents: 1,
                                interior: XcmV3Junctions.Here()
                            },
                            fun: XcmV3MultiassetFungibility.Fungible(TRANSFER_AMOUNT)
                        }]),
                        want: [usdtAsset],
                        maximal: true
                    }),

                    XcmV4Instruction.DepositAsset({
                        assets: XcmV4AssetAssetFilter.Wild(XcmV4AssetWildAsset.All()),
                        beneficiary: beneficiary(bobKeyPair)
                    })

                    // 2c. Send swapped assets back to Asset Hub
                    /*                     XcmV4Instruction.InitiateReserveWithdraw({
                                            assets: XcmV4AssetAssetFilter.Wild(XcmV4AssetWildAsset.All()),
                                            reserve: assetHubDest,
                                            xcm: [
                                                // Pay for Asset Hub execution with calculated fee
                                                XcmV4Instruction.BuyExecution({
                                                    fees: {
                                                        id: {
                                                            parents: 1,
                                                            interior: XcmV3Junctions.Here()
                                                        },
                                                        fun: XcmV3MultiassetFungibility.Fungible(ASSET_HUB_RETURN_FEE)
                                                    },
                                                    //weight_limit: XcmV3WeightLimit.Limited(assetHubWeight.value)
                                                    weight_limit: XcmV3WeightLimit.Unlimited()
                                                }),
                                                XcmV4Instruction.DepositAsset({
                                                    assets: XcmV4AssetAssetFilter.Wild(XcmV4AssetWildAsset.All()),
                                                    beneficiary: beneficiary(bobKeyPair)
                                                })
                                            ]
                                        }) */
                ]
            })
        ]);

        // Query final weight for the complete message
        console.log("\nPrint local execution fees");
        const xcmWeight = await assetHubApi.apis.XcmPaymentApi.query_xcm_weight(message);
        if (!xcmWeight.success) {
            throw new Error("Failed to calculate total XCM weight");
        } else {
            console.log("XCM weight:", xcmWeight);
        }

        const xcmFee = await assetHubApi.apis.XcmPaymentApi.query_weight_to_asset_fee(
            xcmWeight.value,
            dotAssetId
        );

        console.log("XCM fee:", xcmFee);

        // Execute XCM message
        console.log("Executing XCM message...");
        const tx = assetHubApi.tx.PolkadotXcm.execute({
            message: message,
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
            console.log("Dry run successful");
            const fs = require("fs");
            //pretty print and save into a file using serializeKey
            fs.writeFileSync("dryRun.json", serializeKey(dryRun.value));
        } else {
            console.error("Dry run failed:", dryRun);
            throw new Error("Dry run failed");
        }

        const dryRunXcm = await assetHubApi.apis.DryRunApi.dry_run_xcm(
            XcmVersionedLocation.V4(assetHubAddress),
            message
        );
        if (dryRunXcm.success) {
            console.log("Dry run XCM successful");
            const fs = require("fs");
            //pretty print and save into a file using serializeKey
            fs.writeFileSync("dryRunXcm.json", serializeKey(dryRunXcm.value));
        } else {
            console.error("Dry run XCM failed:", dryRunXcm);
        }

       /*  // Submit and watch the transaction
        console.log("Submitting XCM transfer with swap transaction...");
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

        // Wait for transaction processing
        await new Promise(resolve => setTimeout(resolve, 10000));

        // Check final balances
        const finalAssetHubBalance = await assetHubApi.query.System.Account.getValue(ALICE)
        const finalHydraDxDotBalance = await hydraDxApi.query.Tokens.Accounts.getValue(ALICE_HYDRATION, DOT_ASSET_ID)
        const finalHydraDxHdxBalance = await hydraDxApi.query.System.Account.getValue(ALICE_HYDRATION)

        console.log('\nFinal Balances:')
        console.log('Asset Hub:')
        console.log(`- Alice DOT: ${finalAssetHubBalance.data.free} planck (${Number(finalAssetHubBalance.data.free) / 1e10} DOT)`)
        console.log(`- Amount deducted: ${Number(initialBalance.data.free - finalAssetHubBalance.data.free) / 1e10} DOT`)

        console.log('\nHydraDX:')
        console.log(`- Alice DOT: ${Number(finalHydraDxDotBalance?.free || 0n) / 1e10} DOT`)
        console.log(`- Alice HDX: ${Number(finalHydraDxHdxBalance.data.free || 0n) / 1e12} HDX`)
        console.log(`- DOT Change: ${(finalHydraDxDotBalance?.free || 0n) - (initialHydraDxDotBalance?.free || 0n)} planck`)
        console.log(`- HDX Change: ${(finalHydraDxHdxBalance.data.free || 0n) - (initialHydraDxHdxBalance.data.free || 0n)} planck`)

   */  } catch (error) {
        console.error('Transaction error:', error);
    } finally {
        assetHubClient.destroy();
        hydraDxClient.destroy();
    }
}

main().catch(console.error); 
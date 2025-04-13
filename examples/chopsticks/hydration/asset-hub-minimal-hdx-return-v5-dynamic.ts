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
import { Enum, Binary, TypedApi } from "polkadot-api"
import * as fs from 'fs'
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
import { polkadot_asset_hub, hydration } from '@polkadot-api/descriptors';
// Add type definitions
interface Fees {
    initial_execution: bigint;
    initial_delivery: bigint;
    hydradx_execution: bigint;
    return_delivery: bigint;
    final_execution: bigint;
    initial_weight: any;
}

// Constants
const TRANSFER_AMOUNT = 200_000_000_000n // 20 DOT in planck units
const HDX_ASSET_ID = 0 // HDX token ID in HydraDX
const DOT_ASSET_ID = 5 // DOT token ID in HydraDX
const HYDRADX_PARA_ID = 2034 // HydraDX parachain ID
const ASSET_HUB_PARA_ID = 1000 // Asset Hub parachain ID
const SLIPPAGE_TOLERANCE = 5 // 5% slippage tolerance
const MAX_ASSETS = 1 // Maximum number of assets to transfer
const BUFFER_PERCENTAGE = 120n // 20% buffer for fees

// Helper function to safely extract fee value
function extractFeeValue(feeResult: any): bigint {
    if (!feeResult || !feeResult.success) {
        throw new Error(`Fee calculation was not successful: ${JSON.stringify(feeResult)}`);
    }

    // Handle direct bigint value
    if (typeof feeResult.value === 'bigint') {
        return feeResult.value;
    }

    // Handle numeric value
    if (typeof feeResult.value === 'number') {
        return BigInt(feeResult.value);
    }

    // Handle XCM versioned assets (delivery fees)
    if (feeResult.value?.type === 'V4' && Array.isArray(feeResult.value.value)) {
        // Sum up all fee values in the array
        return feeResult.value.value.reduce((sum: bigint, item: any) => {
            if (item && item.fun?.type === 'Fungible') {
                return sum + BigInt(item.fun.value.toString());
            }
            return sum;
        }, 0n);
    }

    throw new Error(`Unexpected fee result structure: ${JSON.stringify(feeResult)}`);
}

async function calculateFees(assetHubApi: TypedApi<typeof polkadot_asset_hub>, hydraDxApi: TypedApi<typeof hydration>,
 dotAssetId: any): Promise<Fees> {
    try {
        // Create locations and asset definitions
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

        // Create a basic message to calculate initial fees
        const initialMessage = XcmVersionedXcm.V4([
            XcmV4Instruction.WithdrawAsset([{
                id: {
                    parents: 1,
                    interior: XcmV3Junctions.Here()
                },
                fun: XcmV3MultiassetFungibility.Fungible(TRANSFER_AMOUNT)
            }]),
            XcmV4Instruction.BuyExecution({
                fees: {
                    id: {
                        parents: 1,
                        interior: XcmV3Junctions.Here()
                    },
                    fun: XcmV3MultiassetFungibility.Fungible(TRANSFER_AMOUNT)
                },
                weight_limit: XcmV3WeightLimit.Unlimited()
            })
        ]);

        // Calculate initial execution fees on Asset Hub
        console.log("\nCalculating initial execution fees on Asset Hub...");
        const initialWeight = await assetHubApi.apis.XcmPaymentApi.query_xcm_weight(initialMessage);
        if (!initialWeight.success) {
            throw new Error("Failed to calculate initial execution weight");
        }
        
        const initialExecutionFeeResult = await assetHubApi.apis.XcmPaymentApi.query_weight_to_asset_fee(
            initialWeight.value,
            dotAssetId
        );
        const initialExecutionFee = extractFeeValue(initialExecutionFeeResult);

        // Calculate delivery fees to HydraDX
        console.log("\nCalculating delivery fees to HydraDX...");
        const deliveryFeesResult = await assetHubApi.apis.XcmPaymentApi.query_delivery_fees(
            XcmVersionedLocation.V4(hydradxDest),
            initialMessage
        );
        const deliveryFees = extractFeeValue(deliveryFeesResult);

        // Calculate execution fees on HydraDX
        console.log("\nCalculating execution fees on HydraDX...");
        const hydraDxWeight = await hydraDxApi.apis.XcmPaymentApi.query_xcm_weight(initialMessage);
        if (!hydraDxWeight.success) {
            throw new Error("Failed to calculate HydraDX execution weight");
        }
        
        const hydraDxExecutionFeeResult = await hydraDxApi.apis.XcmPaymentApi.query_weight_to_asset_fee(
            hydraDxWeight.value,
            dotAssetId
        );
        const hydraDxExecutionFee = extractFeeValue(hydraDxExecutionFeeResult);

        // Calculate return journey fees
        const returnMessage = XcmVersionedXcm.V4([
            XcmV4Instruction.BuyExecution({
                fees: {
                    id: {
                        parents: 1,
                        interior: XcmV3Junctions.Here()
                    },
                    fun: XcmV3MultiassetFungibility.Fungible(TRANSFER_AMOUNT)
                },
                weight_limit: XcmV3WeightLimit.Unlimited()
            }),
            XcmV4Instruction.DepositAsset({
                assets: XcmV4AssetAssetFilter.Wild(XcmV4AssetWildAsset.All()),
                beneficiary: {
                    parents: 0,
                    interior: XcmV3Junctions.Here()
                }
            })
        ]);

        // Calculate return delivery fees
        console.log("\nCalculating return delivery fees...");
        const returnDeliveryFeesResult = await hydraDxApi.apis.XcmPaymentApi.query_delivery_fees(
            XcmVersionedLocation.V4(assetHubAddress),
            returnMessage
        );
        const returnDeliveryFees = extractFeeValue(returnDeliveryFeesResult);

        // Calculate final execution fees on Asset Hub
        console.log("\nCalculating final execution fees on Asset Hub...");
        const finalWeight = await assetHubApi.apis.XcmPaymentApi.query_xcm_weight(returnMessage);
        if (!finalWeight.success) {
            throw new Error("Failed to calculate final execution weight");
        }
        
        const finalExecutionFeeResult = await assetHubApi.apis.XcmPaymentApi.query_weight_to_asset_fee(
            finalWeight.value,
            dotAssetId
        );
        const finalExecutionFee = extractFeeValue(finalExecutionFeeResult);

        // Log fee values
        console.log("\nFee values (BigInt):");
        console.log("Initial Execution Fee:", initialExecutionFee.toString());
        console.log("Delivery Fees:", deliveryFees.toString());
        console.log("HydraDX Execution Fee:", hydraDxExecutionFee.toString());
        console.log("Return Delivery Fees:", returnDeliveryFees.toString());
        console.log("Final Execution Fee:", finalExecutionFee.toString());

        return {
            initial_execution: initialExecutionFee,
            initial_delivery: deliveryFees,
            hydradx_execution: hydraDxExecutionFee,
            return_delivery: returnDeliveryFees,
            final_execution: finalExecutionFee,
            initial_weight: initialWeight.value
        };
    } catch (error) {
        console.error("Error in calculateFees:", error);
        throw error;
    }
}

async function constructXcmMessage(fees: Fees, beneficiaryKeyPair: KeyPair) {
    // Calculate total fees with buffer
    const totalFees = BigInt(fees.initial_execution) + 
                     BigInt(fees.initial_delivery) + 
                     BigInt(fees.hydradx_execution) + 
                     BigInt(fees.return_delivery) + 
                     BigInt(fees.final_execution);
    
    const totalFeesWithBuffer = (totalFees * BUFFER_PERCENTAGE) / 100n;
    const withdrawAmount = TRANSFER_AMOUNT + totalFeesWithBuffer;

    // Log fee breakdown for debugging
    console.log("\nFee Breakdown (in planck):");
    console.log("Initial Execution:", fees.initial_execution.toString());
    console.log("Initial Delivery:", fees.initial_delivery.toString());
    console.log("HydraDX Execution:", fees.hydradx_execution.toString());
    console.log("Return Delivery:", fees.return_delivery.toString());
    console.log("Final Execution:", fees.final_execution.toString());
    console.log("Total Fees:", totalFees.toString());
    console.log("Total Fees with Buffer:", totalFeesWithBuffer.toString());
    console.log("Total Withdraw Amount:", withdrawAmount.toString());

    // Construct the complete XCM message with calculated fees
    return XcmVersionedXcm.V4([
        // 1. Withdraw DOT from Asset Hub (including all fees)
        XcmV4Instruction.WithdrawAsset([{
            id: {
                parents: 1,
                interior: XcmV3Junctions.Here()
            },
            fun: XcmV3MultiassetFungibility.Fungible(withdrawAmount)
        }]),

        // 2. Send to HydraDX with instructions
        XcmV4Instruction.DepositReserveAsset({
            assets: XcmV4AssetAssetFilter.Definite([{
                id: {
                    parents: 1,
                    interior: XcmV3Junctions.Here()
                },
                fun: XcmV3MultiassetFungibility.Fungible(withdrawAmount)
            }]),
            dest: {
                parents: 1,
                interior: XcmV3Junctions.X1(
                    XcmV3Junction.Parachain(HYDRADX_PARA_ID)
                )
            },
            xcm: [
                // 2a. Pay for HydraDX execution
                XcmV4Instruction.BuyExecution({
                    fees: {
                        id: {
                            parents: 1,
                            interior: XcmV3Junctions.Here()
                        },
                        fun: XcmV3MultiassetFungibility.Fungible(fees.hydradx_execution)
                    },
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
                    want: [{
                        id: {
                            parents: 1,
                            interior: XcmV3Junctions.X3([
                                XcmV3Junction.Parachain(ASSET_HUB_PARA_ID),
                                XcmV3Junction.PalletInstance(50),
                                XcmV3Junction.GeneralIndex(BigInt(1984))
                            ])
                        },
                        fun: XcmV3MultiassetFungibility.Fungible(BigInt(5000000))
                    }],
                    maximal: true
                }),

                // 2c. Send swapped assets back to Asset Hub
                XcmV4Instruction.InitiateReserveWithdraw({
                    assets: XcmV4AssetAssetFilter.Wild(XcmV4AssetWildAsset.All()),
                    reserve: {
                        parents: 1,
                        interior: XcmV3Junctions.X1(
                            XcmV3Junction.Parachain(ASSET_HUB_PARA_ID)
                        )
                    },
                    xcm: [
                        // Pay for final Asset Hub execution
                        XcmV4Instruction.BuyExecution({
                            fees: {
                                id: {
                                    parents: 1,
                                    interior: XcmV3Junctions.Here()
                                },
                                fun: XcmV3MultiassetFungibility.Fungible(fees.final_execution)
                            },
                            weight_limit: XcmV3WeightLimit.Unlimited()
                        }),
                        XcmV4Instruction.DepositAsset({
                            assets: XcmV4AssetAssetFilter.Wild(XcmV4AssetWildAsset.All()),
                            beneficiary: {
                                parents: 0,
                                interior: XcmV3Junctions.X1(
                                    XcmV3Junction.AccountId32({
                                        network: undefined,
                                        id: Binary.fromBytes(beneficiaryKeyPair.publicKey)
                                    })
                                )
                            }
                        })
                    ]
                })
            ]
        })
    ]);
}

async function main() {
    const { alice, aliceKeyPair, bobKeyPair } = initSigners();

    // Connect to Asset Hub
    const { api: assetHubApi, client: assetHubClient } = await connectPapi(TEST_RPC_ASSET_HUB, 'asset-hub');

    // Connect to HydraDX
    const { api: hydraDxApi, client: hydraDxClient } = await connectPapi(TEST_RPC_PARACHAIN_HYDRATION, 'hydration');

    try {
        const ALICE = ss58Encode(aliceKeyPair.publicKey, 0);
        const BOB = ss58Encode(bobKeyPair.publicKey, 63);
        console.log("Alice address (Asset Hub):", ALICE);
        console.log("Bob address (HydraDX):", BOB);

        // Check DOT balance on Asset Hub
        const initialBalance = await assetHubApi.query.System.Account.getValue(ALICE);
        const dotBalance = Number(initialBalance.data.free) / 1e10;
        const balanceBigInt = BigInt(initialBalance.data.free);

        console.log('\nInitial Balances:');
        console.log('Asset Hub:');
        console.log(`- Alice DOT: ${dotBalance} DOT (${balanceBigInt.toString()} planck)`);

        // Check if we have enough balance
        if (balanceBigInt < TRANSFER_AMOUNT) {
            throw new Error(`Insufficient balance. Have ${dotBalance} DOT, trying to transfer ${Number(TRANSFER_AMOUNT) / 1e10} DOT`);
        }

        const dotAssetId = XcmVersionedAssetId.V4({
            parents: 1,
            interior: XcmV3Junctions.Here()
        });

        // Calculate all fees
        console.log("\nCalculating fees...");
        const fees = await calculateFees(assetHubApi, hydraDxApi, dotAssetId);
        console.log("\nFees calculated:", fees);

        // Construct XCM message with dynamic fees
        console.log("\nConstructing XCM message with dynamic fees...");
        const message = await constructXcmMessage(fees, bobKeyPair);

        // Execute XCM message
        console.log("\nExecuting XCM message...");
        const tx = assetHubApi.tx.PolkadotXcm.execute({
            message: message,
            max_weight: {
                ref_time: fees.initial_weight.ref_time,
                proof_size: fees.initial_weight.proof_size
            }
        });

        // Dry run the transaction
        const dryRun = await assetHubApi.apis.DryRunApi.dry_run_call(
            PolkadotRuntimeOriginCaller.system({
                type: "Signed",
                value: ALICE
            }),
            tx.decodedCall,
            {}
        );

        if (dryRun.value) {
            console.log("Dry run successful");
            fs.writeFileSync("dryRunDynamic.json", serializeKey(dryRun.value));
        } else {
            console.error("Dry run failed:", dryRun);
            throw new Error("Dry run failed");
        }

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


    } catch (error) {
        console.error('Transaction error:', error);
        // Add more detailed error information
        if (error instanceof Error) {
            console.error('Error details:', error.message);
            console.error('Stack trace:', error.stack);
        }
    } finally {
        assetHubClient.destroy();
        hydraDxClient.destroy();
    }
}

// Initialize signers
const initSigners = () => {
    const miniSecret = entropyToMiniSecret(mnemonicToEntropy(DEV_PHRASE));
    const derive = sr25519CreateDerive(miniSecret);

    const aliceKeyPair = derive("//Alice");
    const bobKeyPair = derive("//Bob");

    const alice = getPolkadotSigner(
        aliceKeyPair.publicKey,
        "Sr25519",
        aliceKeyPair.sign,
    );

    return {
        alice,
        aliceKeyPair,
        bobKeyPair
    };
};

main().catch(console.error); 
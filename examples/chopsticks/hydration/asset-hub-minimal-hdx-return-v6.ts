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
import { Enum, Binary, TypedApi, FixedSizeBinary } from "polkadot-api"
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
const BUFFER_PERCENTAGE = 100n // 20% buffer for fees

// Helper function to safely extract fee value
function extractFeeValue(feeResult: any): bigint {
    if (!feeResult || !feeResult.success) {
        throw new Error(`Fee calculation was not successful: ${serializeKey(feeResult)}`);
    }

    // Handle XCM versioned assets (delivery fees)
    if (feeResult.value?.type === 'V4' && Array.isArray(feeResult.value.value)) {
        // Sum up all fee values in the array
        return feeResult.value.value.reduce((sum: bigint, item: any) => {
            if (item && item.fun?.type === 'Fungible') {
                // Convert the value to string first to handle both string and number cases
                const value = item.fun.value.toString();
                return sum + BigInt(value);
            }
            return sum;
        }, 0n);
    }

    // Handle direct bigint value
    if (typeof feeResult.value === 'bigint') {
        return feeResult.value;
    }

    // Handle numeric value
    if (typeof feeResult.value === 'number') {
        return BigInt(feeResult.value);
    }

    // Handle case where value is a string
    if (typeof feeResult.value === 'string') {
        return BigInt(feeResult.value);
    }

    // Handle case where value is an object with a toString method
    if (typeof feeResult.value === 'object' && feeResult.value !== null && 'toString' in feeResult.value) {
        return BigInt(feeResult.value.toString());
    }

    console.log("Problematic fee result:", serializeKey(feeResult));
    throw new Error(`Unexpected fee result structure: ${serializeKey(feeResult)}`);
}

async function calculateFees(assetHubApi: TypedApi<typeof polkadot_asset_hub>, hydraDxApi: TypedApi<typeof hydration>,
    dotAssetId: any, beneficiaryKeyPair: KeyPair, ALICE: string): Promise<Fees> {
    try {
        // First create the initial message with placeholder fees
        const message = XcmVersionedXcm.V4([
            XcmV4Instruction.WithdrawAsset([{
                id: {
                    parents: 1,
                    interior: XcmV3Junctions.Here()
                },
                fun: XcmV3MultiassetFungibility.Fungible(TRANSFER_AMOUNT)
            }]),
            XcmV4Instruction.DepositReserveAsset({
                assets: XcmV4AssetAssetFilter.Definite([{
                    id: {
                        parents: 1,
                        interior: XcmV3Junctions.Here()
                    },
                    fun: XcmV3MultiassetFungibility.Fungible(TRANSFER_AMOUNT)
                }]),
                dest: {
                    parents: 1,
                    interior: XcmV3Junctions.X1(
                        XcmV3Junction.Parachain(HYDRADX_PARA_ID)
                    )
                },
                xcm: [
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
                    // XcmV4Instruction.DepositAsset({
                    //     assets: XcmV4AssetAssetFilter.Wild(XcmV4AssetWildAsset.All()),
                    //     beneficiary: {
                    //         parents: 0,
                    //         interior: XcmV3Junctions.X1(XcmV3Junction.AccountId32({
                    //             network: undefined,
                    //             id: Binary.fromBytes(beneficiaryKeyPair.publicKey)
                    //         }))
                    //     }
                    // }),
                    XcmV4Instruction.InitiateReserveWithdraw({
                        assets: XcmV4AssetAssetFilter.Wild(XcmV4AssetWildAsset.All()),
                        reserve: {
                            parents: 1,
                            interior: XcmV3Junctions.X1(
                                XcmV3Junction.Parachain(ASSET_HUB_PARA_ID)
                            )
                        },
                        xcm: [
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

        // Calculate initial weight for the complete message
        const xcmWeight = await assetHubApi.apis.XcmPaymentApi.query_xcm_weight(message);
        if (!xcmWeight.success) {
            throw new Error("Failed to calculate total XCM weight");
        }

        // Create the transaction
        const tx = assetHubApi.tx.PolkadotXcm.execute({
            message: message,
            max_weight: {
                ref_time: xcmWeight.value.ref_time,
                proof_size: xcmWeight.value.proof_size
            }
        });

        // Do a dry run to get the actual forwarded messages
        const dryRun = await assetHubApi.apis.DryRunApi.dry_run_call(
            PolkadotRuntimeOriginCaller.system({
                type: "Signed",
                value: ALICE
            }),
            tx.decodedCall,
            {}
        );

        if (!dryRun.success) {
            throw new Error("Dry run failed");
        }

        const { forwarded_xcms } = dryRun.value;

        // Find the message targeting HydraDX
        const targetMessage = forwarded_xcms.find(([location, _]) =>
            location.type === 'V4' &&
            location.value.parents === 1 &&
            location.value.interior.type === 'X1' &&
            location.value.interior.value.type === 'Parachain' &&
            location.value.interior.value.value === HYDRADX_PARA_ID
        );

        if (!targetMessage) {
            throw new Error(`No forwarded message found for parachain ${HYDRADX_PARA_ID}`);
        }

        // Extract the XCM message
        const [_, messages] = targetMessage;
        const xcmMessage = messages[0];

        // Calculate initial execution fee
        const xcmFee = await assetHubApi.apis.XcmPaymentApi.query_weight_to_asset_fee(
            xcmWeight.value,
            dotAssetId
        );
        console.log("Initial execution fee result:", serializeKey(xcmFee));
        const initialExecutionFee = extractFeeValue(xcmFee);

        // Calculate delivery fees to HydraDX
        const deliveryFeesResult = await assetHubApi.apis.XcmPaymentApi.query_delivery_fees(
            XcmVersionedLocation.V4({
                parents: 1,
                interior: XcmV3Junctions.X1(
                    XcmV3Junction.Parachain(HYDRADX_PARA_ID)
                )
            }),
            xcmMessage
        );
        console.log("Delivery fees result:", serializeKey(deliveryFeesResult));
        const deliveryFees = extractFeeValue(deliveryFeesResult);

        // Calculate HydraDX execution fees
        const remoteXcmWeight = await hydraDxApi.apis.XcmPaymentApi.query_xcm_weight(xcmMessage);
        if (!remoteXcmWeight.success) {
            throw new Error("Failed to calculate HydraDX execution weight");
        }

        const remoteXcmFee = await hydraDxApi.apis.XcmPaymentApi.query_weight_to_asset_fee(
            remoteXcmWeight.value,
            dotAssetId
        );
        console.log("HydraDX execution fee result:", serializeKey(remoteXcmFee));
        const hydraDxExecutionFee = extractFeeValue(remoteXcmFee);

        const v4Instructions = XcmVersionedXcm.V4([
            XcmV4Instruction.InitiateReserveWithdraw({
                assets: XcmV4AssetAssetFilter.Wild(XcmV4AssetWildAsset.All()),
                reserve: {
                    parents: 1,
                    interior: XcmV3Junctions.X1(
                        XcmV3Junction.Parachain(ASSET_HUB_PARA_ID)
                    )
                },
                xcm: [
                    // Pay for Asset Hub execution with calculated fee
                    XcmV4Instruction.BuyExecution({
                        fees: {
                            id: {
                                parents: 1,
                                interior: XcmV3Junctions.Here()
                            },
                            fun: XcmV3MultiassetFungibility.Fungible(10000000000n)
                        },
                        //weight_limit: XcmV3WeightLimit.Limited(assetHubWeight.value)
                        weight_limit: XcmV3WeightLimit.Unlimited()
                    }),
                    XcmV4Instruction.DepositAsset({
                        assets: XcmV4AssetAssetFilter.Wild(XcmV4AssetWildAsset.All()),
                        beneficiary: {
                            parents: 1,
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
        ]);

        //print the v4Instructions
        console.log("\n v4Instructions:", serializeKey(v4Instructions));

        // Calculate return delivery fees
        console.log("\nCalculating return delivery fees...");
        const returnDeliveryFeesResult = await hydraDxApi.apis.XcmPaymentApi.query_delivery_fees(
            XcmVersionedLocation.V4({
                parents: 1,
                interior: XcmV3Junctions.X1(
                    XcmV3Junction.Parachain(ASSET_HUB_PARA_ID)
                )
            }),
            v4Instructions
        );
        console.log("Return delivery fees raw result:", serializeKey(returnDeliveryFeesResult));
        // const returnDeliveryFees = extractFeeValue(returnDeliveryFeesResult);
        //console.log("Extracted return delivery fees:", returnDeliveryFees.toString());
        let returnDeliveryFees = 0n;
        if (returnDeliveryFeesResult.success) {
            //extract the value from the result
            const returnDeliveryFeesValue = returnDeliveryFeesResult.value.value[0];
            if (returnDeliveryFeesValue) {
                //extract the fees
                returnDeliveryFees = returnDeliveryFeesValue.fun.value as bigint;
            }
        }
        // Calculate final Asset Hub execution fees
        const finalAssetHubWeight = await assetHubApi.apis.XcmPaymentApi.query_xcm_weight(
            v4Instructions
        );

        if (!finalAssetHubWeight.success) {
            throw new Error("Failed to calculate final Asset Hub execution weight");
        }

        const finalAssetHubFee = await assetHubApi.apis.XcmPaymentApi.query_weight_to_asset_fee(
            finalAssetHubWeight.value,
            dotAssetId
        );
        const finalExecutionFee = extractFeeValue(finalAssetHubFee);

        return {
            initial_execution: initialExecutionFee,
            initial_delivery: deliveryFees,
            hydradx_execution: hydraDxExecutionFee,
            return_delivery: returnDeliveryFees,
            final_execution: finalExecutionFee,
            initial_weight: xcmWeight.value
        };
    } catch (error) {
        console.error("Error in calculateFees:", error);
        throw error;
    }
}

// Add this helper function near the top of the file with other helper functions
function generateTopicId(prefix: string): FixedSizeBinary<32> {
    // Create a 32-byte array filled with zeros
    const bytes = new Uint8Array(32).fill(0);

    // Convert prefix to bytes and copy it to the start of the array
    const prefixBytes = new TextEncoder().encode(prefix);
    bytes.set(prefixBytes.slice(0, 32), 0);

    // Add timestamp to make it unique
    const timestamp = new Uint8Array(new Date().getTime().toString().split('').map(n => parseInt(n)));
    bytes.set(timestamp.slice(0, 32 - prefixBytes.length), prefixBytes.length);

    // Print the topic ID in hex format
    console.log("\nGenerated Topic ID:");
    console.log("Hex:", Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join(''));
    console.log("Prefix:", prefix);
    console.log("Timestamp:", new Date().getTime());

    return Binary.fromBytes(bytes) as FixedSizeBinary<32>;
}

async function constructXcmMessage(fees: Fees, beneficiaryKeyPair: KeyPair) {
    // Calculate total fees with buffer
    const totalFees = fees.initial_execution +
        fees.initial_delivery +
        fees.hydradx_execution +
        fees.return_delivery +
        fees.final_execution;

    // const totalFeesWithBuffer = (totalFees * BUFFER_PERCENTAGE) / 100n;
    const withdrawAmount = TRANSFER_AMOUNT + totalFees;

    // Helper function to format planck to DOT
    const formatDOT = (planck: bigint) => {
        const dot = Number(planck) / 1e10;
        return dot.toFixed(8);
    };

    // Log detailed fee breakdown
    console.log("\n=== Fee Breakdown ===");
    console.log("Initial Execution Fee:");
    console.log(`  ${formatDOT(fees.initial_execution)} DOT`);

    console.log("\nInitial Delivery Fee:");
    console.log(`  ${formatDOT(fees.initial_delivery)} DOT`);

    console.log("\nHydraDX Execution Fee:");
    console.log(`  ${formatDOT(fees.hydradx_execution)} DOT`);

    console.log("\nReturn Delivery Fee:");
    console.log(`  ${formatDOT(fees.return_delivery)} DOT`);

    console.log("\nFinal Execution Fee:");
    console.log(`  ${formatDOT(fees.final_execution)} DOT`);

    console.log("\n=== Totals ===");
    console.log("Total Base Fees:");
    console.log(`  ${formatDOT(totalFees)} DOT`);

    // console.log("\nTotal Fees with Buffer:");
    // console.log(`  ${formatDOT(totalFeesWithBuffer)} DOT`);

    console.log("\nTransfer Amount:");
    console.log(`  ${formatDOT(TRANSFER_AMOUNT)} DOT`);

    console.log("\nTotal Withdraw Amount (Transfer + Fees with Buffer):");
    console.log(`  ${formatDOT(withdrawAmount)} DOT`);

    const topicId = generateTopicId("HDX_SWAP");
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
        //XcmV4Instruction.SetTopic(topicId),

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
                        fun: XcmV3MultiassetFungibility.Fungible(fees.hydradx_execution + fees.initial_delivery)
                    },
                    weight_limit: XcmV3WeightLimit.Unlimited()
                }),
                //XcmV4Instruction.SetTopic(topicId),

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

                // XcmV4Instruction.DepositAsset({
                //     assets: XcmV4AssetAssetFilter.Wild(XcmV4AssetWildAsset.All()),
                //     beneficiary: {
                //         parents: 0,
                //         interior: XcmV3Junctions.X1(XcmV3Junction.AccountId32({
                //             network: undefined,
                //             id: Binary.fromBytes(beneficiaryKeyPair.publicKey)
                //         }))
                //     }
                // }),

                //  2c. Send swapped assets back to Asset Hub
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
                                fun: XcmV3MultiassetFungibility.Fungible(fees.final_execution + fees.return_delivery)
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
                        }),
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
        const fees = await calculateFees(assetHubApi, hydraDxApi, dotAssetId, bobKeyPair, ALICE);
        console.log("\nFees calculated:", fees);

        // Construct XCM message with dynamic fees
        console.log("\nConstructing XCM message with dynamic fees...");
        const message = await constructXcmMessage(fees, bobKeyPair);

        //calculate weights for ref_time and proof_size
        const weights = await assetHubApi.apis.XcmPaymentApi.query_xcm_weight(message);
        // Execute XCM message
        console.log("\nExecuting XCM message...");

        if (weights.success) {
            const tx = assetHubApi.tx.PolkadotXcm.execute({
                message: message,
                max_weight: {
                    ref_time: weights.value.ref_time,
                    proof_size: weights.value.proof_size
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
             //   fs.writeFileSync("dryRunDynamic.json", serializeKey(dryRun.value));
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
        }


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
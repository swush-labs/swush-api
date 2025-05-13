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
import { TEST_RPC_ASSET_HUB, TEST_RPC_PARACHAIN_HYDRATION, XCM_RPC_ASSET_HUB, XCM_RPC_HYDRATION } from "../../../../services/constants"
import { TransactionService } from '../../../../services/network/TransactionService'
import { connectPapi } from "../../../../services/network/types"
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
const TRANSFER_AMOUNT = 200_000_000_000n // 2 DOT in planck units
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
    dotAssetId: any, aliceKeyPair: KeyPair, beneficiaryKeyPair: KeyPair, ALICE: string, ALICE_HYDRATION: string): Promise<any> {
    try {

        //additional 50% of the transfer amount
        const TOTAL_AMOUNT = TRANSFER_AMOUNT + 5000000000000n;
        // First create the initial message with placeholder fees
        const message = XcmVersionedXcm.V4([
            XcmV4Instruction.WithdrawAsset([{
                id: {
                    parents: 1,
                    interior: XcmV3Junctions.Here()
                },
                fun: XcmV3MultiassetFungibility.Fungible(TOTAL_AMOUNT)
            }]),
            XcmV4Instruction.DepositReserveAsset({
                assets: XcmV4AssetAssetFilter.Definite([{
                    id: {
                        parents: 1,
                        interior: XcmV3Junctions.Here()
                    },
                    fun: XcmV3MultiassetFungibility.Fungible(TOTAL_AMOUNT)
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
                            fun: XcmV3MultiassetFungibility.Fungible(TOTAL_AMOUNT)
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
                    XcmV4Instruction.DepositAsset({
                        assets: XcmV4AssetAssetFilter.Wild(XcmV4AssetWildAsset.All()),
                        beneficiary: {
                            parents: 0,
                            interior: XcmV3Junctions.X1(XcmV3Junction.AccountId32({
                                network: undefined,
                                id: Binary.fromBytes(beneficiaryKeyPair.publicKey)
                            }))
                        }
                    }),
                    // XcmV4Instruction.InitiateReserveWithdraw({
                    //     assets: XcmV4AssetAssetFilter.Wild(XcmV4AssetWildAsset.All()),
                    //     reserve: {
                    //         parents: 1,
                    //         interior: XcmV3Junctions.X1(
                    //             XcmV3Junction.Parachain(ASSET_HUB_PARA_ID)
                    //         )
                    //     },
                    //     xcm: [
                    //         XcmV4Instruction.BuyExecution({
                    //             fees: {
                    //                 id: {
                    //                     parents: 1,
                    //                     interior: XcmV3Junctions.Here()
                    //                 },
                    //                 fun: XcmV3MultiassetFungibility.Fungible(TRANSFER_AMOUNT)
                    //             },
                    //             weight_limit: XcmV3WeightLimit.Unlimited()
                    //         }),
                    //         XcmV4Instruction.DepositAsset({
                    //             assets: XcmV4AssetAssetFilter.Wild(XcmV4AssetWildAsset.All()),
                    //             beneficiary: {
                    //                 parents: 0,
                    //                 interior: XcmV3Junctions.X1(
                    //                     XcmV3Junction.AccountId32({
                    //                         network: undefined,
                    //                         id: Binary.fromBytes(beneficiaryKeyPair.publicKey)
                    //                     })
                    //                 )
                    //             }
                    //         })
                    //     ]
                    // })
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

        const dryRunXcmv1 = await assetHubApi.apis.DryRunApi.dry_run_xcm(
            XcmVersionedLocation.V4({
                parents: 1,
                interior: XcmV3Junctions.X1(XcmV3Junction.Parachain(ASSET_HUB_PARA_ID))
            }),
            message
        );

        console.log("\n Dry run XCM result XCM Asset Hub:", serializeKey(dryRunXcmv1));

        // Do a dry run to get the actual forwarded messages
        const dryRun = await assetHubApi.apis.DryRunApi.dry_run_call(
            PolkadotRuntimeOriginCaller.system({
                type: "Signed",
                value: ALICE
            }),
            tx.decodedCall,
            {}
        );

        //print dryRun1 into a file
        fs.writeFileSync('dryRun1.json', serializeKey(dryRun));
        if (dryRun.success) {
            //check value.execution_result.success
            if (!dryRun.value.execution_result.success) {
                throw new Error("Dry run failed");
            }
        } else {
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
        const [xcmOrigin, messages] = targetMessage;
        const xcmMessage = messages[0];

        // console.log the xcmMessage
        console.log("xcmMessage:", serializeKey(xcmMessage));

        // Calculate initial execution fee
        const xcmFee = await assetHubApi.apis.XcmPaymentApi.query_weight_to_asset_fee(
            xcmWeight.value,
            dotAssetId
        );
        console.log("Initial execution fee result:", serializeKey(xcmFee));
        // const initialExecutionFee = extractFeeValue(xcmFee);

        // // Calculate delivery fees to HydraDX
        // const deliveryFeesResult = await assetHubApi.apis.XcmPaymentApi.query_delivery_fees(
        //     XcmVersionedLocation.V4({
        //         parents: 1,
        //         interior: XcmV3Junctions.X1(
        //             XcmV3Junction.Parachain(HYDRADX_PARA_ID)
        //         )
        //     }),
        //     xcmMessage
        // );
        //  console.log("\n dry run xcm on hydraDx");
        // const dryRunXcm2 = await hydraDxApi.apis.DryRunApi.dry_run_xcm(
        //     XcmVersionedLocation.V4({
        //         parents: 1,
        //         interior: XcmV3Junctions.X1(XcmV3Junction.Parachain(ASSET_HUB_PARA_ID))
        //     }),
        //     xcmMessage
        // );
        // if (!dryRunXcm2.success) {
        //     throw new Error("Failed to dry run XCM on HydraDX");
        // }
        // console.log("\n Dry run XCM result 2:", serializeKey(dryRunXcm2));


        const hdxDryRun = await hydraDxApi.apis.DryRunApi.dry_run_xcm(
            XcmVersionedLocation.V4({
                parents: 1,
                interior: XcmV3Junctions.X1(XcmV3Junction.Parachain(ASSET_HUB_PARA_ID))
            }),
            xcmMessage
        );
        console.log("\n Dry hdxDryRun XCM:", serializeKey(hdxDryRun));

        // const remoteXcmWeight = await hydraDxApi.apis.XcmPaymentApi.query_xcm_weight(xcmMessage);
        // if (!remoteXcmWeight.success) {
        //     throw new Error("Failed to calculate HydraDX execution weight");
        // }
        // const txn = hydraDxApi.tx.PolkadotXcm.execute({
        //     message: xcmMessage,
        //     max_weight: {
        //         ref_time: remoteXcmWeight.value.ref_time,
        //         proof_size: remoteXcmWeight.value.proof_size
        //     }
        // });

        // const dryRun2 = await hydraDxApi.apis.DryRunApi.dry_run_call(
        //     PolkadotRuntimeOriginCaller.system({
        //         type: "Signed",
        //         value: ALICE_HYDRATION
        //     }),
        //     txn.decodedCall,
        //     {}
        // );
        // console.log("\n Dry run XCM result 3:", serializeKey(dryRun2));
        /*  
            const xcmWeightHdx = await hydraDxApi.apis.XcmPaymentApi.query_xcm_weight(xcmMessage);
                     if (!xcmWeightHdx.success) {
                         throw new Error("Failed to calculate total XCM weight");
                     }
             
                      // Create the transaction
                      const txHdx = assetHubApi.tx.PolkadotXcm.execute({
                         message: xcmMessage,
                         max_weight: {
                             ref_time: xcmWeightHdx.value.ref_time,
                             proof_size: xcmWeightHdx.value.proof_size
                         }
                     });
             
                     // Do a dry run to get the actual forwarded messages
                     const dryRunHdx = await hydraDxApi.apis.DryRunApi.dry_run_call(
                         PolkadotRuntimeOriginCaller.system({
                             type: "Signed",
                             value: ALICE_HYDRATION
                         }),
                         tx.decodedCall,
                         {}
                     );
                 
                     //print with a new line
                     console.log("\n Dry run XCM result 3:", serializeKey(dryRunHdx)); */


        //     const TOTAL_AMOUNT = TRANSFER_AMOUNT + deliveryFees + initialExecutionFee;
        //     const message_on_hydraDx = XcmVersionedXcm.V4([
        //         XcmV4Instruction.BuyExecution({
        //             fees: {
        //                 id: {
        //                     parents: 1,
        //                     interior: XcmV3Junctions.Here()
        //                 },
        //                 fun: XcmV3MultiassetFungibility.Fungible(TOTAL_AMOUNT)
        //             },
        //             weight_limit: XcmV3WeightLimit.Unlimited()
        //         }),
        //         XcmV4Instruction.ExchangeAsset({
        //             give: XcmV4AssetAssetFilter.Definite([{
        //                 id: {
        //                     parents: 1,
        //                     interior: XcmV3Junctions.Here()
        //                 },
        //                 fun: XcmV3MultiassetFungibility.Fungible(TRANSFER_AMOUNT)
        //             }]),
        //             want: [{
        //                 id: {
        //                     parents: 1,
        //                     interior: XcmV3Junctions.X3([
        //                         XcmV3Junction.Parachain(ASSET_HUB_PARA_ID),
        //                         XcmV3Junction.PalletInstance(50),
        //                         XcmV3Junction.GeneralIndex(BigInt(1984))
        //                     ])
        //                 },
        //                 fun: XcmV3MultiassetFungibility.Fungible(BigInt(5000000))
        //             }],
        //             maximal: true
        //         }),
        //         XcmV4Instruction.InitiateReserveWithdraw({
        //             assets: XcmV4AssetAssetFilter.Wild(XcmV4AssetWildAsset.All()),
        //             reserve: {
        //                 parents: 1,
        //                 interior: XcmV3Junctions.X1(
        //                     XcmV3Junction.Parachain(ASSET_HUB_PARA_ID)
        //                 )
        //             },
        //             xcm: []
        //         })
        //     ]);
        // // Calculate HydraDX execution fees
        // const remoteXcmWeight = await hydraDxApi.apis.XcmPaymentApi.query_xcm_weight(message_on_hydraDx);
        // if (!remoteXcmWeight.success) {
        //     throw new Error("Failed to calculate HydraDX execution weight");
        // }

        // //dry run on hydraDx first execution then dry run on asset hub

        // const txn = hydraDxApi.tx.PolkadotXcm.execute({
        //     message: message_on_hydraDx,
        //     max_weight: {
        //         ref_time: remoteXcmWeight.value.ref_time,
        //         proof_size: remoteXcmWeight.value.proof_size
        //     }
        // });

        // const dryRun2 = await hydraDxApi.apis.DryRunApi.dry_run_call(
        //     PolkadotRuntimeOriginCaller.system({
        //         type: "Signed",
        //         value: ALICE_HYDRATION
        //     }),
        //     txn.decodedCall,
        //     {}
        // );

        // const dry_run_xcm = await hydraDxApi.apis.DryRunApi.dry_run_xcm(
        //     XcmVersionedLocation.V4({
        //         parents: 0,
        //         interior: XcmV3Junctions.X1(
        //             XcmV3Junction.Parachain(HYDRADX_PARA_ID)
        //         )
        //     }),
        //     message_on_hydraDx
        // )

        // //print dryRun2 into a file
        // fs.writeFileSync('dryRun2_hydraDx.json', serializeKey(dry_run_xcm));

        // if (dryRun2.success) {
        //     //check value.execution_result.success
        //     if (!dryRun2.value.execution_result.success) {
        //         throw new Error("Dry run failed");
        //     }
        // } else {
        //     throw new Error("Dry run failed");
        // }
        /* 
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
        
            //dry run on asset hub
            const txn2 = assetHubApi.tx.PolkadotXcm.execute({
                message: v4Instructions,
                max_weight: {
                    ref_time: finalAssetHubWeight.value.ref_time,
                    proof_size: finalAssetHubWeight.value.proof_size
                }
            });
        
            const dryRun3 = await assetHubApi.apis.DryRunApi.dry_run_call(
                PolkadotRuntimeOriginCaller.system({
                    type: "Signed",
                    value: ALICE
                }),
                txn2.decodedCall,
                {}
            );
        
            //print dryRun3 into a file
            fs.writeFileSync('dryRun3.json', serializeKey(dryRun3));
        
            return {
                initial_execution: initialExecutionFee,
                initial_delivery: deliveryFees,
                hydradx_execution: hydraDxExecutionFee,
                return_delivery: returnDeliveryFees,
                final_execution: finalExecutionFee,
                initial_weight: xcmWeight.value
            }; */
    } catch (error) {
        console.error("Error in calculateFees:", error);
        throw error;
    }
}


async function main() {
    let assetHubClient = null;
    let hydraDxClient = null;
    let monitorCleanup = null;

    try {
        const { alice, aliceKeyPair, bobKeyPair } = initSigners();

        // Connect to Asset Hub
        const assetHubConnection = await connectPapi(TEST_RPC_ASSET_HUB, 'asset-hub');
        assetHubClient = assetHubConnection.client;
        const assetHubApi = assetHubConnection.api;

        // Connect to HydraDX
        const hydraDxConnection = await connectPapi(TEST_RPC_PARACHAIN_HYDRATION, 'hydration');
        hydraDxClient = hydraDxConnection.client;
        const hydraDxApi = hydraDxConnection.api;

        const ALICE = ss58Encode(aliceKeyPair.publicKey, 0);
        const ALICE_HYDRATION = ss58Encode(aliceKeyPair.publicKey, 63);
        const BOB = ss58Encode(bobKeyPair.publicKey, 0);
        const BOB_HYDRATION = ss58Encode(bobKeyPair.publicKey, 63);
        console.log("Alice address (Asset Hub):", ALICE);
        console.log("Bob address (HydraDX):", BOB);
        console.log("Bob address (HydraDX):", BOB_HYDRATION);
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
        const fees = await calculateFees(assetHubApi, hydraDxApi, dotAssetId, aliceKeyPair, bobKeyPair, ALICE, ALICE_HYDRATION);
        console.log("\nFees calculated:", fees);

    } catch (error) {
        console.error('Transaction error:', error);
        if (error instanceof Error) {
            console.error('Error details:', error.message);
            console.error('Stack trace:', error.stack);
        }
    } finally {
        // Clean up monitoring if it's still active
        if (monitorCleanup) {
            try {
                await monitorCleanup();
            } catch (e) {
                console.warn("Error during monitoring cleanup:", e);
            }
        }

        // Destroy clients in reverse order of creation
        if (hydraDxClient) {
            try {
                await hydraDxClient.destroy();
            } catch (e) {
                console.warn("Error destroying HydraDX client:", e);
            }
        }

        if (assetHubClient) {
            try {
                await assetHubClient.destroy();
            } catch (e) {
                console.warn("Error destroying Asset Hub client:", e);
            }
        }
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
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

        const assetHubDest = {
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

        // Step 2: Calculate weights and fees for Asset Hub return operations
        console.log("Calculating Asset Hub return journey weights and fees...");
        const assetHubOperations = XcmVersionedXcm.V4([
            XcmV4Instruction.DepositAsset({
                assets: XcmV4AssetAssetFilter.Wild(XcmV4AssetWildAsset.All()),
                beneficiary: beneficiary(bobKeyPair)
            })
        ]);

        const assetHubOperationsDelivery = XcmVersionedXcm.V4([
            XcmV4Instruction.InitiateReserveWithdraw({
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
                            fun: XcmV3MultiassetFungibility.Fungible(1000000000n)
                        },
                        //weight_limit: XcmV3WeightLimit.Limited(assetHubWeight.value)
                        weight_limit: XcmV3WeightLimit.Unlimited()
                    }),
                    XcmV4Instruction.DepositAsset({
                        assets: XcmV4AssetAssetFilter.Wild(XcmV4AssetWildAsset.All()),
                        beneficiary: beneficiary(bobKeyPair)
                    })
                ]
            })
        ]);

        // Calculate Asset Hub execution weight and fees
        const assetHubWeight = await assetHubApi.apis.XcmPaymentApi.query_xcm_weight(assetHubOperations);
        if (!assetHubWeight.success) {
            throw new Error("Failed to calculate Asset Hub return weight");
        }

        const dotAssetId = XcmVersionedAssetId.V4({
            parents: 1,
            interior: XcmV3Junctions.Here()
        });

        const assetHubFee = await assetHubApi.apis.XcmPaymentApi.query_weight_to_asset_fee(
            assetHubWeight.value,
            dotAssetId
        );
        if (!assetHubFee.success) {
            throw new Error("Failed to calculate Asset Hub return fee");
        }

        // // Calculate Asset Hub delivery fees
        // const assetHubDeliveryFee = await hydraDxApi.apis.XcmPaymentApi.query_delivery_fees(
        //     XcmVersionedLocation.V4(assetHubDest),
        //     assetHubOperationsDelivery
        // );
        // if (!assetHubDeliveryFee.success) {
        //     throw new Error("Failed to calculate Asset Hub delivery fees");
        // }

        // console.log("assetHubDeliveryFee", assetHubDeliveryFee)
        // //print using json format
        // console.log(serializeKey(assetHubDeliveryFee))

        // Helper function to safely convert fee values to BigInt
        const extractFeeBigInt = (fee: any): bigint => {
            if (typeof fee === 'bigint') return fee;
            if (typeof fee === 'number') return BigInt(fee);
            if (typeof fee === 'string') return BigInt(fee);
            if (fee && typeof fee.toString === 'function') return BigInt(fee.toString());
            throw new Error(`Unable to convert fee value to BigInt: ${fee}`);
        };

        // Helper function to extract delivery fee from XCM response
        const extractDeliveryFee = (deliveryFeeResponse: any, defaultValue?: bigint): bigint => {
            try {
                // Handle the specific V4 response structure
                if (deliveryFeeResponse?.type === 'V4' && Array.isArray(deliveryFeeResponse.value)) {
                    // If array is empty and default value provided, return default
                    if (deliveryFeeResponse.value.length === 0 && defaultValue !== undefined) {
                        console.log('Using default delivery fee value:', defaultValue.toString());
                        return defaultValue;
                    }

                    const firstAsset = deliveryFeeResponse.value[0];
                    if (firstAsset?.fun?.type === 'Fungible' && firstAsset.fun.value) {
                        return extractFeeBigInt(firstAsset.fun.value);
                    }
                }

                // If we have a default value, use it instead of throwing
                if (defaultValue !== undefined) {
                    console.log('Using default delivery fee value:', defaultValue.toString());
                    return defaultValue;
                }

                throw new Error('Could not find delivery fee value in response');
            } catch (error) {
                if (defaultValue !== undefined) {
                    console.log('Error extracting fee, using default value:', defaultValue.toString());
                    return defaultValue;
                }
                console.error('Error extracting delivery fee:', error);
                console.debug('Delivery fee response:', JSON.stringify(deliveryFeeResponse, null, 2));
                throw error;
            }
        };

        // Apply buffer to Asset Hub fees
        const assetHubFeeValue = extractFeeBigInt(assetHubFee.value);
        // Use the execution fee as a baseline for delivery fee if not available
    //    const assetHubDeliveryFeeValue = extractDeliveryFee(assetHubDeliveryFee.value, assetHubFeeValue);
        const ASSET_HUB_RETURN_FEE = (assetHubFeeValue) * BUFFER_PERCENTAGE / 100n;

        // Step 1: Calculate weights and fees for HydraDX operations
        console.log("\nCalculating HydraDX execution weights and fees...");
        const hydraDxOperations = XcmVersionedXcm.V4([
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
            XcmV4Instruction.InitiateReserveWithdraw({
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
            })
        ]);

        const hydraDxOperationsDelivery = XcmVersionedXcm.V4([
            XcmV4Instruction.DepositReserveAsset({
                assets: XcmV4AssetAssetFilter.Definite([{
                    id: {
                        parents: 1,
                    interior: XcmV3Junctions.Here()
                },
                fun: XcmV3MultiassetFungibility.Fungible(TRANSFER_AMOUNT)
            }]),
            dest: hydradxDest,
            xcm: [/* 
                // 2a. Pay for HydraDX execution with calculated fee
                XcmV4Instruction.BuyExecution({
                    fees: {
                        id: {
                            parents: 1,
                            interior: XcmV3Junctions.Here()
                        },
                        fun: XcmV3MultiassetFungibility.Fungible(1000000000n)
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

                // XcmV4Instruction.DepositAsset({
                //     assets: XcmV4AssetAssetFilter.Wild(XcmV4AssetWildAsset.All()),
                //     beneficiary: beneficiary(bobKeyPair)
                // })
                XcmV4Instruction.InitiateReserveWithdraw({
                    assets: XcmV4AssetAssetFilter.Wild(XcmV4AssetWildAsset.All()),
                    reserve: assetHubDest,
                    xcm: [
                        // Pay for Asset Hub execution with calculated fee
                        // XcmV4Instruction.BuyExecution({
                        //     fees: {
                        //         id: {
                        //             parents: 1,
                        //             interior: XcmV3Junctions.Here()
                        //         },
                        //         fun: XcmV3MultiassetFungibility.Fungible(ASSET_HUB_RETURN_FEE)
                        //     },
                        //     //weight_limit: XcmV3WeightLimit.Limited(assetHubWeight.value)
                        //     weight_limit: XcmV3WeightLimit.Unlimited()
                        // }),
                        // XcmV4Instruction.DepositAsset({
                        //     assets: XcmV4AssetAssetFilter.Wild(XcmV4AssetWildAsset.All()),
                        //     beneficiary: beneficiary(bobKeyPair)
                        // })
                    ]
                })
           */  ]
        })
        ]);

        // Calculate HydraDX execution weight and fees
        const hydraDxWeight = await hydraDxApi.apis.XcmPaymentApi.query_xcm_weight(hydraDxOperations);
        if (!hydraDxWeight.success) {
            throw new Error("Failed to calculate HydraDX execution weight");
        }

        const hydraDxFee = await hydraDxApi.apis.XcmPaymentApi.query_weight_to_asset_fee(
            hydraDxWeight.value,
            dotAssetId
        );
        if (!hydraDxFee.success) {
            throw new Error("Failed to calculate HydraDX execution fee");
        }

        // Calculate HydraDX delivery fees
        const hydraDxDeliveryFee = await assetHubApi.apis.XcmPaymentApi.query_delivery_fees(
            XcmVersionedLocation.V4(hydradxDest),
            hydraDxOperationsDelivery
        );
        if (!hydraDxDeliveryFee.success) {
            throw new Error("Failed to calculate HydraDX delivery fees");
        }

        // Apply buffer to HydraDX fees
        const hydraDxFeeValue = extractFeeBigInt(hydraDxFee.value);
        // Use the execution fee as a baseline for delivery fee if not available
        const hydraDxDeliveryFeeValue = extractDeliveryFee(hydraDxDeliveryFee.value, hydraDxFeeValue);
        const HYDRADX_EXECUTION_FEE = (hydraDxFeeValue + hydraDxDeliveryFeeValue) * BUFFER_PERCENTAGE / 100n;
    // const HYDRADX_EXECUTION_FEE = (hydraDxDeliveryFeeValue) * BUFFER_PERCENTAGE / 100n;

        // Log all fee components with more detailed information
        console.log("\nDetailed Fee Breakdown:");
        console.log("Asset Hub:");
        console.log(`- Base execution fee: ${Number(assetHubFeeValue) / 1e10} DOT`);
        //console.log(`- Delivery fee: ${Number(assetHubDeliveryFeeValue) / 1e10} DOT`);
        console.log(`- Total with ${Number(BUFFER_PERCENTAGE)}% buffer: ${Number(ASSET_HUB_RETURN_FEE) / 1e10} DOT`);
        console.log("\nHydraDX:");
        console.log(`- Base execution fee: ${Number(hydraDxFeeValue) / 1e10} DOT`);
        console.log(`- Delivery fee: ${Number(hydraDxDeliveryFeeValue) / 1e10} DOT`);
        console.log(`- Total with ${Number(BUFFER_PERCENTAGE)}% buffer: ${Number(HYDRADX_EXECUTION_FEE) / 1e10} DOT`);

        // Calculate total amount needed including all fees
        const TOTAL_AMOUNT = TRANSFER_AMOUNT + HYDRADX_EXECUTION_FEE + ASSET_HUB_RETURN_FEE;

        // Create the complete XCM message with calculated fees
        const message = XcmVersionedXcm.V4([
            // 1. Withdraw DOT from Asset Hub (including fees)
            XcmV4Instruction.WithdrawAsset([{
                id: {
                    parents: 1,
                    interior: XcmV3Junctions.Here()
                },
                fun: XcmV3MultiassetFungibility.Fungible(TOTAL_AMOUNT)
            }]),

            // 2. Send to HydraDX with instructions
            XcmV4Instruction.DepositReserveAsset({
                assets: XcmV4AssetAssetFilter.Definite([{
                    id: {
                        parents: 1,
                        interior: XcmV3Junctions.Here()
                    },
                    fun: XcmV3MultiassetFungibility.Fungible(TOTAL_AMOUNT)
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
                            fun: XcmV3MultiassetFungibility.Fungible(HYDRADX_EXECUTION_FEE)
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

                    // XcmV4Instruction.DepositAsset({
                    //     assets: XcmV4AssetAssetFilter.Wild(XcmV4AssetWildAsset.All()),
                    //     beneficiary: beneficiary(bobKeyPair)
                    // })

                    // // 2c. Send swapped assets back to Asset Hub
                    XcmV4Instruction.InitiateReserveWithdraw({
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
                    })
                ]
            })
        ]);

        // Query final weight for the complete message
        console.log("\nCalculating total XCM weight...");
        const xcmWeight = await assetHubApi.apis.XcmPaymentApi.query_xcm_weight(message);
        if (!xcmWeight.success) {
            throw new Error("Failed to calculate total XCM weight");
        } else {
            console.log("XCM weight:", xcmWeight);
        }

        // Execute XCM message
        console.log("Executing XCM message...");
        const tx = assetHubApi.tx.PolkadotXcm.execute({
            message: message,
            max_weight: {
                ref_time: xcmWeight.value.ref_time,
                proof_size: xcmWeight.value.proof_size
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

        if (dryRun.success) {
            console.log("Dry run successful");
        } else {
            console.error("Dry run failed:", dryRun);
            throw new Error("Dry run failed");
        }

        // Submit and watch the transaction
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

    } catch (error) {
        console.error('Transaction error:', error);
    } finally {
        assetHubClient.destroy();
        hydraDxClient.destroy();
    }
}

main().catch(console.error); 
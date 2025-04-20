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
import { TEST_RPC_ASSET_HUB, TEST_RPC_PARACHAIN_HYDRATION } from "../../../services/constants"
import { TransactionService } from '../../../services/network/TransactionService'
import { connectPapi } from "../../../services/network/types"
import { Binary, TypedApi } from "polkadot-api"
import {
    XcmVersionedLocation,
    XcmV3Junction,
    XcmV3Junctions,
    XcmV3MultiassetFungibility,
    XcmVersionedXcm,
    XcmV4Instruction,
    XcmV2OriginKind,
    XcmV3WeightLimit,
    PolkadotRuntimeOriginCaller,
    XcmV4AssetAssetFilter,
    XcmVersionedAssets,
    XcmVersionedAssetId,
    XcmV4AssetWildAsset
} from "@polkadot-api/descriptors"
import { polkadot_asset_hub, hydration } from '@polkadot-api/descriptors';
import { serializeKey } from "@/assets/utils"

// Constants
const TRANSFER_AMOUNT = 200_000_000_000n // 20 DOT in planck units
const HDX_ASSET_ID = 0 // HDX token ID in HydraDX
const DOT_ASSET_ID = 5 // DOT token ID in HydraDX
const HYDRADX_PARA_ID = 2034 // HydraDX parachain ID
const ASSET_HUB_PARA_ID = 1000 // Asset Hub parachain ID
const BUFFER_MULTIPLIER = 120n // 20% buffer for fees
const MIN_XCM_FEE = 4_000_000_000n // Minimum XCM fee in planck units

async function constructHydraDXSwapCall(
    hydraDxApi: TypedApi<typeof hydration>,
    amount: bigint,
    ALICE: string
) {
    console.log("Constructing swap call with params:", {
        asset_in: DOT_ASSET_ID,
        asset_out: HDX_ASSET_ID,
        amount_in: amount.toString(),
        min_amount_out: (amount * 90n / 100n).toString()
    });

    try {
        // Construct the swap call using HydraDX's Router.sell
        const swapCall = hydraDxApi.tx.Router.sell({
            asset_in: DOT_ASSET_ID,
            asset_out: HDX_ASSET_ID,
            amount_in: amount,
            min_amount_out: amount * 90n / 100n, // 10% slippage
            route: []
        });

        // add system.remark
        // const swapCall = hydraDxApi.tx.System.remark({
        //     remark: Binary.fromText("test")
        // });

        console.log("Swap call constructed successfully");

        // Get the encoded call data and weight
        console.log("Getting encoded call data...");
        const encodedSwapHex = await swapCall.getEncodedData();
        console.log("Encoded call data:", encodedSwapHex.asHex());

        console.log("Getting weight info...");
        const swapWeight = await swapCall.getPaymentInfo(ALICE);
        console.log("Weight info:", swapWeight);

        return {
            encodedCall: encodedSwapHex,
            weight: swapWeight.weight
        };
    } catch (error) {
        console.error("Error in constructHydraDXSwapCall:", error);
        if (error instanceof Error) {
            console.error("Error details:", error.message);
            console.error("Stack trace:", error.stack);
        }
        throw error;
    }
}

async function calculateXcmFees(
    assetHubApi: TypedApi<typeof polkadot_asset_hub>,
    hydraDxApi: TypedApi<typeof hydration>,
    message: any,
    dotAssetLocation: any
) {
    // Calculate execution weight
    const xcmWeight = await hydraDxApi.apis.XcmPaymentApi.query_xcm_weight(message);
    if (!xcmWeight.success) {
        throw new Error("Failed to calculate XCM weight");
    }

    // Calculate fee in DOT
    const xcmFee = await hydraDxApi.apis.XcmPaymentApi.query_weight_to_asset_fee(
        xcmWeight.value,
        dotAssetLocation
    );

    if (!xcmFee.success) {
        throw new Error("Failed to calculate XCM fee");
    }

    console.log("XCM fee:", serializeKey(xcmFee));
    return {
        weight: xcmWeight.value,
        fee: extractFeeValue(xcmFee)
    };
}

function extractFeeValue(feeResult: any): bigint {
    if (!feeResult || !feeResult.success) {
        throw new Error(`Fee calculation failed: ${serializeKey(feeResult)}`);
    }

    if (typeof feeResult.value === 'bigint') {
        return feeResult.value;
    }

    if (feeResult.value?.type === 'V4' && Array.isArray(feeResult.value.value)) {
        return feeResult.value.value.reduce((sum: bigint, item: any) => {
            if (item?.fun?.type === 'Fungible') {
                return sum + BigInt(item.fun.value.toString());
            }
            return sum;
        }, 0n);
    }

    throw new Error(`Unexpected fee result structure: ${serializeKey(feeResult)}`);
}

async function main() {
    let assetHubClient = null;
    let hydraDxClient = null;

    try {
        // Initialize signers
        const { alice, aliceKeyPair, bobKeyPair } = initSigners();

        const ALICE = ss58Encode(aliceKeyPair.publicKey, 0);
        const ALICE_HYDRADX = ss58Encode(aliceKeyPair.publicKey, 63);

        console.log("Alice Asset Hub address:", ALICE);
        console.log("Alice HydraDX address:", ALICE_HYDRADX);

        // Connect to chains
        const assetHubConnection = await connectPapi(TEST_RPC_ASSET_HUB, 'asset-hub');
        assetHubClient = assetHubConnection.client;
        const assetHubApi = assetHubConnection.api;

        const hydraDxConnection = await connectPapi(TEST_RPC_PARACHAIN_HYDRATION, 'hydration');
        hydraDxClient = hydraDxConnection.client;
        const hydraDxApi = hydraDxConnection.api;

        // Check initial balance
        const initialBalance = await assetHubApi.query.System.Account.getValue(ALICE);
        const dotBalance = initialBalance.data.free;
        console.log(`Initial DOT balance: ${dotBalance.toString()}`);

        // Construct the swap call for HydraDX
        const { encodedCall, weight: swapWeight } = await constructHydraDXSwapCall(
            hydraDxApi,
            TRANSFER_AMOUNT,
            ALICE_HYDRADX
        );

        const minAmountOut = TRANSFER_AMOUNT * 90n / 100n;

        // Construct the XCM message for executing on HydraDX
        const xcmMessage = XcmVersionedXcm.V4([
            // Buy execution for swap
            XcmV4Instruction.BuyExecution({
                fees: {
                    id: {
                        parents: 1,
                        interior: XcmV3Junctions.Here()
                    },
                    fun: XcmV3MultiassetFungibility.Fungible(MIN_XCM_FEE)
                },
                weight_limit: XcmV3WeightLimit.Unlimited()
            }),
            // Execute the swap
            XcmV4Instruction.Transact({
                origin_kind: XcmV2OriginKind.SovereignAccount(),
                require_weight_at_most: swapWeight,
                call: encodedCall
            }),
            
            //WithdrawAsset
            XcmV4Instruction.WithdrawAsset([{
                id: {
                    parents: 1,
                    interior: XcmV3Junctions.Here()
                },
                fun: XcmV3MultiassetFungibility.Fungible(minAmountOut)
            }]),

            //DepositAsset
            XcmV4Instruction.DepositAsset({
                assets: XcmV4AssetAssetFilter.Wild(XcmV4AssetWildAsset.All()),
                beneficiary: {
                    parents: 0,
                    interior: XcmV3Junctions.X1(
                        XcmV3Junction.AccountId32({
                            id: Binary.fromBytes(bobKeyPair.publicKey),
                            network: undefined
                        })
                    )
                }
            })  
            



            // Send swapped assets back to Asset Hub
            // XcmV4Instruction.InitiateReserveWithdraw({
            //     assets: XcmV4AssetAssetFilter.Definite([{
            //         id: {
            //             parents: 0,
            //             interior: XcmV3Junctions.Here()
            //         },
            //         fun: XcmV3MultiassetFungibility.Fungible(TRANSFER_AMOUNT)
            //     }]),
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
            //                 fun: XcmV3MultiassetFungibility.Fungible(MIN_XCM_FEE)
            //             },
            //             weight_limit: XcmV3WeightLimit.Unlimited()
            //         }),
            //         XcmV4Instruction.DepositAsset({
            //             assets: XcmV4AssetAssetFilter.Definite([{
            //                 id: {
            //                     parents: 0,
            //                     interior: XcmV3Junctions.Here()
            //                 },
            //                 fun: XcmV3MultiassetFungibility.Fungible(TRANSFER_AMOUNT)
            //             }]),
            //             beneficiary: {
            //                 parents: 0,
            //                 interior: XcmV3Junctions.X1(
            //                     XcmV3Junction.AccountId32({
            //                         network: undefined,
            //                         id: Binary.fromBytes(aliceKeyPair.publicKey)
            //                     })
            //                 )
            //             }
            //         })
            //     ]
            // })
        ]);

        // Calculate total fees needed
        const dotAssetLocation = {
            parents: 1,
            interior: XcmV3Junctions.Here()
        };

        const xcmWeight = await hydraDxApi.apis.XcmPaymentApi.query_xcm_weight(xcmMessage);
        if (!xcmWeight.success) {
            throw new Error("Failed to calculate XCM weight");
        }
    
        // Calculate fee in DOT
        const xcmFee = await hydraDxApi.apis.XcmPaymentApi.query_weight_to_asset_fee(
            xcmWeight.value,
            XcmVersionedAssetId.V4(dotAssetLocation)
        );
    
        if (!xcmFee.success) {
            throw new Error("Failed to calculate XCM fee");
        }
    
        const totalRequired = TRANSFER_AMOUNT + (xcmFee.value * BUFFER_MULTIPLIER / 100n);
        console.log(`Total DOT required: ${totalRequired.toString()}`);

        if (dotBalance < totalRequired) {
            throw new Error(`Insufficient balance. Have ${dotBalance.toString()}, need ${totalRequired.toString()}`);
        }

        // // Fix the reserve_transfer_assets call
        // const tx = assetHubApi.tx.PolkadotXcm.reserve_transfer_assets({
        //     dest: XcmVersionedLocation.V4({
        //         parents: 1,
        //         interior: XcmV3Junctions.X1(
        //             XcmV3Junction.Parachain(HYDRADX_PARA_ID)
        //         )
        //     }),
        //     beneficiary: XcmVersionedLocation.V4({
        //         parents: 0,
        //         interior: XcmV3Junctions.X1(
        //             XcmV3Junction.AccountId32({
        //                 network: undefined,
        //                 id: Binary.fromBytes(aliceKeyPair.publicKey)
        //             })
        //         )
        //     }),
        //     assets: XcmVersionedAssets.V4([{
        //         id: {
        //             parents: 1,
        //             interior: XcmV3Junctions.Here()
        //         },
        //         fun: XcmV3MultiassetFungibility.Fungible(totalRequired)
        //     }]),
        //     fee_asset_item: 0
        // });


        const tx = hydraDxApi.tx.PolkadotXcm.execute({
            message: xcmMessage,
            max_weight: xcmWeight.value
        });

        // Dry run the transaction
        // const dryRun = await hydraDxApi.apis.DryRunApi.dry_run_call(
        //     PolkadotRuntimeOriginCaller.system({
        //         type: "Signed",
        //         value: ALICE
        //     }),
        //     tx.decodedCall,
        //     {}
        // );

        // if (!dryRun.success) {
        //     throw new Error(`Dry run failed: ${serializeKey(dryRun)}`);
        // }

        // console.log("Dry run successful, submitting transaction...");

        // Submit and watch the transaction
        await new Promise((resolve, reject) => {
            TransactionService.submitAndWatch(tx, alice, {
                onSuccess: (status) => {
                    console.log(`Transaction included in block ${status.blockNumber}`);
                    resolve(status);
                },
                onError: (error) => {
                    console.error("Transaction failed:", error);
                    reject(error);
                },
                onStatusChange: (status) => {
                    console.log("Transaction status:", status);
                }
            });
        });

        console.log("Transaction completed successfully!");

        // Wait for a few blocks to ensure finality
        await new Promise(resolve => setTimeout(resolve, 30000));

        // Check final balances
        const finalBalance = await assetHubApi.query.System.Account.getValue(ALICE);
        console.log(`Final DOT balance: ${finalBalance.data.free.toString()}`);

    } catch (error) {
        console.error("Error:", error);
        if (error instanceof Error) {
            console.error("Error details:", error.message);
            console.error("Stack trace:", error.stack);
        }
    } finally {
        // Cleanup
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
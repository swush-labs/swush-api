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
    XcmV2MultiassetWildFungibility,
    XcmV3Instruction
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
const TRANSFER_AMOUNT = 200_000_000_000_000n // 20 DOT in planck units
const HDX_ASSET_ID = 0 // HDX token ID in HydraDX
const DOT_ASSET_ID = 5 // DOT token ID in HydraDX
const HYDRADX_PARA_ID = 2034 // HydraDX parachain ID
const ASSET_HUB_PARA_ID = 1000 // Asset Hub parachain ID
const SLIPPAGE_TOLERANCE = 5 // 5% slippage tolerance
const MAX_ASSETS = 1 // Maximum number of assets to transfer
const BUFFER_PERCENTAGE = 100n // 20% buffer for fees



async function constructXcmMessage(beneficiaryKeyPair: KeyPair,
    aliceKeyPair: KeyPair,
    hydraDxApi: TypedApi<typeof hydration>, ALICE: string) {
    // Calculate total fees with buffer and add 10000000000n for the execution fee
    const buffer = 10000000000n;
    const withdrawAmount = TRANSFER_AMOUNT;
    const minBuyAmount = TRANSFER_AMOUNT * BigInt(100 - SLIPPAGE_TOLERANCE) / 100n

    // Example: Replace encodedOmnipoolSellHex with encoded remark
    const remarkCall = hydraDxApi.tx.System.remark_with_event({ remark: Binary.fromText("Test from AH") });
    const encodedRemarkHex = await remarkCall.getEncodedData();
    const remarkWeight = await remarkCall.getPaymentInfo(ALICE); // Use Alice's HydraDX address for estimation proxy
    //print the remarkWeight and encodedRemarkHex
    console.log("Remark Weight:", remarkWeight);
    console.log("Encoded Remark Hex:", encodedRemarkHex.asHex());


    const setMultiCurrency = hydraDxApi.tx.MultiTransactionPayment.set_currency({
        currency: 5,
    });
    const encodedSetMultiCurrencyHex = await setMultiCurrency.getEncodedData();
    console.log("Encoded Set Multi Currency Hex:", encodedSetMultiCurrencyHex.asHex());

    const setMultiCurrencyWeight = await setMultiCurrency.getPaymentInfo(ALICE);
    console.log("Set Multi Currency Weight:", setMultiCurrencyWeight);

    const dot_loc = {
        parents: 1,
        interior: XcmV3Junctions.Here()
    };
    const hdx_loc = {
        parents: 1,
        interior: XcmV3Junctions.X2([
            XcmV3Junction.Parachain(HYDRADX_PARA_ID),
            XcmV3Junction.GeneralIndex(0n)
        ])
    };

    //XCM TRANSACTION
    const XCM_TRANSACTION =
        XcmV4Instruction.Transact({
            origin_kind: XcmV2OriginKind.SovereignAccount(),
            require_weight_at_most: setMultiCurrencyWeight.weight,
            call: encodedSetMultiCurrencyHex
        });

    //calculate the weight of the XCM_TRANSACTION
    const transactionWeight = await hydraDxApi.apis.XcmPaymentApi.query_xcm_weight(XcmVersionedXcm.V4([XCM_TRANSACTION]));
    console.log("Transaction Weight:", transactionWeight);

    if (!transactionWeight.success) {
        throw new Error("Failed to calculate transaction weight");
    }

    const fees = await hydraDxApi.apis.XcmPaymentApi.query_weight_to_asset_fee(transactionWeight.value, XcmVersionedAssetId.V4(dot_loc));
    console.log("Fees:", fees);
    if (!fees.success) {
        throw new Error("Failed to calculate fees");
    }

    const final_fees = fees.value + buffer;
    return XcmVersionedXcm.V3([
        // XcmV4Instruction.DescendOrigin(XcmV3Junctions.X2([
        //     XcmV3Junction.Parachain(ASSET_HUB_PARA_ID),
        //     XcmV3Junction.AccountId32({
        //         network: undefined,
        //         id: Binary.fromBytes(aliceKeyPair.publicKey),
        //     }),
        // ])),
        // XcmV4Instruction.DescendOrigin(XcmV3Junctions.X1(
        //     XcmV3Junction.AccountId32({
        //         network: undefined,
        //         id: Binary.fromText("0xdd2399f3b5ca0fc584c4637283cda4d73f6f87c0")
        //     })
        // )),
        //add WithdrawAsset, BuyExecution, Transact
        // XcmV3Instruction.WithdrawAsset([{
        //     id: XcmV3MultiassetAssetId.Concrete({
        //         parents: 1,
        //         interior: XcmV3Junctions.Here()
        //     }),
        //     fun: XcmV3MultiassetFungibility.Fungible(withdrawAmount)
        // }]),
        XcmV3Instruction.BuyExecution({
            fees: {
                id: XcmV3MultiassetAssetId.Concrete({
                    parents: 1,
                    interior: XcmV3Junctions.Here()
                }),
                fun: XcmV3MultiassetFungibility.Fungible(final_fees)
            },
            weight_limit: XcmV3WeightLimit.Limited(transactionWeight.value)
        }),
        XCM_TRANSACTION
    ])
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
        // console.log("\nCalculating fees...");
        // const fees = await calculateFees(assetHubApi, hydraDxApi, dotAssetId, bobKeyPair, ALICE);
        // console.log("\nFees calculated:", fees);

        // Construct XCM message with dynamic fees
        console.log("\nConstructing XCM message with dynamic fees...");
        const message = await constructXcmMessage(bobKeyPair, aliceKeyPair, hydraDxApi, ALICE_HYDRATION);

        //calculate weights for ref_time and proof_size
        const weights = await assetHubApi.apis.XcmPaymentApi.query_xcm_weight(message);

        if (!weights.success) {
            throw new Error("Failed to calculate weights");
        }

        // Execute XCM message
        console.log("\nExecuting XCM message...");
        const tx = assetHubApi.tx.PolkadotXcm.send({
            dest: XcmVersionedLocation.V3({
                parents: 1,
                interior: XcmV3Junctions.X1(
                    XcmV3Junction.Parachain(HYDRADX_PARA_ID)
                )
            }),
            message: message
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

        if (!dryRun.value) {
            console.error("Dry run failed:", dryRun);
            throw new Error("Dry run failed");
        }

        console.log("Dry run successful");

        // Create a promise to track transaction completion
        const txPromise = new Promise((resolve, reject) => {
            console.log("Submitting XCM transfer with swap transaction...");
            TransactionService.submitAndWatch(tx, alice, {
                onSuccess: async (status) => {
                    console.log(`Transaction successful in block ${status.blockNumber}`);
                    resolve(status);
                },
                onError: (error) => {
                    console.error('Transaction failed:', error);
                    reject(error);
                },
                onStatusChange: (status) => {
                    console.log('Transaction status:', status);
                }
            });
        });

        // Wait for transaction to complete
        await txPromise;

        // Start monitoring the XCM flow
        // console.log("\nStarting XCM flow monitoring...");
        // const flowSuccess = await monitorXcmFlow(
        //     assetHubApi,
        //     hydraDxApi,
        //     ALICE,
        //     BOB,
        //     TRANSFER_AMOUNT
        // );

        // if (flowSuccess) {
        //     console.log("\n🎉 Transaction fully completed! Funds have been transferred across chains.");

        //     // Verify final balances
        //     const finalBalance = await assetHubApi.query.System.Account.getValue(BOB);
        //     console.log("\nFinal balances:");
        //     console.log(`Bob DOT on Asset Hub: ${Number(finalBalance.data.free) / 1e10} DOT`);
        // } else {
        //     console.log("\n⚠️ XCM flow monitoring ended but could not confirm full completion.");
        // }

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
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
    XcmV3Instruction,
    XcmV3MultiassetMultiAssetFilter
} from "@polkadot-api/descriptors"
import { serializeKey } from "@/assets/utils"

// Constants
const TRANSFER_AMOUNT = 200_000_000_000n // 20 DOT in planck units
const HDX_ASSET_ID = 0 // HDX token ID in HydraDX
const DOT_ASSET_ID = 5 // DOT token ID in HydraDX (example, adjust as needed)
const HYDRADX_PARA_ID = 2034 // HydraDX parachain ID
const ASSET_HUB_PARA_ID = 1000 // Asset Hub parachain ID
const SLIPPAGE_TOLERANCE = 5 // 5% slippage tolerance
const MAX_ASSETS = 1 // Maximum number of assets to transfer

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
 * Example of XCM asset transfer from Asset Hub to HydraDX with swap
 * Implementation follows the pattern:
 * 1. WithdrawAsset - withdraws assets from Asset Hub
 * 2. DepositReserveAsset - sends assets to HydraDX with instructions:
 *    a. BuyExecution - pays for execution on HydraDX
 *    b. ExchangeAsset - swaps DOT for HDX
 *    c. DepositReserveAsset - sends swapped assets back to Asset Hub with instructions:
 *       i. BuyExecution - pays for execution on Asset Hub
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

        // console.log('Transfer details:')
        // console.log(`- Amount to transfer: ${Number(TRANSFER_AMOUNT) / 1e10} DOT (${TRANSFER_AMOUNT} planck)`)
        // console.log(`- Available balance: ${dotBalance} DOT (${initialBalance.data.free} planck)`)

        // Check initial balances on HydraDX
        const initialHydraDxDotBalance = await hydraDxApi.query.Tokens.Accounts.getValue(BOB, DOT_ASSET_ID)
        const initialHydraDxHdxBalance = await hydraDxApi.query.System.Account.getValue(BOB)

        console.log('\nInitial Balances:')
        console.log('Asset Hub:')
        console.log(`- Alice DOT: ${dotBalance} DOT (${initialBalance.data.free} planck)`)
        console.log('\nHydraDX:')
        console.log(`- Bob DOT: ${initialHydraDxDotBalance?.free || 0n} planck`)
        console.log(`- Bob HDX: ${initialHydraDxHdxBalance.data.free || 0n} planck`)

        console.log(`Have ${dotBalance} DOT, trying to transfer ${Number(TRANSFER_AMOUNT) / 1e10} DOT`)
        // Check if we have enough balance
        if (initialBalance.data.free < TRANSFER_AMOUNT) {
            throw new Error(`Insufficient balance. Have ${dotBalance} DOT, trying to transfer ${Number(TRANSFER_AMOUNT) / 1e10} DOT`)
        }
        const TXN_FEE1 = TRANSFER_AMOUNT / 50n
        const TXN_FEE2 = TRANSFER_AMOUNT / 10n
        const FINAL_TRANSFER_AMOUNT = TRANSFER_AMOUNT + TXN_FEE1
        // Create assets
        // DOT asset for withdrawal from Asset Hub
        const dotAsset = {
            id: {
                parents: 1, // Relay chain
                interior: XcmV3Junctions.Here()
            },
            fun: XcmV3MultiassetFungibility.Fungible(FINAL_TRANSFER_AMOUNT)
        };
    //    const dotAssetFilter = XcmV3MultiassetMultiAssetFilter.Definite([dotAsset])

        // Create fee assets
        // DOT fee for execution on HydraDX
        const dotFeeAsset1 = {
            id: {
                parents: 1, // Relay chain
                interior: XcmV3Junctions.Here()
            },
            fun: XcmV3MultiassetFungibility.Fungible(TXN_FEE1) // Fee for HydraDX execution
        };

        // DOT fee for execution on Asset Hub (return trip)
        const dotFeeAsset2 = {
            id: {
                parents: 1, // Relay chain
                interior: XcmV3Junctions.Here()
            },
            fun: XcmV3MultiassetFungibility.Fungible(TXN_FEE2) // Fee for Asset Hub execution
        };

        // Create locations
        // Beneficiary account (Bob) on Asset Hub
        const beneficiary = (keypair: KeyPair) => ({
            parents: 0,
            interior: XcmV3Junctions.X1(
                XcmV3Junction.AccountId32({
                    network: undefined,
                    id: Binary.fromBytes(keypair.publicKey)
                })
            )
        });

        // HydraDX destination
        const hydradxDest = {
            parents: 1,
            interior: XcmV3Junctions.X1(
                XcmV3Junction.Parachain(HYDRADX_PARA_ID)
            )
        };

        // Asset Hub destination
        const assetHubDest = {
            parents: 1,
            interior: XcmV3Junctions.X1(
                XcmV3Junction.Parachain(ASSET_HUB_PARA_ID)
            )
        };

        const dotAssetSwap = {
            id: {
                parents: 1, // Relay chain 
                interior: XcmV3Junctions.Here()
            },
            fun: XcmV3MultiassetFungibility.Fungible(TRANSFER_AMOUNT)
        };
        const dotAssetSwapFilter = XcmV4AssetAssetFilter.Definite([dotAssetSwap])

        const usdtAsset = {
            id: {
                parents: 1, // Local to Asset Hub
                interior: XcmV3Junctions.X3([
                    XcmV3Junction.Parachain(ASSET_HUB_PARA_ID), // Assets pallet
                    XcmV3Junction.PalletInstance(50), // USDT asset ID (example)
                    XcmV3Junction.GeneralIndex(BigInt(1984))
                ])
            },
            fun: XcmV3MultiassetFungibility.Fungible(BigInt(5000000)) // Amount will be determined by swap
        };

        const wildAllOf = XcmV4AssetWildAsset.AllOf({
            id: {
                parents: 1, // Local to Asset Hub
                interior: XcmV3Junctions.X3([
                    XcmV3Junction.Parachain(ASSET_HUB_PARA_ID), // Assets pallet
                    XcmV3Junction.PalletInstance(50), // USDT asset ID (example)
                    XcmV3Junction.GeneralIndex(BigInt(1984))
                ])
            },
            fun: XcmV2MultiassetWildFungibility.Fungible() // Amount will be determined by swap
        })
        // Create XCM message using V4 instructions
        const message = XcmVersionedXcm.V3([
            // 1. Withdraw DOT from Asset Hub
            XcmV3Instruction.WithdrawAsset([
                {
                    id: XcmV3MultiassetAssetId.Concrete({
                        parents: 1,
                        interior: XcmV3Junctions.Here()
                }),
                    fun: XcmV3MultiassetFungibility.Fungible(FINAL_TRANSFER_AMOUNT)
                }
            ]),
            // XcmV3Instruction.ClearOrigin(),

            // 2. Deposit to HydraDX with instructions
            XcmV3Instruction.DepositReserveAsset({
                assets: XcmV3MultiassetMultiAssetFilter.Definite([{
                    id: XcmV3MultiassetAssetId.Concrete({
                        parents: 1,
                        interior: XcmV3Junctions.Here()
                    }),
                    fun: XcmV3MultiassetFungibility.Fungible(FINAL_TRANSFER_AMOUNT)
                }]),
                dest: assetHubDest,
                xcm: [
                    // XcmV4Instruction.SetFeesMode({
                    //     jit_withdraw: true
                    // }),
                    // 2c.i. Pay for execution on Asset Hub
                    XcmV3Instruction.BuyExecution({
                        fees: {
                            id: XcmV3MultiassetAssetId.Concrete({
                                parents: 1,
                                interior: XcmV3Junctions.Here()
                            }),
                            fun: XcmV3MultiassetFungibility.Fungible(TXN_FEE1)
                        },
                        weight_limit: XcmV3WeightLimit.Unlimited()
                    }),

                    // 2c.ii. Deposit to Bob
                    XcmV3Instruction.DepositAsset({
                        assets: XcmV3MultiassetMultiAssetFilter.Definite([{
                            id: XcmV3MultiassetAssetId.Concrete({
                                parents: 1,
                                interior: XcmV3Junctions.Here()
                            }),
                            fun: XcmV3MultiassetFungibility.Fungible(TRANSFER_AMOUNT)
                        }]),
                        beneficiary: beneficiary(bobKeyPair)
                    })
                ]
            })
        ]);

    // Query weight for XCM message
    const xcmWeight = await hydraDxApi.apis.XcmPaymentApi.query_xcm_weight(message);

    console.log("XCM weight:", xcmWeight);

    if (xcmWeight.success) {
        // Execute XCM message on Asset Hub
        const tx = hydraDxApi.tx.PolkadotXcm.execute({
            message: message,
            max_weight: {
                ref_time: xcmWeight.value.ref_time,
                proof_size: xcmWeight.value.proof_size
            }
        });

        //print call data
        const callData = await tx.getEncodedData();
        console.log("Call data hex: ", callData.asHex());

        const dryRun = await assetHubApi.apis.DryRunApi.dry_run_call(
            PolkadotRuntimeOriginCaller.system({
                type: "Signed",
                value: ALICE
            }),
            tx.decodedCall,
            {}
        );
        if (dryRun.success) {
            console.log("Dry run result:", dryRun);
            //pretty print dryRun
            //console.log(serializeKey(dryRun));
        } else {
            console.error("Dry run failed:", dryRun);
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
    } else {
        console.error("Failed to query XCM weight:", xcmWeight);
        return;
    }

    // // Wait a bit for the transaction to be processed
    // await new Promise(resolve => setTimeout(resolve, 10000));


    // // Check final balances
    // const finalAssetHubBalance = await assetHubApi.query.System.Account.getValue(ALICE)
    // const finalHydraDxDotBalance = await hydraDxApi.query.Tokens.Accounts.getValue(ALICE_HYDRATION, DOT_ASSET_ID)
    // const finalHydraDxHdxBalance = await hydraDxApi.query.System.Account.getValue(ALICE_HYDRATION)

    // console.log('\nFinal Balances:')
    // console.log('Asset Hub:')
    // console.log(`- Alice DOT: ${finalAssetHubBalance.data.free} planck (${Number(finalAssetHubBalance.data.free) / 1e10} DOT)`)
    // console.log(`- Amount deducted: ${Number(initialBalance.data.free - finalAssetHubBalance.data.free) / 1e10} DOT`)

    // console.log('\nHydraDX:')
    // //console.log(`- Alice DOT: ${finalHydraDxDotBalance?.free || 0n} planck`)
    // //amount in DOT without planck
    // console.log(`- Alice DOT: ${Number(finalHydraDxDotBalance?.free || 0n) / 1e10} DOT`)
    // //console.log(`- Alice HDX: ${finalHydraDxHdxBalance.data.free || 0n} planck`)
    // //amount in HDX without planck
    // console.log(`- Alice HDX: ${Number(finalHydraDxHdxBalance.data.free || 0n) / 1e12} HDX`)
    // console.log(`- DOT Change: ${(finalHydraDxDotBalance?.free || 0n) - (initialHydraDxDotBalance?.free || 0n)} planck`)
    // console.log(`- HDX Change: ${(finalHydraDxHdxBalance.data.free || 0n) - (initialHydraDxHdxBalance.data.free || 0n)} planck`)

    console.log("write a poem about the transaction")
} catch (error) {
    console.error('Transaction error:', error);
} finally {
    assetHubClient.destroy();
    hydraDxClient.destroy();
}
}

main().catch(console.error);
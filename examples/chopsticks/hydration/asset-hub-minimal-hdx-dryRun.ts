import { sr25519CreateDerive } from "@polkadot-labs/hdkd"
import {
    DEV_PHRASE,
    entropyToMiniSecret,
    mnemonicToEntropy,
    ss58Decode,
    ss58Encode
} from "@polkadot-labs/hdkd-helpers"
import { getPolkadotSigner } from "polkadot-api/signer"
import { TEST_RPC_ASSET_HUB, TEST_RPC_PARACHAIN_HYDRATION, XCM_RPC_ASSET_HUB, XCM_RPC_HYDRATION } from "../../../services/constants"
import { TransactionService } from '../../../services/network/TransactionService'
import { connectPapi } from "../../../services/network/types"
import { Enum, Binary, FixedSizeArray, FixedSizeBinary, SS58String } from "polkadot-api"
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
    ArithmeticError,
    BalanceStatus,
    DispatchClass,
    SessionEvent,
    TokenError,
    TransactionalError,
    TransactionPaymentEvent,
    VestingEvent,
    XcmV3TraitsError,
    XcmV4Response,
    XcmV4TraitsOutcome
} from "@polkadot-api/descriptors"

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

        // Calculate minimum amount out with slippage tolerance
        const minBuyAmount = TRANSFER_AMOUNT * BigInt(100 - SLIPPAGE_TOLERANCE) / 100n

        // Create assets
        // DOT asset for withdrawal from Asset Hub
        const dotAsset = {
            id: {
                parents: 1, // Relay chain 
                interior: XcmV3Junctions.Here()
            },
            fun: XcmV3MultiassetFungibility.Fungible(TRANSFER_AMOUNT)
        };

        // HDX asset that we want to receive from swap
        const hdxAsset = {
            id: {
                parents: 0, // Local to HydraDX
                interior: XcmV3Junctions.Here()
            },
            fun: XcmV3MultiassetFungibility.Fungible(8000000n) // Amount will be determined by swap
        };

        // Create fee assets
        // DOT fee for execution on HydraDX
        const dotFeeAsset = {
            id: {
                parents: 1, // Relay chain
                interior: XcmV3Junctions.Here()
            },
            fun: XcmV3MultiassetFungibility.Fungible(TRANSFER_AMOUNT / 20n) // 10% for fees
        };

        // HDX fee for execution on Asset Hub
        const hdxFeeAsset = {
            id: {
                parents: 0, // Local on HydraDX
                interior: XcmV3Junctions.X2([
                    //Parachain(2034) and GeneralIndex(0)
                    XcmV3Junction.Parachain(HYDRADX_PARA_ID),
                    XcmV3Junction.GeneralIndex(BigInt(HDX_ASSET_ID))
                ])
            },
            fun: XcmV3MultiassetFungibility.Fungible(minBuyAmount / 10n) // 10% for fees
        };

        // Create locations
        // Beneficiary account (Bob) on Asset Hub
        const beneficiary = {
            parents: 0,
            interior: XcmV3Junctions.X1(
                XcmV3Junction.AccountId32({
                    network: undefined,
                    id: Binary.fromBytes(bobKeyPair.publicKey)
                })
            )
        };

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

        const dotAssetFilter = XcmV4AssetAssetFilter.Definite([dotAsset])
        const hdxAssetFilter = XcmV4AssetAssetFilter.Definite([hdxAsset])
        // HDX asset that we want to receive from swap
        const HDX_AMOUNT = 66 * 1e12;
        //print HDX_AMOUNT original
        console.log(`HDX_AMOUNT original: ${HDX_AMOUNT / 1e12}`)
        const hdxAssetNew = {
            id: {
                parents: 0, // Local to HydraDX
                interior: XcmV3Junctions.X1(
                    XcmV3Junction.GeneralIndex(BigInt(HDX_ASSET_ID))
                )
            },
            fun: XcmV3MultiassetFungibility.Fungible(BigInt(HDX_AMOUNT)) // Amount will be determined by swap
        };
        const hdxDepositFilter = XcmV4AssetAssetFilter.Definite([hdxAssetNew])

        // Create separate messages for local and remote execution
        const localMessage = XcmVersionedXcm.V4([
            // Local execution on Asset Hub
            XcmV4Instruction.WithdrawAsset([dotAsset])
        ]);

        const remoteMessage = XcmVersionedXcm.V4([
            // Remote execution on HydraDX
            XcmV4Instruction.DepositReserveAsset({
                assets: dotAssetFilter,
                dest: hydradxDest,
                xcm: [
                    XcmV4Instruction.BuyExecution({
                        fees: dotFeeAsset,
                        weight_limit: XcmV3WeightLimit.Unlimited()
                    }),
                    XcmV4Instruction.ExchangeAsset({
                        give: dotAssetFilter,
                        want: [hdxAssetNew],
                        maximal: true
                    }),
                    XcmV4Instruction.DepositAsset({
                        assets: hdxDepositFilter,
                        beneficiary: {
                            parents: 0,
                            interior: XcmV3Junctions.X1(
                                XcmV3Junction.AccountId32({
                                    network: undefined,
                                    id: Binary.fromBytes(aliceKeyPair.publicKey)
                                })
                            )
                        }
                    })
                ]
            })
        ]);

        // Origin locations for dry runs
        const assetHubOrigin = XcmVersionedLocation.V4({
            parents: 0,
            interior: XcmV3Junctions.X1(
                XcmV3Junction.AccountId32({
                    network: undefined,
                    id: Binary.fromBytes(aliceKeyPair.publicKey)
                })
            )
        });

        const hydraDxOrigin = XcmVersionedLocation.V3({
            parents: 1,
            interior: XcmV3Junctions.X1(
                XcmV3Junction.Parachain(HYDRADX_PARA_ID)
            )
        });

        const here = XcmVersionedLocation.V4({
            parents: 0,
            interior: XcmV3Junctions.Here()
        })

        const localDryRunSuccess = await assetHubApi.apis.DryRunApi.dry_run_xcm(
            assetHubOrigin,
            localMessage,
            {}
        );
        //print dryRun results
        if (localDryRunSuccess.success) {
            console.log('Local dry run successful and results:');
            console.log(localDryRunSuccess.value.execution_result)
            console.log(localDryRunSuccess.value.emitted_events)
        } else {
            console.log('Local dry run failed');
        }

    /* 
        const remoteDryRunSuccess = await hydraDxApi.apis.DryRunApi.dry_run_xcm(
            hydraDxOrigin,
            remoteMessage,
            {}
        );
        //print dryRun results
        if (remoteDryRunSuccess.success) {
            console.log('Remote dry run successful and results:');
            console.log(remoteDryRunSuccess.value.execution_result)
            console.log(remoteDryRunSuccess.value.emitted_events)
        } else {
            console.log('Remote dry run failed');
        }

        if (!localDryRunSuccess || !remoteDryRunSuccess) {
            console.error('Dry run failed. Aborting transaction.');
            return;
        }

        console.log('\nDry runs successful! Proceeding with actual transaction...\n');

        // Create the complete XCM message for actual execution
        const message = XcmVersionedXcm.V4([
            // 1. Withdraw DOT from Asset Hub
            XcmV4Instruction.WithdrawAsset([dotAsset]),

            // 2. Deposit to HydraDX with instructions
            XcmV4Instruction.DepositReserveAsset({
                assets: dotAssetFilter,
                dest: hydradxDest,
                xcm: [
                    // 2a. Pay for execution on HydraDX
                    XcmV4Instruction.BuyExecution({
                        fees: dotFeeAsset,
                        weight_limit: XcmV3WeightLimit.Unlimited()
                    }),
                    // 2b. Exchange DOT for HDX
                    XcmV4Instruction.ExchangeAsset({
                        give: dotAssetFilter,
                        want: [hdxAssetNew],
                        maximal: true
                    }),
                    // 2c. Deposit HDX to account on HydraDX
                    XcmV4Instruction.DepositAsset({
                        assets: hdxDepositFilter,
                        beneficiary: {
                            parents: 0,
                            interior: XcmV3Junctions.X1(
                                XcmV3Junction.AccountId32({
                                    network: undefined,
                                    id: Binary.fromBytes(aliceKeyPair.publicKey)
                                })
                            )
                        }
                    })
                ]
            })
        ]);
    // Query weight for XCM message
        const xcmWeight = await assetHubApi.apis.XcmPaymentApi.query_xcm_weight(message);

        if (xcmWeight.success) {
            // Execute XCM message on Asset Hub
            const tx = assetHubApi.tx.PolkadotXcm.execute({
                message: message,
                max_weight: {
                    ref_time: xcmWeight.value.ref_time,
                    proof_size: xcmWeight.value.proof_size
                }
            });

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

        // Wait a bit for the transaction to be processed
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
        //console.log(`- Alice DOT: ${finalHydraDxDotBalance?.free || 0n} planck`)
        //amount in DOT without planck
        console.log(`- Alice DOT: ${Number(finalHydraDxDotBalance?.free || 0n) / 1e10} DOT`)
        //console.log(`- Alice HDX: ${finalHydraDxHdxBalance.data.free || 0n} planck`)
        //amount in HDX without planck
        console.log(`- Alice HDX: ${Number(finalHydraDxHdxBalance.data.free || 0n) / 1e12} HDX`)
        console.log(`- DOT Change: ${(finalHydraDxDotBalance?.free || 0n) - (initialHydraDxDotBalance?.free || 0n)} planck`)
        console.log(`- HDX Change: ${(finalHydraDxHdxBalance.data.free || 0n) - (initialHydraDxHdxBalance.data.free || 0n)} planck`)
 */
    } catch (error) {
        console.error('Transaction error:', error);
    } finally {
        assetHubClient.destroy();
        hydraDxClient.destroy();
    }
}

// Function to perform XCM dry run
async function dryRunXcmMessage(
    api: any,
    originLocation: any,
    message: any,
    description: string
) {
    try {
        console.log(`\nPerforming dry run for ${description}...`);
        const dryRunResult = await api.apis.DryRunApi.dry_run_xcm({
            origin_location: originLocation,
            xcm: message
        });

        if ('success' in dryRunResult.value) {
            const result = dryRunResult.value;
            console.log(`${description} Dry Run Successful!`);
            console.log('Execution Result:', result.execution_result);
            if (result.emitted_events.length > 0) {
                console.log('Emitted Events:', result.emitted_events);
            }
            return true;
        } else {
            console.error(`${description} Dry Run Failed:`, dryRunResult.value);
            return false;
        }
    } catch (error) {
        console.error(`Error during ${description} dry run:`, error);
        return false;
    }
}


main().catch(console.error);


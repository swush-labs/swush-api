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
    XcmV4AssetAssetFilter
} from "@polkadot-api/descriptors"

// Constants
const TRANSFER_AMOUNT = 100_000_000_000_000n // 1 DOT in planck units
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
    const { api: assetHubApi, client: assetHubClient } = await connectPapi(XCM_RPC_ASSET_HUB, 'asset-hub')

    // Connect to HydraDX
    const { api: hydraDxApi, client: hydraDxClient } = await connectPapi(XCM_RPC_HYDRATION, 'hydration')

    try {
        const ALICE = ss58Encode(aliceKeyPair.publicKey, 0) // Asset Hub SS58 format
        const BOB = ss58Encode(bobKeyPair.publicKey, 63) // HydraDX SS58 format

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
            fun: XcmV3MultiassetFungibility.Fungible(0n) // Amount will be determined by swap
        };

        // Create fee assets
        // DOT fee for execution on HydraDX
        const dotFeeAsset = {
            id: {
                parents: 1, // Relay chain
                interior: XcmV3Junctions.Here()
            },
            fun: XcmV3MultiassetFungibility.Fungible(TRANSFER_AMOUNT / 10n) // 10% for fees
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

        // Create XCM message using V4 instructions
        const message = XcmVersionedXcm.V4([
            // 1. Withdraw DOT from Asset Hub
            XcmV4Instruction.WithdrawAsset([dotAsset]),

            // 2. Deposit to HydraDX with instructions
            XcmV4Instruction.DepositReserveAsset({
                assets: dotAssetFilter,
                dest: hydradxDest,
                xcm: [
                ]
            })
        ]);

        /*                     // 2c. Send HDX back to Asset Hub
                    XcmV4Instruction.DepositReserveAsset({
                        assets: assetFilter,
                        dest: assetHubDest,
                        xcm: [
                            // 2c.i. Pay for execution on Asset Hub
                            XcmV4Instruction.BuyExecution({
                                fees: hdxFeeAsset,
                                weight_limit: XcmV3WeightLimit.Unlimited()
                            }),
                            
                            // 2c.ii. Deposit to Bob
                            XcmV4Instruction.DepositAsset({
                                assets: assetFilter,
                                beneficiary: beneficiary
                            })
                        ]
                    }) */
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


        /*         // Check final DOT balance on Asset Hub
                const finalBalance = await assetHubApi.query.System.Account.getValue(ALICE);
                console.log(`Final DOT balance of Alice: ${finalBalance.data.free} planck (${Number(finalBalance.data.free) / 1e10} DOT)`);
                console.log(`Amount deducted: ${Number(initialBalance.data.free - finalBalance.data.free) / 1e10} DOT`);
        
                // Check HDX balance of Bob on Asset Hub
                try {
                    const bobTokensBalance = await assetHubApi.query.Assets.Account.getValue(HDX_ASSET_ID, BOB);
                    console.log(`HDX balance of Bob on Asset Hub: ${bobTokensBalance?.balance || 0n} planck`);
                } catch (error) {
                    console.error('Error checking HDX balance:', error);
                }
         */
        // Check final balances
        const finalAssetHubBalance = await assetHubApi.query.System.Account.getValue(ALICE)
        const finalHydraDxDotBalance = await hydraDxApi.query.Tokens.Accounts.getValue(BOB, DOT_ASSET_ID)
        const finalHydraDxHdxBalance = await hydraDxApi.query.System.Account.getValue(BOB)

        console.log('\nFinal Balances:')
        console.log('Asset Hub:')
        console.log(`- Alice DOT: ${finalAssetHubBalance.data.free} planck (${Number(finalAssetHubBalance.data.free) / 1e10} DOT)`)
        console.log(`- Amount deducted: ${Number(initialBalance.data.free - finalAssetHubBalance.data.free) / 1e10} DOT`)

        console.log('\nHydraDX:')
        console.log(`- Bob DOT: ${finalHydraDxDotBalance?.free || 0n} planck`)
        console.log(`- Bob HDX: ${finalHydraDxHdxBalance.data.free || 0n} planck`)
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
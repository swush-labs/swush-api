import { sr25519CreateDerive } from "@polkadot-labs/hdkd";
import {
    DEV_PHRASE,
    entropyToMiniSecret,
    KeyPair,
    mnemonicToEntropy,
    ss58Decode,
    ss58Encode
} from "@polkadot-labs/hdkd-helpers";
import { getPolkadotSigner } from "polkadot-api/signer";
import { TEST_RPC_ASSET_HUB, TEST_RPC_PARACHAIN_HYDRATION } from "../../../services/constants";
import { TransactionService } from '../../../services/network/TransactionService';
import { connectPapi } from "../../../services/network/types";
import {
    XcmVersionedLocation,
    XcmVersionedAssetId,
    XcmV3WeightLimit,
    XcmV3Junction,
    XcmV3Junctions,
    XcmV3MultiassetFungibility,
    XcmVersionedXcm,
    XcmV4Instruction,
    XcmV4AssetAssetFilter,
    XcmV4AssetWildAsset,
    PolkadotRuntimeOriginCaller,
} from "@polkadot-api/descriptors";
import { Binary } from "polkadot-api";
import { XcmFeeCalculator } from "./XcmFeeCalculator";
import { DryRunUtils } from './utils/DryRunUtils';
import { DOT_ASSET_ID } from './constants';

// Constants
const TRANSFER_AMOUNT = 200_000_000_000n; // 20 DOT in planck units
const HYDRADX_PARA_ID = 2034;
const ASSET_HUB_PARA_ID = 1000;
const BUFFER_PERCENTAGE = 120n;

async function main() {
    // Initialize signers
    const miniSecret = entropyToMiniSecret(mnemonicToEntropy(DEV_PHRASE));
    const derive = sr25519CreateDerive(miniSecret);
    const aliceKeyPair = derive("//Alice");
    const bobKeyPair = derive("//Bob");
    const alice = getPolkadotSigner(aliceKeyPair.publicKey, "Sr25519", aliceKeyPair.sign);

    // Connect to chains
    const { api: assetHubApi, client: assetHubClient } = await connectPapi(TEST_RPC_ASSET_HUB, 'asset-hub');
    const { api: hydraDxApi, client: hydraDxClient } = await connectPapi(TEST_RPC_PARACHAIN_HYDRATION, 'hydration');

    try {
        // Setup addresses
        const ALICE = ss58Encode(aliceKeyPair.publicKey, 0);
        const BOB = ss58Encode(bobKeyPair.publicKey, 63);
        console.log("Alice address (Asset Hub):", ALICE);
        console.log("Bob address (HydraDX):", BOB);

        // Check initial balances
        const initialBalance = await assetHubApi.query.System.Account.getValue(ALICE);
        console.log('\nInitial Balance on Asset Hub:');
        console.log(`Alice DOT: ${Number(initialBalance.data.free) / 1e10} DOT`);

        if (initialBalance.data.free < TRANSFER_AMOUNT) {
            throw new Error(`Insufficient balance. Have ${Number(initialBalance.data.free) / 1e10} DOT, need ${Number(TRANSFER_AMOUNT) / 1e10} DOT`);
        }

        // Helper function to create beneficiary location
        const beneficiary = (keypair: KeyPair) => ({
            parents: 0,
            interior: XcmV3Junctions.X1(
                XcmV3Junction.AccountId32({
                    network: undefined,
                    id: Binary.fromBytes(keypair.publicKey)
                })
            )
        });

        // Create locations
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

        // Define the USDT asset we want to receive
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

        // Create the XCM message (with placeholder fees that will be updated)
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
                dest: hydradxDest,
                xcm: [
                    XcmV4Instruction.BuyExecution({
                        fees: {
                            id: {
                                parents: 1,
                                interior: XcmV3Junctions.Here()
                            },
                            fun: XcmV3MultiassetFungibility.Fungible(0n) // Will be updated
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
                        want: [usdtAsset],
                        maximal: true
                    }),
                    XcmV4Instruction.InitiateReserveWithdraw({
                        assets: XcmV4AssetAssetFilter.Wild(XcmV4AssetWildAsset.All()),
                        reserve: assetHubDest,
                        xcm: [
                            XcmV4Instruction.BuyExecution({
                                fees: {
                                    id: {
                                        parents: 1,
                                        interior: XcmV3Junctions.Here()
                                    },
                                    fun: XcmV3MultiassetFungibility.Fungible(TRANSFER_AMOUNT) // Will be updated
                                },
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

        // Initialize fee calculator
        // const feeCalculator = new XcmFeeCalculator(
        //     assetHubApi,
        //     hydraDxApi,
        //     { bufferPercentage: BUFFER_PERCENTAGE }
        // );

        // Initialize DryRunUtils
        const dryRunUtils = new DryRunUtils(assetHubApi, Number(BUFFER_PERCENTAGE));

        // Create origin location for Asset Hub
        const assetHubOrigin = XcmVersionedLocation.V4({
            parents: 1,
            interior: XcmV3Junctions.X1(
                XcmV3Junction.Parachain(ASSET_HUB_PARA_ID)
            )
        });

        // Calculate fees and update message
        console.log("\nCalculating fees and updating message...");
        // const fees = await feeCalculator.calculateMultiHopFees(
        //     message,
        //     XcmVersionedLocation.V4({
        //         parents: 0,
        //         interior: XcmV3Junctions.X1(
        //             XcmV3Junction.AccountId32({
        //                 network: undefined,
        //                 id: Binary.fromBytes(aliceKeyPair.publicKey)
        //             })
        //         )
        //     }),
        //     HYDRADX_PARA_ID,
        //     ASSET_HUB_PARA_ID
        // );

        // console.log("Fees:", fees);

        // Perform dry run for the XCM message
        const dryRunResult = await dryRunUtils.dryRunXcmMessage(
            assetHubOrigin,
            message,
            "Asset Hub to HydraDX Transfer"
        );

        console.log("Dry run result:", dryRunResult);

      /*   // Validate dry run results
        const { isValid, details, warnings } = dryRunUtils.validateDryRunResult(dryRunResult);
        
        if (!isValid) {
            console.error("Dry run validation failed:", details);
            if (warnings.length > 0) {
                console.warn("Warnings:", warnings);
            }
            throw new Error("Dry run validation failed");
        }

        if (warnings.length > 0) {
            console.warn("Warnings:", warnings);
        }

        // Estimate XCM fees
        const xcmFees = await dryRunUtils.estimateXcmFees(message, DOT_ASSET_ID);
        if (!xcmFees) {
            throw new Error("Failed to estimate XCM fees");
        }

        console.log("\nFee Breakdown:");
        console.log(`- Execution Fee: ${Number(xcmFees.executionFee) / 1e10} DOT`);
        console.log(`- Delivery Fee: ${Number(xcmFees.deliveryFee) / 1e10} DOT`);
        console.log(`- Total with Buffer: ${Number(xcmFees.totalWithBuffer) / 1e10} DOT`);
 */
      /*   // Execute XCM message
        console.log("\nExecuting XCM message...");
        const tx = assetHubApi.tx.PolkadotXcm.execute({
            message: message,
            max_weight: {
                ref_time: 10000000000n,
                proof_size: 100000n
            }
        });

        // Submit and watch the transaction
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

        // Wait for finalization
        await new Promise(resolve => setTimeout(resolve, 10000));

        // Check final balances
        const finalBalance = await assetHubApi.query.System.Account.getValue(ALICE);
        console.log('\nFinal Balance on Asset Hub:');
        console.log(`Alice DOT: ${Number(finalBalance.data.free) / 1e10} DOT`);
        console.log(`Total DOT spent: ${Number(initialBalance.data.free - finalBalance.data.free) / 1e10} DOT`);
    */ } catch (error) {
        console.error('Error:', error);
    } finally {
        assetHubClient.destroy();
        hydraDxClient.destroy();
    }
}

main().catch(console.error); 
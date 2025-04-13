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
                                    fun: XcmV3MultiassetFungibility.Fungible(0n) // Will be updated
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
        const feeCalculator = new XcmFeeCalculator(
            assetHubApi,
            hydraDxApi,
            { bufferPercentage: BUFFER_PERCENTAGE }
        );

        // Calculate fees and update message
        console.log("\nCalculating fees and updating message...");
        const fees = await feeCalculator.calculateMultiHopFees(
            message,
            XcmVersionedLocation.V4({
                parents: 0,
                interior: XcmV3Junctions.X1(
                    XcmV3Junction.AccountId32({
                        network: undefined,
                        id: Binary.fromBytes(aliceKeyPair.publicKey)
                    })
                )
            }),
            HYDRADX_PARA_ID,
            ASSET_HUB_PARA_ID);

        console.log("Fees:", fees);
        
/*         const { updatedMessage, fees } = await feeCalculator.calculateFeesAndUpdateMessage(
            message,
            XcmVersionedLocation.V4({
                parents: 0,
                interior: XcmV3Junctions.X1(
                    XcmV3Junction.AccountId32({
                        network: undefined,
                        id: Binary.fromBytes(aliceKeyPair.publicKey)
                    })
                )
            }),
            HYDRADX_PARA_ID,
            ASSET_HUB_PARA_ID
        );

        // Log fee breakdown
        console.log("\nFee Breakdown:");
        console.log("First Hop (Asset Hub -> HydraDX):");
        console.log(`- Execution Fee: ${Number(fees.firstHopFees.executionFee) / 1e10} DOT`);
        console.log(`- Delivery Fee: ${Number(fees.firstHopFees.deliveryFee) / 1e10} DOT`);
        console.log(`- Total with Buffer: ${Number(fees.firstHopFees.totalWithBuffer) / 1e10} DOT`);
        
        console.log("\nReturn Hop (HydraDX -> Asset Hub):");
        console.log(`- Execution Fee: ${Number(fees.returnHopFees.executionFee) / 1e10} DOT`);
        console.log(`- Delivery Fee: ${Number(fees.returnHopFees.deliveryFee) / 1e10} DOT`);
        console.log(`- Total with Buffer: ${Number(fees.returnHopFees.totalWithBuffer) / 1e10} DOT`);
        
        console.log("\nTotal Fees Required:", Number(fees.totalFeesRequired) / 1e10, "DOT");

        // Execute XCM message
        console.log("\nExecuting XCM message...");
        const tx = assetHubApi.tx.PolkadotXcm.execute({
            message: updatedMessage,
            max_weight: {
                ref_time: 10000000000n,
                proof_size: 100000n
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

        if (!dryRun.success) {
            console.error("Dry run failed:", dryRun);
            throw new Error("Dry run failed");
        }

        console.log("Dry run successful, submitting transaction...");

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
 */
    } catch (error) {
        console.error('Error:', error);
    } finally {
        assetHubClient.destroy();
        hydraDxClient.destroy();
    }
}

main().catch(console.error); 
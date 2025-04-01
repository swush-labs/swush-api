import { sr25519CreateDerive } from "@polkadot-labs/hdkd"
import {
  DEV_PHRASE,
  entropyToMiniSecret,
  mnemonicToEntropy,
  ss58Decode,
  ss58Encode
} from "@polkadot-labs/hdkd-helpers"
import { getPolkadotSigner } from "polkadot-api/signer"
import { TEST_RPC_ASSET_HUB, TEST_RPC_PARACHAIN_HYDRATION } from "../../../services/constants"
import { TransactionService } from '../../../services/network/TransactionService';
import { connectPapi } from "../../../services/network/types";
import { Enum } from "polkadot-api";

// Constants
const TRANSFER_AMOUNT = 100_000_000_000_000n // 1 DOT in planck units
const HDX_ASSET_ID = 0 // HDX token ID in HydraDX
const DOT_ASSET_ID = 1 // DOT token ID in HydraDX (example, adjust as needed)
const HYDRADX_PARA_ID = 2034 // HydraDX parachain ID
const SLIPPAGE_TOLERANCE = 5 // 5% slippage tolerance

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
 * Example of using transfer_assets_using_type_and_then to transfer assets 
 * from Asset Hub to HydraDX and execute an Omnipool swap
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

        console.log("Alice address (Asset Hub):", ALICE)
        console.log("Bob address (HydraDX):", BOB)

        // Check DOT balance on Asset Hub
        const initialBalance = await assetHubApi.query.System.Account.getValue(ALICE)
        const dotBalance = Number(initialBalance.data.free) / 1e10
        
        console.log('Transfer details:')
        console.log(`- Amount to transfer: ${Number(TRANSFER_AMOUNT) / 1e10} DOT (${TRANSFER_AMOUNT} planck)`)
        console.log(`- Available balance: ${dotBalance} DOT (${initialBalance.data.free} planck)`)

        // Check if we have enough balance
        if (initialBalance.data.free < TRANSFER_AMOUNT) {
            throw new Error(`Insufficient balance. Have ${dotBalance} DOT, trying to transfer ${Number(TRANSFER_AMOUNT) / 1e10} DOT`)
        }

        // Calculate minimum amount out with slippage tolerance
        const minBuyAmount = TRANSFER_AMOUNT * BigInt(100 - SLIPPAGE_TOLERANCE) / 100n

        // Get the encoded Omnipool.sell call
        const encodedOmnipoolSell = hydraDxApi.tx.Omnipool.sell({
            asset_in: DOT_ASSET_ID,
            asset_out: HDX_ASSET_ID,
            amount: TRANSFER_AMOUNT,
            min_buy_amount: minBuyAmount
        });

        // Create the transaction
        const tx = assetHubApi.tx.PolkadotXcm.transfer_assets_using_type_and_then({
            assets: assets,
            assets_transfer_type: Enum("RemoteReserve", destination),
            custom_xcm_on_dest: customXcm,
            dest: destination,
            fees_transfer_type: Enum("RemoteReserve", destination),
            remote_fees_id: remoteFeesId,
            weight_limit: Enum("Unlimited", null)
        });

        console.log("Submitting XCM transfer with Omnipool swap transaction...")
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

        // Wait a bit for the transaction to be processed
        await new Promise(resolve => setTimeout(resolve, 5000));

        // Check final DOT balance on Asset Hub
        const finalBalance = await assetHubApi.query.System.Account.getValue(ALICE)
        console.log(`Final DOT balance of Alice: ${finalBalance.data.free} planck (${Number(finalBalance.data.free) / 1e10} DOT)`)
        console.log(`Amount deducted: ${Number(initialBalance.data.free - finalBalance.data.free) / 1e10} DOT`)

        // Check HDX balance on HydraDX
        try {
            const hdxBalance = await hydraDxApi.query.Tokens.Accounts.getValue(BOB, HDX_ASSET_ID)
            console.log(`HDX balance of Bob: ${hdxBalance.free} planck (${Number(hdxBalance.free) / 1e12} HDX)`)
        } catch (error) {
            console.error('Error checking HDX balance:', error)
        }

    } catch (error) {
        console.error('Transaction error:', error);
    } finally {
        assetHubClient.destroy()
        hydraDxClient.destroy()
    }
}

main().catch(console.error) 
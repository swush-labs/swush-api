import { sr25519CreateDerive } from "@polkadot-labs/hdkd"
import {
  DEV_PHRASE,
  entropyToMiniSecret,
  mnemonicToEntropy,
  ss58Encode
} from "@polkadot-labs/hdkd-helpers"
import { getPolkadotSigner } from "polkadot-api/signer"
import { TEST_RPC_PARACHAIN_HYDRATION } from "../../../services/constants"
import { TransactionService } from '../../../services/network/TransactionService';
import { connectPapi } from "../../../services/network/types";

// Constants
const SWAP_AMOUNT = 100_000_000_000_000n // 1 DOT in planck units
const HDX_ASSET_ID = 0 // HDX token ID in Hydration
const DOT_ASSET_ID = 5 // DOT token ID in Hydration (adjust as needed)
const SLIPPAGE_TOLERANCE = 5 // 5% slippage tolerance

/**
 * Example of using Omnipool.sell to swap DOT for HDX
 */
async function main() {
    // Initialize signer
    const miniSecret = entropyToMiniSecret(mnemonicToEntropy(DEV_PHRASE))
    const derive = sr25519CreateDerive(miniSecret)
    const aliceKeyPair = derive("//Alice")
    const alice = getPolkadotSigner(
        aliceKeyPair.publicKey,
        "Sr25519",
        aliceKeyPair.sign,
    )

    // Connect to Hydration
    const { api, client } = await connectPapi(TEST_RPC_PARACHAIN_HYDRATION, 'hydration')

    try {
        const ALICE = ss58Encode(aliceKeyPair.publicKey, 63) // Hydration SS58 format
        console.log("Alice address:", ALICE)

        // Check DOT balance
        const initialDotBalance = await api.query.Tokens.Accounts.getValue(ALICE, DOT_ASSET_ID)
        const dotBalance = Number(initialDotBalance.free) / 1e10
        
        console.log('Swap details:')
        console.log(`- Amount to swap: ${Number(SWAP_AMOUNT) / 1e10} DOT (${SWAP_AMOUNT} planck)`)
        console.log(`- Available DOT balance: ${dotBalance} DOT (${initialDotBalance.free} planck)`)

        // Check HDX balance before swap
        const initialHdxBalance = await api.query.Tokens.Accounts.getValue(ALICE, HDX_ASSET_ID)
        console.log(`- Initial HDX balance: ${Number(initialHdxBalance.free) / 1e12} HDX (${initialHdxBalance.free} planck)`)

        // Check if we have enough balance
        if (initialDotBalance.free < SWAP_AMOUNT) {
            throw new Error(`Insufficient balance. Have ${dotBalance} DOT, trying to swap ${Number(SWAP_AMOUNT) / 1e10} DOT`)
        }

        // Calculate minimum amount out with slippage tolerance
        const minBuyAmount = SWAP_AMOUNT * BigInt(100 - SLIPPAGE_TOLERANCE) / 100n

        // Create Omnipool swap transaction
        console.log("Creating Omnipool sell transaction...")
        const sellTx = api.tx.Omnipool.sell({
            asset_in: DOT_ASSET_ID,
            asset_out: HDX_ASSET_ID,
            amount: SWAP_AMOUNT,
            min_buy_amount: minBuyAmount
        })
        
        console.log("Submitting Omnipool sell transaction...")
        await TransactionService.submitAndWatch(sellTx, alice, {
            onSuccess: (status) => {
                console.log(`Omnipool swap successful in block ${status.blockNumber}`);
            },
            onError: (error) => {
                console.error('Omnipool swap failed:', error);
            },
            onStatusChange: (status) => {
                console.log('Omnipool swap status:', status);
            }
        });
        

        // Wait a bit for the transaction to be processed
        await new Promise(resolve => setTimeout(resolve, 5000));

        // Check final balances
        const finalDotBalance = await api.query.Tokens.Accounts.getValue(ALICE, DOT_ASSET_ID)
        const finalHdxBalance = await api.query.Tokens.Accounts.getValue(ALICE, HDX_ASSET_ID)
        
        console.log('Swap results:')
        console.log(`- Final DOT balance: ${Number(finalDotBalance.free) / 1e10} DOT (${finalDotBalance.free} planck)`)
        console.log(`- DOT spent: ${Number(initialDotBalance.free - finalDotBalance.free) / 1e10} DOT`)
        console.log(`- Final HDX balance: ${Number(finalHdxBalance.free) / 1e12} HDX (${finalHdxBalance.free} planck)`)
        console.log(`- HDX received: ${Number(finalHdxBalance.free - initialHdxBalance.free) / 1e12} HDX`)

    } catch (error) {
        console.error('Transaction error:', error);
    } finally {
        client.destroy()
    }
}

main().catch(console.error) 
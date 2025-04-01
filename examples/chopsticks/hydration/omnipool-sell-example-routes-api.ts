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
import { BigNumber, PoolService, TradeRouter } from '@galacticcouncil/sdk';
import { connectPolkadotjs } from '../../../services/network/types';
import { Binary } from 'polkadot-api';
import { HydrationApi } from '../../../services/network/hydration-types';

// Constants
const SWAP_AMOUNT = 10_000_000_000n // 0.1 DOT in planck units (reduced from 1 DOT)
const AMOUNT_OUT = 30 // HDX token ID in Hydration
const AMOUNT_IN = 5 // DOT token ID in Hydration (adjust as needed)
const SLIPPAGE_TOLERANCE = 10 // 10% slippage tolerance
const minBuyAmount = SWAP_AMOUNT * BigInt(100 - SLIPPAGE_TOLERANCE) / 100n
/**
 * Example of using TradeRouter to find best sell route and execute the swap
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
        const initialDotBalance = await api.query.Tokens.Accounts.getValue(ALICE, AMOUNT_IN)
        const dotBalance = Number(initialDotBalance.free) / 1e10
        
        console.log('Swap details:')
        console.log(`- Amount to swap: ${Number(SWAP_AMOUNT) / 1e10} DOT (${SWAP_AMOUNT} planck)`)
        console.log(`- Available DOT balance: ${dotBalance} DOT (${initialDotBalance.free} planck)`)

        // Check HDX balance before swap
        const initialHdxBalance = await api.query.Tokens.Accounts.getValue(ALICE, AMOUNT_OUT)
        console.log(`- Initial HDX balance: ${Number(initialHdxBalance.free) / 1e12} HDX (${initialHdxBalance.free} planck)`)

        // Check if we have enough balance
        if (initialDotBalance.free < SWAP_AMOUNT) {
            throw new Error(`Insufficient balance. Have ${dotBalance} DOT, trying to swap ${Number(SWAP_AMOUNT) / 1e10} DOT`)
        }

        await getBestSellRoute(alice, api);

        // Wait a bit for the transaction to be processed
        await new Promise(resolve => setTimeout(resolve, 5000));

        // Check final balances
        const finalDotBalance = await api.query.Tokens.Accounts.getValue(ALICE, AMOUNT_IN)
        const finalHdxBalance = await api.query.Tokens.Accounts.getValue(ALICE, AMOUNT_OUT)
        
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

async function getBestSellRoute(alice: any, api: HydrationApi) {
    // const pjsApi = await connectPolkadotjs(TEST_RPC_PARACHAIN_HYDRATION);
    // const poolService = new PoolService(pjsApi);
    // const tradeRouter = new TradeRouter(poolService);
    
    // // Get best sell route for DOT to HDX
    // console.log("Getting best sell route...")
    // const trade = await tradeRouter.getBestSell(
    //     DOT_ASSET_ID.toString(),  // asset_in
    //     HDX_ASSET_ID.toString(),  // asset_out
    //     1000000000
    // );
    // console.log("Best sell route:", trade.toHuman());

    // Get route from storage
    // const routes = await getRouteStorage(api);
    // const route = routes.find(r => 
    //     r.keyArgs[0].asset_in === DOT_ASSET_ID && 
    //     r.keyArgs[0].asset_out === HDX_ASSET_ID
    // );
    
    // if (!route) {
    //     throw new Error(`No route found for ${DOT_ASSET_ID} -> ${HDX_ASSET_ID}`);
    // }
    
    // console.log("Found route:", jsonStringify(route.value));

    const txParams = {
        asset_in: 5,
        asset_out: 10,
        amount_in: 10000000000n,
        min_amount_out: 9000000000n,
        route: []
    };
    
    console.log("Transaction parameters:", jsonStringify(txParams));

    // Create the sell transaction with route
    const tx = api.tx.Router.sell(txParams);
    
    console.log("Submitting trade transaction...")
    await TransactionService.submitAndWatch(tx, alice, {
        onSuccess: (status) => {
            console.log(`Trade successful in block ${status.blockNumber}`);
        },
        onError: (error) => {
            console.error('Trade failed:', error);
        },
        onStatusChange: (status) => {
            console.log('Trade status:', status);
        }
    });

    // // Cleanup polkadot.js API connection
    // await pjsApi.disconnect();
}

async function getRouteStorage(api: HydrationApi) {
    const routeStorage = await api.query.Router.Routes.getEntries();
    console.log("All routes:", routeStorage);
    return routeStorage;
}

//json stringify includes bigint
function jsonStringify(obj: any) {
    return JSON.stringify(obj, (key, value) => typeof value === 'bigint' ? value.toString() : value);
}
main().catch(console.error)

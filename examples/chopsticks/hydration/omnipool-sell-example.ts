import { TEST_RPC_PARACHAIN_HYDRATION } from "../../../services/constants"
import { TransactionService } from '../../../services/network/TransactionService';
import { connectPapi } from "../../../services/network/types";
import { BigNumber, PoolService, TradeRouter } from '@galacticcouncil/sdk';
import { connectPolkadotjs } from '../../../services/network/types';
import { Binary } from 'polkadot-api';
import { 
    WSManager, 
    initSigners, 
    produceBlocksAndWait,
    checkBalances,
    formatBalanceChanges,
    DOT_ASSET_ID,
    HDX_ASSET_ID
} from '../../../services/network/hydration/utils';
import { ss58Encode } from "@polkadot-labs/hdkd-helpers";
import { HydrationApi } from '../../../services/network/hydration-types';

// Constants
const SWAP_AMOUNT = 10_000_000_000n // 0.1 DOT in planck units
const SLIPPAGE_TOLERANCE = 10 // 10% slippage tolerance
const minBuyAmount = SWAP_AMOUNT * BigInt(100 - SLIPPAGE_TOLERANCE) / 100n

/**
 * Example of using TradeRouter to find best sell route and execute the swap
 */
async function main() {
    // Initialize WebSocket manager and signers
    const wsManager = new WSManager();
    wsManager.connect(TEST_RPC_PARACHAIN_HYDRATION, 'Hydration');
    
    const { alice, aliceKeyPair } = initSigners();

    // Connect to Hydration
    const { api, client } = await connectPapi(TEST_RPC_PARACHAIN_HYDRATION, 'hydration')

    try {
        const ALICE = ss58Encode(aliceKeyPair.publicKey, 63) // Hydration SS58 format
        console.log("Alice address:", ALICE)

        // Check initial balances
        const initialBalances = await checkBalances(api, ALICE);
        
        console.log('Swap details:')
        console.log(`- Amount to swap: ${Number(SWAP_AMOUNT) / 1e10} DOT (${SWAP_AMOUNT} planck)`)
        console.log(`- Available DOT balance: ${initialBalances.dot.freeFormatted} DOT (${initialBalances.dot.free} planck)`)
        console.log(`- Initial HDX balance: ${initialBalances.hdx.freeFormatted} HDX (${initialBalances.hdx.free} planck)`)

        // Check if we have enough balance
        if (initialBalances.dot.free < SWAP_AMOUNT) {
            throw new Error(`Insufficient balance. Have ${initialBalances.dot.freeFormatted} DOT, trying to swap ${Number(SWAP_AMOUNT) / 1e10} DOT`)
        }

        await getBestSellRoute(alice, api, wsManager);

        // Check final balances
        const finalBalances = await checkBalances(api, ALICE);
        const dotChanges = formatBalanceChanges(initialBalances.dot.free, finalBalances.dot.free, 10);
        const hdxChanges = formatBalanceChanges(initialBalances.hdx.free, finalBalances.hdx.free, 12);
        
        console.log('Swap results:')
        console.log(`- Final DOT balance: ${finalBalances.dot.freeFormatted} DOT`)
        console.log(`- DOT spent: ${dotChanges.change} DOT`)
        console.log(`- Final HDX balance: ${finalBalances.hdx.freeFormatted} HDX`)
        console.log(`- HDX received: ${hdxChanges.change} HDX`)

    } catch (error) {
        console.error('Transaction error:', error);
    } finally {
        client.destroy();
        wsManager.close();
    }
}

async function getBestSellRoute(alice: any, api: HydrationApi, wsManager: WSManager) {
    const pjsApi = await connectPolkadotjs(TEST_RPC_PARACHAIN_HYDRATION);
    const poolService = new PoolService(pjsApi);
    const tradeRouter = new TradeRouter(poolService);
    
    // Get best sell route for DOT to HDX
    console.log("Getting best sell route...")
    const trade = await tradeRouter.getBestSell(
        DOT_ASSET_ID.toString(),  // asset_in
        HDX_ASSET_ID.toString(),  // asset_out
        Number(SWAP_AMOUNT)  // Convert bigint to number for SDK
    );
    console.log("Best sell route:", trade.toHuman());

    // Get route from storage
    const routes = await api.query.Router.Routes.getEntries();
    const route = routes.find(r => 
        r.keyArgs[0].asset_in === DOT_ASSET_ID && 
        r.keyArgs[0].asset_out === HDX_ASSET_ID
    );
    
    if (!route) {
        throw new Error(`No route found for ${DOT_ASSET_ID} -> ${HDX_ASSET_ID}`);
    }
    
    console.log("Found route:", JSON.stringify(route.value, null, 2));

    const txParams = {
        asset_in: DOT_ASSET_ID,
        asset_out: HDX_ASSET_ID,
        amount_in: SWAP_AMOUNT,
        min_amount_out: minBuyAmount,
        route: route.value
    };
    
    console.log("Transaction parameters:", JSON.stringify(txParams, null, 2));

    // Create the sell transaction with route
    const tx = api.tx.Router.sell(txParams);

    //print tx simulation
    console.log("Simulation:", await tx.getPaymentInfo(alice));
    
    console.log("Submitting trade transaction...")
    await TransactionService.submitAndWatch(tx, alice, {
        onSuccess: async (status) => {
            console.log(`Trade successful in block ${status.blockNumber}`);
            await produceBlocksAndWait(wsManager);
        },
        onError: (error) => {
            console.error('Trade failed:', error);
        },
        onStatusChange: (status) => {
            console.log('Trade status:', status);
        }
    });

    // Cleanup polkadot.js API connection
    await pjsApi.disconnect();
}

main().catch(console.error)
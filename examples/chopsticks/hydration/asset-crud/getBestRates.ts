// Import
import { ApiPromise, WsProvider } from '@polkadot/api';
import { TradeRouter, PoolService, PoolType, BigNumber } from '@galacticcouncil/sdk';
import { base, degen } from './external'


/**
 * Step-by-step logic:
When you want to trade USDC → DOT:

If you know how much USDC you want to spend = use sell
If you know how much DOT you want to receive = use buy
The methods are:

sell(assetIn, assetOut, amountIn) - You specify how much you're spending (USDC)
buy(assetIn, assetOut, amountOut) - You specify how much you want to receive (DOT)
Recommendation:
Most users prefer sell since they usually know how much they want to spend. Here's how to use it:
 * 
 */

async function main() {
    // Initialize Polkadot API
    const wsProvider = new WsProvider('wss://rpc.hydradx.cloud');
    //local
    // const wsProvider = new WsProvider('ws://localhost:3422');
    const api = await ApiPromise.create({ provider: wsProvider });

    // Initialize Trade Router
    const poolService = new PoolService(api);

    // Combine base and degen arrays and pass to syncRegistry
    const externalAssets = [...base, ...degen];
    await poolService.syncRegistry(externalAssets);

    const tradeRouter = new TradeRouter(poolService);

    // Sell 5 DOT(5) for USDT(10)
    // const trade = await tradeRouter.getBestSell('10', '5', '2');

    // Buy 5 DOT(5) for MYTH(30)
    const trade = await tradeRouter.getBestBuy('5', '1000021', '2');


    console.log('Trade details:');
    console.log('Trade:', trade.toHuman());

    //close the api
    await api.disconnect();
}

main().catch(console.error);
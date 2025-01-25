// Import
import { ApiPromise, WsProvider } from '@polkadot/api';
import { TradeRouter, PoolService, PoolType } from '@galacticcouncil/sdk';


async function main() {
    // Initialize Polkadot API
    const wsProvider = new WsProvider('wss://rpc.hydradx.cloud');
    const api = await ApiPromise.create({ provider: wsProvider });

    // Initialize Trade Router
    const poolService = new PoolService(api);
    await poolService.syncRegistry(); // Wait until pools initialized (optional), fallback to lazy init
    const tradeRouter = new TradeRouter(poolService);

    const pools = await tradeRouter.getPools();


    //close the api
    await api.disconnect();
}

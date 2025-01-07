// services/DataFetcher.ts
import RpcConnection from './RpcConnection';
import CacheManager from '../cache/CacheManager';

class DataFetcher {
  private rpcUrl: string;

  constructor(rpcUrl: string) {
    this.rpcUrl = rpcUrl;
  } 

  public async fetchBalances(): Promise<void> {
    const api = await RpcConnection.getInstance().connect(this.rpcUrl);
    const balances = await api.query.balances.totalIssuance(); // Example API call
    const cache = CacheManager.getInstance();
    cache.set('balances', balances.toHuman());
    console.log('Balances fetched and cached:', balances.toHuman());
  }

  public async fetchPoolData(): Promise<void> {
    const api = await RpcConnection.getInstance().connect(this.rpcUrl);
    const pools = await api.query.nominationPools.totalValueLocked(); // Example API call
    const cache = CacheManager.getInstance();
    cache.set('pools', pools.toHuman());
    console.log('Pools fetched and cached:', pools.toHuman());
  }

  public async refreshCache(): Promise<void> {
    await Promise.all([this.fetchBalances(), this.fetchPoolData()]);
  }
}

export default DataFetcher;

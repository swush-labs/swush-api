// services/RpcConnection.ts
import { ApiPromise, WsProvider } from '@polkadot/api';

class RpcConnection {
  private static instance: RpcConnection;
  private api: ApiPromise | null = null;
  private currentUrl: string | null = null;

  private constructor() {}

  public static getInstance(): RpcConnection {
    if (!RpcConnection.instance) {
      RpcConnection.instance = new RpcConnection();
    }
    return RpcConnection.instance;
  }

  public async connect(rpcUrl: string): Promise<ApiPromise> {
    if (!this.api || this.currentUrl !== rpcUrl) {
      const provider = new WsProvider(rpcUrl);
      this.api = await ApiPromise.create({ provider });
      this.currentUrl = rpcUrl;
      console.log(`Connected to ${rpcUrl}`);
    }
    return this.api;
  }

  public getApi(): ApiPromise | null {
    return this.api;
  }
}

export default RpcConnection;

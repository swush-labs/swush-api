// services/RpcConnection.ts
import { ApiPromise, WsProvider } from '@polkadot/api';

class RpcConnection {
  private static instance: RpcConnection;
  private api: ApiPromise | null = null;

  private constructor() {}

  public static getInstance(): RpcConnection {
    if (!RpcConnection.instance) {
      RpcConnection.instance = new RpcConnection();
    }
    return RpcConnection.instance;
  }

  public async connect(rpcUrl: string): Promise<ApiPromise> {
    if (!this.api) {
      const provider = new WsProvider(rpcUrl);
      this.api = await ApiPromise.create({ provider });
      console.log(`Connected to ${rpcUrl}`);
    }
    return this.api;
  }

  public getApi(): ApiPromise | null {
    return this.api;
  }
}

export default RpcConnection;

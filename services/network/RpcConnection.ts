// services/RpcConnection.ts
import { ApiPromise, WsProvider } from '@polkadot/api';
import { createClient, TypedApi } from 'polkadot-api';
import { getWsProvider } from 'polkadot-api/ws-provider/node';
import { withPolkadotSdkCompat } from 'polkadot-api/polkadot-sdk-compat';
import { polkadot_asset_hub } from '@polkadot-api/descriptors';

/**
 * Example usage:
 * 
 * // Using Polkadot API
const polkadotConn = RpcConnection.getInstance('polkadotjs');
await polkadotConn.connect('wss://your-endpoint');
const polkadotApi = polkadotConn.getApi();

// Using PAPI
const papiConn = RpcConnection.getInstance('papi');
await papiConn.connect('wss://your-endpoint');
const papiApi = papiConn.getApi();
 * 
 */

type ApiType = 'polkadotjs' | 'papi';

interface IApiWrapper {
  connect(rpcUrl: string): Promise<ApiPromise | TypedApi<any>>;
  getApi(): ApiPromise | TypedApi<any> | null;
}

class PolkadotApiWrapper implements IApiWrapper {
  private api: ApiPromise | null = null;
  private currentUrl: string | null = null;

  async connect(rpcUrl: string): Promise<ApiPromise> {
    try {
      if (!this.api || this.currentUrl !== rpcUrl) {
        const provider = new WsProvider(rpcUrl);
        this.api = await ApiPromise.create({ provider });
        this.currentUrl = rpcUrl;
        console.log(`Connected to ${rpcUrl} using Polkadot API`);
      }
      return this.api;
    } catch (error) {
      console.error(`Failed to connect to ${rpcUrl} using Polkadot API:`, error);
      throw new Error(`Connection failed: ${error.message}`);
    }
  }

  getApi(): ApiPromise | null {
    return this.api;
  }
}

class PapiWrapper implements IApiWrapper {
  private client: ReturnType<typeof createClient> | null = null;
  private typedApi: TypedApi<any> | null = null;
  private currentUrl: string | null = null;

  async connect(rpcUrl: string): Promise<TypedApi<any>> {
    try {
      if (!this.client || this.currentUrl !== rpcUrl) {
        this.client = createClient(
          withPolkadotSdkCompat(getWsProvider(rpcUrl))
        );
        this.typedApi = this.client.getTypedApi(polkadot_asset_hub);
        this.currentUrl = rpcUrl;
        console.log(`Connected to ${rpcUrl} using PAPI`);
      }
      if (!this.typedApi) {
        throw new Error('Failed to initialize PAPI client');
      }
      return this.typedApi;
    } catch (error) {
      console.error(`Failed to connect to ${rpcUrl} using PAPI:`, error);
      throw new Error(`Connection failed: ${error.message}`);
    }
  }

  getApi(): TypedApi<any> | null {
    return this.typedApi;
  }
}

class RpcConnection {
  private static instances: Map<ApiType, RpcConnection> = new Map();
  private apiWrapper: IApiWrapper;

  private constructor(apiType: ApiType) {
    this.apiWrapper = apiType === 'polkadotjs' 
      ? new PolkadotApiWrapper() 
      : new PapiWrapper();
  }

  public static getInstance(apiType: ApiType): RpcConnection {
    if (!this.instances.has(apiType)) {
      this.instances.set(apiType, new RpcConnection(apiType));
    }
    return this.instances.get(apiType)!;
  }

  // For testing purposes
  public static clearInstances(): void {
    this.instances.clear();
  }

  public async connect(rpcUrl: string): Promise<ApiPromise | TypedApi<any>> {
    return this.apiWrapper.connect(rpcUrl);
  }

  public getApi(): ApiPromise | TypedApi<any> | null {
    return this.apiWrapper.getApi();
  }
}

export default RpcConnection;



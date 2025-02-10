// services/RpcConnection.ts
import { ApiPromise, WsProvider } from '@polkadot/api';
import { createClient, PolkadotClient, TypedApi } from 'polkadot-api';
import { getWsProvider } from 'polkadot-api/ws-provider/node';
import { withPolkadotSdkCompat } from 'polkadot-api/polkadot-sdk-compat';
import { polkadot_asset_hub, polkadot, hydration } from '@polkadot-api/descriptors';

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

type ApiReturnType = ApiPromise | TypedApi<any> | { api: TypedApi<any>, client: PolkadotClient };

interface IApiWrapper {
  connect(rpcUrl: string, chainType?: 'asset-hub' | 'polkadot' | 'hydration'): Promise<ApiReturnType>;
  getApi(): ApiPromise | TypedApi<any> | null;
  getSigner(): any;
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
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      throw new Error(`Connection failed: ${errorMessage}`);
    }
  }

  getApi(): ApiPromise | null {
    return this.api;
  }

  getSigner(): any {
    throw new Error('Polkadot API does not support signer');
  }
}

class PapiWrapper implements IApiWrapper {
  private client: ReturnType<typeof createClient> | null = null;
  private typedApi: TypedApi<any> | null = null;
  private currentUrl: string | null = null;
  private signer: any = null;

  async connect(rpcUrl: string, chainType: 'asset-hub' | 'polkadot' | 'hydration'): Promise<{ api: TypedApi<any>, client: PolkadotClient }> {
    try {
      if (!this.client || this.currentUrl !== rpcUrl) {
        this.client = createClient(
          withPolkadotSdkCompat(getWsProvider(rpcUrl))
        );
        
        // Select chain descriptor based on chainType
        const chainDescriptor = (() => {
          switch (chainType) {
            case 'asset-hub': return polkadot_asset_hub;
            case 'polkadot': return polkadot;
            case 'hydration': return hydration;
            default: throw new Error(`Unsupported chain type: ${chainType}`);
          }
        })();
        
        this.typedApi = this.client.getTypedApi(chainDescriptor);
        this.currentUrl = rpcUrl;
        console.log(`Connected to ${rpcUrl} using PAPI`);
      }
      if (!this.typedApi || !this.client) {
        throw new Error('Failed to initialize PAPI client');
      }
      return { 
        api: this.typedApi, 
        client: this.client 
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      throw new Error(`Connection failed: ${errorMessage}`);
    }
  }

  getApi(): TypedApi<any> | null {
    return this.typedApi;
  }

  setSigner(signer: any) {
    this.signer = signer;
  }

  getSigner(): any {
    return this.signer;
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

  public async connect(rpcUrl: string, chainType?: 'asset-hub' | 'polkadot' | 'hydration'): Promise<ApiReturnType> {
    return this.apiWrapper.connect(rpcUrl, chainType);
  }

  public getApi(): ApiPromise | TypedApi<any> | null {
    return this.apiWrapper.getApi();
  }
}

export default RpcConnection;



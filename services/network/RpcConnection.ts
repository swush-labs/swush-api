// services/RpcConnection.ts
import { ApiPromise, WsProvider } from '@polkadot/api';
import { createClient, PolkadotClient, TypedApi } from 'polkadot-api';
import { getWsProvider } from 'polkadot-api/ws-provider/node';
import { withPolkadotSdkCompat } from 'polkadot-api/polkadot-sdk-compat';
import { polkadot_asset_hub } from '@polkadot-api/descriptors';
import { TxSubscriber, TxCallback } from './TxSubscriber';
import { getPolkadotSigner } from "polkadot-api/signer"

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
  connect(rpcUrl: string): Promise<ApiReturnType>;
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
      console.error(`Failed to connect to ${rpcUrl} using Polkadot API:`, error);
      throw new Error(`Connection failed: ${error.message}`);
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

  async connect(rpcUrl: string): Promise<{ api: TypedApi<any>, client: PolkadotClient }> {
    try {
      if (!this.client || this.currentUrl !== rpcUrl) {
        this.client = createClient(
          withPolkadotSdkCompat(getWsProvider(rpcUrl))
        );
        this.typedApi = this.client.getTypedApi(polkadot_asset_hub);
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
      console.error(`Failed to connect to ${rpcUrl} using PAPI:`, error);
      throw new Error(`Connection failed: ${error.message}`);
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
  private txSubscriber: TxSubscriber;

  private constructor(apiType: ApiType) {
    this.apiWrapper = apiType === 'polkadotjs' 
      ? new PolkadotApiWrapper() 
      : new PapiWrapper();
    this.txSubscriber = new TxSubscriber();
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

  public async connect(rpcUrl: string): Promise<ApiReturnType> {
    return this.apiWrapper.connect(rpcUrl);
  }

  public getApi(): ApiPromise | TypedApi<any> | null {
    return this.apiWrapper.getApi();
  }

  public setSigner(signer: any) {
    if (this.apiWrapper instanceof PapiWrapper) {
      this.apiWrapper.setSigner(signer);
    }
  }

  public subscribeTx(
    userId: string,
    tx: any,
    callbacks: TxCallback
  ): string {
    const signer = this.apiWrapper.getSigner();
    if (!signer) {
      throw new Error('No signer set for transaction');
    }

    try {
      return this.txSubscriber.subscribe(
        userId,
        tx.call.signSubmitAndWatch(signer),
        {
          ...callbacks,
          onError: (error) => {
            // Ensure we're passing the full error object
            callbacks.onError?.(error?.error || error);
          }
        }
      );
    } catch (error) {
      throw error;
    }
  }

  public unsubscribeTx(subscriptionId: string): void {
    this.txSubscriber.unsubscribe(subscriptionId);
  }
}

export default RpcConnection;



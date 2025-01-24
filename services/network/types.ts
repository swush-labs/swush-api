import { TypedApi, PolkadotClient, ChainDefinition } from 'polkadot-api';
import { 
    polkadot_asset_hub,
    polkadot,
    hydration 
} from '@polkadot-api/descriptors';
import RpcConnection from './RpcConnection';

// Define supported chains
export type SupportedChains = 
    | typeof polkadot_asset_hub
    | typeof polkadot
    | typeof hydration;

export interface PapiConnection<T extends ChainDefinition = SupportedChains> {
    api: TypedApi<T>;
    client: PolkadotClient;
}

// Type guard
export function isPapiConnection(result: unknown): result is PapiConnection {
    return Boolean(result && typeof result === 'object' && 'api' in result && 'client' in result);
}

// Network-specific connection creators
export function createAssetHubConnection(connection: { api: TypedApi<any>; client: PolkadotClient }): PapiConnection<typeof polkadot_asset_hub> {
    return {
        api: connection.api as TypedApi<typeof polkadot_asset_hub>,
        client: connection.client
    };
}

export function createPolkadotConnection(connection: { api: TypedApi<any>; client: PolkadotClient }): PapiConnection<typeof polkadot> {
    return {
        api: connection.api as TypedApi<typeof polkadot>,
        client: connection.client
    };
}

export function createHydrationConnection(connection: { api: TypedApi<any>; client: PolkadotClient }): PapiConnection<typeof hydration> {
    return {
        api: connection.api as TypedApi<typeof hydration>,
        client: connection.client
    };
}

// Chain-specific connect functions
export async function connectPapi(rpcUrl: string, chainType: 'asset-hub' | 'polkadot' | 'hydration'): Promise<PapiConnection<SupportedChains>> {
    const papiConn = RpcConnection.getInstance('papi');
    const result = await papiConn.connect(rpcUrl, chainType);
    
    if (!isPapiConnection(result)) {
        throw new Error('Invalid connection type');
    }
    
    switch (chainType) {
        case 'asset-hub':
            return createAssetHubConnection(result);
        case 'polkadot':
            return createPolkadotConnection(result);
        case 'hydration':
            return createHydrationConnection(result);
        default:
            throw new Error(`Unsupported chain type: ${chainType}`);
    }
} 
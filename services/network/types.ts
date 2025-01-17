import { TypedApi, PolkadotClient, ChainDefinition } from 'polkadot-api';
import { polkadot_asset_hub } from '@polkadot-api/descriptors';
import RpcConnection from './RpcConnection';

export interface PapiConnection<T extends ChainDefinition = ChainDefinition> {
    api: TypedApi<T>;
    client: PolkadotClient;
}

export function isPapiConnection(result: unknown): result is PapiConnection {
    return Boolean(result && typeof result === 'object' && 'api' in result && 'client' in result);
}

// Helper function to create typed PAPI connections for specific networks
export function createPapiConnection(connection: { api: TypedApi<any>; client: PolkadotClient }): PapiConnection<typeof polkadot_asset_hub> {
    return {
        api: connection.api as TypedApi<typeof polkadot_asset_hub>,
        client: connection.client
    };
}

// Add more network-specific type helpers as needed
// Example:
// export function createKusamaConnection(connection: PapiConnection): PapiConnection<typeof kusama> {
//     return {
//         api: connection.api as TypedApi<typeof kusama>,
//         client: connection.client
//     };
// } 

export async function connectPapi(rpcUrl: string): Promise<PapiConnection<typeof polkadot_asset_hub>> {
    const papiConn = RpcConnection.getInstance('papi');
    const result = await papiConn.connect(rpcUrl);
    
    if (!isPapiConnection(result)) {
        throw new Error('Invalid connection type');
    }
    
    return createPapiConnection(result);
} 
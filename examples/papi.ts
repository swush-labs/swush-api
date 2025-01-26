import { RPC_URL, TEST_RPC_ASSET_HUB } from "../services/constants";

import { connectPapi } from '../services/network/types';
import RpcConnection from '../services/network/RpcConnection';

async function main() {
    try {
        const { api, client } = await connectPapi(TEST_RPC_ASSET_HUB,'asset-hub');
        
        const assetConversionAssets = await api.query.Assets.Metadata.getEntries();
        client.destroy();
    } catch (error) {
        console.error("Error connecting to PAPI:", error);
    } finally {
        RpcConnection.clearInstances();
    }
}

main();

import { RPC_URL } from "../services/constants";

import { connectPapi } from '../services/network/types';
import RpcConnection from '../services/network/RpcConnection';

interface AssetMetadata {
    symbol: string;
    deposit: bigint;
    name: string;
    decimals: number;
    is_frozen: boolean;
}

async function main() {
    try {
        const { api, client } = await connectPapi(RPC_URL);
        
        const assetConversionAssets = await api.query.Assets.Metadata.getEntries();
        assetConversionAssets.forEach((asset) => {
            const metadata: AssetMetadata = {
                symbol: asset.value.symbol.asText(),
                deposit: asset.value.deposit,
                name: asset.value.name.asText(),
                decimals: asset.value.decimals,
                is_frozen: asset.value.is_frozen
            };
            console.log(metadata);
        });
        client.destroy();
    } catch (error) {
        console.error("Error connecting to PAPI:", error);
    } finally {
        RpcConnection.clearInstances();
    }
}

main();

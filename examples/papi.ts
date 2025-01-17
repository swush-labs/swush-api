import RpcConnection, { isPapiConnection } from "../services/network/RpcConnection";
import { RPC_URL } from "../services/constants";

interface AssetMetadata {
    symbol: string;
    deposit: bigint;
    name: string;
    decimals: number;
    is_frozen: boolean;
}

async function main() {
    try {
        const papiConn = RpcConnection.getInstance('papi');
        const result = await papiConn.connect(RPC_URL);
        
        if (!isPapiConnection(result)) {
            throw new Error('Invalid connection type');
        }
        
        const { api, client } = result;
        
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

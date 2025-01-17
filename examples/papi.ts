import RpcConnection from "../services/network/RpcConnection";
import { RPC_URL } from "../services/constants";
import { TypedApi } from 'polkadot-api';
import { polkadot_asset_hub } from '@polkadot-api/descriptors';

// Using PAPI

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
        const dotApi = await papiConn.connect(RPC_URL) as TypedApi<typeof polkadot_asset_hub>;

        const assetConversionAssets = await dotApi.query.Assets.Metadata.getEntries();
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
    } catch (error) {
        console.error("Error connecting to PAPI:", error);
    }
}

main();

import RpcConnection from "../services/network/RpcConnection";
import { RPC_URL } from "../services/constants";
import { TypedApi } from 'polkadot-api';
import { polkadot_asset_hub } from '@polkadot-api/descriptors';

// Using PAPI

async function main() {
    try {
        const papiConn = RpcConnection.getInstance('papi');
        const dotApi = await papiConn.connect(RPC_URL) as TypedApi<typeof polkadot_asset_hub>;

        const assetConversionAssets = await dotApi.query.Assets.Metadata.getEntries();
        assetConversionAssets.forEach((asset) => {

            //print all the assets metadata
            console.log(asset.value.symbol.asText());
            console.log(asset.value.name.asText());
            console.log(asset.value.decimals);
            console.log(asset.value.is_frozen);
            console.log(asset.value.deposit);
        });
    } catch (error) {
        console.error("Error connecting to PAPI:", error);
    }
}

main();

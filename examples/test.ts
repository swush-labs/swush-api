
import RpcConnection from '../services/network/RpcConnection';
import { RPC_URL } from '../services/constants';
import { AssetDetails } from '@polkadot/types/interfaces/assets/types';
import {MultiLocationV4} from '@polkadot/types/interfaces/xcm/types';

async function main() {
    // Initialize the cache
    const rpcConnection = RpcConnection.getInstance();
    const api = await rpcConnection.connect(RPC_URL);
 
    // print asset metadata
    const assetMetadata = await api.query.assets.asset('0') as AssetDetails;
    console.log(assetMetadata.toHuman());

}

main().catch(console.error);
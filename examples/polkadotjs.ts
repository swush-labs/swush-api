
import RpcConnection from '../services/network/RpcConnection';
import { RPC_URL } from '../services/constants';
import { AssetDetails } from '@polkadot/types/interfaces/assets/types';
import {MultiLocationV4} from '@polkadot/types/interfaces/xcm/types';
import { WsProvider, ApiPromise } from '@polkadot/api';

async function main() {
    // Initialize the cache
    const rpcConnection = RpcConnection.getInstance('polkadotjs');
    const api = await rpcConnection.connect(RPC_URL) as ApiPromise;

    console.log('Successfully connected to the blockchain node.');
    const asset = await api.query.assets.asset.entries();

    asset.forEach(([key, value]) => {
        console.log(key.toHuman());
        console.log(value.toHuman());
    });
}

main().catch(console.error);
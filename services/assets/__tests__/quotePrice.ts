//implement AssetConversionApi.quote_price_exact_tokens_for_tokens by initializing the papi and calling the method

import { polkadot_asset_hub } from '@polkadot-api/descriptors';
import { connectPapi } from '../../../services/network/types';
import { AH_RPC_URL } from '../../constants';
import { createXcmLocation } from '../utils';

async function main() {
    const { api } = await connectPapi(AH_RPC_URL, 'asset-hub');
    const quote = await api.apis.AssetConversionApi.quote_price_exact_tokens_for_tokens(
        createXcmLocation(1),
        createXcmLocation(2),
        BigInt(100000000000), //10 DOT
        true
    );
}



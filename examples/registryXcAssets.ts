//fetch xcAssets and check if type is correct

import { fetchXcAssetData} from '../services/registry/XCMRegistry';
import { getAllCachedCurrencyIds, getAssetByCurrencyId } from '../services/assets/currency';

async function main() {
    // Initialize the cache
    await fetchXcAssetData();
    
    // Get all available currency IDs
    const currencyIds = getAllCachedCurrencyIds();
    console.log('Available currency IDs:', currencyIds);
    
    // Look up a specific asset
    const currencyId = currencyIds[0]; // example
    const asset = getAssetByCurrencyId(currencyId);
    if (asset) {
        console.log('Found asset:', {
            name: asset.name,
            symbol: asset.symbol,
            decimals: asset.decimals,
            currencyID: asset.currencyID
        });
    }
}

main().catch(console.error);
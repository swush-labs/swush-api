//fetch xcAssets and check if type is correct

import { fetchXcAssetData} from '../services/registry/XCMRegistry';
import { getAssetByCurrencyId } from '../services/assets/currency';

async function main() {
    // Initialize the cache
    await fetchXcAssetData();
    
    
    // Look up a specific asset
    const currencyId = "1"; // example
    const asset = getAssetByCurrencyId(currencyId);
    // pretty print all details
    console.log("asset details:", JSON.stringify(asset, null, 2));
}

main().catch(console.error);
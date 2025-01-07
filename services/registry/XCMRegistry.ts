import {ChainInfoRegistry, ChainInfoKeys} from './types-xcm';
import {XcAssets, AssetData} from './types-xcassets';
import {
    PARITY_XCM_REGISTRY_URL,
    COLORFULNOTION_XCM_GLOBAL_REGISTRY_URL,
    CACHE_KEYS,
} from '../constants';
import CacheManager from '../cache/CacheManager';


// Add type for the lookup cache
export type AssetLookupCache = {
    [currencyId: string]: AssetData;
};

// Helper function to create lookup cache
function createAssetLookup(xcAssets: XcAssets): AssetLookupCache {
    const lookup: AssetLookupCache = {};
    
    // Process both Polkadot and Kusama assets
    ['polkadot', 'kusama'].forEach(chain => {
        xcAssets[chain as keyof XcAssets].forEach(xcAssetInfo => {
            xcAssetInfo.data.forEach(assetData => {
                if (assetData.currencyID) {
                    lookup[assetData.currencyID] = assetData;
                }
            });
        });
    });
    
    return lookup;
}

export async function initializeRegistry() {
    const cacheManager = CacheManager.getInstance();
    const cachedRegistry = cacheManager.get(CACHE_KEYS.PARITY_XCM_REGISTRY);
    
    if (cachedRegistry) {
        return cachedRegistry;
    }

    let data;
    try {
        data = await fetch(PARITY_XCM_REGISTRY_URL);
        const fetchedRegistry = (await data.json()) as ChainInfoRegistry<ChainInfoKeys>;
        
        // Cache the fetched registry
        cacheManager.set(CACHE_KEYS.PARITY_XCM_REGISTRY, fetchedRegistry);
        
        return fetchedRegistry;
    } catch (e) {
        throw new Error(
            'Failed to fetch XCM registry from CDN',
        );
    }
}

// TODO: initialize XC assets lookup cache first
export async function fetchXcAssetData(): Promise<{ xcAssets: XcAssets }> {
    const cacheManager = CacheManager.getInstance();
    const cachedAssets = cacheManager.get(CACHE_KEYS.CN_XCM_REGISTRY);
    
    if (cachedAssets) {
        return cachedAssets;
    }

    try {
        const xcAssetsRegistry = (await (await fetch(COLORFULNOTION_XCM_GLOBAL_REGISTRY_URL)).json()) as {
            xcAssets: XcAssets;
        };
        
        // Cache the fetched XC assets
        cacheManager.set(CACHE_KEYS.CN_XCM_REGISTRY, xcAssetsRegistry);
        
        // Create and cache the lookup
        const assetLookup = createAssetLookup(xcAssetsRegistry.xcAssets);
        cacheManager.set(CACHE_KEYS.CN_XCM_REGISTRY_ASSETS, assetLookup);
        
        return xcAssetsRegistry;
    } catch (e) {
        throw new Error(
            'Failed to fetch XC assets from CDN',
        );
    }
};

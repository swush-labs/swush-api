import {ChainInfoRegistry, ChainInfoKeys} from './types-xcm';
import {XcAssets, AssetData} from './types-xcassets';
import {
    ASSET_TRANSFER_API_XCM_REGISTRY_URL,
    XC_ASSET_CDN_URL
} from '../constants';
import CacheManager from '../cache/CacheManager';

const CACHE_KEYS = {
    XCM_REGISTRY: 'xcm_registry',
    XC_ASSETS: 'xc_assets',
    XC_ASSETS_LOOKUP: 'xc_assets_lookup'
};

// Add type for the lookup cache
type AssetLookupCache = {
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
    const cachedRegistry = cacheManager.get(CACHE_KEYS.XCM_REGISTRY);
    
    if (cachedRegistry) {
        return cachedRegistry;
    }

    let data;
    try {
        data = await fetch(ASSET_TRANSFER_API_XCM_REGISTRY_URL);
        const fetchedRegistry = (await data.json()) as ChainInfoRegistry<ChainInfoKeys>;
        
        // Cache the fetched registry
        cacheManager.set(CACHE_KEYS.XCM_REGISTRY, fetchedRegistry);
        
        return fetchedRegistry;
    } catch (e) {
        throw new Error(
            'Failed to fetch XCM registry from CDN',
        );
    }
}

export async function fetchXcAssetData(): Promise<{ xcAssets: XcAssets }> {
    const cacheManager = CacheManager.getInstance();
    const cachedAssets = cacheManager.get(CACHE_KEYS.XC_ASSETS);
    
    if (cachedAssets) {
        return cachedAssets;
    }

    try {
        const xcAssetsRegistry = (await (await fetch(XC_ASSET_CDN_URL)).json()) as {
            xcAssets: XcAssets;
        };
        
        // Cache the fetched XC assets
        cacheManager.set(CACHE_KEYS.XC_ASSETS, xcAssetsRegistry);
        
        // Create and cache the lookup
        const assetLookup = createAssetLookup(xcAssetsRegistry.xcAssets);
        cacheManager.set(CACHE_KEYS.XC_ASSETS_LOOKUP, assetLookup);
        
        return xcAssetsRegistry;
    } catch (e) {
        throw new Error(
            'Failed to fetch XC assets from CDN',
        );
    }
};

// Add helper function to get asset by currency ID
export function getAssetByCurrencyId(currencyId: string): AssetData | undefined {
    const cacheManager = CacheManager.getInstance();
    const lookupCache = cacheManager.get(CACHE_KEYS.XC_ASSETS_LOOKUP) as AssetLookupCache;
    
    if (!lookupCache) {
        throw new Error('Asset lookup cache not initialized');
    }
    
    return lookupCache[currencyId];
}

// Add helper function to get all cached currency IDs
export function getAllCachedCurrencyIds(): string[] {
    const cacheManager = CacheManager.getInstance();
    const lookupCache = cacheManager.get(CACHE_KEYS.XC_ASSETS_LOOKUP) as AssetLookupCache;
    
    if (!lookupCache) {
        throw new Error('Asset lookup cache not initialized');
    }
    
    return Object.keys(lookupCache);
}
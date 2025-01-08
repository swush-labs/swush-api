import {ChainInfoRegistry, ChainInfoKeys} from './types-xcm';
import {
    Assets,
    AssetData,
    XCMAssetData,
    XcAssetsXCMInfo
} from './types-xcassets';
import {
    PARITY_XCM_REGISTRY_URL,
    COLORFULNOTION_XCM_GLOBAL_REGISTRY_URL,
    CACHE_KEYS,
    NETWORKS_SUPPORTED,
} from '../constants';
import CacheManager from '../cache/CacheManager';


// Add type for the lookup cache
export type AssetLookupCache = {
    [currencyId: string]: AssetData;
};

export type SymbolLookupCache = {
    [symbol: string]: XCMAssetData;
};

// Helper function to create lookup cache
function createAssetLookup(xcmAssetsRegistry: Assets): AssetLookupCache {
    const lookup: AssetLookupCache = {};
    
    NETWORKS_SUPPORTED.forEach(chain => {
        xcmAssetsRegistry.assets[chain].forEach(assetInfo => {
            if (assetInfo.id === "asset-hub-polkadot") {
                assetInfo.data.forEach(assetData => {
                    if (assetData.currencyID) {
                        lookup[assetData.currencyID.toString()] = assetData;
                    }
                });
            }
        });
    });
    
    return lookup;
}

function createSymbolLookup(xcmAssetsRegistry: Assets): SymbolLookupCache {
    const lookup: SymbolLookupCache = {};
    
    NETWORKS_SUPPORTED.forEach(chain => {
        xcmAssetsRegistry.xcAssets[chain].forEach(xcAssetInfo => {
            if (xcAssetInfo.id === "asset-hub-polkadot") {
                xcAssetInfo.data.forEach(assetData => {
                    lookup[assetData.symbol] = assetData;
                });
            }
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

    try {
        const data = await fetch(PARITY_XCM_REGISTRY_URL);
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
export async function fetchXcAssetData(): Promise<{ xcAssets: Assets } | undefined> {
    const cacheManager = CacheManager.getInstance();
    const cachedAssets = cacheManager.get(CACHE_KEYS.CN_XCM_REGISTRY);
    
    if (cachedAssets) {
        return cachedAssets;
    }

    try {
        const data = await fetch(COLORFULNOTION_XCM_GLOBAL_REGISTRY_URL)
        const xcmAssetsRegistry = (await data.json()) as Assets;
        
        // Cache the fetched XC assets
        cacheManager.set(CACHE_KEYS.CN_XCM_REGISTRY, xcmAssetsRegistry);
        
        // Create and cache the asset lookup
        const assetLookup = createAssetLookup(xcmAssetsRegistry);
        cacheManager.set(CACHE_KEYS.CN_XCM_REGISTRY_AH_NATIVE_ASSETS, assetLookup);

        // Create and cache the symbol lookup
        const symbolLookup = createSymbolLookup(xcmAssetsRegistry);
        cacheManager.set(CACHE_KEYS.CN_XCM_REGISTRY_XC_ASSETS, symbolLookup);
        
    } catch (e) {
        console.error('Error fetching XC assets:', e);
        return undefined;
    }
}

import CacheManager from "../cache/CacheManager";
import { AssetData } from "../registry/types-xcassets";
import { CACHE_KEYS } from "../constants";
import { AssetLookupCache } from "../registry/XCMRegistry";

// Add helper function to get asset by currency ID
export function getAssetByCurrencyId(currencyId: string): AssetData | undefined {
    const cacheManager = CacheManager.getInstance();
    const lookupCache = cacheManager.get(CACHE_KEYS.CN_XCM_REGISTRY_AH_NATIVE_ASSETS) as AssetLookupCache;
    
    if (!lookupCache) {
        throw new Error('Asset lookup cache not initialized');
    }
    
    return lookupCache[currencyId];
}

// Add helper function to get all cached currency IDs
export function getAllCachedCurrencyIds(): string[] {
    const cacheManager = CacheManager.getInstance();
    const lookupCache = cacheManager.get(CACHE_KEYS.CN_XCM_REGISTRY_AH_NATIVE_ASSETS) as AssetLookupCache;
    
    if (!lookupCache) {
        throw new Error('Asset lookup cache not initialized');
    }
    
    return Object.keys(lookupCache);
}   
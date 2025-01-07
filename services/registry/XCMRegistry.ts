import {ChainInfoRegistry, ChainInfoKeys} from './types-xcm';
import {XcAssets} from './types-xcassets';
import {
    ASSET_TRANSFER_API_XCM_REGISTRY_URL,
    XC_ASSET_CDN_URL
} from '../constants';
import CacheManager from '../cache/CacheManager';

const CACHE_KEYS = {
    XCM_REGISTRY: 'xcm_registry',
    XC_ASSETS: 'xc_assets'
};

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
        
        return xcAssetsRegistry;
    } catch (e) {
        throw new Error(
            'Failed to fetch XC assets from CDN',
        );
    }
};
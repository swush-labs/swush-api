import { AssetService } from './assets/AssetService';
import { Asset } from './assets/types';
import { CacheService } from './cache/CacheService';
import { ConnectionManager } from './network/ConnectionManager';

let isInitialized = false;

export async function initializeSDK(): Promise<void> {
    if (isInitialized) return;
    
    try {
        await ConnectionManager.getInstance().initialize();
        await CacheService.getInstance().initializeAllCaches();
        isInitialized = true;
        console.log('SDK initialized successfully');
    } catch (error) {
        console.error('SDK initialization failed:', error);
        throw error;
    }
}

export async function cleanupSDK(): Promise<void> {
    if (!isInitialized) return;
    
    try {
        await ConnectionManager.getInstance().disconnect();
        CacheService.getInstance().stopCacheRefresh();
        isInitialized = false;
        console.log('SDK cleanup complete');
    } catch (error) {
        console.error('SDK cleanup failed:', error);
        throw error;
    }
}

export async function getAssets(forceRefresh = false): Promise<Map<string, Asset>> {
    if (!isInitialized) {
        throw new Error('SDK not initialized. Call initializeSDK() first');
    }
    return await AssetService.getInstance().getAssets(forceRefresh);
}

export * from './assets/types';
export * from './assets/utils'; 
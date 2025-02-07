import { AssetService } from './services/assets/AssetService';
import { Asset } from './services/assets/types';
import { CacheService } from './services/cache/CacheService';
import { ConnectionManager } from './services/network/ConnectionManager';

// SDK initialization status
let isInitialized = false;

// Initialize SDK
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

// SDK cleanup
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

// Asset SDK functions
export async function getAssets(forceRefresh = false): Promise<Map<string, Asset>> {
    if (!isInitialized) {
        throw new Error('SDK not initialized. Call initializeSDK() first');
    }
    return await AssetService.getInstance().getAssets(forceRefresh);
}

export * from './services/assets/types';
export * from './services/assets/utils'; 
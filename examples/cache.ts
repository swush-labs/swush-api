//write a cache manager with main and sub cache

import { CacheService } from '../services/cache/CacheService';

async function main() {
    const rpcUrl = 'wss://your-rpc-endpoint';
    const cacheService = CacheService.getInstance(rpcUrl);

    // Initialize all caches first
    await cacheService.initializeAllCaches();

    // Start automatic cache refresh
    cacheService.startCacheRefresh();

    // To stop cache refresh (when needed)
    // cacheService.stopCacheRefresh();

    // To clear all caches (when needed)
    // cacheService.clearAllCaches();
}

main().catch(console.error);

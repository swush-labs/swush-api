// pages/api/initialize.ts
import { ConnectionManager } from './services/network/ConnectionManager';
import { CacheService } from './services/cache/CacheService';

async function initialize() {
    try {
        // Initialize all network connections first
        await ConnectionManager.getInstance().initialize();

        // Initialize and start cache service
        await CacheService.getInstance().initializeAllCaches();

        console.log('Server initialization complete');
    } catch (error) {
        console.error('Server initialization failed:', error);
        process.exit(1);
    }
}

// Handle cleanup on shutdown
process.on('SIGTERM', async () => {
    console.log('Server shutting down...');
    try {
        await ConnectionManager.getInstance().disconnect();
        CacheService.getInstance().stopCacheRefresh();
        console.log('Cleanup complete');
        process.exit(0);
    } catch (error) {
        console.error('Error during cleanup:', error);
        process.exit(1);
    }
});

// Handle uncaught errors
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
});

initialize();

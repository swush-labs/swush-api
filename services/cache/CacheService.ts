import { initializeRegistry, fetchXcAssetData } from '../registry/XCMRegistry';
import CacheManager from './CacheManager';

export class CacheService {
    private static instance: CacheService;
    private intervals: { [key: string]: NodeJS.Timer } = {};

    // Cache refresh intervals in milliseconds
    private static REFRESH_INTERVALS = {
        XCM_REGISTRY: 5 * 60 * 1000,      // 5 minutes
        XC_ASSETS: 10 * 60 * 1000,        // 10 minutes
        CHAIN_DATA: 1 * 60 * 1000         // 1 minute
    };


    public static getInstance(): CacheService {
        return CacheService.instance;
    }

    public startCacheRefresh(): void {
        // Start XCM Registry refresh
        this.intervals['XCM_REGISTRY'] = setInterval(async () => {
            try {
                await initializeRegistry();
                console.log('XCM Registry cache refreshed');
            } catch (error) {
                console.error('Failed to refresh XCM Registry cache:', error);
            }
        }, CacheService.REFRESH_INTERVALS.XCM_REGISTRY);

        // Start XC Assets refresh
        this.intervals['XC_ASSETS'] = setInterval(async () => {
            try {
                await fetchXcAssetData();
                console.log('XC Assets cache refreshed');
            } catch (error) {
                console.error('Failed to refresh XC Assets cache:', error);
            }
        }, CacheService.REFRESH_INTERVALS.XC_ASSETS);

        // Start Chain Data refresh
        this.intervals['CHAIN_DATA'] = setInterval(async () => {
            try {
               // TODO : refresh cache
               // await this.dataFetcher.refreshCache();
                console.log('Chain Data cache refreshed');
            } catch (error) {
                console.error('Failed to refresh Chain Data cache:', error);
            }
        }, CacheService.REFRESH_INTERVALS.CHAIN_DATA);
    }
    public stopCacheRefresh(): void {
        Object.values(this.intervals).forEach(interval => {
            if (interval) {
                clearInterval(interval as NodeJS.Timeout);
            }
        });
        this.intervals = {};
        console.log('All cache refresh intervals stopped');
    }

    public async initializeAllCaches(): Promise<void> {
        try {
            await Promise.all([
                initializeRegistry(),
                fetchXcAssetData(),
            ]);
            console.log('All caches initialized');
        } catch (error) {
            console.error('Failed to initialize caches:', error);
            throw error;
        }
    }

    public clearAllCaches(): void {
        CacheManager.getInstance().clear();
        console.log('All caches cleared');
    }
} 
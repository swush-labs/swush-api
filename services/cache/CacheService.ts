import { initializeRegistry, fetchXcAssetData } from '../registry/XCMRegistry';
import DataFetcher from '../network/DataFetcher';
import CacheManager from './CacheManager';

export class CacheService {
    private static instance: CacheService;
    private intervals: { [key: string]: NodeJS.Timer } = {};
    private dataFetcher: DataFetcher;

    // Cache refresh intervals in milliseconds
    private static REFRESH_INTERVALS = {
        XCM_REGISTRY: 5 * 60 * 1000,      // 5 minutes
        XC_ASSETS: 10 * 60 * 1000,        // 10 minutes
        CHAIN_DATA: 1 * 60 * 1000         // 1 minute
    };

    private constructor(rpcUrl: string) {
        this.dataFetcher = new DataFetcher(rpcUrl);
    }

    public static getInstance(rpcUrl: string): CacheService {
        if (!CacheService.instance) {
            CacheService.instance = new CacheService(rpcUrl);
        }
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
                await this.dataFetcher.refreshCache();
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
                this.dataFetcher.refreshCache()
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
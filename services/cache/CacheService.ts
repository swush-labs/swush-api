import { initializeRegistry, fetchXcAssetData } from '../registry/XCMRegistry';
import CacheManager from './CacheManager';
import { AssetService } from '../assets/AssetService';

export class CacheService {
    private static instance: CacheService;
    private intervals: { [key: string]: NodeJS.Timer } = {};
    private assetService: AssetService;

    // Cache refresh intervals in milliseconds
    private static REFRESH_INTERVALS = {
        XCM_REGISTRY: 5 * 60 * 1000,      // 5 minutes
        XC_ASSETS: 10 * 60 * 1000,        // 10 minutes
        CHAIN_DATA: 1 * 60 * 1000,        // 1 minute
        ASSETS: 30 * 60 * 1000             // 2 minutes
    };

    private constructor() {
        this.assetService = AssetService.getInstance();
    }

    public static getInstance(): CacheService {
        if (!CacheService.instance) {
            CacheService.instance = new CacheService();
        }
        return CacheService.instance;
    }

    public startCacheRefresh(): void {
        // Start Assets refresh
        this.intervals['ASSETS'] = setInterval(async () => {
            try {
                await this.assetService.getAssets(true);
                console.log('Assets cache refreshed');
            } catch (error) {
                console.error('Failed to refresh Assets cache:', error);
            }
        }, CacheService.REFRESH_INTERVALS.ASSETS);
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
                this.assetService.getAssets()
            ]);
            console.log('All caches initialized');
            this.startCacheRefresh();
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
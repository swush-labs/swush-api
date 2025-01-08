import { CacheService } from '../CacheService';
import { initializeRegistry, fetchXcAssetData } from '../../registry/XCMRegistry';
import DataFetcher from '../../network/DataFetcher';

// Mock dependencies
jest.mock('../../registry/XCMRegistry');
jest.mock('../../network/DataFetcher');

describe('CacheService', () => {
    let cacheService: CacheService;
    const mockRpcUrl = 'ws://test.url';

    beforeEach(() => {
        jest.useFakeTimers();
        cacheService = CacheService.getInstance(mockRpcUrl);
    });

    afterEach(() => {
        jest.clearAllMocks();
        jest.clearAllTimers();
        cacheService.stopCacheRefresh();
    });

    it('should be a singleton', () => {
        const instance1 = CacheService.getInstance(mockRpcUrl);
        const instance2 = CacheService.getInstance(mockRpcUrl);
        expect(instance1).toBe(instance2);
    });

    it('should start cache refresh intervals', () => {
        cacheService.startCacheRefresh();
        expect(setInterval).toHaveBeenCalledTimes(3);
    });

    it('should stop cache refresh intervals', () => {
        cacheService.startCacheRefresh();
        cacheService.stopCacheRefresh();
        expect(clearInterval).toHaveBeenCalledTimes(3);
    });

    it('should initialize all caches', async () => {
        await cacheService.initializeAllCaches();
        expect(initializeRegistry).toHaveBeenCalled();
        expect(fetchXcAssetData).toHaveBeenCalled();
        expect(DataFetcher.prototype.refreshCache).toHaveBeenCalled();
    });
}); 
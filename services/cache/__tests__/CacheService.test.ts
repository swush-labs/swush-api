import { CacheService } from '../CacheService';
import { initializeRegistry, fetchXcAssetData } from '../../registry/XCMRegistry';
import DataFetcher from '../../network/DataFetcher';

jest.mock('../../registry/XCMRegistry');
jest.mock('../../network/DataFetcher');

describe('CacheService', () => {
    let cacheService: CacheService;
    const mockRpcUrl = 'ws://test.url';

    beforeEach(() => {
        // Mock timer functions
        jest.useFakeTimers();
        // TODO: global.setInterval = jest.fn();
        global.clearInterval = jest.fn();
        
        cacheService = CacheService.getInstance();
    });

    afterEach(() => {
        jest.clearAllMocks();
        jest.clearAllTimers();
        cacheService.stopCacheRefresh();
    });

    it('should stop cache refresh intervals', () => {
        cacheService.startCacheRefresh();
        cacheService.stopCacheRefresh();
        expect(global.clearInterval).toHaveBeenCalledTimes(3);
    });

    it('should initialize all caches', async () => {
        (initializeRegistry as jest.Mock).mockResolvedValue({});
        (fetchXcAssetData as jest.Mock).mockResolvedValue({});
        (DataFetcher.prototype.refreshCache as jest.Mock).mockResolvedValue({});

        await cacheService.initializeAllCaches();
        
        expect(initializeRegistry).toHaveBeenCalled();
        expect(fetchXcAssetData).toHaveBeenCalled();
        expect(DataFetcher.prototype.refreshCache).toHaveBeenCalled();
    });
}); 
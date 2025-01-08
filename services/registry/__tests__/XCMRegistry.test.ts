import { initializeRegistry, fetchXcAssetData } from '../XCMRegistry';
import CacheManager from '../../cache/CacheManager';
import { CACHE_KEYS } from '../../constants';

// Mock fetch
global.fetch = jest.fn();

describe('XCMRegistry', () => {
    beforeEach(() => {
        // Clear cache and reset mocks before each test
        CacheManager.getInstance().clear();
        (global.fetch as jest.Mock).mockClear();
    });

    describe('initializeRegistry', () => {
        it('should fetch and cache XCM registry when cache is empty', async () => {
            const mockRegistry = { someData: 'test' };
            (global.fetch as jest.Mock).mockResolvedValueOnce({
                json: () => Promise.resolve(mockRegistry)
            });

            const result = await initializeRegistry();
            expect(result).toEqual(mockRegistry);
            expect(CacheManager.getInstance().get(CACHE_KEYS.PARITY_XCM_REGISTRY)).toEqual(mockRegistry);
        });

        it('should return cached data when available', async () => {
            const mockRegistry = { someData: 'cached' };
            CacheManager.getInstance().set(CACHE_KEYS.PARITY_XCM_REGISTRY, mockRegistry);

            const result = await initializeRegistry();
            expect(result).toEqual(mockRegistry);
            expect(global.fetch).not.toHaveBeenCalled();
        });
    });

    describe('fetchXcAssetData', () => {
        it('should fetch and cache XC assets data', async () => {
            const mockAssets = {
                xcAssets: {
                    assets: {
                        polkadot: [],
                        kusama: []
                    },
                    xcAssets: {
                        polkadot: [],
                        kusama: []
                    }
                }
            };

            (global.fetch as jest.Mock).mockResolvedValueOnce({
                json: () => Promise.resolve(mockAssets)
            });

            const result = await fetchXcAssetData();
            expect(result).toEqual(mockAssets);
            expect(CacheManager.getInstance().get(CACHE_KEYS.CN_XCM_REGISTRY)).toEqual(mockAssets);
        });
    });
}); 
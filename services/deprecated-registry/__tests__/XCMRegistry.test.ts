import { initializeRegistry, fetchXcAssetData } from '../XCMRegistry';
import CacheManager from '../../cache/CacheManager';
import { CACHE_KEYS } from '../../constants';
import type { 
    Assets, 
    AssetData, 
    XCMAssetData,
    XCMV1MultiLocation,
} from '../types-xcassets';

// Mock fetch
global.fetch = jest.fn();

describe('XCMRegistry', () => {
    beforeEach(() => {
        CacheManager.getInstance().clear();
        (global.fetch as jest.Mock).mockClear();
    });

    describe('fetchXcAssetData', () => {
        it('should fetch data matching the Assets type structure', async () => {
            const mockAssetData: AssetData = {
                asset: { Token: "DOT" },
                name: "Polkadot",
                symbol: "DOT",
                decimals: 10,
                currencyID: "1"
            };

            const mockXCMAssetData: XCMAssetData = {
                paraID: 1000,
                relayChain: "polkadot",
                nativeChainID: "asset-hub-polkadot",
                symbol: "DOT",
                decimals: 10,
                interiorType: "x3",
                xcmV1Standardized: [
                    {
                        network: "polkadot"
                    },
                    {
                        parachain: 1000
                    }
                ],
                xcmV1MultiLocation: {
                    v1: {
                        parents: 1,
                        interior: {
                            X2: [
                                { Parachain: 1000 },
                                { GeneralKey: "0x0" }
                            ]
                        }
                    }
                },
                asset: { Token: "DOT" },
                source: ["1000"]
            };

            const mockAssets: Assets = {
                assets: {
                    polkadot: [{
                        relayChain: "polkadot",
                        paraID: 1000,
                        id: "asset-hub-polkadot",
                        assetCnt: "405",
                        data: [mockAssetData]
                    }],
                    kusama: []
                },
                xcAssets: {
                    polkadot: [{
                        relayChain: "polkadot",
                        paraID: 1000,
                        id: "asset-hub-polkadot",
                        xcAssetCnt: "18",
                        data: [mockXCMAssetData]
                    }],
                    kusama: []
                }
            };

            (global.fetch as jest.Mock).mockResolvedValueOnce({
                json: () => Promise.resolve(mockAssets)
            });

            const result = await fetchXcAssetData();

            // Type checks
            expect(result).toBeDefined();
            if (result) {
                // Check assets structure
                expect(result.assets).toHaveProperty('polkadot');
                expect(result.assets).toHaveProperty('kusama');
                
                // Check asset data structure
                const assetData = result.assets.polkadot[0].data[0];
                expect(assetData).toMatchObject<AssetData>(mockAssetData);

                // Check xcAssets structure
                expect(result.xcAssets).toHaveProperty('polkadot');
                expect(result.xcAssets).toHaveProperty('kusama');

                // Check XCM asset data structure
                const xcmAssetData = result.xcAssets.polkadot[0].data[0];
                expect(xcmAssetData).toMatchObject<XCMAssetData>(mockXCMAssetData);

                // Verify specific type structures
                expect(xcmAssetData.xcmV1MultiLocation).toMatchObject<XCMV1MultiLocation>({
                    v1: expect.any(Object)
                });

                // Cache verification
                expect(CacheManager.getInstance().get(CACHE_KEYS.CN_XCM_REGISTRY)).toEqual(result);
            }
        });

        it('should handle fetch errors gracefully', async () => {
            (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));
            const result = await fetchXcAssetData();
            expect(result).toBeUndefined();
        });

        it('should return cached data if available', async () => {
            const mockCachedData: Assets = {
                assets: { polkadot: [], kusama: [] },
                xcAssets: { polkadot: [], kusama: [] }
            };
            
            CacheManager.getInstance().set(CACHE_KEYS.CN_XCM_REGISTRY, mockCachedData);
            const result = await fetchXcAssetData();
            expect(result).toEqual(mockCachedData);
            expect(global.fetch).not.toHaveBeenCalled();
        });
    });

});

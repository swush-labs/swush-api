import DataFetcher from '../DataFetcher';
import RpcConnection from '../RpcConnection';
import CacheManager from '../../cache/CacheManager';

// Mock dependencies
jest.mock('../RpcConnection');
jest.mock('../../cache/CacheManager');

describe('DataFetcher', () => {
    const mockRpcUrl = 'ws://test.url';
    let dataFetcher: DataFetcher;
    let mockApi: any;

    beforeEach(() => {
        mockApi = {
            query: {
                balances: {
                    totalIssuance: jest.fn().mockResolvedValue({
                        toHuman: () => '1000'
                    })
                },
                nominationPools: {
                    totalValueLocked: jest.fn().mockResolvedValue({
                        toHuman: () => '500'
                    })
                }
            }
        };

        (RpcConnection.getInstance().connect as jest.Mock).mockResolvedValue(mockApi);
        dataFetcher = new DataFetcher(mockRpcUrl);
    });

    it('should fetch and cache balances', async () => {
        await dataFetcher.fetchBalances();
        expect(mockApi.query.balances.totalIssuance).toHaveBeenCalled();
        expect(CacheManager.getInstance().set).toHaveBeenCalledWith('balances', '1000');
    });

    it('should fetch and cache pool data', async () => {
        await dataFetcher.fetchPoolData();
        expect(mockApi.query.nominationPools.totalValueLocked).toHaveBeenCalled();
        expect(CacheManager.getInstance().set).toHaveBeenCalledWith('pools', '500');
    });

    it('should refresh all caches', async () => {
        await dataFetcher.refreshCache();
        expect(mockApi.query.balances.totalIssuance).toHaveBeenCalled();
        expect(mockApi.query.nominationPools.totalValueLocked).toHaveBeenCalled();
    });
}); 
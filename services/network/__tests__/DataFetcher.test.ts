/* import DataFetcher from '../DataFetcher';
import RpcConnection from '../RpcConnection';
import CacheManager from '../../cache/CacheManager';

jest.mock('../RpcConnection');
jest.mock('../../cache/CacheManager');

describe.skip('DataFetcher', () => {
    const mockRpcUrl = 'ws://test.url';
    let dataFetcher: DataFetcher;
    let mockApi: any;
    let mockRpcConnection: any;

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

        mockRpcConnection = {
            connect: jest.fn().mockResolvedValue(mockApi)
        };

        (RpcConnection.getInstance as jest.Mock).mockReturnValue(mockRpcConnection);
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
});  */
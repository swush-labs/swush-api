import RpcConnection from '../RpcConnection';
import { ApiPromise, WsProvider } from '@polkadot/api';

jest.mock('@polkadot/api', () => ({
    ApiPromise: {
        create: jest.fn()
    },
    WsProvider: jest.fn()
}));

describe('RpcConnection', () => {
    const mockRpcUrl = 'ws://test.url';
    let rpcConnection: RpcConnection;
    let mockApi: any;

    beforeEach(() => {
        mockApi = { someMethod: jest.fn() };
        (ApiPromise.create as jest.Mock).mockResolvedValue(mockApi);
        rpcConnection = RpcConnection.getInstance();
        // Reset the instance's api to null before each test
        (rpcConnection as any).api = null;
    });

    it('should create API connection', async () => {
        const api = await rpcConnection.connect(mockRpcUrl);
        expect(WsProvider).toHaveBeenCalledWith(mockRpcUrl);
        expect(ApiPromise.create).toHaveBeenCalled();
        expect(api).toBe(mockApi);
    });

    it('should reuse existing API connection', async () => {
        const firstApi = await rpcConnection.connect(mockRpcUrl);
        const secondApi = await rpcConnection.connect(mockRpcUrl);
        expect(firstApi).toBe(secondApi);
        expect(ApiPromise.create).toHaveBeenCalledTimes(1);
    });

    it('should return null when no API is connected', () => {
        (rpcConnection as any).api = null;
        expect(rpcConnection.getApi()).toBeNull();
    });
}); 
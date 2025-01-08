import RpcConnection from '../RpcConnection';
import { ApiPromise, WsProvider } from '@polkadot/api';

// Mock @polkadot/api
jest.mock('@polkadot/api', () => ({
    ApiPromise: {
        create: jest.fn()
    },
    WsProvider: jest.fn()
}));

describe('RpcConnection', () => {
    const mockRpcUrl = 'ws://test.url';
    let rpcConnection: RpcConnection;

    beforeEach(() => {
        (ApiPromise.create as jest.Mock).mockClear();
        (WsProvider as jest.Mock).mockClear();
        rpcConnection = RpcConnection.getInstance();
    });

    it('should be a singleton', () => {
        const instance1 = RpcConnection.getInstance();
        const instance2 = RpcConnection.getInstance();
        expect(instance1).toBe(instance2);
    });

    it('should create API connection', async () => {
        const mockApi = { someMethod: jest.fn() };
        (ApiPromise.create as jest.Mock).mockResolvedValueOnce(mockApi);

        const api = await rpcConnection.connect(mockRpcUrl);
        expect(WsProvider).toHaveBeenCalledWith(mockRpcUrl);
        expect(ApiPromise.create).toHaveBeenCalled();
        expect(api).toBe(mockApi);
    });

    it('should reuse existing API connection', async () => {
        const mockApi = { someMethod: jest.fn() };
        (ApiPromise.create as jest.Mock).mockResolvedValueOnce(mockApi);

        await rpcConnection.connect(mockRpcUrl);
        const secondConnection = await rpcConnection.connect(mockRpcUrl);

        expect(ApiPromise.create).toHaveBeenCalledTimes(1);
        expect(secondConnection).toBe(mockApi);
    });

    it('should return null when no API is connected', () => {
        expect(rpcConnection.getApi()).toBeNull();
    });
}); 
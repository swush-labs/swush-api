import RpcConnection from '../RpcConnection';
import { ApiPromise, WsProvider } from '@polkadot/api';
import { createClient } from 'polkadot-api';
import { polkadot_asset_hub } from '@polkadot-api/descriptors';

// Mock polkadot/api
jest.mock('@polkadot/api', () => ({
    ApiPromise: {
        create: jest.fn()
    },
    WsProvider: jest.fn()
}));

// Mock polkadot-api and its dependencies
jest.mock('polkadot-api', () => ({
    createClient: jest.fn()
}));

jest.mock('@polkadot-api/descriptors', () => ({
    polkadot_asset_hub: {}
}));

describe('RpcConnection', () => {
    const mockRpcUrl = 'ws://test.url';
    let polkadotJsConnection: RpcConnection;
    let papiConnection: RpcConnection;
    let mockPolkadotApi: any;
    let mockPapiTypedApi: any;
    let mockPapiClient: any;

    beforeEach(() => {
        // Clear singleton instances before each test
        (RpcConnection as any).clearInstances();

        // Setup Polkadot.js mocks
        mockPolkadotApi = { someMethod: jest.fn() };
        (ApiPromise.create as jest.Mock).mockResolvedValue(mockPolkadotApi);
        (WsProvider as jest.Mock).mockImplementation(() => ({}));

        // Setup PAPI mocks
        mockPapiTypedApi = { someMethod: jest.fn() };
        mockPapiClient = {
            getTypedApi: jest.fn().mockReturnValue(mockPapiTypedApi)
        };
        (createClient as jest.Mock).mockReturnValue(mockPapiClient);

        // Get fresh instances
        polkadotJsConnection = RpcConnection.getInstance('polkadotjs');
        papiConnection = RpcConnection.getInstance('papi');

        jest.clearAllMocks();
    });

    describe('Polkadot.js API', () => {
        it('should create Polkadot.js API connection', async () => {
            const api = await polkadotJsConnection.connect(mockRpcUrl);
            expect(WsProvider).toHaveBeenCalledWith(mockRpcUrl);
            expect(ApiPromise.create).toHaveBeenCalled();
            expect(api).toBe(mockPolkadotApi);
        });

        it('should reuse existing Polkadot.js API connection', async () => {
            await polkadotJsConnection.connect(mockRpcUrl);
            await polkadotJsConnection.connect(mockRpcUrl);
            expect(ApiPromise.create).toHaveBeenCalledTimes(1);
        });

        it('should return null when no Polkadot.js API is connected', () => {
            expect(polkadotJsConnection.getApi()).toBeNull();
        });
    });

    describe('PAPI', () => {
        it('should create PAPI connection', async () => {
            const api = await papiConnection.connect(mockRpcUrl);
            expect(createClient).toHaveBeenCalled();
            expect(mockPapiClient.getTypedApi).toHaveBeenCalledWith(polkadot_asset_hub);
            expect(api).toBe(mockPapiTypedApi);
        });

        it('should reuse existing PAPI connection', async () => {
            await papiConnection.connect(mockRpcUrl);
            await papiConnection.connect(mockRpcUrl);
            expect(createClient).toHaveBeenCalledTimes(1);
        });

        it('should return null when no PAPI is connected', () => {
            expect(papiConnection.getApi()).toBeNull();
        });
    });

    describe('Singleton behavior', () => {
        it('should return the same instance for the same API type', () => {
            const instance1 = RpcConnection.getInstance('polkadotjs');
            const instance2 = RpcConnection.getInstance('polkadotjs');
            expect(instance1).toBe(instance2);
        });

        it('should maintain separate instances for different API types', () => {
            const polkadotInstance = RpcConnection.getInstance('polkadotjs');
            const papiInstance = RpcConnection.getInstance('papi');
            expect(polkadotInstance).not.toBe(papiInstance);
        });
    });
}); 
import RpcConnection from '../services/network/RpcConnection';
import DataFetcher from '../services/network/DataFetcher';
import CacheManager from '../services/cache/CacheManager';

// Constants
const RPC_URL = 'wss://rpc.polkadot.io';
const CACHE_REFRESH_INTERVAL = 60000; // 60 seconds

// Initialize the DEX Aggregator Service
async function initializeDexAggregator() {
  console.log('Starting DEX Aggregator Service...');

  try {
    // Establish a connection to the blockchain node
    const rpcConnection = RpcConnection.getInstance();
    await rpcConnection.connect(RPC_URL);

    console.log('Successfully connected to the blockchain node.');

    // Create instances of DataFetcher and CacheManager
    const dataFetcher = new DataFetcher(RPC_URL);
    const cacheManager = CacheManager.getInstance();

    // Initial cache population
    console.log('Fetching initial data...');
    await dataFetcher.refreshCache();

    console.log('Initial data cached:', cacheManager.getAll());

    // Periodic cache updates
    setInterval(async () => {
      console.log('Refreshing cache...');
      await dataFetcher.refreshCache();
      console.log('Cache refreshed:', cacheManager.getAll());
    }, CACHE_REFRESH_INTERVAL);

  } catch (error) {
    console.error('Error initializing DEX Aggregator Service:', error);
    process.exit(1);
  }
}

// Start the service
initializeDexAggregator();

import RpcConnection from '../services/network/RpcConnection';
import { fetchAllAssets } from '../services/pools/fetchPoolAssets';
import { RPC_URL } from '../services/constants';
//asset hub RPC URL
const CACHE_REFRESH_INTERVAL = 60000; // 60 seconds

// Initialize the DEX Aggregator Service
async function initializeDexAggregator() {
  console.log('Starting DEX Aggregator Service...');

  try {
    // Establish a connection to the blockchain node
    const rpcConnection = RpcConnection.getInstance();
    const api = await rpcConnection.connect(RPC_URL);

    console.log('Successfully connected to the blockchain node.');

    // Create instances of DataFetcher and CacheManager
    await fetchAllAssets(api);
    await api.disconnect();
  } catch (error) {
    console.error('Error initializing DEX Aggregator Service:', error);
    process.exit(1);
  }
}

// Start the service
initializeDexAggregator();

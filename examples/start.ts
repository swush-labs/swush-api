import RpcConnection from '../services/network/RpcConnection';
import { AH_RPC_URL } from '../services/constants';
import { ApiPromise } from '@polkadot/api';
//asset hub RPC URL
const CACHE_REFRESH_INTERVAL = 60000; // 60 seconds

// Initialize the DEX Aggregator Service
async function initializeDexAggregator() {
  console.log('Starting DEX Aggregator Service...');

  try {
    // Establish a connection to the blockchain node
    const rpcConnection = RpcConnection.getInstance('polkadotjs');
    const api = await rpcConnection.connect(AH_RPC_URL) as ApiPromise;

    console.log('Successfully connected to the blockchain node.');

    // Create instances of DataFetcher and CacheManager
    await api.disconnect();
  } catch (error) {
    console.error('Error initializing DEX Aggregator Service:', error);
    process.exit(1);
  }
}

// Start the service
initializeDexAggregator();

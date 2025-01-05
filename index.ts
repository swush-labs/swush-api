// pages/api/initialize.ts
import DataFetcher from './services/DataFetcher';

async function main() { 
const RPC_URL = 'wss://rpc.polkadot.io';
const fetcher = new DataFetcher(RPC_URL);

// Refresh the cache every minute
setInterval(() => {
  fetcher.refreshCache();
    }, 60000);
    console.log('Cache refresh initialized.');
}

main();

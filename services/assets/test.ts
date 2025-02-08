//main function to test the asset service

import { AssetService } from './AssetService';
import { CacheService } from '../cache/CacheService';
import { initializeSDK } from '../../start';
import fs from 'fs';
import path from 'path';
import { ConnectionManager } from '../network/ConnectionManager';
import { AssetHubRouter } from './AssetHubRouter';
import CacheManager from '@/cache/CacheManager';

// await CacheService.getInstance().initializeAllCaches();
// const assetService = AssetService.getInstance();
// await assetService.getAssets();

// add main function        
async function testAssetHubQuotes() {
    try {
        // Get required services
        const assetService = AssetService.getInstance();
        const connectionManager = ConnectionManager.getInstance();
        const cacheManager = CacheManager.getInstance();

        // Get assets and API
        const assets = await assetService.getAssets();
        const api = connectionManager.getAssetHubApi();
        if (!api) throw new Error('Asset Hub API not initialized');

        // Get cached router or create new one
        const cachedRouter = cacheManager.get('asset_hub_router');
        const router = cachedRouter || new AssetHubRouter(api, assets);

        // Test some example routes
        const testCases = [
            {
                from: '1', // DOT
                to: '2',   // USDC
                amount: BigInt(1e12) // 1 DOT
            },
            {
                from: '2', // USDC
                to: '3',   // ETH
                amount: BigInt(1e6)  // 1 USDC
            },
            // Add more test cases as needed
        ];

        console.log('\n=== Testing Asset Hub Router Quotes ===\n');

        for (const test of testCases) {
            console.log(`Finding route for ${test.amount} from Asset ${test.from} to Asset ${test.to}...`);
            
            const route = await router.findBestRoute(
                test.from,
                test.to,
                test.amount
            );

            if (route) {
                console.log('\nRoute found:');
                console.log('Path:', route.path.join(' -> '));
                console.log('Expected Output:', route.expectedOutput.toString());
                console.log('Total Price Impact:', (route.totalPriceImpact * 100).toFixed(2) + '%');
                
                console.log('\nHops:');
                for (const hop of route.hops) {
                    console.log(`\nFrom ${hop.from} to ${hop.to}:`);
                    console.log('Amount In:', hop.amountIn.toString());
                    console.log('Amount Out:', hop.amountOut.toString());
                    console.log('Price Impact:', (hop.priceImpact * 100).toFixed(2) + '%');
                    console.log('Reserves:', [
                        hop.reserves[0].toString(),
                        hop.reserves[1].toString()
                    ]);
                }
            } else {
                console.log('No route found!');
            }
            console.log('\n-------------------\n');
        }

    } catch (error) {
        console.error('Error testing Asset Hub quotes:', error);
    }
}

// Main function to test the asset service
async function main() {
    try {
        await initializeSDK();
        
        // Test original asset fetching
        const assetService = AssetService.getInstance();
        const testAssets = await assetService.getAssets();
        
        // Save assets to file
        const outputDir = path.join(__dirname, 'output');
        fs.mkdirSync(outputDir, { recursive: true });
        
        fs.writeFileSync(
            path.join(outputDir, 'testAssets.json'),
            JSON.stringify(
                Object.fromEntries(testAssets),
                (_, value) => typeof value === 'bigint' ? value.toString() : value,
                2
            )
        );

        // Test router quotes
        await testAssetHubQuotes();

    } catch (error) {
        console.error('Error in main:', error);
    }
}

main();
//main function to test the asset service

import { AssetService } from './AssetService';
import { CacheService } from '../cache/CacheService';
import { initializeSDK } from '../../start';
import fs from 'fs';
import path from 'path';

// await CacheService.getInstance().initializeAllCaches();
// const assetService = AssetService.getInstance();
// await assetService.getAssets();

// add main function        
async function main() {
    await initializeSDK();

    const assetService = AssetService.getInstance();
    const testAssets = await assetService.getAssets();

    //print all assets into a file
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
}

main();
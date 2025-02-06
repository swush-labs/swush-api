//main function to test the asset service

import { AssetService } from './AssetService';
import { CacheService } from '../cache/CacheService';

await CacheService.getInstance().initializeAllCaches();
const assetService = AssetService.getInstance();
await assetService.getAssets();

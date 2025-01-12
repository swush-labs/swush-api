// Portions of this code are derived from the paritytech/asset-transfer-api-registry repository,
// licensed under the Apache License 2.0. See LICENSE-APACHE for details.

// services/DataFetcher.ts
import RpcConnection from './RpcConnection';
import CacheManager from '../cache/CacheManager';
import { AssetInfo, AssetMetadata, PoolPairsInfo, TokenPair } from './types';
import { UnionXcmMultiLocation } from '@substrate/asset-transfer-api/lib/src/createXcmTypes/types';
import { ForeignAssetsInfo } from './types';
import { ApiPromise } from '@polkadot/api';

interface Asset {
  asset: AssetInfo;
  metadata: AssetMetadata;
}

// Utility function to serialize complex keys
function serializeKey(key: any): string {
  return JSON.stringify(key);
}


  /**
   * Fetches all assets (both native and foreign) and their metadata
   * @returns Map of asset IDs to their details
   */
  export async function fetchAllAssets(api: ApiPromise) {
    const cache = CacheManager.getInstance();

    // Get all entries in parallel
    const [nativeAssets, nativeMetadata, foreignAssets, foreignMetadata] = await Promise.all([
      api.query.assets.asset.entries(),
      api.query.assets.metadata.entries(),
      api.query.foreignAssets.asset.entries(),
      api.query.foreignAssets.metadata.entries()
    ]);

    // Create metadata maps for quick lookup
    const nativeMetadataMap = new Map(
      nativeMetadata.map(([key, value]) => [key.args[0].toHuman(), value])
    );

    const foreignMetadataMap = new Map(
      foreignMetadata.map(([key, value]) => [serializeKey(key.args[0].toHuman()), value])
    );

    const nativeAssetsMap = new Map<string, Asset>();
    const foreignAssetsMap = new Map<string, Asset>();

    // Process native assets
    for (const [key, assetOption] of nativeAssets) {
      const assetId = key.args[0].toHuman() as any;
        const metadata = nativeMetadataMap.get(assetId) as any;
 //       console.log('nativeMetadataMap ', metadata?.toHuman());
        if (metadata) {
          const assetDetails: Asset = {
            asset: assetOption.toHuman() as unknown as AssetInfo,
            metadata: metadata.toHuman() as unknown as AssetMetadata
          };
          nativeAssetsMap.set(assetId, assetDetails);
        }
    }
    // pretty print nativeAssetsMap
 //   console.log('Native Assets:', JSON.stringify(nativeAssetsMap, null, 2));

    // Process foreign assets
    for (const [key, assetOption] of foreignAssets) {
      const assetId = serializeKey(key.args[0].toHuman()); // Use the utility function
      console.log('Attempting to access foreignMetadataMap with assetId:', assetId); // Debugging line
      const metadata = foreignMetadataMap.get(assetId);
      //print assetId
      console.log('assetId ', assetId);
      console.log('foreignMetadataMap ', metadata?.toHuman());
      if (metadata) {
        const assetDetails = {
          asset: assetOption.toHuman() as unknown as AssetInfo,
          metadata: metadata.toHuman() as unknown as AssetMetadata
        };
        foreignAssetsMap.set(assetId, assetDetails);
      }
    }
    // pretty print foreignAssetsMap
 //   console.log('Foreign Assets:', JSON.stringify(foreignAssetsMap, null, 2));

    // Cache all assets and metadata separately for potential reuse
    cache.set('nativeAssets', nativeAssetsMap);
    cache.set('foreignAssets', foreignAssetsMap);

    console.log('All assets and metadata fetched and cached');
   await fetchSystemParachainAssetConversionPoolInfo(nativeAssetsMap, foreignAssetsMap, api);
    return nativeAssetsMap;
  }


  async function fetchSystemParachainAssetConversionPoolInfo(
    nativeAssetsInfo: Map<string, Asset>,
    foreignAssetsInfo: Map<string, Asset>,
    api: ApiPromise
  ) {
    const poolPairsInfo: TokenPair[] = [];
    const uniqueAssets = new Map<string, { symbol: string; name: string; multiLocation: string }>();

    if (api.query.assetConversion !== undefined) {
      for (const [key, value] of await api.query.assetConversion.pools.entries()) {
        const poolPairs = key.args[0].toHuman() as [any, any]; // Access the array of token pairs
        
        // Assuming TokenPair interface has assetA and assetB properties
        const tokenPair: TokenPair = {
          pairOne: serializeKey(poolPairs[0]), // First token in pair
          pairTwo: serializeKey(poolPairs[1]), // Second token in pair
        };
        poolPairsInfo.push(tokenPair);

        console.log('tokenPair ', tokenPair);

        // Store unique assets information
        for (const asset of [poolPairs[0], poolPairs[1]]) {
          const assetId = serializeKey(asset);
          if (!uniqueAssets.has(assetId)) {
            // Try to get asset info from either native or foreign assets
            const assetInfo = nativeAssetsInfo.get(assetId) || foreignAssetsInfo.get(assetId);
            if (assetInfo) {
              uniqueAssets.set(assetId, {
                symbol: assetInfo.metadata.symbol,
                name: assetInfo.metadata.name,
                multiLocation: assetId
              });
            }
          }
        }
      }
    }
    return poolPairsInfo;
  }





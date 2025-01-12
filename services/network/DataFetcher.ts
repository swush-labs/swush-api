// Portions of this code are derived from the paritytech/asset-transfer-api-registry repository,
// licensed under the Apache License 2.0. See LICENSE-APACHE for details.

// services/DataFetcher.ts
import RpcConnection from './RpcConnection';
import CacheManager from '../cache/CacheManager';
import { AssetInfo, AssetMetadata } from './types';
import { UnionXcmMultiLocation } from '@substrate/asset-transfer-api/lib/src/createXcmTypes/types';
import { ForeignAssetsInfo } from './types';
import { ApiPromise } from '@polkadot/api';

interface NativeAsset {
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

    const nativeAssetsMap = new Map<string, NativeAsset>();
    const foreignAssetsMap = new Map<UnionXcmMultiLocation, { asset: AssetInfo; metadata: AssetMetadata }>();

    // Process native assets
    for (const [key, assetOption] of nativeAssets) {
      const assetId = key.args[0].toHuman() as any;
        const metadata = nativeMetadataMap.get(assetId) as any;
 //       console.log('nativeMetadataMap ', metadata?.toHuman());
        if (metadata) {
          const assetDetails: NativeAsset = {
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
    //    foreignAssetsMap.set(assetId, assetDetails);
      }
    }
    // pretty print foreignAssetsMap
 //   console.log('Foreign Assets:', JSON.stringify(foreignAssetsMap, null, 2));

    // Cache all assets and metadata separately for potential reuse
    cache.set('nativeAssets', nativeAssetsMap);
    cache.set('foreignAssets', foreignAssetsMap);

    console.log('All assets and metadata fetched and cached');
   // this.fetchSystemParachainAssetConversionPoolInfo(nativeAssetsMap, foreignAssetsMap);
    return nativeAssetsMap;
  }


  /* public async fetchSystemParachainAssetConversionPoolInfo(
    nativeAssetsInfo: Map<string, NativeAsset>,
    foreignAssetsInfo: Map<UnionXcmMultiLocation, { asset: AssetInfo; metadata: AssetMetadata }>
  ) {
    const api = await RpcConnection.getInstance().connect(this.rpcUrl);

    const poolPairsInfo: PoolPairsData = {};
    const uniqueAssets = new Map<string, { symbol: string; name: string; multiLocation: string }>(); // To store unique assets

    if (api.query.assetConversion !== undefined) {
        for (const [
            poolKeyStorageData,
            PoolInfo,
        ] of await api.query.assetConversion.pools.entries()) {
            const maybePoolData = poolKeyStorageData.toHuman();
            const maybePoolInfo = PoolInfo.toHuman();

            if (maybePoolData && maybePoolInfo) {
                // remove any commas from multilocation key values e.g. Parachain: 2,125 -> Parachain: 2125
                const poolAssetDataStr = JSON.stringify(maybePoolData).replace(
                    /(\d),/g,
                    '$1',
                );

                const palletAssetConversionNativeOrAssetIdData = JSON.parse(
                    poolAssetDataStr,
                ) as UnionXcmMultiLocation[][];

                const pool = maybePoolInfo as unknown as PoolInfo;

                poolPairsInfo[pool.lpToken] = {
                    lpToken: pool.lpToken,
                    pairInfo: palletAssetConversionNativeOrAssetIdData,
                };

                // Collect unique assets from pairInfo
                for (const pair of palletAssetConversionNativeOrAssetIdData) {
                    for (const asset of pair) {
                        const assetId = JSON.stringify(asset); // Convert to string for unique key
                        if (!uniqueAssets.has(assetId)) {
                            // Check if it's a native or foreign asset
                            const nativeAsset = nativeAssetsInfo.get(assetId);
                            const foreignAsset = foreignAssetsInfo.get(assetId);

                            if (nativeAsset) {
                                uniqueAssets.set(assetId, {
                                    symbol: nativeAsset.symbol,
                                    name: nativeAsset.name,
                                    multiLocation: nativeAsset.multiLocation,
                                });
                            } else if (foreignAsset) {
                                uniqueAssets.set(assetId, {
                                    symbol: foreignAsset.symbol,
                                    name: foreignAsset.name,
                                    multiLocation: foreignAsset.multiLocation,
                                });
                            }
                        }
                    }
                }
            }
        }
    }

    // Now uniqueAssets contains all unique assets with their details
    console.log('Unique Assets:', Array.from(uniqueAssets.values()));
  } */




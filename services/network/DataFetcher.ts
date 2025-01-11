// Portions of this code are derived from the paritytech/asset-transfer-api-registry repository,
// licensed under the Apache License 2.0. See LICENSE-APACHE for details.

// services/DataFetcher.ts
import RpcConnection from './RpcConnection';
import CacheManager from '../cache/CacheManager';
import { AssetInfo, AssetMetadata } from './types';
import { UnionXcmMultiLocation } from '@substrate/asset-transfer-api/lib/src/createXcmTypes/types';
import { PoolPairsData, PoolInfo } from '../types-xcm';

interface NativeAsset {
  asset: AssetInfo;
  metadata: AssetMetadata;
}

interface ForeignAsset {
  asset: AssetInfo;
  metadata: AssetMetadata;
}

class DataFetcher {
  private rpcUrl: string;

  constructor(rpcUrl: string) {
    this.rpcUrl = rpcUrl;
  }


  /**
   * Fetches all assets (both native and foreign) and their metadata
   * @returns Map of asset IDs to their details
   */
  public async fetchAllAssets(): Promise<Map<string, NativeAsset>> {
    const api = await RpcConnection.getInstance().connect(this.rpcUrl);
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
      nativeMetadata.map(([key, value]) => [key.args[0].toString(), value])
    );

    const foreignMetadataMap = new Map(
      foreignMetadata.map(([key, value]) => [key.args[0].toString(), value])
    );

    const assetDetailsMap = new Map<string, NativeAsset>();

    // Process native assets
    for (const [key, assetOption] of nativeAssets) {
      const assetId = key.args[0].toString();
      if (assetOption) {
        const metadata = nativeMetadataMap.get(assetId);
        if (metadata) {
          const assetDetails: NativeAsset = {
            asset: assetOption.toHuman() as unknown as AssetInfo,
            metadata: metadata.toHuman() as unknown as AssetMetadata
          };
          assetDetailsMap.set(`native:${assetId}`, assetDetails);
        }
      }
    }

    // Process foreign assets
    for (const [key, assetOption] of foreignAssets) {
      const assetId = key.args[0].toString();
      if (assetOption) {
        const metadata = foreignMetadataMap.get(assetId);
        if (metadata) {
          const assetDetails: NativeAsset = {
            asset: assetOption.toHuman() as unknown as AssetInfo,
            metadata: metadata.toHuman() as unknown as AssetMetadata
          };
          assetDetailsMap.set(`foreign:${assetId}`, assetDetails);
        }
      }
    }

    // Cache all assets and metadata separately for potential reuse
    cache.set('all_assets', Object.fromEntries(assetDetailsMap));
    cache.set('native_metadata', Object.fromEntries(nativeMetadataMap));
    cache.set('foreign_metadata', Object.fromEntries(foreignMetadataMap));

    console.log('All assets and metadata fetched and cached');
    return assetDetailsMap;
  }


  public async fetchSystemParachainAssetConversionPoolInfo(
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
  }
}


export default DataFetcher;

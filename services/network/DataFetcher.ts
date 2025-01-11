// services/DataFetcher.ts
import RpcConnection from './RpcConnection';
import CacheManager from '../cache/CacheManager';
import { AssetInfo, AssetMetadata, PoolInfo } from '../types';

interface AssetDetails {
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
  public async fetchAllAssets(): Promise<Map<string, AssetDetails>> {
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

    const assetDetailsMap = new Map<string, AssetDetails>();

    // Process native assets
    for (const [key, assetOption] of nativeAssets) {
      const assetId = key.args[0].toString();
      if (assetOption) {
        const metadata = nativeMetadataMap.get(assetId);
        if (metadata) {
          const assetDetails: AssetDetails = {
            asset: assetOption.toHuman(),
            metadata: metadata.toHuman()
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
          const assetDetails: AssetDetails = {
            asset: assetOption.toHuman(),
            metadata: metadata.toHuman()
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

  /**
   * Fetches pool data and matches with cached asset information
   * @returns Map of pool IDs to enriched pool information
   */
  public async fetchPoolsWithAssets(): Promise<Map<string, PoolInfo>> {
    const api = await RpcConnection.getInstance().connect(this.rpcUrl);
    const cache = CacheManager.getInstance();
    
    // Ensure we have latest asset data
    await this.fetchAllAssets();
    
    // Get all pools
    const poolEntries = await api.query.assetConversion.pools.entries();
    const poolsMap = new Map<string, PoolInfo>();

    for (const [key, poolOption] of poolEntries) {
      const poolAssetId = key.args[0].toString();
      if (poolOption) {
        const poolInfo = poolOption.toHuman();
        
        // Enrich pool info with asset details if available
        const nativeAsset = cache.get(`native:${poolAssetId}`);
        const foreignAsset = cache.get(`foreign:${poolAssetId}`);
        
        poolsMap.set(poolAssetId, {
          ...poolInfo,
          assetDetails: nativeAsset || foreignAsset || null
        });
      }
    }

    // Cache the enriched pool data
    cache.set('pools_with_assets', Object.fromEntries(poolsMap));
    
    console.log('Pools with assets fetched and cached');
    return poolsMap;
  }
}

export default DataFetcher;

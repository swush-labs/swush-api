import CacheManager from '../cache/CacheManager';
import { AssetInfo, AssetMetadata, TokenPair, Asset, XcmV4Location } from './types';
import { ApiPromise } from '@polkadot/api';
import fs from 'fs';
import { TradeRouter, PoolService, PoolBase, PoolType, Asset as HydradxAsset } from '@galacticcouncil/sdk';


// Utility function to serialize complex keys
function serializeKey(key: any): string {
  // Remove any undefined or null values to ensure consistent serialization
  // const cleanKey = JSON.parse(JSON.stringify(key));
  return JSON.stringify(key).replace(/(\d),/g, '$1');
}


// transform key using regex to remove commas
function transformKey(key: any): string {
  return key.replace(/(\d),/g, '$1');
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
    nativeMetadata.map(([key, value]) => [transformKey(key.args[0].toHuman()), value])
  );

  const foreignMetadataMap = new Map(
    foreignMetadata.map(([key, value]) => [serializeKey(key.args[0].toHuman()), value])
  );

  const nativeAssetsMap = new Map<string, Asset>();
  const foreignAssetsMap = new Map<string, Asset>();

  // Process native assets
  for (const [key, assetOption] of nativeAssets) {
    const assetId = transformKey(key.args[0].toHuman())
    const metadata = nativeMetadataMap.get(assetId);
    if (metadata) {
      const assetDetails: Asset = {
        asset: JSON.parse(
          serializeKey(assetOption.toHuman())
        ) as AssetInfo,
        metadata: JSON.parse(
          serializeKey(metadata.toHuman())
        ) as AssetMetadata
      };
      nativeAssetsMap.set(assetId, assetDetails);
    }
  }
  //write native assets to file
  fs.writeFileSync(
    'examples/output/nativeAssets.json', 
    JSON.stringify(Object.fromEntries(nativeAssetsMap), null, 2)
  );

  // Process foreign assets
  for (const [key, assetOption] of foreignAssets) {
    const assetId = serializeKey(key.args[0].toHuman());
    const metadata = foreignMetadataMap.get(assetId);
    if (metadata) {
      const assetDetails = {
        asset: JSON.parse(
          serializeKey(assetOption.toHuman())
        ) as AssetInfo,
        metadata: JSON.parse(
          serializeKey(metadata.toHuman())
        ) as AssetMetadata
      };
      foreignAssetsMap.set(assetId, assetDetails);
    }
  }

  // Cache all assets and metadata separately for potential reuse
  cache.set('nativeAssets', nativeAssetsMap);
  cache.set('foreignAssets', foreignAssetsMap);

  console.log('All assets and metadata fetched and cached');
  const uniqueAssets = await fetchSystemParachainAssetConversionPoolInfo(nativeAssetsMap, foreignAssetsMap, api);
  
  if (uniqueAssets) {
    // Enrich with HydraDX data after getting unique assets
    const enrichedAssets = await enrichWithHydraDxData(api, uniqueAssets);
    return enrichedAssets;
  }
  
  return new Map<string, Asset>(); // Return empty map if no assets found
}


async function fetchSystemParachainAssetConversionPoolInfo(
  nativeAssetsInfo: Map<string, Asset>,
  foreignAssetsInfo: Map<string, Asset>,
  api: ApiPromise
) {
  const poolPairsInfo: TokenPair[] = [];
  const uniqueAssets = new Map<string, Asset>();

  if (api.query.assetConversion !== undefined) {
    for (const [key, value] of await api.query.assetConversion.pools.entries()) {
      const poolAssetDataStr = serializeKey(key.args[0].toHuman());
      const poolPairs = JSON.parse(poolAssetDataStr) as [XcmV4Location, XcmV4Location];
      
      // Process both assets in the pair
      const [assetOne, assetTwo] = poolPairs;
      const assetsToProcess = [assetOne, assetTwo];

      for (const asset of assetsToProcess) {

        if (
          asset.parents === '0' &&
          asset.interior?.X2 &&
          asset.interior.X2[0]?.PalletInstance === '50'
        ) {
          // Handle native assets
          const assetId = asset.interior.X2[1]?.GeneralIndex;
          if (assetId !== undefined) {
            const nativeAssetInfo = nativeAssetsInfo.get(assetId);
            if (nativeAssetInfo) {
              uniqueAssets.set(assetId, nativeAssetInfo);
              console.log('Added native asset:', assetId);
            }
          }
        } else {
          // Handle foreign assets
          const normalizedXcmLocation = {
            parents: asset.parents,
            interior: asset.interior
          };
          
          const foreignAssetId = serializeKey(normalizedXcmLocation);
          
          const foreignAssetInfo = foreignAssetsInfo.get(foreignAssetId);
          if (foreignAssetInfo) {
            uniqueAssets.set(foreignAssetId, foreignAssetInfo);
            console.log('Added foreign asset:', foreignAssetId);
          } 
        }
      }

      const tokenPair: TokenPair = {
        pairOne: serializeKey(poolPairs[0]),
        pairTwo: serializeKey(poolPairs[1])
      };
      poolPairsInfo.push(tokenPair);
    }

    fs.writeFileSync(
      'examples/output/uniqueAssets.json', 
      JSON.stringify(Object.fromEntries(uniqueAssets), null, 2)
    );

    return uniqueAssets; // Return uniqueAssets instead of poolPairsInfo
  }
  return null;
}

/**
 * Enriches the unique assets with HydraDX pool information
 */
export async function enrichWithHydraDxData(
  api: ApiPromise, 
  uniqueAssets: Map<string, Asset>
) {
  const poolService = new PoolService(api);
  await poolService.syncRegistry();
  const tradeRouter = new TradeRouter(poolService);
  const hydradxPools = await tradeRouter.getPools();

  const enrichedAssets = new Map<string, Asset>();

  for (const [assetId, assetInfo] of uniqueAssets.entries()) {
    const asset = { ...assetInfo };
    
    // Try to find matching HydraDX pool
    const matchingPool = hydradxPools.find((pool: PoolBase) => {
      return pool.tokens.some(poolAsset => {
        if (asset.asset.isSufficient) {
          // For native assets (from pallet 50)
          return poolAsset.location?.interior?.X2?.[0]?.PalletInstance === '50' &&
                 poolAsset.location?.interior?.X2?.[1]?.GeneralIndex === assetId;
        } else {
          // For foreign assets
          const assetLocation = JSON.parse(assetId); // Since foreign asset IDs are serialized XCM locations
          return poolAsset.location?.parents === assetLocation.parents &&
                 JSON.stringify(poolAsset.location?.interior) === JSON.stringify(assetLocation.interior);
        }
      });
    });

    if (matchingPool) {
      const matchedAsset = matchingPool.tokens.find(a => {
        // Same matching logic as above
        if (asset.asset.isSufficient) {
          return a.location?.interior?.X2?.[0]?.PalletInstance === '50' &&
                 a.location?.interior?.X2?.[1]?.GeneralIndex === assetId;
        } else {
          const assetLocation = JSON.parse(assetId);
          return a.location?.parents === assetLocation.parents &&
                 JSON.stringify(a.location?.interior) === JSON.stringify(assetLocation.interior);
        }
      });

      if (matchedAsset) {
        asset.hydradx = {
          assetId: matchedAsset.id,
          location: matchedAsset.location,
          poolAddress: matchingPool.address,
          poolType: matchingPool.type,
          balance: matchedAsset.balance,
          existentialDeposit: matchedAsset.existentialDeposit
        };
      }
    }

    enrichedAssets.set(assetId, asset);
  }

  // Write enriched assets to file
  fs.writeFileSync(
    'examples/output/enrichedAssets.json',
    JSON.stringify(Object.fromEntries(enrichedAssets), null, 2)
  );

  return enrichedAssets;
}

import CacheManager from '../cache/CacheManager';
import { AssetInfo, AssetMetadata, TokenPair, Asset, XcmV4Location } from './types';
import { ApiPromise } from '@polkadot/api';
import fs from 'fs';


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
  await fetchSystemParachainAssetConversionPoolInfo(nativeAssetsMap, foreignAssetsMap, api);
  return nativeAssetsMap;
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

    return poolPairsInfo;
  }
}

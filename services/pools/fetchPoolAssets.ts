// Portions of this code are derived from the paritytech/asset-transfer-api-registry repository,
// licensed under the Apache License 2.0. See LICENSE-APACHE for details.

// services/DataFetcher.ts
import RpcConnection from '../network/RpcConnection';
import CacheManager from '../cache/CacheManager';
import { AssetInfo, AssetMetadata, PoolPairsInfo, TokenPair } from '../network/types';
import { UnionXcmMultiLocation } from '@substrate/asset-transfer-api/lib/src/createXcmTypes/types';
import { ForeignAssetsInfo } from '../network/types';
import { ApiPromise } from '@polkadot/api';
import fs from 'fs';

interface Asset {
  asset: AssetInfo;
  metadata: AssetMetadata;
}

// Utility function to serialize complex keys
function serializeKey(key: any): string {
  // Remove any undefined or null values to ensure consistent serialization
  const cleanKey = JSON.parse(JSON.stringify(key));
  return JSON.stringify(cleanKey).replace(/(\d),/g, '$1');
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
    if (metadata) {
      const assetDetails: Asset = {
        asset: assetOption.toHuman() as unknown as AssetInfo,
        metadata: metadata.toHuman() as unknown as AssetMetadata
      };
      nativeAssetsMap.set(assetId, assetDetails);
    }
  }

  // Process foreign assets
  for (const [key, assetOption] of foreignAssets) {
    const assetId = serializeKey(key.args[0].toHuman()).replace(/(\d),/g, '$1') ; // Use the utility function
    const metadata = foreignMetadataMap.get(assetId);
    if (metadata) {
      const assetDetails = {
        asset: assetOption.toHuman() as unknown as AssetInfo,
        metadata: metadata.toHuman() as unknown as AssetMetadata
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
      const poolAssetDataStr = JSON.stringify(key.args[0].toHuman()).replace(/(\d),/g, '$1');
      const poolPairs = JSON.parse(poolAssetDataStr) as [UnionXcmMultiLocation, UnionXcmMultiLocation];
      
      // Process both assets in the pair
      const [assetOne, assetTwo] = poolPairs;
      const assetsToProcess = [assetOne, assetTwo];

      for (const asset of assetsToProcess) {
        const xcmAsset = asset as UnionXcmMultiLocation;
        console.log('Processing XCM Asset:', xcmAsset);

        if (
          Number(xcmAsset.parents) === 0 &&
          xcmAsset.interior?.X2 &&
          Number(xcmAsset.interior.X2[0]?.PalletInstance) === 50
        ) {
          // Handle native assets
          const generalIndex = xcmAsset.interior.X2[1]?.GeneralIndex;
          if (generalIndex !== undefined) {
            const assetId = generalIndex.toString();
            const nativeAssetInfo = nativeAssetsInfo.get(assetId);
            if (nativeAssetInfo) {
              uniqueAssets.set(assetId, nativeAssetInfo);
              console.log('Added native asset:', assetId);
            }
          }
        } else {
          // Handle foreign assets
          const normalizedXcmLocation = {
            parents: xcmAsset.parents,
            interior: xcmAsset.interior
          };
          
          const foreignAssetId = serializeKey(normalizedXcmLocation);
          console.log('Looking up foreign asset with ID:', foreignAssetId);
          
          const foreignAssetInfo = foreignAssetsInfo.get(foreignAssetId);
          if (foreignAssetInfo) {
            uniqueAssets.set(foreignAssetId, foreignAssetInfo);
            console.log('Added foreign asset:', foreignAssetId);
          } else {
            console.log('Foreign asset not found:', foreignAssetId);
            console.log('Available foreign asset IDs:', Array.from(foreignAssetsInfo.keys()));
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
      'uniqueAssets.json', 
      JSON.stringify(Object.fromEntries(uniqueAssets), null, 2)
    );

    return poolPairsInfo;
  }
}

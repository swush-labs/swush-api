import { TypedApi } from 'polkadot-api';
import { polkadot_asset_hub } from '@polkadot-api/descriptors';
import { WsProvider } from '@polkadot/api';
import { ApiPromise } from '@polkadot/api';
import { PoolService, TradeRouter } from '@galacticcouncil/sdk';
import CacheManager from '../cache/CacheManager';
import { Asset, AssetType, TokenPair, XcmV4Location } from './types';
import { getXcmV3Multilocation, serializeKey } from './utils';
import fs from 'fs';
import path from 'path';
import { base, degen } from './external';
import { connectPapi, connectPolkadotjs } from '../network/types';
import { RPC_URL } from '../constants';
import { ConnectionManager } from '../network/ConnectionManager';

export class AssetService {
    private static instance: AssetService;
    private cacheManager: CacheManager;
    private connectionManager: ConnectionManager;

    private static readonly CACHE_KEYS = {
        ASSET_HUB_ASSETS: 'asset_hub_assets',
        MERGED_ASSETS: 'merged_assets'
    };

    private constructor() {
        this.cacheManager = CacheManager.getInstance();
        this.connectionManager = ConnectionManager.getInstance();
    }

    public static getInstance(): AssetService {
        if (!AssetService.instance) {
            AssetService.instance = new AssetService();
        }
        return AssetService.instance;
    }

    public async getAssets(forceRefresh = false): Promise<Map<string, Asset>> {
        const cachedAssets = this.cacheManager.get(AssetService.CACHE_KEYS.MERGED_ASSETS);
        if (!forceRefresh && cachedAssets) {
            console.log('Returning cached assets');
            return cachedAssets;
        }
        console.log('Fetching assets from API');

        const api = this.connectionManager.getAssetHubApi();
        if (!api) throw new Error('Asset Hub API not initialized');
        
        const allAssets = await this.fetchAllAssetsPapi(api);
        return allAssets;
    }

    public async fetchAllAssetsPapi(api: TypedApi<typeof polkadot_asset_hub>): Promise<Map<string, Asset>> {
        const cache = CacheManager.getInstance();
    
        // Get all entries in parallel using PAPI
        const [nativeAssets, nativeMetadata, foreignAssets, foreignMetadata] = await Promise.all([
            api.query.Assets.Asset.getEntries(),
            api.query.Assets.Metadata.getEntries(),
            api.query.ForeignAssets.Asset.getEntries(),
            api.query.ForeignAssets.Metadata.getEntries()
        ]);
    
        // Create metadata maps with string keys
        const nativeMetadataMap = new Map(
            nativeMetadata.map(entry => [entry.keyArgs[0].toString(), entry.value])
        );
    
        const foreignMetadataMap = new Map(
            foreignMetadata.map(entry => [serializeKey(entry.keyArgs[0]), entry.value])
        );
    
        const nativeAssetsMap = new Map<string, Asset>();
        const foreignAssetsMap = new Map<string, Asset>();
    
        // Process native assets with string keys
        for (const nativeAsset of nativeAssets) {
            const assetId = nativeAsset.keyArgs[0].toString();
            const metadata = nativeMetadataMap.get(assetId);
    
            if (metadata) {
                const assetDetails: Asset = {
                    asset: {
                        owner: nativeAsset.value.owner,
                        issuer: nativeAsset.value.issuer,
                        admin: nativeAsset.value.admin,
                        freezer: nativeAsset.value.freezer,
                        supply: nativeAsset.value.supply,
                        deposit: nativeAsset.value.deposit,
                        min_balance: nativeAsset.value.min_balance,
                        is_sufficient: nativeAsset.value.is_sufficient,
                        accounts: nativeAsset.value.accounts,
                        sufficients: nativeAsset.value.sufficients,
                        approvals: nativeAsset.value.approvals,
                    },
                    metadata: {
                        deposit: metadata.deposit,
                        name: metadata.name.asText(),
                        symbol: metadata.symbol.asText(),
                        decimals: metadata.decimals,
                        is_frozen: metadata.is_frozen
                    },
                    type: AssetType.Native,
                    xcmLocation: getXcmV3Multilocation(BigInt(assetId))
                };
                nativeAssetsMap.set(assetId, assetDetails);
            }
        }
    
        // Process foreign assets
        for (const foreignAsset of foreignAssets) {
            const assetId = serializeKey(foreignAsset.keyArgs[0]);
            const metadata = foreignMetadataMap.get(assetId);
    
            if (metadata) {
                const assetDetails: Asset = {
                    asset: {
                        owner: foreignAsset.value.owner,
                        issuer: foreignAsset.value.issuer,
                        admin: foreignAsset.value.admin,
                        freezer: foreignAsset.value.freezer,
                        supply: foreignAsset.value.supply,
                        deposit: foreignAsset.value.deposit,
                        min_balance: foreignAsset.value.min_balance,
                        is_sufficient: foreignAsset.value.is_sufficient,
                        accounts: foreignAsset.value.accounts,
                        sufficients: foreignAsset.value.sufficients,
                        approvals: foreignAsset.value.approvals,
                    },
                    metadata: {
                        deposit: metadata.deposit,
                        name: metadata.name.asText(),
                        symbol: metadata.symbol.asText(),
                        decimals: metadata.decimals,
                        is_frozen: metadata.is_frozen
                    },
                    type: AssetType.Foreign,
                    xcmLocation: foreignAsset.keyArgs[0]
                };
                foreignAssetsMap.set(assetId, assetDetails);
            }
        }
    
        // Cache the results
        cache.set('nativeAssets', nativeAssetsMap);
        cache.set('foreignAssets', foreignAssetsMap);
    
        console.log('All assets and metadata fetched and cached');
        await this.fetchPoolsPapi(nativeAssetsMap, foreignAssetsMap);
        return nativeAssetsMap;
    }
    
    public async fetchPoolsPapi(
        nativeAssetsInfo: Map<string, Asset>,
        foreignAssetsInfo: Map<string, Asset>
    ) {
        const api = this.connectionManager.getAssetHubApi();
        if (!api) throw new Error('API not initialized');

        const assetHubAssets = new Map<string, Asset>();
        const poolPairsInfo: TokenPair[] = [];
    
        // Get assets from Asset Hub pools
        const pools = await api.query.AssetConversion.Pools.getEntries();
    
        for (const pool of pools) {
            const poolPairs = pool.keyArgs[0] as [XcmV4Location, XcmV4Location];
            const [assetOne, assetTwo] = poolPairs;
            const assetsToProcess = [assetOne, assetTwo];
    
            for (const asset of assetsToProcess) {
                const { parents, interior } = asset;
                if (
                    parents === 0 &&
                    interior?.type === 'X2' &&
                    interior.value.some((e) => e.type === "PalletInstance" && e.value === 50)
                ) {
                    // Handle native assets
                    for (const entry of interior.value)
                        if (entry.type === "GeneralIndex") {
                            const assetId = entry.value;
                            const nativeAssetInfo = nativeAssetsInfo.get(assetId.toString());
                            if (nativeAssetInfo) {
                                assetHubAssets.set(assetId.toString(), nativeAssetInfo);
                                console.log('Added native asset from Asset Hub:', assetId.toString());
                            }

                        }
                }
                else {
                    // Handle foreign assets
                    const normalizedXcmLocation = {
                        parents: asset.parents,
                        interior: asset.interior
                    };
    
                    const foreignAssetId = serializeKey(normalizedXcmLocation);
                    const foreignAssetInfo = foreignAssetsInfo.get(foreignAssetId);
                    if (foreignAssetInfo) {
                        assetHubAssets.set(foreignAssetId, foreignAssetInfo);
                        console.log('Added foreign asset from Asset Hub:', foreignAssetId);
                    }
                }
            }
    
            poolPairsInfo.push({ pairOne: poolPairs[0], pairTwo: poolPairs[1] });
        }

        //set cache for assetHubAssets
        this.cacheManager.set(AssetService.CACHE_KEYS.ASSET_HUB_ASSETS, assetHubAssets);
    
        const outputDir = path.join(__dirname, 'output');
        fs.mkdirSync(outputDir, { recursive: true });
    
        fs.writeFileSync(
            path.join(outputDir, 'assetHubAssets.json'),
            JSON.stringify(
                Object.fromEntries(assetHubAssets),
                (_, value) => typeof value === 'bigint' ? value.toString() : value,
                2
            )
        );
    
        // Get HydraDX assets and merge them
        const mergedAssets = await this.enrichWithHydraDxData(assetHubAssets, nativeAssetsInfo, foreignAssetsInfo);
    

        // Save final merged assets
        fs.writeFileSync(
            path.join(outputDir, 'mergedAssets.json'),
            JSON.stringify(
                Object.fromEntries(mergedAssets),
                (_, value) => typeof value === 'bigint' ? value.toString() : value,
                2
            )
        );

        //set cache for mergedAssets
        this.cacheManager.set(AssetService.CACHE_KEYS.MERGED_ASSETS, mergedAssets);
    
        return mergedAssets;
    }
    

    public async enrichWithHydraDxData(
        assetHubAssets: Map<string, Asset>,
        nativeAssetsInfo: Map<string, Asset>,
        foreignAssetsInfo: Map<string, Asset>

    ): Promise<Map<string, Asset>> {
        const hydraApi = this.connectionManager.getHydradxApi();
        if (!hydraApi) throw new Error('HydraDX API not initialized');

        const mergedAssets = new Map<string, Asset>(assetHubAssets);
    
        // Helper function to check native asset match and extract assetId
        const getNativeAssetId = (location: any): string | null => {
            if (!location?.interior?.x3) return null;
            const interior = location.interior.x3;
            
            if (!interior.some(j => j.palletInstance === 50) || 
                !interior.some(j => j.parachain === 1000)) {
                return null;
            }
    
            const generalIndexEntry = interior.find(j => j.generalIndex !== undefined);
            return generalIndexEntry ? generalIndexEntry.generalIndex.toString() : null;
        };
    
        // Helper function to check foreign asset match
        const getForeignAssetId = (location: any): string | null => {
            try {
                const normalizedLocation = {
                    parents: location.parents,
                    interior: location.interior
                };
                return serializeKey(normalizedLocation);
            } catch (error) {
                console.error('Error matching foreign asset:', error);
                return null;
            }
        };
    
        try {
            const poolService = new PoolService(hydraApi);
            const externalAssets = [...base, ...degen];
            console.log("Syncing registry with", externalAssets.length, "assets");
            await poolService.syncRegistry(externalAssets);
            const tradeRouter = new TradeRouter(poolService);
            const hydradxPools = await tradeRouter.getPools();
    
            console.log('First HydraDX Pool:', JSON.stringify(hydradxPools[0], null, 2));
    
            // Process all HydraDX pools
            for (const pool of hydradxPools) {
                for (const token of pool.tokens) {
                    const hydradxInfo = {
                        assetId: token.id,
                        location: token.location,
                        poolAddress: pool.address,
                        poolType: pool.type,
                        balance: token.balance,
                        existentialDeposit: token.existentialDeposit
                    };
    
                    // Try to match native asset first
                    const nativeAssetId = getNativeAssetId(token.location);
                    if (nativeAssetId !== null) {
                        const nativeAsset = nativeAssetsInfo.get(nativeAssetId);
                        if (nativeAsset) {
                            const existingAsset = mergedAssets.get(nativeAssetId);
                            
                            if (existingAsset) {
                                existingAsset.hydradx = hydradxInfo;
                                console.log('Updated existing Asset Hub asset with HydraDX info:', nativeAssetId);
                            } else {
                                const newAsset = { ...nativeAsset, hydradx: hydradxInfo };
                                mergedAssets.set(nativeAssetId, newAsset);
                                console.log('Added new native asset from HydraDX:', nativeAssetId);
                            }
                            continue;
                        }
                    }
    
                    // Try to match foreign asset
                    const foreignId = getForeignAssetId(token.location);
                    if (foreignId !== null) {
                        const foreignAsset = foreignAssetsInfo.get(foreignId);
                        if (foreignAsset) {
                            const existingAsset = mergedAssets.get(foreignId);
                            if (existingAsset) {
                                existingAsset.hydradx = hydradxInfo;
                                console.log('Updated existing foreign Asset Hub asset with HydraDX info:', foreignId);
                            } else {
                                const newAsset = { ...foreignAsset, hydradx: hydradxInfo };
                                mergedAssets.set(foreignId, newAsset);
                                console.log('Added new foreign asset from HydraDX:', foreignId);
                            }
                        }
                    }
                }
            }
    
            return mergedAssets;
        } catch (error) {
            console.error('Error enriching with HydraDX data:', error);
            throw error;
        }
    }
}    
    // async function main() {
    //     try {
    //         const { api, client } = await connectPapi(RPC_URL, "asset-hub");
    
    //         await fetchAllAssetsPapi(api);
    //         client.destroy();
    //     } catch (error) {
    //         console.error("Error:", error);
    //     }
    // }
    
    // main();

import { RPC_URL } from "../../services/constants";
import { SS58String, TypedApi } from 'polkadot-api';
import { polkadot_asset_hub, XcmV3Junction, XcmV3Junctions } from '@polkadot-api/descriptors';
import fs from 'fs';
import CacheManager from '../../services/cache/CacheManager';
import { connectPapi } from "../../services/network/types";
import { TradeRouter, PoolService, PoolBase } from '@galacticcouncil/sdk';
import { ApiPromise, WsProvider } from '@polkadot/api';
import { base, degen } from "./external";

//enum for asset type
enum AssetType {
    Native = 'Native',
    Foreign = 'Foreign',
    Hydration = 'Hydration'
}

export type Asset = {
    asset: AssetInfo;
    metadata: AssetMetadata;
    type: AssetType;
    xcmLocation: XcmV4Location;
    hydradx?: {
        assetId: string;
        location: XcmV4Location;
        poolAddress: string;
        poolType: string;
        balance: string;
        existentialDeposit: string;
    };
};

export type AssetMetadata = {
    "deposit": bigint;
    "name": string;
    "symbol": string;
    "decimals": number;
    "is_frozen": boolean;
};

export type AssetInfo = {
    "owner": SS58String;
    "issuer": SS58String;
    "admin": SS58String;
    "freezer": SS58String;
    "supply": bigint;
    "deposit": bigint;
    "min_balance": bigint;
    "is_sufficient": boolean;
    "accounts": number;
    "sufficients": number;
    "approvals": number;
};

export type XcmV4Location = {
    parents: number;
    interior: XcmV3Junctions;
};

export type TokenPair = {
    pairOne: XcmV4Location;
    pairTwo: XcmV4Location;
};

// getXcmV3Multilocation for native asset from assetId
export function getXcmV3Multilocation(assetId: bigint | number): XcmV4Location {
    return {
        parents: 0,
        interior: XcmV3Junctions.X2([
            XcmV3Junction.PalletInstance(50),
            XcmV3Junction.GeneralIndex(BigInt(assetId)),
        ]),
    };
}

function serializeKey(key: any): string {
    // If key is a number or bigint, convert directly to string
    if (typeof key === 'number' || typeof key === 'bigint') {
        return key.toString();
    }

    // If key is an XCM location (for foreign assets), create a deterministic string
    if (key && typeof key === 'object' && 'parents' in key && 'interior' in key) {
        const xcmLocation = key as XcmV4Location;
        // Custom replacer for JSON.stringify to handle BigInt
        const replacer = (_: string, value: any) => {
            if (typeof value === 'bigint') {
                return value.toString();
            }
            return value;
        };
        return `${xcmLocation.parents}-${JSON.stringify(xcmLocation.interior, replacer)}`;
    }

    // Fallback to JSON stringify with BigInt handling
    const replacer = (_: string, value: any) => {
        if (typeof value === 'bigint') {
            return value.toString();
        }
        return value;
    };
    return JSON.stringify(key, replacer);
}

async function fetchAllAssetsPapi(api: TypedApi<typeof polkadot_asset_hub>) {
    const cache = CacheManager.getInstance();

    // Get all entries in parallel using PAPI
    const [nativeAssets, nativeMetadata, foreignAssets, foreignMetadata] = await Promise.all([
        api.query.Assets.Asset.getEntries(),
        api.query.Assets.Metadata.getEntries(),
        api.query.ForeignAssets.Asset.getEntries(),
        api.query.ForeignAssets.Metadata.getEntries()
    ]);

    // Create metadata maps for quick lookup using keyArgs
    const nativeMetadataMap = new Map(
        nativeMetadata.map(entry => [BigInt(entry.keyArgs[0]), entry.value])
    );

    const foreignMetadataMap = new Map(
        foreignMetadata.map(entry => [serializeKey(entry.keyArgs[0]), entry.value])
    );

    const nativeAssetsMap = new Map<bigint, Asset>();
    const foreignAssetsMap = new Map<string, Asset>();

    // Process native assets
    for (const nativeAsset of nativeAssets) {
        const assetId = BigInt(nativeAsset.keyArgs[0]);
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
                xcmLocation: getXcmV3Multilocation(assetId)
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
    await fetchPoolsPapi(nativeAssetsMap, foreignAssetsMap, api);
    return nativeAssetsMap;
}

async function fetchPoolsPapi(
    nativeAssetsInfo: Map<bigint, Asset>,
    foreignAssetsInfo: Map<string, Asset>,
    api: TypedApi<typeof polkadot_asset_hub>
) {
    const poolPairsInfo: TokenPair[] = [];
    const uniqueAssets = new Map<string, Asset>();

    const pools = await api.query.AssetConversion.Pools.getEntries();

    for (const pool of pools) {
        const poolPairs = pool.keyArgs[0] as [XcmV4Location, XcmV4Location];

        // Process both assets in the pair
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
                        //get asset id (already bigint)
                        const assetId = entry.value;
                        const nativeAssetInfo = nativeAssetsInfo.get(assetId);
                        if (nativeAssetInfo) {
                            const xcmLocation = getXcmV3Multilocation(assetId);
                            uniqueAssets.set(assetId.toString(), nativeAssetInfo);
                            console.log('Added native asset:', assetId.toString());
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
                    uniqueAssets.set(foreignAssetId, foreignAssetInfo);
                    console.log('Added foreign asset:', foreignAssetId);
                }
            }
        }

        const tokenPair: TokenPair = {
            pairOne: poolPairs[0],
            pairTwo: poolPairs[1]
        };
        poolPairsInfo.push(tokenPair);
    }

    fs.writeFileSync(
        'output/uniqueAssets.json',
        JSON.stringify(
            Object.fromEntries(uniqueAssets),
            (_, value) => {
                if (typeof value === 'bigint') {
                    return value.toString();
                }
                return value;
            },
            2
        )
    );
    // Enrich with HydraDX data
    const enrichedAssets = await enrichWithHydraDxData(uniqueAssets);

    fs.writeFileSync(
        'output/enrichedAssets.json',
        JSON.stringify(
            Object.fromEntries(enrichedAssets),
            (_, value) => {
                if (typeof value === 'bigint') {
                    return value.toString();
                }
                return value;
            },
            2
        )
    );

    return enrichedAssets;
}

/**
 * Enriches the unique assets with HydraDX pool information
 */
async function enrichWithHydraDxData(uniqueAssets: Map<string, Asset>) {
    const wsProvider = new WsProvider('wss://rpc.hydradx.cloud');
    const hydraApi = await ApiPromise.create({ provider: wsProvider });

    try {
        const poolService = new PoolService(hydraApi);
        const externalAssets = [...base, ...degen];
        console.log("Syncing registry with", externalAssets.length, "assets");
        await poolService.syncRegistry(externalAssets);
        const tradeRouter = new TradeRouter(poolService);
        const hydradxPools = await tradeRouter.getPools();

        console.log('First HydraDX Pool:', JSON.stringify(hydradxPools[0], null, 2));

        const enrichedAssets = new Map<string, Asset>();

        // Helper function to check native asset match
        const isNativeAssetMatch = (location: any, assetId: string) => {
            if (!location?.interior?.x3) return false;
            const interior = location.interior.x3;
            return interior.some(j => j.palletInstance === 50) && 
                   interior.some(j => j.generalIndex === Number(assetId)) &&
                   interior.some(j => j.parachain === 1000);
        };

        // // Helper function to check foreign asset match
        // const isForeignAssetMatch = (poolLocation: any, assetLocation: XcmV4Location) => {
        //     try {
        //         const normalizedPoolLocation = {
        //             parents: poolLocation.parents,
        //             interior: poolLocation.interior
        //         };
        //         const normalizedAssetLocation = {
        //             parents: assetLocation.parents,
        //             interior: assetLocation.interior
        //         };
        //         return serializeKey(normalizedPoolLocation) === serializeKey(normalizedAssetLocation);
        //     } catch (error) {
        //         console.error('Error matching foreign asset:', error);
        //         return false;
        //     }
        // };

        for (const [assetId, assetInfo] of uniqueAssets.entries()) {
            const asset = { ...assetInfo };
            
            // Store all pools where this asset appears
            const matchingPools: Array<{
                pool: PoolBase;
                token: any;
            }> = [];

            // Check all pools for matches
            for (const pool of hydradxPools) {
                // Check both tokens in the pool
                for (const token of pool.tokens) {
                    if (asset.type === AssetType.Native && isNativeAssetMatch(token.location, assetId)) {
                        matchingPools.push({ pool, token });
                    }
                }
            }

            // If we found any matches, use the first one
            // You could also implement logic to choose the best pool based on some criteria
            if (matchingPools.length > 0) {
                const { pool, token } = matchingPools[0];
                asset.hydradx = {
                    assetId: token.id,
                    location: token.location,
                    poolAddress: pool.address,
                    poolType: pool.type,
                    balance: token.balance,
                    existentialDeposit: token.existentialDeposit
                };
                console.log('Matched asset:', assetId, 'with HydraDX asset:', token.id);
                console.log('Found in', matchingPools.length, 'pools');
            }

            enrichedAssets.set(assetId, asset);
        }

        return enrichedAssets;
    } finally {
        await hydraApi.disconnect();
    }
}

async function main() {
    try {
        const { api, client } = await connectPapi(RPC_URL, "asset-hub");

        await fetchAllAssetsPapi(api);
        client.destroy();
    } catch (error) {
        console.error("Error:", error);
    }
}

main();
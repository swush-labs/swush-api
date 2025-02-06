import { RPC_URL } from "../../services/constants";
import { SS58String, TypedApi } from 'polkadot-api';
import { polkadot_asset_hub, XcmV3Junction, XcmV3Junctions } from '@polkadot-api/descriptors';
import fs from 'fs';
import CacheManager from '../../services/cache/CacheManager';
import { connectPapi } from "../../services/network/types";
import { TradeRouter, PoolService, PoolBase } from '@galacticcouncil/sdk';
import { ApiPromise, WsProvider } from '@polkadot/api';
import { base, degen } from "./external";
import path from 'path';

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
                        const nativeAssetInfo = nativeAssetsInfo.get(assetId);
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
    const mergedAssets = await enrichWithHydraDxData(assetHubAssets, nativeAssetsInfo, foreignAssetsInfo);

    // Save final merged assets
    fs.writeFileSync(
        path.join(outputDir, 'mergedAssets.json'),
        JSON.stringify(
            Object.fromEntries(mergedAssets),
            (_, value) => typeof value === 'bigint' ? value.toString() : value,
            2
        )
    );

    return mergedAssets;
}

async function enrichWithHydraDxData(
    assetHubAssets: Map<string, Asset>,
    nativeAssetsInfo: Map<bigint, Asset>,
    foreignAssetsInfo: Map<string, Asset>
): Promise<Map<string, Asset>> {
    const wsProvider = new WsProvider('wss://rpc.hydradx.cloud');
    const hydraApi = await ApiPromise.create({ provider: wsProvider });
    const mergedAssets = new Map<string, Asset>(assetHubAssets);

    // Helper function to check native asset match and extract assetId
    const getNativeAssetId = (location: any): bigint | null => {
        if (!location?.interior?.x3) return null;
        const interior = location.interior.x3;
        
        if (!interior.some(j => j.palletInstance === 50) || 
            !interior.some(j => j.parachain === 1000)) {
            return null;
        }

        const generalIndexEntry = interior.find(j => j.generalIndex !== undefined);
        return generalIndexEntry ? BigInt(generalIndexEntry.generalIndex) : null;
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
                        const assetIdStr = nativeAssetId.toString();
                        const existingAsset = mergedAssets.get(assetIdStr);
                        
                        if (existingAsset) {
                            existingAsset.hydradx = hydradxInfo;
                            console.log('Updated existing Asset Hub asset with HydraDX info:', assetIdStr);
                        } else {
                            const newAsset = { ...nativeAsset, hydradx: hydradxInfo };
                            mergedAssets.set(assetIdStr, newAsset);
                            console.log('Added new native asset from HydraDX:', assetIdStr);
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
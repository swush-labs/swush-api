import { UnionXcmMultiLocation } from "@substrate/asset-transfer-api/lib/src/createXcmTypes/types";
import { initializeRegistry } from "../services/registry/XCMRegistry";
import { ForeignAssetsData, ForeignAssetsInfo } from "../services/registry/types-xcm";
import { CACHE_KEYS } from "../services/constants";
import CacheManager from "../services/cache/CacheManager";

async function main() {
    const xcAssets = await initializeRegistry();
    // //store lpToken and pairInfo of PoolPairsData in a dataset
    // const poolPairs = [] as { lpToken: string; pairInfo: [[UnionXcmMultiLocation, UnionXcmMultiLocation]] }[];
    // for (const chain in xcAssets.polkadot) {    
    //     for (const pool in xcAssets.polkadot[chain].poolPairsInfo) {
    //         const poolData = xcAssets.polkadot[chain].poolPairsInfo[pool];
    //         poolPairs.push({
    //             lpToken: poolData.lpToken,
    //             pairInfo: poolData.pairInfo
    //         });
    //     }
    // }

    const cacheManager = CacheManager.getInstance();
    const foreignAssetsInfo = cacheManager.get(CACHE_KEYS.CN_XCM_REGISTRY_FOREIGN_ASSETS);
    //print foreignAssetsInfo of polkadot and all assets
    for (const asset in foreignAssetsInfo) {
    
         //print asset details of asset of multiLocation and print parent and interior
         console.log("parent:", JSON.stringify(foreignAssetsInfo[asset].multiLocation.parents, null, 2));
         console.log("interior:", JSON.stringify(foreignAssetsInfo[asset].multiLocation.interior, null, 2));
    }
}

main();
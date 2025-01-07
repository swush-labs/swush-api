import { UnionXcmMultiLocation } from "@substrate/asset-transfer-api/lib/src/createXcmTypes/types";
import { initializeRegistry } from "../services/registry/XCMRegistry";

async function main() {
    const xcAssets = await initializeRegistry();

    //store lpToken and pairInfo of PoolPairsData in a dataset
    const poolPairs = [] as { lpToken: string; pairInfo: [[UnionXcmMultiLocation, UnionXcmMultiLocation]] }[];
    for (const chain in xcAssets.polkadot) {    
        for (const pool in xcAssets.polkadot[chain].poolPairsInfo) {
            const poolData = xcAssets.polkadot[chain].poolPairsInfo[pool];
            poolPairs.push({
                lpToken: poolData.lpToken,
                pairInfo: poolData.pairInfo
            });
        }
    }
    // //print lpToken and pairInfo of PoolPairsData
    // for (const chain in xcAssets.polkadot) {    
    //     for (const pool in xcAssets.polkadot[chain].poolPairsInfo) {
    //         const poolData = xcAssets.polkadot[chain].poolPairsInfo[pool];
    //         console.log(`lpToken: ${poolData.lpToken}, pairInfo: ${poolData.pairInfo}`);
    //     }
    // }
}

main();
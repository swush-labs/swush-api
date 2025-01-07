import { initializeRegistry } from "../services/registry/XCMRegistry";

async function main() {
    const xcAssets = await initializeRegistry();
    //print lpToken and pairInfo of PoolPairsData
    for (const chain in xcAssets.polkadot) {    
        for (const pool in xcAssets.polkadot[chain].poolPairsInfo) {
            const poolData = xcAssets.polkadot[chain].poolPairsInfo[pool];
            console.log(`lpToken: ${poolData.lpToken}, pairInfo: ${poolData.pairInfo}`);
        }
    }
}

main();
//fetch xcAssets and check if type is correct

import { XcAssets } from "../services/registry/types-xcassets";
import { fetchXcAssetData } from "../services/registry/XCMRegistry";


// add a main function
async function main() {
    const xcAssets = await fetchXcAssetData();
    //print into a file
    const fs = require('fs');
    fs.writeFileSync('xcAssets.json', JSON.stringify(xcAssets, null, 2));
}

main();
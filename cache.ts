//write a cache manager with main and sub cache

import CacheManager from "./services/CacheManager";

function main() {
    const cache = CacheManager.getInstance();
    // Define a nested object structure
    const nestedData = {
        id: 'nested1',
        metadata: {
            tokens: [
                { name: 'TokenA', amount: 100 },
                { name: 'TokenB', amount: 200 },
            ],
        },
        update: () => {
            console.log('Update function called!');
        },
    };

    // Store the nested data
    cache.set('nestedKey', nestedData);
    // Retrieve and use the nested data
    const retrievedNestedData = cache.get('nestedKey');
    if (retrievedNestedData) {
        console.log(retrievedNestedData.metadata.tokens); // Output: [{ name: 'TokenA', amount: 100 }, { name: 'TokenB', amount: 200 }]
        retrievedNestedData.update(); // Output: Update function called!
    }

}

main();

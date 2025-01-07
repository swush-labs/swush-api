import {ChainInfoRegistry, ChainInfoKeys} from '@substrate/asset-transfer-api/lib/src/registry/types';

export const CDN_URL = 'https://paritytech.github.io/asset-transfer-api-registry/registry.json';

export async function initializeRegistry() {
    let data;
    try {
        data = await fetch(CDN_URL);
    } catch (e) {
        throw new Error(
            'Failed to fetch XCM registry from CDN',
        );
    }
    const fetchedRegistry = (await data.json()) as ChainInfoRegistry<ChainInfoKeys>;
}

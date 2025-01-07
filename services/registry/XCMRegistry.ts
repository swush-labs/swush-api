import {ChainInfoRegistry, ChainInfoKeys} from '@substrate/asset-transfer-api/lib/src/registry/types';
import {XcAssets} from './types';
import {
    ASSET_TRANSFER_API_XCM_REGISTRY_URL,
    XC_ASSET_CDN_URL
} from '../constants';

export async function initializeRegistry() {
    let data;
    try {
        data = await fetch(ASSET_TRANSFER_API_XCM_REGISTRY_URL);
    } catch (e) {
        throw new Error(
            'Failed to fetch XCM registry from CDN',
        );
    }
    const fetchedRegistry = (await data.json()) as ChainInfoRegistry<ChainInfoKeys>;
    return fetchedRegistry;
}

export async function fetchXcAssetData(): Promise<{ xcAssets: XcAssets }> {
	const xcAssetsRegistry = (await (await fetch(XC_ASSET_CDN_URL)).json()) as {
		xcAssets: XcAssets;
	};

	return xcAssetsRegistry;
};
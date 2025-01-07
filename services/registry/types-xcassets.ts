import type { AnyJson } from '@polkadot/types/types';

export type XcAssets = {
	polkadot: XcAssetsInfo[];
	kusama: XcAssetsInfo[];
};

export type XcAssetsInfo = {
	relayChain: string;
	paraID: number;
	id: string;
	xcAssetCnt: string;
	data: XcAssetsData[];
};

export type XcAssetsData = {
	paraID: number;
	relayChain: string;
	nativeChainID: string | null;
	symbol: string;
	decimals: number;
	interiorType: string;
	xcmV1Standardized: (XcAssetXcmStandardized | string)[];
	xcmV1MultiLocation: AnyJson;
	asset: Object | string;
	source: string[];
	xcmV1MultiLocationByte?: `0x${string}`;
};

export type SanitizedXcAssetsData = {
	paraID: number;
	nativeChainID: string | null;
	symbol: string;
	decimals: number;
	xcmV1MultiLocation: string;
	asset: Object | string;
	assetHubReserveLocation: string;
	originChainReserveLocation?: string | undefined;
};

export type XcAssetXcmStandardized = {
	[x: string]: string | number | undefined;
};

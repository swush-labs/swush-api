		
export type XcAssets = {
	polkadot: XcAssetsInfo[];
	kusama: XcAssetsInfo[];
};

export type XcAssetsInfo = {
	relayChain: string;
	paraID: number;
	id: string;
	xcAssetCnt: string;
	data: AssetData[];
};

export type AssetData = {
    asset: Asset;
    name: string;
    symbol: string;
    decimals: number;
    xcmInteriorKey?: string; // Optional as it is not in all objects
    inferred?: boolean; // Optional as it is not in all objects
    confidence?: number; // Optional as it is not in all objects
    currencyID?: string; // Optional as it is not in all objects
}

export type Asset = {
    Token: string;
}


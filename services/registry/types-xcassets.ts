import type { UnionXcmMultiLocation } from '@substrate/asset-transfer-api/lib/src/createXcmTypes/types';


export type Assets = {
    assets: {
        polkadot: XcAssetsInfo[];
        kusama: XcAssetsInfo[];
    };
    xcAssets: {
        polkadot: XcAssetsXCMInfo[];
        kusama: XcAssetsXCMInfo[];
    };
};

export type XcAssetsInfo = {
    relayChain: string;
    paraID: number;
    id: string | null;
    assetCnt: string;
    data: AssetData[];
};

export type XcAssetsXCMInfo = {
    relayChain: string;
    paraID: number;
    id: string;
    xcAssetCnt: string;
    data: XCMAssetData[];
};

export type AssetData = {
    asset: Asset;
    name: string;
    symbol: string;
    decimals: number;
    xcmInteriorKey?: string;
    inferred?: boolean;
    confidence?: number;
    currencyID?: string | { ForeignAsset: string };
};

export type XCMAssetData = {
    paraID: number;
    relayChain: string;
    nativeChainID: string;
    symbol: string;
    decimals: number;
    interiorType: string;
    xcmV1Standardized: XCMStandardized[];
    xcmV1MultiLocation: XCMV1MultiLocation;
    asset: Asset | { ForeignAsset: string };
    source: string[];
};

export type XCMV1MultiLocation = {
    v1: UnionXcmMultiLocation
}


export type XCMStandardized = {
    network?: string;
    parachain?: number;
    palletInstance?: number;
    generalIndex?: number;
    generalKey?: string;
};


export type Asset = {
    Token: string;
};
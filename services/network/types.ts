import { UnionXcmMultiLocation } from "@substrate/asset-transfer-api/lib/src/createXcmTypes/types";

export interface AssetInfo {
  supply: string;
  owner: string;
  status: string;
  issuer: string;
  admin: string;
  freezer: string;
  minBalance: string;
  isSufficient: boolean;
  accounts: string;
  sufficients: string;
  approvals: string;
}

export interface AssetMetadata {
  name: string;
  symbol: string;
  decimals: number;
  isFrozen: boolean;
  deposit: string;
}

export type ForeignAssetsInfo = Map<UnionXcmMultiLocation, {
  name: string;
  symbol: string;
  decimals: number;
  isFrozen: boolean;
  deposit: string;
}>;

export type PoolPairsData = {
	[key: string]: {
		lpToken: string;
		pairInfo: [[UnionXcmMultiLocation,UnionXcmMultiLocation]]
	};
};
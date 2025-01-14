// Portions of this code are derived from the paritytech/asset-transfer-api-registry repository,
// licensed under the Apache License 2.0. See LICENSE-APACHE for details.

import { AnyJson } from "@polkadot/types/types";
import { XcmV2Network } from "@substrate/asset-transfer-api/lib/src/createXcmTypes/types";
import { RequireOnlyOne } from "@substrate/asset-transfer-api/lib/src/types";

export interface Asset {
  asset: AssetInfo;
  metadata: AssetMetadata;
}

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

export type PoolPairsInfo = {
		lpToken: string;
		pairInfo: TokenPair;
};

export type TokenPair = {
	pairOne: string;
	pairTwo: string;
};

export type XcmV4Location = {
  parents: string;
  interior: RequireOnlyOne<XcmV4Junctions>;
};
export interface XcmV4Junctions {
  Here: '' | null;
  X1: [XcmV4Junction];
  X2: [XcmV4Junction, XcmV4Junction];
  X3: [XcmV4Junction, XcmV4Junction, XcmV4Junction];
  X4: [XcmV4Junction, XcmV4Junction, XcmV4Junction, XcmV4Junction];
  X5: [XcmV4Junction, XcmV4Junction, XcmV4Junction, XcmV4Junction, XcmV4Junction];
  X6: [XcmV4Junction, XcmV4Junction, XcmV4Junction, XcmV4Junction, XcmV4Junction, XcmV4Junction];
  X7: [XcmV4Junction, XcmV4Junction, XcmV4Junction, XcmV4Junction, XcmV4Junction, XcmV4Junction, XcmV4Junction];
  X8: [
      XcmV4Junction,
      XcmV4Junction,
      XcmV4Junction,
      XcmV4Junction,
      XcmV4Junction,
      XcmV4Junction,
      XcmV4Junction,
      XcmV4Junction
  ];
}
export type XcmV4Junction = RequireOnlyOne<XcmV4JunctionBase>;
export type XcmV4JunctionBase = {
  Parachain: string;
  AccountId32: {
      network?: XcmV2Network;
      id: string;
  };
  AccountIndex64: {
      network?: XcmV2Network;
      id: string;
  };
  AccountKey20: {
      network?: XcmV2Network;
      id: string;
  };
  PalletInstance: string;
  GeneralIndex: string | number;
  GeneralKey: string;
  OnlyChild: AnyJson;
  Plurality: {
      id: AnyJson;
      part: AnyJson;
  };
  GlobalConsensus: string | AnyJson;
};
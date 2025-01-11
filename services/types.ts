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

export interface PoolInfo {
  poolId: string;
  assetDetails?: AssetDetails | null;
  // Add other pool-specific fields based on your API response
  lpToken?: string;
  liquidityTotal?: string;
  // ... other pool fields
} 
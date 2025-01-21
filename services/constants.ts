export const PARITY_XCM_REGISTRY_URL = 'https://paritytech.github.io/asset-transfer-api-registry/registry.json';
export const COLORFULNOTION_XCM_GLOBAL_REGISTRY_URL = 'https://cdn.jsdelivr.net/gh/colorfulnotion/xcm-global-registry/metadata/xcmgar.json'; 

export const CACHE_KEYS = {
    PARITY_XCM_REGISTRY: 'parity_xcm_registry',
    CN_XCM_REGISTRY: 'cn_xcm_registry',
    CN_XCM_REGISTRY_AH_NATIVE_ASSETS: 'cn_xcm_registry_ah_native_assets',
    CN_XCM_REGISTRY_XC_ASSETS: 'cn_xcm_registry_xc_assets',
    CN_XCM_REGISTRY_FOREIGN_ASSETS: 'cn_xcm_registry_foreign_assets'
};

export const NETWORKS_SUPPORTED = ['polkadot'];

export const RPC_URL = 'wss://asset-hub-polkadot.dotters.network';
//TEST_RPC
export const TEST_RPC = 'ws://localhost:8000'
export const TEST_RPC_ASSET_HUB = 'ws://localhost:3421'
export const TEST_RPC_POLKADOT = 'ws://localhost:3420'
export const TEST_RPC_PARACHAIN_HYDRATION = 'ws://localhost:3422'

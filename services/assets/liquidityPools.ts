//fetch liquidity pools from initializeRegistry and return them

import CacheManager from "../cache/CacheManager";
import { CACHE_KEYS } from "../constants";

export function getLiquidityPools() {
    const cacheManager = CacheManager.getInstance();
    const liquidityPools = cacheManager.get(CACHE_KEYS.PARITY_XCM_REGISTRY);
    return liquidityPools;
}

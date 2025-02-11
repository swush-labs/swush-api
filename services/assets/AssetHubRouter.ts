import { TypedApi } from 'polkadot-api';
import { polkadot_asset_hub } from '@polkadot-api/descriptors';
import { TokenGraph } from './TokenGraph';
import { Asset } from './types';


export interface RouteQuote {
    path: string[];
    expectedOutput: bigint;
    hops: {
        from: string;
        to: string;
        amountIn: bigint;
        amountOut: bigint;
    }[];
}

export class AssetHubRouter {
    private tokenGraph: TokenGraph;
    private api: TypedApi<typeof polkadot_asset_hub>;
    private assetMap: Map<string, Asset>;

    constructor(
        api: TypedApi<typeof polkadot_asset_hub>,
        assetMap: Map<string, Asset>
    ) {
        this.api = api;
        this.assetMap = assetMap;
        this.tokenGraph = new TokenGraph();
        
        // Initialize graph with ALL assets
        for (const [assetId, asset] of assetMap) {
            this.tokenGraph.addNode(assetId, asset);
        }
        return this;
    }

    // Add method to expose graph
    public getTokenGraph(): TokenGraph {
        return this.tokenGraph;
    }

    // Method to initialize from cached graph
    public static fromCachedGraph(
        api: TypedApi<typeof polkadot_asset_hub>,
        assetMap: Map<string, Asset>,
        cachedGraph: TokenGraph
    ): AssetHubRouter {
        const router = new AssetHubRouter(api, assetMap);
        router.tokenGraph = cachedGraph;
        return router;
    }

    public addPool(assetOneId: string, assetTwoId: string): void {
        // Add edge without liquidity - we'll fetch it real-time when needed
        this.tokenGraph.addEdge(
            assetOneId,
            assetTwoId,
            `${assetOneId}-${assetTwoId}`,
            BigInt(0), // Placeholder liquidity
            0.003,
            'assetHub'
        );
    }

    public async findBestRoute(
        fromAssetId: string,
        toAssetId: string,
        amountIn: bigint
    ): Promise<RouteQuote | null> {
        try {
            // Find all possible paths up to 3 hops
            const paths = this.tokenGraph.findAllPaths(fromAssetId, toAssetId, 3, 'assetHub');
            if (paths.length === 0) return null;

            // Get quotes for all paths in parallel using batch calls
            const pathQuotes = await Promise.all(
                paths.map(path => this.calculatePathQuoteWithBatch(path, amountIn))
            );

            const validQuotes = pathQuotes.filter((quote): quote is RouteQuote => quote !== null);
            if (validQuotes.length === 0) return null;

            // Return the path with highest output amount
            return validQuotes.reduce((best, current) => 
                current.expectedOutput > best.expectedOutput ? current : best
            );

        } catch (error) {
            console.error('Error finding route:', error);
            return null;
        }
    }

    private async calculatePathQuoteWithBatch(
        path: string[],
        amountIn: bigint
    ): Promise<RouteQuote | null> {
        try {
            const hops: RouteQuote['hops'] = [];
            
            // Prepare pathAssets of type Asset
            const pathAssets: { from: Asset, to: Asset }[] = [];

            for (let i = 0; i < path.length - 1; i++) {
                const fromAsset = this.assetMap.get(path[i]);
                const toAsset = this.assetMap.get(path[i + 1]);
                
                if (!fromAsset || !toAsset) return null;
                pathAssets.push({ from: fromAsset, to: toAsset });
            }

            // Calculate quotes for each hop
            let currentAmount = amountIn;
            let toAssetDecimals = 0;
            
            for (let i = 0; i < pathAssets.length; i++) {
                const { from: fromAsset, to: toAsset } = pathAssets[i];

                // Get quote for this hop including fee calculation
                const quote = await this.api.apis.AssetConversionApi.quote_price_exact_tokens_for_tokens(
                    fromAsset.xcmLocation,
                    toAsset.xcmLocation,
                    currentAmount,
                    true // include_fee parameter
                );

                if (!quote) return null;

                hops.push({
                    from: path[i],
                    to: path[i + 1],
                    amountIn: currentAmount,
                    amountOut: quote
                });

                toAssetDecimals = toAsset.metadata.decimals;
                currentAmount = quote;
            }

            const finalAmount = currentAmount / BigInt(10 ** toAssetDecimals);
            return {
                path,
                expectedOutput: finalAmount,
                hops
            };

        } catch (error) {
            console.error('Error calculating path quote:', error);
            return null;
        }
    }

    // private calculateHopPriceImpact(
    //     amountIn: bigint,
    //     amountOut: bigint,
    //     reserves: [bigint, bigint]
    // ): number {
    //     // Calculate price impact based on reserves and amounts
    //     const k = reserves[0] * reserves[1];
    //     const newReserve0 = reserves[0] + amountIn;
    //     const newReserve1 = k / newReserve0;
    //     const expectedOut = reserves[1] - newReserve1;
        
    //     return Number((expectedOut - amountOut) * BigInt(10000) / expectedOut) / 10000;
    // }

    // // Helper method to execute the multi-hop swap
    // public async executeSwap(
    //     route: RouteQuote,
    //     recipient: string,
    //     slippageTolerance: number = 0.01 // 1% default slippage
    // ) {
    //     const minOutput = route.expectedOutput * BigInt(Math.floor((1 - slippageTolerance) * 1000)) / BigInt(1000);
        
    //     // For multi-hop swaps, we use swap_exact_tokens_for_tokens with the full path
    //     const path = route.path.map(assetId => {
    //         const asset = this.assetMap.get(assetId);
    //         if (!asset) throw new Error(`Asset not found: ${assetId}`);
    //         return asset.xcmLocation;
    //     });

    //     return this.api.tx.AssetConversion.swap_exact_tokens_for_tokens({
    //         path,
    //         amount_in: route.hops[0].amountIn,
    //         amount_out_min: minOutput,
    //         send_to: recipient,
    //         keep_alive: true
    //     });
    // }
}


/*

// In your application code

// In your application code
async function findRoute(
    fromAssetId: string,
    toAssetId: string,
    amount: bigint
): Promise<RouteQuote | null> {
    const assetService = AssetService.getInstance();
    const cacheManager = CacheManager.getInstance();
    const connectionManager = ConnectionManager.getInstance();
    
    // Get cached graph and assets
    const cachedGraph = cacheManager.get('token_graph');
    const assets = await assetService.getAssets();
    const api = connectionManager.getAssetHubApi();
    
    if (!cachedGraph || !api) {
        throw new Error('Graph or API not initialized');
    }

    // Create router with cached graph
    const router = AssetHubRouter.fromCachedGraph(api, assets, cachedGraph);
    
    // Get real-time route
    return router.findBestRoute(fromAssetId, toAssetId, amount);
}
} */
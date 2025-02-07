import { TypedApi } from 'polkadot-api';
import { polkadot_asset_hub } from '@polkadot-api/descriptors';
import { TokenGraph } from './TokenGraph';
import { Asset, XcmV4Location } from '../types';

export interface RouteQuote {
    path: string[];
    expectedOutput: bigint;
    hops: {
        from: string;
        to: string;
        amountIn: bigint;
        amountOut: bigint;
        reserves: [bigint, bigint];
        priceImpact: number;
    }[];
    totalPriceImpact: number;
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
        this.tokenGraph = this.initializeGraph(assetMap);
    }

    private initializeGraph(assets: Map<string, Asset>): TokenGraph {
        const graph = new TokenGraph();
        
        // Add all assets as nodes
        for (const [assetId, asset] of assets) {
            graph.addNode(assetId, asset);
        }
        
        return graph;
    }

    public async initializePools(): Promise<void> {
        const pools = await this.api.query.AssetConversion.Pools.getEntries();
        
        for (const pool of pools) {
            const [assetOne, assetTwo] = pool.keyArgs[0] as [XcmV4Location, XcmV4Location];
            const assetOneId = this.getAssetIdFromLocation(assetOne);
            const assetTwoId = this.getAssetIdFromLocation(assetTwo);

            if (assetOneId && assetTwoId) {
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
        }
    }

    public async findBestRoute(
        fromAssetId: string,
        toAssetId: string,
        amountIn: bigint
    ): Promise<RouteQuote | null> {
        try {
            // Find all possible paths
            const paths = this.tokenGraph.findAllPaths(fromAssetId, toAssetId, 3, 'assetHub');
            if (paths.length === 0) return null;

            // Calculate metrics for each path with real-time data
            const pathQuotes = await Promise.all(
                paths.map(path => this.calculatePathQuote(path, amountIn))
            );

            // Filter out failed quotes and find best route
            const validQuotes = pathQuotes.filter((quote): quote is RouteQuote => quote !== null);
            if (validQuotes.length === 0) return null;

            return validQuotes.reduce((best, current) => 
                current.expectedOutput > best.expectedOutput ? current : best
            );

        } catch (error) {
            console.error('Error finding route:', error);
            return null;
        }
    }

    private async calculatePathQuote(
        path: string[],
        amountIn: bigint
    ): Promise<RouteQuote | null> {
        try {
            let currentAmount = amountIn;
            const hops: RouteQuote['hops'] = [];

            for (let i = 0; i < path.length - 1; i++) {
                const fromAssetId = path[i];
                const toAssetId = path[i + 1];
                
                const fromAsset = this.assetMap.get(fromAssetId);
                const toAsset = this.assetMap.get(toAssetId);
                
                if (!fromAsset || !toAsset) continue;

                // Get real-time reserves
                const reserves = await this.api.call.assetConversionApi.getReserves(
                    fromAsset.xcmLocation,
                    toAsset.xcmLocation
                );

                if (!reserves) continue;

                // Get quote for this hop
                const quote = await this.api.call.assetConversionApi.quotePriceExactTokensForTokens(
                    fromAsset.xcmLocation,
                    toAsset.xcmLocation,
                    currentAmount
                );

                if (!quote) continue;

                const priceImpact = this.calculateHopPriceImpact(
                    currentAmount,
                    BigInt(quote),
                    reserves
                );

                hops.push({
                    from: fromAssetId,
                    to: toAssetId,
                    amountIn: currentAmount,
                    amountOut: BigInt(quote),
                    reserves: [BigInt(reserves[0]), BigInt(reserves[1])],
                    priceImpact
                });

                currentAmount = BigInt(quote);
            }

            if (hops.length !== path.length - 1) return null;

            const totalPriceImpact = hops.reduce((total, hop) => total + hop.priceImpact, 0);

            return {
                path,
                expectedOutput: hops[hops.length - 1].amountOut,
                hops,
                totalPriceImpact
            };

        } catch (error) {
            console.error('Error calculating path quote:', error);
            return null;
        }
    }

    private calculateHopPriceImpact(
        amountIn: bigint,
        amountOut: bigint,
        reserves: [bigint, bigint]
    ): number {
        // Calculate price impact based on reserves and amounts
        const k = reserves[0] * reserves[1];
        const newReserve0 = reserves[0] + amountIn;
        const newReserve1 = k / newReserve0;
        const expectedOut = reserves[1] - newReserve1;
        
        return Number((expectedOut - amountOut) * BigInt(10000) / expectedOut) / 10000;
    }

    private getAssetIdFromLocation(location: XcmV4Location): string | null {
        for (const [assetId, asset] of this.assetMap) {
            if (this.compareXcmLocations(asset.xcmLocation, location)) {
                return assetId;
            }
        }
        return null;
    }

    private compareXcmLocations(a: XcmV4Location, b: XcmV4Location): boolean {
        // Implement XCM location comparison logic
        return JSON.stringify(a) === JSON.stringify(b);
    }
}
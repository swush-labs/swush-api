import { TypedApi } from 'polkadot-api';
import { polkadot_asset_hub } from '@polkadot-api/descriptors';
import { Asset, XcmV4Location } from './types';

export interface Node {
    assetId: string;      // Using assetId as unique identifier
    asset: Asset;         // Full asset details
    xcmLocation: XcmV4Location;
}

export interface Edge {
    from: string;         // assetId of from token
    to: string;          // assetId of to token
    poolId: string;
    liquidity: bigint;
    fee: number;
    dex: 'assetHub' | 'hydraDx';
    poolType?: string;    // For HydraDX different pool types
}

export interface HopInfo {
    from: string;
    to: string;
    amountIn: bigint;
    amountOut: bigint;
    fee: number;
    liquidity: bigint;
    poolId: string;
    dex: string;
}

export interface PathMetrics {
    path: string[];
    hops: HopInfo[];
    totalOutput: bigint;
    totalFee: number;
    minLiquidity: bigint;
    priceImpact: number;
}

export class TokenGraph {
    private nodes: Map<string, Node> = new Map();
    private adjacencyList: Map<string, Edge[]> = new Map();

    addNode(assetId: string, asset: Asset) {
        this.nodes.set(assetId, {
            assetId,
            asset,
            xcmLocation: asset.xcmLocation
        });
        if (!this.adjacencyList.has(assetId)) {
            this.adjacencyList.set(assetId, []);
        }
    }

    addEdge(
        fromAssetId: string,
        toAssetId: string,
        poolId: string,
        liquidity: bigint,
        fee: number,
        dex: 'assetHub' | 'hydraDx',
        poolType?: string
    ) {
        if (!this.nodes.has(fromAssetId) || !this.nodes.has(toAssetId)) {
            throw new Error(`One or both assets not found: ${fromAssetId}, ${toAssetId}`);
        }

        // Create bidirectional edges for the pool
        const edge: Edge = { 
            from: fromAssetId, 
            to: toAssetId, 
            poolId, 
            liquidity, 
            fee, 
            dex, 
            poolType 
        };
        this.adjacencyList.get(fromAssetId)?.push(edge);
        
        const reverseEdge: Edge = { 
            ...edge, 
            from: toAssetId, 
            to: fromAssetId 
        };
        this.adjacencyList.get(toAssetId)?.push(reverseEdge);
    }

    getNode(assetId: string): Node | undefined {
        return this.nodes.get(assetId);
    }

    getEdge(fromAssetId: string, toAssetId: string): Edge | undefined {
        return this.adjacencyList.get(fromAssetId)?.find(edge => edge.to === toAssetId);
    }

    findAllPaths(
        startAssetId: string,
        endAssetId: string,
        maxHops: number = 3,
        preferredDex?: string
    ): string[][] {
        if (!this.nodes.has(startAssetId) || !this.nodes.has(endAssetId)) {
            throw new Error(`Invalid start or end asset: ${startAssetId}, ${endAssetId}`);
        }

        const visited = new Set<string>();
        const paths: string[][] = [];

        const dfs = (
            current: string,
            target: string,
            path: string[],
            hopCount: number,
            currentDex?: string
        ) => {
            path.push(current);
            visited.add(current);

            if (current === target && path.length <= maxHops + 1) {
                paths.push([...path]);
            } else if (hopCount < maxHops) {
                const edges = this.adjacencyList.get(current) || [];
                for (const edge of edges) {
                    if (!visited.has(edge.to)) {
                        // If preferred DEX is specified, only follow edges from that DEX
                        // or allow first hop to be from any DEX
                        if (!preferredDex || 
                            edge.dex === preferredDex || 
                            !currentDex) {
                            dfs(edge.to, target, path, hopCount + 1, edge.dex);
                        }
                    }
                }
            }

            path.pop();
            visited.delete(current);
        };

        dfs(startAssetId, endAssetId, [], 0);
        return paths;
    }

    async calculatePathMetrics(
        path: string[],
        amountIn: bigint,
        quoteProvider: (
            fromAsset: XcmV4Location,
            toAsset: XcmV4Location,
            amount: bigint,
            dex: string
        ) => Promise<bigint | null>
    ): Promise<PathMetrics> {
        let currentAmount = amountIn;
        let totalFee = 0;
        let minLiquidity = BigInt(Number.MAX_SAFE_INTEGER);
        const hops: HopInfo[] = [];

        for (let i = 0; i < path.length - 1; i++) {
            const fromAssetId = path[i];
            const toAssetId = path[i + 1];
            
            const edge = this.getEdge(fromAssetId, toAssetId);
            if (!edge) throw new Error(`No pool found between ${fromAssetId} and ${toAssetId}`);

            const fromNode = this.nodes.get(fromAssetId)!;
            const toNode = this.nodes.get(toAssetId)!;

            const quote = await quoteProvider(
                fromNode.xcmLocation,
                toNode.xcmLocation,
                currentAmount,
                edge.dex
            );

            if (!quote) {
                throw new Error(`No quote available for ${fromAssetId} to ${toAssetId}`);
            }

            const hopOutput = quote;
            minLiquidity = edge.liquidity < minLiquidity ? edge.liquidity : minLiquidity;
            totalFee += edge.fee;

            hops.push({
                from: fromAssetId,
                to: toAssetId,
                amountIn: currentAmount,
                amountOut: hopOutput,
                fee: edge.fee,
                liquidity: edge.liquidity,
                poolId: edge.poolId,
                dex: edge.dex
            });

            currentAmount = hopOutput;
        }

        return {
            path,
            hops,
            totalOutput: currentAmount,
            totalFee,
            minLiquidity,
            priceImpact: this.calculatePriceImpact(hops)
        };
    }

    
    private calculatePriceImpact(hops: HopInfo[]): number {
        // Simplified price impact calculation
        // In real implementation, you'd want to consider:
        // - Pool depths
        // - Amount relative to liquidity
        // - Specific DEX formulas
        let totalImpact = 0;
        for (const hop of hops) {
            const impact = 1 - Number(hop.amountOut) / (Number(hop.amountIn) * (1 - hop.fee));
            totalImpact += impact;
        }
        return totalImpact;
    }

    private async getQuoteForExactTokens(
        api: TypedApi<typeof polkadot_asset_hub>,
        assetIn: XcmV4Location,
        assetOut: XcmV4Location,
        amount: bigint
    ): Promise<bigint | null> {
        const quote = await api.apis.AssetConversionApi.quote_price_exact_tokens_for_tokens(
            assetIn,
            assetOut,
            amount,
            true
        );
        return quote ? BigInt(quote) : null;
    }
}

import { TypedApi } from 'polkadot-api';
import { XcmV4Location } from './pools';
import { polkadot_asset_hub } from '@polkadot-api/descriptors';

export interface Node {
    asset: XcmV4Location;
    symbol: string;
    decimals: number;
}

export interface Edge {
    from: string;
    to: string;
    poolId: string;
    liquidity: bigint;
    fee: number;
    dex: string;  // e.g., 'assetHub', 'hydraDx'
    poolType?: string;  // For HydraDX different pool types
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

    addNode(asset: XcmV4Location, symbol: string, decimals: number) {
        this.nodes.set(symbol, { asset, symbol, decimals });
        if (!this.adjacencyList.has(symbol)) {
            this.adjacencyList.set(symbol, []);
        }
    }

    addEdge(
        fromSymbol: string,
        toSymbol: string,
        poolId: string,
        liquidity: bigint,
        fee: number,
        dex: string,
        poolType?: string
    ) {
        if (!this.nodes.has(fromSymbol) || !this.nodes.has(toSymbol)) {
            throw new Error(`One or both tokens not found: ${fromSymbol}, ${toSymbol}`);
        }

        // Create the forward edge
        const edge: Edge = { from: fromSymbol, to: toSymbol, poolId, liquidity, fee, dex, poolType };
        this.adjacencyList.get(fromSymbol)?.push(edge);
        
        // Create the reverse edge
        const reverseEdge: Edge = { ...edge, from: toSymbol, to: fromSymbol };
        this.adjacencyList.get(toSymbol)?.push(reverseEdge);
    }

    getNode(symbol: string): Node | undefined {
        return this.nodes.get(symbol);
    }

    getEdge(fromSymbol: string, toSymbol: string): Edge | undefined {
        return this.adjacencyList.get(fromSymbol)?.find(edge => edge.to === toSymbol);
    }

    findAllPaths(
        startSymbol: string,
        endSymbol: string,
        maxHops: number = 3,
        preferredDex?: string
    ): string[][] {
        if (!this.nodes.has(startSymbol) || !this.nodes.has(endSymbol)) {
            throw new Error(`Invalid start or end token: ${startSymbol}, ${endSymbol}`);
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

        dfs(startSymbol, endSymbol, [], 0);
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
            const fromSymbol = path[i];
            const toSymbol = path[i + 1];
            
            const edge = this.getEdge(fromSymbol, toSymbol);
            if (!edge) throw new Error(`No pool found between ${fromSymbol} and ${toSymbol}`);

            const fromNode = this.nodes.get(fromSymbol)!;
            const toNode = this.nodes.get(toSymbol)!;

            const quote = await quoteProvider(
                fromNode.asset,
                toNode.asset,
                currentAmount,
                edge.dex
            );

            if (!quote) {
                throw new Error(`No quote available for ${fromSymbol} to ${toSymbol}`);
            }

            const hopOutput = quote;
            minLiquidity = edge.liquidity < minLiquidity ? edge.liquidity : minLiquidity;
            totalFee += edge.fee;

            hops.push({
                from: fromSymbol,
                to: toSymbol,
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

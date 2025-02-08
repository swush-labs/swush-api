import { TokenGraph } from '../TokenGraph';
import { XcmV3Junction, XcmV3Junctions } from '@polkadot-api/descriptors';

describe('TokenGraph', () => {
    let graph: TokenGraph;

    // Helper function to create XCM location
    const createXcmLocation = (assetId: number) => ({
        parents: 0,
        interior: XcmV3Junctions.X2([
            XcmV3Junction.PalletInstance(50),
            XcmV3Junction.GeneralIndex(BigInt(assetId)),
        ])
    });

    beforeEach(() => {
        graph = new TokenGraph();
        
        // Add nodes
        graph.addNode(createXcmLocation(1), "DOT");
        graph.addNode(createXcmLocation(2), "USDC");
        graph.addNode(createXcmLocation(3), "ETH");
        graph.addNode(createXcmLocation(4), "PINK");

        graph.addNode(createXcmLocation(5), "MYTH");
        graph.addNode(createXcmLocation(6), "BTC");

    });

    describe('Basic Graph Operations', () => {
        test('should add nodes correctly', () => {
            expect(graph.getNode("DOT")).toBeDefined();
            expect(graph.getNode("INVALID")).toBeUndefined();
        });

        test('should add edges correctly', () => {
            graph.addEdge("DOT", "USDC", "pool1", BigInt(1000000), 0.003, "assetHub");
            const edge = graph.getEdge("DOT", "USDC");
            expect(edge).toBeDefined();
            expect(edge?.fee).toBe(0.003);
        });

        test('should throw error for invalid edge addition', () => {
            expect(() => {
                graph.addEdge("DOT", "INVALID", "pool1", BigInt(1000000), 0.003, "assetHub");
            }).toThrow();
        });
    });

    describe('Path Finding', () => {
        beforeEach(() => {
            // Setup DOT-based pools
            graph.addEdge("DOT", "USDC", "pool1", BigInt(1000000), 0.003, "assetHub");
            graph.addEdge("DOT", "ETH", "pool2", BigInt(2000000), 0.003, "assetHub");
            graph.addEdge("DOT", "PINK", "pool3", BigInt(500000), 0.003, "assetHub");
            graph.addEdge("DOT", "MYTH", "pool4", BigInt(800000), 0.003, "assetHub");
            
            // Add some HydraDX pools
            graph.addEdge("ETH", "USDC", "hydra1", BigInt(1500000), 0.002, "hydraDx", "Omnipool");
            graph.addEdge("BTC", "ETH", "hydra2", BigInt(3000000), 0.002, "hydraDx", "Omnipool");
        });

        test('should find all paths between USDC and MYTH', () => {
            const paths = graph.findAllPaths("USDC", "MYTH");
            expect(paths).toContainEqual(["USDC", "DOT", "MYTH"]); // Direct through DOT
            expect(paths).toContainEqual(["USDC", "ETH", "DOT", "MYTH"]); // Through ETH
        });

        test('should respect max hops limit', () => {
            const paths = graph.findAllPaths("USDC", "MYTH", 1);
            expect(paths).toHaveLength(1); // Only the direct DOT path
            expect(paths[0]).toEqual(["USDC", "DOT", "MYTH"]);
        });

        test('should find paths with preferred DEX', () => {
            const assetHubPaths = graph.findAllPaths("USDC", "MYTH", 3, "assetHub");
            const hydraDxPaths = graph.findAllPaths("USDC", "MYTH", 3, "hydraDx");
            
            // Asset Hub paths should only use Asset Hub pools after first hop
            expect(assetHubPaths.every(path => 
                path.length <= 2 || path.includes("DOT")
            )).toBeTruthy();

            // HydraDX paths should prefer HydraDX pools
            expect(hydraDxPaths.some(path => 
                path.includes("ETH") && path.includes("BTC")
            )).toBeTruthy();
        });
    });

    describe('Path Metrics', () => {
        const mockQuoteProvider = async (
            _fromAsset: any,
            _toAsset: any,
            amountIn: bigint,
            _dex: string
        ) => {
            // Mock quote that returns 98% of input (2% slippage/fees)
            return amountIn * BigInt(98) / BigInt(100);
        };

        test('should calculate metrics for a path', async () => {
            graph.addEdge("DOT", "USDC", "pool1", BigInt(1000000), 0.003, "assetHub");
            graph.addEdge("DOT", "MYTH", "pool2", BigInt(800000), 0.003, "assetHub");

            const metrics = await graph.calculatePathMetrics(
                ["USDC", "DOT", "MYTH"],
                BigInt(1000000),
                mockQuoteProvider
            );

            expect(metrics.hops).toHaveLength(2);
            expect(metrics.totalFee).toBe(0.006); // 0.3% + 0.3%
            expect(metrics.minLiquidity).toBe(BigInt(800000));
        });

        test('should handle failed quotes', async () => {
            graph.addEdge("DOT", "USDC", "pool1", BigInt(1000000), 0.003, "assetHub");
            
            const failingQuoteProvider = async () => null;

            await expect(graph.calculatePathMetrics(
                ["USDC", "DOT"],
                BigInt(1000000),
                failingQuoteProvider
            )).rejects.toThrow();
        });
    });
});
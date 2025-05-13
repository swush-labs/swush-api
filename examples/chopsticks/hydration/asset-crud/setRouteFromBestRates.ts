import { sr25519CreateDerive } from "@polkadot-labs/hdkd"
import {
    DEV_PHRASE,
    entropyToMiniSecret,
    mnemonicToEntropy,
    ss58Encode
} from "@polkadot-labs/hdkd-helpers"
import { getPolkadotSigner } from "polkadot-api/signer"
import { TEST_RPC_PARACHAIN_HYDRATION } from "../../../../services/constants"
import { TransactionService } from '../../../../services/network/TransactionService'
import { connectPapi } from "../../../../services/network/types"
import { Enum } from "polkadot-api"
import { ApiPromise, WsProvider } from '@polkadot/api'
import { TradeRouter, PoolService } from '@galacticcouncil/sdk'
import { base, degen } from './external'

// Initialize signers
const initSigners = () => {
    const miniSecret = entropyToMiniSecret(mnemonicToEntropy(DEV_PHRASE))
    const derive = sr25519CreateDerive(miniSecret)

    const aliceKeyPair = derive("//Alice")
    const bobKeyPair = derive("//Bob")

    const alice = getPolkadotSigner(
        aliceKeyPair.publicKey,
        "Sr25519",
        aliceKeyPair.sign,
    )

    return {
        alice,
        aliceKeyPair,
        bobKeyPair
    }
}

// Function to construct route from trade data
function constructRouteFromTradeData(tradeData) {
    // Extract the asset_in from the first swap and asset_out from the last swap
    const assetIn = Number(tradeData.swaps[0].assetIn);
    const assetOut = Number(tradeData.swaps[tradeData.swaps.length - 1].assetOut);
    
    // Create asset pair
    const assetPair = {
        asset_in: assetIn,
        asset_out: assetOut
    };
    
    // Construct route from swaps
    const route = tradeData.swaps.map(swap => {
        // Map pool type and handle special cases
        let poolEnum;
        if (swap.pool === "Stableswap") {
            // For Stableswap, we need to include the poolId
            // The poolId should be available in the poolAddress field
            const poolId = Number(swap.poolAddress);
            poolEnum = Enum("Stableswap", poolId);
        } else {
            // For other pool types (XYK, LBP, Omnipool, Aave), no additional data needed
            poolEnum = Enum(swap.pool === "Xyk" ? "XYK" : swap.pool, null);
        }
        
        return {
            pool: poolEnum,
            asset_in: Number(swap.assetIn),
            asset_out: Number(swap.assetOut)
        };
    });
    
    return {
        asset_pair: assetPair,
        new_route: route
    };
}

async function main() {
    const { alice } = initSigners();
    let sdkApi = null;
    let hydraDxClient = null;

    try {
        // Initialize Trade Router from SDK (similar to getBestRates.ts)
        const wsProvider = new WsProvider('wss://rpc.hydradx.cloud');
        sdkApi = await ApiPromise.create({ provider: wsProvider });
        const poolService = new PoolService(sdkApi);
        
        // Combine base and degen arrays and pass to syncRegistry
        const externalAssets = [...base];
        await poolService.syncRegistry(externalAssets);
        
        const tradeRouter = new TradeRouter(poolService);
        
        // Get trade data using getBestBuy (using same parameters as in getBestRates.ts)
        // Parameters: amountOut, assetOut, assetIn
        const trade = await tradeRouter.getBestBuy('5', '1000085', '2');
        
        console.log('Trade details:', trade.toHuman());
        
        // Connect to HydraDX for transaction submission
        const { api: hydraDxApi, client } = await connectPapi(TEST_RPC_PARACHAIN_HYDRATION, 'hydration');
        hydraDxClient = client;
        
        // Construct route from trade data
        const routeParams = constructRouteFromTradeData(trade);
        
        console.log("Route parameters:", JSON.stringify(routeParams, null, 2));
        
        // Create and submit the transaction
        const routerTx = await hydraDxApi.tx.Router.set_route(routeParams);

        // Print the tx encoded
        const encodedTx = await routerTx.getEncodedData()
        console.log("Tx encoded asHex:", encodedTx.asHex());
        
        // console.log("Submitting Router.set_route transaction...");
        // await TransactionService.submitAndWatch(routerTx, alice, {
        //     onSuccess: (status) => {
        //         console.log(`Transaction successful in block ${status.blockNumber}`);
        //     },
        //     onError: (error) => {
        //         console.error('Transaction failed:', error);
        //     },
        //     onStatusChange: (status) => {
        //         console.log('Transaction status:', status);
        //     }
        // });

    } catch (error) {
        console.error('Transaction error:', error);
    } finally {
        if (sdkApi) {
            await sdkApi.disconnect();
        }
        if (hydraDxClient) {
            hydraDxClient.destroy();
        }
    }
}

main().catch(console.error); 
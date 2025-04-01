import WebSocket from 'ws';
import { sr25519CreateDerive } from "@polkadot-labs/hdkd";
import {
    DEV_PHRASE,
    entropyToMiniSecret,
    mnemonicToEntropy,
    ss58Encode
} from "@polkadot-labs/hdkd-helpers";
import { getPolkadotSigner } from "polkadot-api/signer";
import { HydrationApi } from '../hydration-types';

// Constants
export const BLOCK_PRODUCTION_COUNT = 2;
export const TRANSACTION_WAIT_TIME = 4000; // 4 seconds
export const HDX_ASSET_ID = 10; // HDX token ID in Hydration
export const DOT_ASSET_ID = 5; // DOT token ID in Hydration

// Types
export interface KeyPairs {
    alice: ReturnType<typeof getPolkadotSigner>;
    aliceKeyPair: {
        publicKey: Uint8Array;
        sign: (message: Uint8Array) => Uint8Array;
    };
    bobKeyPair: {
        publicKey: Uint8Array;
        sign: (message: Uint8Array) => Uint8Array;
    };
}

// WebSocket connection manager
export class WSManager {
    private connections: Map<string, WebSocket> = new Map();

    connect(endpoint: string, name: string) {
        const ws = new WebSocket(endpoint);
        ws.on('open', () => {
            console.log(`Connected to ${name} WebSocket`);
        });
        this.connections.set(name, ws);
        return ws;
    }

    sendCommand(method: string, params: any) {
        const message = JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method,
            params,
        });
        
        this.connections.forEach((ws, name) => {
            console.log(`Sending command to ${name}`);
            ws.send(message);
        });
    }

    close() {
        this.connections.forEach(ws => ws.close());
    }
}

// Initialize signers
export function initSigners(): KeyPairs {
    const miniSecret = entropyToMiniSecret(mnemonicToEntropy(DEV_PHRASE));
    const derive = sr25519CreateDerive(miniSecret);
    
    const aliceKeyPair = derive("//Alice");
    const bobKeyPair = derive("//Bob");
    
    const alice = getPolkadotSigner(
        aliceKeyPair.publicKey,
        "Sr25519",
        aliceKeyPair.sign,
    );

    return {
        alice,
        aliceKeyPair,
        bobKeyPair
    };
}

// Helper function to produce blocks and wait
export async function produceBlocksAndWait(
    wsManager: WSManager,
    blockCount: number = BLOCK_PRODUCTION_COUNT,
    waitTime: number = TRANSACTION_WAIT_TIME
) {
    wsManager.sendCommand('dev_newBlock', [{ count: blockCount }]);
    await new Promise(resolve => setTimeout(resolve, waitTime));
}

// Helper function to check balances
export async function checkBalances(api: HydrationApi, address: string) {
    const dotBalance = await api.query.Tokens.Accounts.getValue(address, DOT_ASSET_ID);
    const hdxBalance = await api.query.Tokens.Accounts.getValue(address, HDX_ASSET_ID);

    return {
        dot: {
            free: dotBalance.free,
            reserved: dotBalance.reserved,
            frozen: dotBalance.frozen,
            freeFormatted: Number(dotBalance.free) / 1e10
        },
        hdx: {
            free: hdxBalance.free,
            reserved: hdxBalance.reserved,
            frozen: hdxBalance.frozen,
            freeFormatted: Number(hdxBalance.free) / 1e12
        }
    };
}

// Helper function to format balance changes
export function formatBalanceChanges(initial: bigint, final: bigint, decimals: number = 10) {
    return {
        initial: Number(initial) / Math.pow(10, decimals),
        final: Number(final) / Math.pow(10, decimals),
        change: Number(final - initial) / Math.pow(10, decimals)
    };
} 
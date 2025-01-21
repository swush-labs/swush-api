import { setupNetworks, testingPairs } from '@acala-network/chopsticks-testing';
import { NetworkContext } from '@acala-network/chopsticks-utils';
import fs from 'fs';
import path from 'path';
// Logger setup
function createLogger(sessionId: string) {
    const logFile = path.join(__dirname, `chopsticks-session-${sessionId}.log`);
    return function log(message: string) {
        const timestamp = new Date().toISOString();
        const logMessage = `[${timestamp}] ${message}\n`;
        fs.appendFileSync(logFile, logMessage);
        console.log(message);
    }
}

async function main() {
    const sessionId = new Date().toISOString().replace(/[:.]/g, '-');
    const log = createLogger(sessionId);

    // Network contexts
    let network1: NetworkContext;
    let network2: NetworkContext;

    try {
        log('Setting up networks...');
        const { network1: net1, network2: net2 } = await setupNetworks({
            network1: {
                endpoint: 'wss://your-endpoint-1',
                port: 8001,
                runtimeLogLevel: 5,
            },
            network2: {
                endpoint: 'wss://your-endpoint-2',
                port: 8002,
                runtimeLogLevel: 5,
            },
        });

        network1 = net1;
        network2 = net2;

        // Get testing accounts
        const { alice, bob } = testingPairs();
        log('Testing accounts loaded');

        // Your testing logic here
        log('Starting tests...');

        // Example test
        const balance = await network1.api.query.system.account(alice.address);
        log(`Alice's balance: ${balance.toString()}`);

    } catch (error) {
        log(`Error: ${error}`);
        throw error;
    }
}

if (require.main === module) {
    main().catch((error) => {
        console.error(error);
        process.exit(1);
    });
}
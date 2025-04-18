import { serializeKey } from "@/assets/utils";
import { hydration, polkadot_asset_hub } from "@polkadot-api/descriptors";
import { TypedApi } from "polkadot-api";


/**
 * Monitors XCM events for a successful transfer
 */
async function monitorXcmFlow(
    assetHubApi: TypedApi<typeof polkadot_asset_hub>,
    hydraDxApi: TypedApi<typeof hydration>,
    alice: string,
    bob: string,
    transferAmount: bigint
) {
    console.log("\n=== Starting XCM Flow Monitoring ===");

    let assetHubSubscription: { unsubscribe: () => void } | null = null;
    let hydraDxSubscription: { unsubscribe: () => void } | null = null;
    let isCompleted = false;

    // Create a promise that resolves when monitoring is complete
    return new Promise<boolean>(async (resolve, reject) => {
        // Set a timeout to prevent indefinite waiting
        const timeoutId = setTimeout(() => {
            if (!isCompleted) {
                console.log("XCM monitoring timed out after 2 minutes");
                cleanup();
                resolve(false);
            }
        }, 2 * 60 * 1000); // 2 minutes timeout

        let assetHubComplete = false;
        let hydraDxComplete = false;
        let returnComplete = false;
        let routerComplete = false;
        const cleanup = () => {
            if (isCompleted) return; // Prevent multiple cleanups
            isCompleted = true;

            clearTimeout(timeoutId);

            if (assetHubSubscription) {
                try {
                    assetHubSubscription.unsubscribe();
                    assetHubSubscription = null;
                } catch (e) {
                    console.warn("Error unsubscribing from Asset Hub events:", e);
                }
            }

            if (hydraDxSubscription) {
                try {
                    hydraDxSubscription.unsubscribe();
                    hydraDxSubscription = null;
                } catch (e) {
                    console.warn("Error unsubscribing from HydraDX events:", e);
                }
            }
        };

        const checkCompletion = () => {
            if (assetHubComplete && hydraDxComplete && returnComplete && routerComplete && !isCompleted) {
                cleanup();
                console.log("\n✅ Complete XCM flow successful!");
                resolve(true);
            }
        };

        try {
            // Subscribe to Asset Hub events using watchValue
            const assetHubObservable = assetHubApi.query.System.Events.watchValue("finalized");
            assetHubSubscription = assetHubObservable.subscribe({
                next: (events) => {
                    if (isCompleted) return; // Skip if already completed

                    for (const record of events) {
                        const eventData = record.event;

                        // Check for PolkadotXcm events
                        if (eventData.type === 'PolkadotXcm') {
                            const xcmEvent = eventData.value;
                            if (xcmEvent.type === 'Attempted' && !assetHubComplete) {
                                console.log("✅ Initial XCM from Asset Hub sent successfully");
                                assetHubComplete = true;
                                checkCompletion();
                            }
                        }

                        // Check for Balances events to detect final deposit
                        if (eventData.type === 'Assets') {
                            console.log(`✅ Assets event detected: ${eventData.type}`);
                            //print event details
                            const balanceEvent = eventData.value;
                            if (balanceEvent.type === 'Issued') {
                                console.log(`Assets event data: ${serializeKey(eventData)}`);
                                const issuedData = balanceEvent.value;
                                if (issuedData.owner === bob) {
                                    console.log(`✅ Final deposit detected to ${bob}`);
                                    returnComplete = true;
                                    checkCompletion();
                                }
                            }
                        }
                    }
                },
                error: (error) => {
                    if (!isCompleted) {
                        console.error("Error in Asset Hub event monitoring:", error);
                        cleanup();
                        reject(error);
                    }
                },
                complete: () => {
                    console.log("Asset Hub subscription completed");
                }
            });

            // Subscribe to HydraDX events using watchValue
            const hydraDxObservable = hydraDxApi.query.System.Events.watchValue("finalized");
            hydraDxSubscription = hydraDxObservable.subscribe({
                next: (events) => {
                    if (isCompleted) return; // Skip if already completed

                    for (const record of events) {
                        const eventData = record.event;

                        // Check for XCM events on HydraDX
                        if (eventData.type === 'XcmpQueue' || eventData.type === 'PolkadotXcm') {
                            const eventValue = eventData.value;
                            console.log(`HydraDX ${eventData.type}:${eventValue.type} event detected`);

                            // Check for successful XCM processing
                            if (eventData.type === 'PolkadotXcm' && eventValue.type === 'Attempted') {
                                console.log("✅ HydraDX received and processed XCM successfully");
                                hydraDxComplete = true;
                                checkCompletion();
                            }
                            // Check for successful XCMP message
                            if (eventData.type === 'XcmpQueue' && eventValue.type === 'XcmpMessageSent') {
                                console.log("✅ HydraDX processed XCMP message successfully");
                                hydraDxComplete = true;
                                checkCompletion();
                            }
                        }

                        // Check for exchange events
                        if (eventData.type === 'Router') {
                            const routerEvent = eventData.value;
                            console.log(`✅ Swap executed on HydraDX: Router:${routerEvent.type}`);
                            routerComplete = true;
                            checkCompletion();
                        }
                    }
                },
                error: (error) => {
                    if (!isCompleted) {
                        console.error("Error in HydraDX event monitoring:", error);
                        cleanup();
                        reject(error);
                    }
                },
                complete: () => {
                    console.log("HydraDX subscription completed");
                }
            });
        } catch (error) {
            if (!isCompleted) {
                console.error("Error in event monitoring:", error);
                cleanup();
                resolve(false);
            }
        }

        return cleanup;
    });
}


// Helper function to safely extract fee value
function extractFeeValue(feeResult: any): bigint {
    if (!feeResult || !feeResult.success) {
        throw new Error(`Fee calculation was not successful: ${serializeKey(feeResult)}`);
    }

    // Handle XCM versioned assets (delivery fees)
    if (feeResult.value?.type === 'V4' && Array.isArray(feeResult.value.value)) {
        // Sum up all fee values in the array
        return feeResult.value.value.reduce((sum: bigint, item: any) => {
            if (item && item.fun?.type === 'Fungible') {
                // Convert the value to string first to handle both string and number cases
                const value = item.fun.value.toString();
                return sum + BigInt(value);
            }
            return sum;
        }, 0n);
    }

    // Handle direct bigint value
    if (typeof feeResult.value === 'bigint') {
        return feeResult.value;
    }

    // Handle numeric value
    if (typeof feeResult.value === 'number') {
        return BigInt(feeResult.value);
    }

    // Handle case where value is a string
    if (typeof feeResult.value === 'string') {
        return BigInt(feeResult.value);
    }

    // Handle case where value is an object with a toString method
    if (typeof feeResult.value === 'object' && feeResult.value !== null && 'toString' in feeResult.value) {
        return BigInt(feeResult.value.toString());
    }

    console.log("Problematic fee result:", serializeKey(feeResult));
    throw new Error(`Unexpected fee result structure: ${serializeKey(feeResult)}`);
}
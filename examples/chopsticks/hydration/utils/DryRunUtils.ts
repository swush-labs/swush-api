import { SupportedChains } from "@/network/types";
import { TypedApi } from "polkadot-api";
import { XcmVersionedLocation, XcmVersionedXcm } from "@polkadot-api/descriptors";

export interface DryRunResult {
    success: boolean;
    executionResult?: any;
    events?: any[];
    gasUsed?: bigint;
    outputData?: any;
    error?: any;
}

export interface XcmFees {
    executionFee: bigint;
    deliveryFee: bigint;
    totalWithBuffer: bigint;
}

export class DryRunUtils {
    constructor(
        private readonly api: TypedApi<SupportedChains>,
        private readonly bufferPercentage: number = 10
    ) {}

    /**
     * Perform a dry run of an XCM message
     */
    async dryRunXcmMessage(
        originLocation: XcmVersionedLocation,
        message: XcmVersionedXcm,
        description: string
    ): Promise<DryRunResult> {
        try {
            console.log(`\nPerforming dry run for ${description}...`);
            const dryRunResult = await this.api.apis.DryRunApi.dry_run_xcm(
                originLocation,
                message,
                {}
            );

            if (dryRunResult.success) {
                const result = dryRunResult.value;
                console.log(`${description} Dry Run Successful!`);
                console.log('Execution Result:', result.execution_result);
                
                if (result.emitted_events?.length > 0) {
                    console.log('Emitted Events:', result.emitted_events);
                }

                return {
                    success: true,
                    executionResult: result.execution_result,
                    events: result.emitted_events
                };
            }

            console.error(`${description} Dry Run Failed:`, dryRunResult.value);
            return {
                success: false,
                error: dryRunResult.value
            };
        } catch (error) {
            console.error(`Error during ${description} dry run:`, error);
            return {
                success: false,
                error
            };
        }
    }

    /**
     * Estimate XCM fees for a message
     */
    async estimateXcmFees(
        message: XcmVersionedXcm,
        assetId: any
    ): Promise<XcmFees | null> {
        try {
            const weight = await this.api.apis.XcmPaymentApi.query_xcm_weight(message);
            
            if (!weight.success) {
                console.error("Failed to query XCM weight");
                return null;
            }

            const fees = await this.api.apis.XcmPaymentApi.query_weight_to_asset_fee(
                weight.value,
                assetId
            );

            if (!fees.success) {
                console.error("Failed to query weight to asset fee");
                return null;
            }

            const executionFee = fees.value;
            const deliveryFee = await this.estimateDeliveryFee(message);
            const totalFee = executionFee + deliveryFee;
            const buffer = (totalFee * BigInt(this.bufferPercentage)) / 100n;

            return {
                executionFee,
                deliveryFee,
                totalWithBuffer: totalFee + buffer
            };
        } catch (error) {
            console.error("Error estimating XCM fees:", error);
            return null;
        }
    }

    /**
     * Estimate delivery fee for an XCM message
     */
    private async estimateDeliveryFee(message: XcmVersionedXcm): Promise<any> {
        try {
            const deliveryFees = await this.api.apis.XcmPaymentApi.query_delivery_fees(
                message.destination,
                message
            );

            return deliveryFees.success ? deliveryFees.value : 0n;
        } catch (error) {
            console.error("Error estimating delivery fee:", error);
            return 0n;
        }
    }

    /**
     * Validate and analyze a dry run result
     */
    validateDryRunResult(result: DryRunResult): {
        isValid: boolean;
        details: string;
        warnings: string[];
    } {
        const warnings: string[] = [];
        let isValid = result.success;
        let details = result.success ? "Dry run completed successfully" : "Dry run failed";

        if (result.success) {
            // Check execution result
            if (result.executionResult?.error) {
                isValid = false;
                details = `Execution failed: ${result.executionResult.error}`;
            }

            // Check gas usage
            if (result.gasUsed && result.gasUsed > 1000000000n) {
                warnings.push("High gas usage detected");
            }

            // Check events
            if (!result.events || result.events.length === 0) {
                warnings.push("No events emitted during dry run");
            }
        }

        return { isValid, details, warnings };
    }
} 
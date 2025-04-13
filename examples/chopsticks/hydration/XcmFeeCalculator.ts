import {
    XcmVersionedLocation,
    XcmVersionedAssets,
    XcmVersionedAssetId,
    XcmV3WeightLimit,
    XcmV3Junction,
    XcmV3Junctions,
    XcmV3MultiassetAssetId,
    XcmV3MultiassetFungibility,
    XcmVersionedXcm,
    XcmV4Instruction,
    XcmV2OriginKind,
    XcmV4AssetAssetFilter,
    XcmPalletOrigin,
    PolkadotRuntimeOriginCaller,
    XcmV4AssetWildAsset
} from "@polkadot-api/descriptors";

interface FeeCalculationResult {
    executionFee: bigint;
    deliveryFee: bigint;
    totalWithBuffer: bigint;
}

interface MultiHopFeeResult {
    firstHopFees: FeeCalculationResult;
    returnHopFees: FeeCalculationResult;
    totalFeesRequired: bigint;
}

interface XcmFeeCalculatorConfig {
    bufferPercentage?: bigint;
    defaultDeliveryFee?: bigint;
}

export class XcmFeeCalculator {
    private readonly bufferPercentage: bigint;
    private readonly defaultDeliveryFee: bigint;

    constructor(
        private readonly sourceApi: any,
        private readonly targetApi: any,
        config: XcmFeeCalculatorConfig = {}
    ) {
        this.bufferPercentage = config.bufferPercentage || 120n;
        this.defaultDeliveryFee = config.defaultDeliveryFee || 1_000_000_000n; // 0.1 DOT as default
    }

    /**
     * Extracts fee value from a fungible asset response
     */
    private extractFeeBigInt(fee: any): bigint {
        if (typeof fee === 'bigint') return fee;
        if (typeof fee === 'number') return BigInt(fee);
        if (typeof fee === 'string') return BigInt(fee);
        if (fee && typeof fee.toString === 'function') return BigInt(fee.toString());
        throw new Error(`Unable to convert fee value to BigInt: ${fee}`);
    }

    /**
     * Extracts delivery fee from XCM response with fallback
     */
    private extractDeliveryFee(deliveryFeeResponse: any, defaultValue?: bigint): bigint {
        try {
            if (deliveryFeeResponse?.type === 'V4' && Array.isArray(deliveryFeeResponse.value)) {
                if (deliveryFeeResponse.value.length === 0 && defaultValue !== undefined) {
                    return defaultValue;
                }

                const firstAsset = deliveryFeeResponse.value[0];
                if (firstAsset?.fun?.type === 'Fungible' && firstAsset.fun.value) {
                    return this.extractFeeBigInt(firstAsset.fun.value);
                }
            }

            return defaultValue || this.defaultDeliveryFee;
        } catch (error) {
            console.error('Error extracting delivery fee:', error);
            return defaultValue || this.defaultDeliveryFee;
        }
    }

    /**
     * Simulates XCM execution and extracts forwarded messages for a specific parachain
     */
    private async simulateAndExtractForwarded(
        api: any,
        origin: XcmVersionedLocation,
        message: XcmVersionedXcm,
        targetParaId: number
    ) {
        const dryRunResult = await api.apis.DryRunApi.dry_run_xcm(origin, message);
        
        if (!dryRunResult.success) {
            throw new Error(`Dry run failed: ${JSON.stringify(dryRunResult)}`);
        }

        const { forwarded_xcms } = dryRunResult.value;
        
        // Find the message targeting our desired parachain
        const targetMessage = forwarded_xcms.find(([location, _]) => 
            location.type === 'V4' &&
            location.value.parents === 1 &&
            location.value.interior.type === 'X1' &&
            location.value.interior.value.type === 'Parachain' &&
            location.value.interior.value.value === targetParaId
        );

        if (!targetMessage) {
            throw new Error(`No forwarded message found for parachain ${targetParaId}`);
        }

        return targetMessage[1][0]; // Return the first message in the array
    }

    /**
     * Calculates execution and delivery fees for a single hop
     */
    private async calculateChainFees(
        sourceApi: any,
        targetApi: any,
        message: XcmVersionedXcm,
        destination: XcmVersionedLocation
    ): Promise<FeeCalculationResult> {
        // Calculate execution weight and fees
        const weightResult = await targetApi.apis.XcmPaymentApi.query_xcm_weight(message);
        if (!weightResult.success) {
            throw new Error("Failed to calculate execution weight");
        }

        const dotAssetId = XcmVersionedAssetId.V4({
            parents: 1,
            interior: XcmV3Junctions.Here()
        });

        const executionFeeResult = await targetApi.apis.XcmPaymentApi.query_weight_to_asset_fee(
            weightResult.value,
            dotAssetId
        );
        if (!executionFeeResult.success) {
            throw new Error("Failed to calculate execution fee");
        }

        // Calculate delivery fees
        const deliveryFeeResult = await sourceApi.apis.XcmPaymentApi.query_delivery_fees(
            destination,
            message
        );

        const executionFee = this.extractFeeBigInt(executionFeeResult.value);
        const deliveryFee = deliveryFeeResult.success 
            ? this.extractDeliveryFee(deliveryFeeResult.value, executionFee)
            : this.defaultDeliveryFee;

        const totalWithBuffer = (executionFee + deliveryFee) * this.bufferPercentage / 100n;

        return {
            executionFee,
            deliveryFee,
            totalWithBuffer
        };
    }

    /**
     * Calculates fees for a multi-hop XCM operation
     */
    async calculateMultiHopFees(
        initialMessage: XcmVersionedXcm,
        originLocation: XcmVersionedLocation,
        intermediateChainId: number,
        finalChainId: number
    ): Promise<MultiHopFeeResult> {
        // Calculate first hop fees (source -> intermediate)
        const forwardedToIntermediate = await this.simulateAndExtractForwarded(
            this.sourceApi,
            originLocation,
            initialMessage,
            intermediateChainId
        );

        const firstHopFees = await this.calculateChainFees(
            this.sourceApi,
            this.targetApi,
            forwardedToIntermediate,
            XcmVersionedLocation.V4({
                parents: 1,
                interior: XcmV3Junctions.X1(
                    XcmV3Junction.Parachain(intermediateChainId)
                )
            })
        );

        // Calculate return hop fees (intermediate -> final)
        const forwardedToFinal = await this.simulateAndExtractForwarded(
            this.targetApi,
            XcmVersionedLocation.V4({
                parents: 1,
                interior: XcmV3Junctions.X1(
                    XcmV3Junction.Parachain(intermediateChainId)
                )
            }),
            forwardedToIntermediate,
            finalChainId
        );

        const returnHopFees = await this.calculateChainFees(
            this.targetApi,
            this.sourceApi,
            forwardedToFinal,
            XcmVersionedLocation.V4({
                parents: 1,
                interior: XcmV3Junctions.X1(
                    XcmV3Junction.Parachain(finalChainId)
                )
            })
        );

        return {
            firstHopFees,
            returnHopFees,
            totalFeesRequired: firstHopFees.totalWithBuffer + returnHopFees.totalWithBuffer
        };
    }

    /**
     * Updates an XCM message with calculated fees
     */
    private updateMessageWithFees(
        message: XcmVersionedXcm,
        fees: MultiHopFeeResult
    ): XcmVersionedXcm {
        if (message.type !== 'V4') {
            throw new Error('Only V4 XCM messages are supported');
        }

        const instructions = message.value;
        const updatedInstructions = instructions.map(instruction => {
            if (instruction.type === 'DepositReserveAsset') {
                const xcm = instruction.value.xcm.map(subInstruction => {
                    if (subInstruction.type === 'BuyExecution') {
                        // Update first hop fees
                        return XcmV4Instruction.BuyExecution({
                            ...subInstruction.value,
                            fees: {
                                ...subInstruction.value.fees,
                                fun: XcmV3MultiassetFungibility.Fungible(fees.firstHopFees.totalWithBuffer)
                            }
                        });
                    }
                    if (subInstruction.type === 'InitiateReserveWithdraw') {
                        const innerXcm = subInstruction.value.xcm.map(innerInstruction => {
                            if (innerInstruction.type === 'BuyExecution') {
                                // Update return hop fees
                                return XcmV4Instruction.BuyExecution({
                                    ...innerInstruction.value,
                                    fees: {
                                        ...innerInstruction.value.fees,
                                        fun: XcmV3MultiassetFungibility.Fungible(fees.returnHopFees.totalWithBuffer)
                                    }
                                });
                            }
                            return innerInstruction;
                        });
                        return XcmV4Instruction.InitiateReserveWithdraw({
                            ...subInstruction.value,
                            xcm: innerXcm
                        });
                    }
                    return subInstruction;
                });
                return XcmV4Instruction.DepositReserveAsset({
                    ...instruction.value,
                    xcm
                });
            }
            if (instruction.type === 'WithdrawAsset') {
                // Update the withdrawal amount to include all fees
                return XcmV4Instruction.WithdrawAsset([{
                    ...instruction.value[0],
                    fun: XcmV3MultiassetFungibility.Fungible(
                        this.extractFeeBigInt(instruction.value[0].fun.value) + fees.totalFeesRequired
                    )
                }]);
            }
            return instruction;
        });

        return XcmVersionedXcm.V4(updatedInstructions);
    }

    /**
     * Calculates fees and updates the message with them
     */
    async calculateFeesAndUpdateMessage(
        message: XcmVersionedXcm,
        originLocation: XcmVersionedLocation,
        intermediateChainId: number,
        finalChainId: number
    ): Promise<{
        updatedMessage: XcmVersionedXcm;
        fees: MultiHopFeeResult;
    }> {
        const fees = await this.calculateMultiHopFees(
            message,
            originLocation,
            intermediateChainId,
            finalChainId
        );

        const updatedMessage = this.updateMessageWithFees(message, fees);

        return {
            updatedMessage,
            fees
        };
    }
} 
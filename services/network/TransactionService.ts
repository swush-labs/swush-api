import { TxEvent, InvalidTxError, TransactionValidityError } from 'polkadot-api';
import { Polkadot_asset_hubDispatchError } from '@polkadot-api/descriptors';

export interface TransactionStatus {
    type: string;
    blockNumber?: number;
    blockHash?: string;
    txHash?: string;
    success?: boolean;
    error?: any;
}

export interface TransactionCallbacks {
    onSuccess?: (status: TransactionStatus) => void;
    onError?: (error: any) => void;
    onStatusChange?: (status: TransactionStatus) => void;
}

export class TransactionService {
    static async submitAndWatch(
        call: any,
        signer: any,
        callbacks?: TransactionCallbacks
    ): Promise<void> {
        return new Promise((resolve, reject) => {
            call.signSubmitAndWatch(signer).subscribe({
                next: (event: TxEvent) => {
                    const status: TransactionStatus = {
                        type: event.type
                    };

                    if (event.type === 'signed') {
                        status.txHash = event.txHash;
                        console.log(`Transaction signed with hash:`, event.txHash);
                    }

                    if ((event.type === 'txBestBlocksState' && event.found) || event.type === 'finalized') {
                        status.blockNumber = event.block.number;
                        status.blockHash = event.block.hash;
                        status.success = event.ok;

                        if (!event.ok && event.dispatchError) {
                            const err = event.dispatchError as Polkadot_asset_hubDispatchError;
                            status.error = err;
                            
                            // Enhanced error handling as per PAPI docs
                            if (err.type === 'Module') {
                                console.error('Module Error:', {
                                    module: err.value.type,
                                    error: err.value,
                                    block: event.block.number
                                });
                            } else {
                                console.error('Other Error:', {
                                    type: err.type,
                                    error: err,
                                    block: event.block.number
                                });
                            }
                        }

                        if (event.type === 'finalized') {
                            if (event.ok) {
                                callbacks?.onSuccess?.(status);
                                resolve();
                            } else {
                                const error = event.dispatchError 
                                    ? this.formatDispatchError(event.dispatchError as Polkadot_asset_hubDispatchError)
                                    : 'Transaction failed without dispatch error';
                                const txError = new Error(`Transaction failed: ${error}`);
                                callbacks?.onError?.(txError);
                                reject(txError);
                            }
                        }
                    }

                    callbacks?.onStatusChange?.(status);
                },
                error: (error) => {
                    // Handle InvalidTxError specifically
                    if (error instanceof InvalidTxError) {
                        const errorMessage = `Invalid transaction: ${this.formatValidityError(error.error)}`;
                        console.error(errorMessage);
                        callbacks?.onError?.(error);
                        reject(new Error(errorMessage));
                        return;
                    }

                    // Handle other errors
                    console.error(`Transaction error:`, error);
                    callbacks?.onError?.(error);
                    reject(error);
                },
                complete: () => {
                    console.log(`Transaction subscription completed`);
                }
            });
        });
    }

    private static formatDispatchError(dispatchError: Polkadot_asset_hubDispatchError): string {
        try {
            if (dispatchError.type === 'Module') {
                return `Module Error: ${JSON.stringify(dispatchError.value)}`;
            }
            return JSON.stringify(dispatchError);
        } catch (e) {
            return 'Unknown dispatch error format';
        }
    }

    private static formatValidityError(error: TransactionValidityError<any>): string {
        try {
            return JSON.stringify(error, null, 2);
        } catch (e) {
            return 'Unknown validity error format';
        }
    }
    
} 
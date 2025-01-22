import { InvalidTxError } from "polkadot-api";
import { Observable, Subscription } from "rxjs";

export type TxEvent = {
    type: string;
    txHash?: string;
    ok?: boolean;
    dispatchError?: {
        type: string;
        value: {
            type: string;
            value?: any;
        };
    };
    events?: any[];
};

export type TxStatus = {
    isFinalized: boolean;
    isInBlock: boolean;
    hasError: boolean;
    error?: any;
    events?: any[];
    txHash?: string;
};

export type TxCallback = {
    onSuccess?: (status: TxStatus) => void;
    onError?: (error: any) => void;
    onStatusChange?: (status: TxStatus) => void;
};

export class TxSubscriber {
    private subscriptions: Map<string, Subscription> = new Map();
    private txStatus: Map<string, TxStatus> = new Map();

    constructor() {
        // Clean up inactive subscriptions periodically
        setInterval(() => this.cleanupInactiveSubscriptions(), 5 * 60 * 1000);
    }

    /**
     * Subscribe to a transaction
     * @param userId Unique identifier for the user/wallet
     * @param txObservable Observable from the transaction
     * @param callbacks Callbacks for transaction events
     * @returns Subscription ID
     */
    subscribe(
        userId: string,
        txObservable: Observable<any>,
        callbacks: TxCallback
    ): string {
        const subscriptionId = `${userId}-${Date.now()}`;
        
        const subscription = txObservable.subscribe({
            next: (event: TxEvent) => {
                const status = this.updateTxStatus(subscriptionId, event);
                
                if (callbacks.onStatusChange) {
                    callbacks.onStatusChange(status);
                }

                if (status.isFinalized && !status.hasError) {
                    callbacks.onSuccess?.(status);
                    this.unsubscribe(subscriptionId);
                }
            },
            error: (error: any) => {
                const errorStatus = this.handleError(subscriptionId, error);
                callbacks.onError?.(errorStatus);
                this.unsubscribe(subscriptionId);
            },
            complete: () => {
                this.unsubscribe(subscriptionId);
            }
        });

        this.subscriptions.set(subscriptionId, subscription);
        this.txStatus.set(subscriptionId, {
            isFinalized: false,
            isInBlock: false,
            hasError: false
        });

        return subscriptionId;
    }

    /**
     * Unsubscribe from a transaction
     * @param subscriptionId Subscription ID to unsubscribe
     */
    unsubscribe(subscriptionId: string): void {
        const subscription = this.subscriptions.get(subscriptionId);
        if (subscription) {
            subscription.unsubscribe();
            this.subscriptions.delete(subscriptionId);
            this.txStatus.delete(subscriptionId);
        }
    }

    /**
     * Get current status of a transaction
     * @param subscriptionId Subscription ID
     */
    getStatus(subscriptionId: string): TxStatus | undefined {
        return this.txStatus.get(subscriptionId);
    }

    private updateTxStatus(subscriptionId: string, event: TxEvent): TxStatus {
        const currentStatus = this.txStatus.get(subscriptionId) || {
            isFinalized: false,
            isInBlock: false,
            hasError: false
        };

        const newStatus = {
            ...currentStatus,
            txHash: event.txHash || currentStatus.txHash,
            events: event.events,
            isFinalized: event.type === "finalized",
            isInBlock: event.type === "txBestBlocksState" || event.type === "finalized",
            hasError: !event.ok
        };

        if (event.dispatchError) {
            newStatus.hasError = true;
            newStatus.error = {
                type: event.dispatchError.type,
                module: event.dispatchError.value?.type,
                error: event.dispatchError.value?.value,
            };
        }

        this.txStatus.set(subscriptionId, newStatus);
        return newStatus;
    }

    private handleError(subscriptionId: string, error: any): TxStatus {
        const errorStatus: TxStatus = {
            isFinalized: false,
            isInBlock: false,
            hasError: true,
            error: error instanceof InvalidTxError 
                ? { type: 'InvalidTx', details: error.error }
                : { type: 'Unknown', details: error }
        };

        this.txStatus.set(subscriptionId, errorStatus);
        return errorStatus;
    }

    private cleanupInactiveSubscriptions(): void {
        for (const [subscriptionId, status] of this.txStatus.entries()) {
            if (status.isFinalized || status.hasError) {
                this.unsubscribe(subscriptionId);
            }
        }
    }
} 
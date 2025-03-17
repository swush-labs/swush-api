import { TypedApi } from 'polkadot-api';
import { hydration } from '@polkadot-api/descriptors';

// Export the Hydration API type
export type HydrationApi = TypedApi<typeof hydration>;

// Export the descriptor type
export type HydrationDescriptors = typeof hydration; 
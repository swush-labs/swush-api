import { XcmV3Junction } from '@polkadot-api/descriptors';
import { XcmV3Junctions } from '@polkadot-api/descriptors';
import { XcmV4Location } from './types';

export function serializeKey(key: any): string {
    if (typeof key === 'number' || typeof key === 'bigint') {
        return key.toString();
    }

    if (key && typeof key === 'object') {
        const replacer = (_: string, value: any) => {
            if (typeof value === 'bigint') {
                return value.toString();
            }
            return value;
        };
        return JSON.stringify(key, replacer);
    }

    return JSON.stringify(key);
}

export function getXcmV3Multilocation(assetId: bigint | number): XcmV4Location {
    return {
        parents: 0,
        interior: XcmV3Junctions.X2([
            XcmV3Junction.PalletInstance(50),
            XcmV3Junction.GeneralIndex(BigInt(assetId)),
        ]),
    };
}

// Helper function to create XCM location
export function createXcmLocation(assetId: number) {
    return {
        parents: 0,
        interior: XcmV3Junctions.X2([
            XcmV3Junction.PalletInstance(50),
            XcmV3Junction.GeneralIndex(BigInt(assetId)),
        ])
    };
}
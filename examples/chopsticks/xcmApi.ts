import { XcmV3MultiassetAssetId, XcmV3MultiassetFungibility, XcmV3WeightLimit, XcmVersionedAssets } from '@polkadot-api/descriptors';
import { XcmV3Junctions } from '@polkadot-api/descriptors';
import { XcmV3Junction } from '@polkadot-api/descriptors';
import { XcmVersionedLocation } from '@polkadot-api/descriptors';
import { AccountId, Binary, SS58String } from 'polkadot-api';
import { XcmV4Location } from '../assets/pools';
import { Enum } from "polkadot-api";

type AssetInfo = {
	assetType: 'relay' | 'native' | 'foreign'
	assetLocation : XcmV4Location
}

//create asset location for foreign asset from parachain, palletInstance, assetId
export function getXcmV3Multilocation(parents: number, parachain: number, palletInstance: number, assetId: bigint | number): XcmV4Location {
    return {
        parents: parents,
        interior: XcmV3Junctions.X3([
			XcmV3Junction.Parachain(parachain),
			XcmV3Junction.PalletInstance(palletInstance),
			XcmV3Junction.GeneralIndex(BigInt(assetId))
        ]),
    };
}

// get XcmV3Multilocation for native asset
export function getXcmV3MultilocationForNativeAsset(parents: number, palletInstance: number, assetId: bigint | number): XcmV4Location {
	return {
		parents: parents,
		interior: XcmV3Junctions.X2([
			XcmV3Junction.PalletInstance(palletInstance),
			XcmV3Junction.GeneralIndex(BigInt(assetId))
		])
	};
}

// Asset Hub (1000) to other parachain
export const transferFromAssetHubToPara = (
	api: any,
	paraId: number,
	address: SS58String,
	amount: bigint
) => ({
	type: "asset_hub_to_para" as const,
	call: api.tx.PolkadotXcm.limited_reserve_transfer_assets({
		dest: XcmVersionedLocation.V3({
			parents: 1, // Up to relay chain
			interior: XcmV3Junctions.X1(XcmV3Junction.Parachain(paraId)),
		}),
		beneficiary: getBeneficiary(address),
		assets: getNativeAsset(amount, 1), // DOT is from relay chain (parent: 1)
		fee_asset_item: 0,
		weight_limit: XcmV3WeightLimit.Unlimited(),
	}),
});

// From parachain to Asset Hub (1000)
export const transferParaToAssetHub = (
	api: any,
	paraId: number,
	address: SS58String,
	amount: bigint,
) => ({
	type: "para_to_asset_hub" as const,
	call: api.tx.PolkadotXcm.limited_reserve_transfer_assets({
		dest: XcmVersionedLocation.V3({
			parents: 1, // Up to relay chain
			interior: XcmV3Junctions.X1(XcmV3Junction.Parachain(paraId)), // Asset Hub paraID
		}),
		beneficiary: getBeneficiary(address),
		assets: getNativeAsset(amount, 1), // DOT is from relay chain (parent: 1) or HDX is from parachain (parent: 0)
		fee_asset_item: 0,
		weight_limit: XcmV3WeightLimit.Unlimited(),
	}),
});

// Transfer assets from Asset Hub to HydraDX and execute an Omnipool swap
export const transferAndSwapOnHydraDX = (
	assetHubApi: any,
	hydraDxApi: any,
	assetId: number | bigint,
	amount: bigint,
	hydradxParaId: number,
	beneficiary: SS58String,
	assetToSwapInto: number | bigint,
	minAmountOut: bigint
) => {
	// Create the assets array with a single asset
	const assets = {
		V3: [{
			id: XcmV3MultiassetAssetId.Concrete({
				parents: 0,
				interior: XcmV3Junctions.X1(XcmV3Junction.GeneralIndex(assetId))
			}),
			fun: XcmV3MultiassetFungibility.Fungible(amount)
		}]
	};

	// Define the destination (HydraDX parachain)
	const destination = XcmVersionedLocation.V3({
		parents: 1,
		interior: XcmV3Junctions.X1(XcmV3Junction.Parachain(hydradxParaId))
	});

	// Create the remote fees asset ID (using the same asset for fees)
	const remoteFeesId = {
		V3: {
			Concrete: {
				parents: 0,
				interior: XcmV3Junctions.X1(XcmV3Junction.GeneralIndex(assetId))
			}
		}
	};

	// Get the encoded Omnipool.sell call
	const encodedOmnipoolSell = hydraDxApi.tx.Omnipool.sell({
		asset_in: assetId,
		asset_out: assetToSwapInto,
		amount: amount,
		min_buy_amount: minAmountOut
	}).method.toHex();

	// Create the custom XCM to execute on HydraDX
	const customXcm = {
		V3: [
			// First deposit the assets to the account
			{
				DepositAsset: {
					assets: { Wild: { AllCounted: 1 } },
					beneficiary: getBeneficiary(beneficiary)
				}
			},
			// Then execute the Omnipool swap call
			{
				Transact: {
					originKind: 'SovereignAccount',
					requireWeightAtMost: {
						refTime: 10000000000n,
						proofSize: 65536n
					},
					call: {
						encoded: encodedOmnipoolSell
					}
				}
			}
		]
	};

	return {
		type: "asset_hub_to_hydradx_with_swap" as const,
		call: assetHubApi.tx.PolkadotXcm.transfer_assets_using_type_and_then({
			assets: assets,
			assets_transfer_type: Enum("RemoteReserve", destination),
			custom_xcm_on_dest: customXcm,
			dest: destination,
			fees_transfer_type: Enum("RemoteReserve", destination),
			remote_fees_id: remoteFeesId,
			weight_limit: XcmV3WeightLimit.Unlimited()
		})
	};
};

const getBeneficiary = (address: SS58String) =>
	XcmVersionedLocation.V3({
		parents: 0,
		interior: XcmV3Junctions.X1(
			XcmV3Junction.AccountId32({
				network: undefined,
				id: Binary.fromBytes(encodeAccount(address)),
			}),
		),
	});

const getNativeAsset = (amount: bigint, parents: 1 | 0) =>
	XcmVersionedAssets.V3([
		{
			id: XcmV3MultiassetAssetId.Concrete({
				parents: parents, // 1 for relay chain DOT, 0 for local asset
				interior: XcmV3Junctions.Here(),
			}),
			fun: XcmV3MultiassetFungibility.Fungible(amount),
		},
	]);

const encodeAccount = AccountId().enc;

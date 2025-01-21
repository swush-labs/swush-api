
import { XcmV3MultiassetAssetId, XcmV3MultiassetFungibility, XcmV3WeightLimit, XcmVersionedAssets } from '@polkadot-api/descriptors';
import { XcmV3Junctions } from '@polkadot-api/descriptors';
import { XcmV3Junction } from '@polkadot-api/descriptors';
import { XcmVersionedLocation } from '@polkadot-api/descriptors';
import { AccountId, Binary, SS58String } from 'polkadot-api';

export const teleportAssetHubToPara = (
	api: any,
	paraId: number,
	address: SS58String,
	amount: bigint,
) => ({
	type: "relay_to_para" as const,
	call: api.tx.PolkadotXcm.limited_reserve_transfer_assets({
		dest: XcmVersionedLocation.V3({
			parents: 1,
			interior: XcmV3Junctions.X1(XcmV3Junction.Parachain(paraId)),
		}),
		beneficiary: getBeneficiary(address),
		assets: getNativeAsset(amount, 1),
		fee_asset_item: 0,
		weight_limit: XcmV3WeightLimit.Unlimited(),
	}),
});

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
				parents,
				interior: XcmV3Junctions.Here(),
			}),
			fun: XcmV3MultiassetFungibility.Fungible(amount),
		},
	]);
    const encodeAccount = AccountId().enc;

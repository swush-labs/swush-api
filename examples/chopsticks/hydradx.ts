import { createClient } from "polkadot-api";
import { getSmProvider } from "polkadot-api/sm-provider";
import { start } from "polkadot-api/smoldot";
import { Enum } from "polkadot-api";
import { XcmVersionedLocation, XcmVersionedAssets, XcmVersionedAssetId, XcmVersionedXcm, XcmV3WeightLimit } from "@polkadot-api/descriptors";

/**
 * Transfers assets from Polkadot Asset Hub to HydraDX and executes an Omnipool swap
 * 
 * @param api - The connected API instance for Asset Hub
 * @param signer - The Polkadot signer to sign the transaction
 * @param assetId - The asset ID to transfer
 * @param amount - Amount to transfer (as bigint)
 * @param hydradxParaId - The parachain ID of HydraDX
 * @param beneficiary - The account that will receive the swapped assets on HydraDX
 * @param assetToSwapInto - The asset ID to swap into on HydraDX
 * @param minAmountOut - Minimum amount to receive from the swap
 * @returns A transaction that can be signed and submitted
 */
export function transferAndSwapOnHydraDX(
  api,
  signer,
  assetId,
  amount,
  hydradxParaId,
  beneficiary,
  assetToSwapInto,
  minAmountOut
) {
  // Create the assets array with a single asset
  const assets = {
    V3: [{
      id: {
        Concrete: {
          parents: 0,
          interior: {
            X1: { GeneralIndex: assetId }
          }
        }
      },
      fun: {
        Fungible: amount
      }
    }]
  };

  // Define the destination (HydraDX parachain)
  const destination = {
    V3: {
      parents: 1,
      interior: {
        X1: { Parachain: hydradxParaId }
      }
    }
  };

  // Create the remote fees asset ID (using the same asset for fees)
  const remoteFeesId = {
    V3: {
      Concrete: {
        parents: 0,
        interior: {
          X1: { GeneralIndex: assetId }
        }
      }
    }
  };

  // Create the custom XCM to execute on HydraDX
  // This will deposit the assets and then execute the Omnipool swap
  const customXcm = {
    V3: [
      // First deposit the assets to the account
      {
        DepositAsset: {
          assets: { Wild: { AllCounted: 1 } },
          beneficiary: {
            parents: 0,
            interior: {
              X1: { AccountId32: { network: null, id: beneficiary } }
            }
          }
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
            // Create the encoded call for Omnipool.sell with the correct parameters
            encoded: api.tx.Omnipool.sell({
              asset_in: assetId,
              asset_out: assetToSwapInto,
              amount: amount,
              min_buy_amount: minAmountOut
            }).method.toHex()
          }
        }
      }
    ]
  };

  // Create the transaction
  const tx = api.tx.PolkadotXcm.transfer_assets_using_type_and_then({
    assets: assets,
    assets_transfer_type: Enum("RemoteReserve", destination),
    custom_xcm_on_dest: customXcm,
    dest: destination,
    fees_transfer_type: Enum("RemoteReserve", destination),
    remote_fees_id: remoteFeesId,
    weight_limit: Enum("Unlimited", null)
  });

  return tx;
}

/**
 * Example usage:
 * 
 * const tx = transferAndSwapOnHydraDX(
 *   api,
 *   signer,
 *   1234n, // Asset ID to transfer
 *   10000000000n, // Amount to transfer
 *   2034, // HydraDX parachain ID
 *   "0x...", // Beneficiary account ID
 *   0, // Asset ID to swap into (HDX)
 *   9000000000n // Minimum amount out (90% of input)
 * );
 * 
 * tx.signSubmitAndWatch(signer).subscribe({
 *   next: (event) => console.log("Tx event: ", event.type),
 *   error: console.error,
 *   complete: () => console.log("Transaction finalized")
 * });
 */
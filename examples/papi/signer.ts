import { sr25519CreateDerive } from "@polkadot-labs/hdkd"
import {
  DEV_PHRASE,
  entropyToMiniSecret,
  mnemonicToEntropy,
  ss58Address
} from "@polkadot-labs/hdkd-helpers"
import { getPolkadotSigner } from "polkadot-api/signer"
  
const miniSecret = entropyToMiniSecret(mnemonicToEntropy(DEV_PHRASE))
const derive = sr25519CreateDerive(miniSecret)
const aliceKeyPair = derive("//Alice")


// Get Alice's address (default prefix 42 for substrate)
const ALICE = ss58Address(aliceKeyPair.publicKey);
// Or with specific network prefix (e.g., 0 for Polkadot)
const ALICE_POLKADOT = ss58Address(aliceKeyPair.publicKey, 0);

console.log('Alice address:', ALICE);

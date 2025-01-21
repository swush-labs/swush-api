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
const bobKeyPair = derive("//Bob")


// Get Alice's address (default prefix 42 for substrate)
const ALICE = ss58Address(aliceKeyPair.publicKey);
// Or with specific network prefix (e.g., 0 for Polkadot)
const ALICE_POLKADOT = ss58Address(aliceKeyPair.publicKey, 0);

console.log('Alice address:', ALICE);
const BOB = ss58Address(bobKeyPair.publicKey);
const BOB_POLKADOT = ss58Address(bobKeyPair.publicKey,63);
console.log('Bob address:', BOB);
console.log('Bob address:', BOB_POLKADOT);

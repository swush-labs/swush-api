import { sr25519CreateDerive } from "@polkadot-labs/hdkd";
import {
  DEV_PHRASE,
  entropyToMiniSecret,
  mnemonicToEntropy,
  ss58Encode
} from "@polkadot-labs/hdkd-helpers";

interface AccountExport {
  address: string;
  name: string;
  mnemonic: string;
  derivationPath: string;
}

export function exportDevAccounts(): AccountExport[] {
  // Initialize the derive function with dev phrase
  const miniSecret = entropyToMiniSecret(mnemonicToEntropy(DEV_PHRASE));
  const derive = sr25519CreateDerive(miniSecret);

  // Generate keypairs
  const aliceKeyPair = derive("//Alice");
  const bobKeyPair = derive("//Bob");

  // Format accounts for export
  const accounts: AccountExport[] = [
    {
      name: "Alice (Dev)",
      address: ss58Encode(aliceKeyPair.publicKey, 0), // Using substrate format (0)
      mnemonic: DEV_PHRASE,
      derivationPath: "//Alice"
    },
    {
      name: "Bob (Dev)",
      address: ss58Encode(bobKeyPair.publicKey, 0), // Using substrate format (0)
      mnemonic: DEV_PHRASE,
      derivationPath: "//Bob"
    }
  ];

  return accounts;
}

// Utility function to generate QR-compatible JSON
export function generateWalletImportData(account: AccountExport): string {
  return JSON.stringify({
    name: account.name,
    address: account.address,
    encoded: account.mnemonic, // The mnemonic phrase
    encoding: {
      content: ["mnemonic"],
      type: "none",
      version: "0"
    },
    meta: {
      name: account.name,
      whenCreated: Date.now()
    }
  }, null, 2);
}

// Example usage
export function printWalletInstructions(): void {
  const accounts = exportDevAccounts();
  
  console.log("=== Instructions for Importing Development Accounts ===\n");
  
  accounts.forEach(account => {
    console.log(`For ${account.name}:`);
    console.log("1. Mnemonic Phrase (Save Securely):");
    console.log(`   ${account.mnemonic}`);
    console.log("2. Derivation Path:");
    console.log(`   ${account.derivationPath}`);
    console.log("3. Address:");
    console.log(`   ${account.address}`);
    console.log("\nTo import into Polkadot.js extension or other web wallets:");
    console.log("1. Click 'Import Account'");
    console.log("2. Enter the mnemonic phrase");
    console.log("3. In advanced options, enter the derivation path");
    console.log("4. Complete the import process\n");
    console.log("----------------------------------------\n");
  });
} 
import { exportDevAccounts, printWalletInstructions, generateWalletImportData } from '../utils/accountExport';

async function main() {
    // Print detailed instructions for manual import
    printWalletInstructions();

    // Example of generating QR-compatible JSON for each account
    const accounts = exportDevAccounts();
    accounts.forEach(account => {
        console.log(`\nQR-compatible JSON for ${account.name}:`);
        console.log(generateWalletImportData(account));
    });
}

main().catch(console.error); 
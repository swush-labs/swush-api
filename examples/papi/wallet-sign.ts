import {
    getInjectedExtensions,
    connectInjectedExtension,
    InjectedExtension,
    InjectedPolkadotAccount,
  } from "polkadot-api/pjs-signer"
   

async function main(){
  // Get the list of installed extensions
  const extensions: string[] = getInjectedExtensions()
   
  // Connect to an extension
  const selectedExtension: InjectedExtension = await connectInjectedExtension(
    extensions[0],
  )
   
  // Get accounts registered in the extension
  const accounts: InjectedPolkadotAccount[] = selectedExtension.getAccounts()
   
  // The signer for each account is in the `polkadotSigner` property of `InjectedPolkadotAccount`
  const polkadotSigner = accounts[0].polkadotSigner;
}

main().catch(console.error);
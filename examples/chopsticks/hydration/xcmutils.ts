
//extract forwarded xcms from dry run result
export function extractForwardedXcms(dryRunResult: any) {
    
    const { forwarded_xcms } = dryRunResult.value;
        
    // Find the message targeting our desired parachain
    const targetMessage = forwarded_xcms.find(([location, _]) => 
        location.type === 'V4' &&
        location.value.parents === 1 &&
        location.value.interior.type === 'X1' &&
        location.value.interior.value.type === 'Parachain' &&
        location.value.interior.value.value === targetParaId
    );

    if (!targetMessage) {
        throw new Error(`No forwarded message found for parachain ${targetParaId}`);
    }

    return targetMessage[1][0]; // Return the first message in the array
}



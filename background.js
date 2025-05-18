
// Background script for YouTube Force Buffer
console.log('[YT Force Buffer] Background script initialized');

// Listen for messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'BUFFER_STATUS') {
    const data = message.data;
    
    // Format quality info if available
    const qualityInfo = data.quality ? ` (${data.quality})` : '';
    const videoTypeInfo = data.isShorts ? ' [Shorts]' : '';
    
    // Log based on status
    if (data.status === 'started') {
      console.log(`[YT Force Buffer] Started buffering${videoTypeInfo}${qualityInfo}`);
    } else if (data.status === 'complete') {
      console.log(`[YT Force Buffer] Finished buffering${videoTypeInfo}${qualityInfo}`);
    } else {
      console.log(`[YT Force Buffer] Buffer status: ${data.status}${videoTypeInfo}${qualityInfo}`);
    }
  }
  return true;
});

// Listen for extension install or update
chrome.runtime.onInstalled.addListener((details) => {
  console.log(`[YT Force Buffer] Extension ${details.reason}ed`);
});

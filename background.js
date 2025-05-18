
/**
 * YouTube Force Buffer - Background Script
 * Handles background tasks and logging for the extension
 */

console.log('[YT Force Buffer] Background script initialized');

// Track active buffering sessions
const activeBuffers = new Map();

// Format elapsed time in seconds
const formatElapsedTime = (seconds) => {
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  
  const minutes = Math.floor(seconds / 60);
  const remainingSecs = (seconds % 60).toFixed(0);
  return `${minutes}m ${remainingSecs}s`;
};

// Format video quality for display
const formatQuality = (quality) => {
  return quality ? ` (${quality})` : '';
};

// Format video type info
const formatVideoType = (isShorts) => {
  return isShorts ? ' [Shorts]' : '';
};

// Handle messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'BUFFER_STATUS') {
    const data = message.data;
    const tabId = sender.tab ? sender.tab.id : 'unknown';
    
    // Get quality and video type info
    const qualityInfo = formatQuality(data.quality);
    const videoTypeInfo = formatVideoType(data.isShorts);
    
    // Handle different status updates
    switch(data.status) {
      case 'started':
        // Start tracking this buffer session
        activeBuffers.set(tabId, {
          startTime: Date.now(),
          videoType: data.isShorts ? 'Shorts' : 'Video',
          quality: data.quality,
          progress: 0
        });
        console.log(`[YT Force Buffer] Started buffering${videoTypeInfo}${qualityInfo}`);
        break;
        
      case 'progress':
        // Update progress
        if (activeBuffers.has(tabId)) {
          const buffer = activeBuffers.get(tabId);
          buffer.progress = data.progress;
          buffer.speed = data.speed;
          
          // Only log every 10% or when speed changes significantly
          if (data.progress % 10 === 0 || data.progress === 25 || data.progress === 75) {
            const elapsedTime = formatElapsedTime((Date.now() - buffer.startTime) / 1000);
            console.log(`[YT Force Buffer] Buffering: ${data.progress}% complete${videoTypeInfo}${qualityInfo}, Speed: ${data.speed}s/s, Elapsed: ${elapsedTime}`);
          }
        }
        break;
        
      case 'quality_change':
        console.log(`[YT Force Buffer] Quality changed${videoTypeInfo} from ${data.from} to ${data.to}`);
        
        // Update stored quality if we're tracking this session
        if (activeBuffers.has(tabId)) {
          const buffer = activeBuffers.get(tabId);
          buffer.quality = data.to;
        }
        break;
        
      case 'complete':
        // Calculate total time
        if (activeBuffers.has(tabId)) {
          const buffer = activeBuffers.get(tabId);
          const totalTime = (Date.now() - buffer.startTime) / 1000;
          console.log(`[YT Force Buffer] Finished buffering${videoTypeInfo}${qualityInfo} in ${formatElapsedTime(totalTime)} (${data.attempts} seeks)`);
          
          // Clean up
          activeBuffers.delete(tabId);
        } else {
          console.log(`[YT Force Buffer] Finished buffering${videoTypeInfo}${qualityInfo}`);
        }
        break;
        
      default:
        console.log(`[YT Force Buffer] Buffer status: ${data.status}${videoTypeInfo}${qualityInfo}`);
    }
  }
  return true;
});

// Listen for tab close events to clean up tracking
chrome.tabs.onRemoved.addListener((tabId) => {
  if (activeBuffers.has(tabId)) {
    activeBuffers.delete(tabId);
  }
});

// Listen for extension install or update
chrome.runtime.onInstalled.addListener((details) => {
  console.log(`[YT Force Buffer] Extension ${details.reason}ed`);
  
  if (details.reason === 'install') {
    console.log('[YT Force Buffer] Thank you for installing YouTube Force Buffer! The extension is now ready to use.');
  } else if (details.reason === 'update') {
    const version = chrome.runtime.getManifest().version;
    console.log(`[YT Force Buffer] Updated to version ${version} with improved buffering features.`);
  }
});

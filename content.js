
/**
 * YouTube Force Buffer - Content Script
 * Forces complete video buffering on YouTube videos and Shorts
 */

(function() {
  'use strict';
  
  // Configuration
  const config = {
    checkInterval: 1000,         // How often to check video buffer status (ms)
    seekStepSize: 30,            // Default seek step size for regular videos (seconds)
    shortsSeekStepSize: 5,       // Smaller seek step size for Shorts (seconds)
    maxSeekAttempts: 100,        // Maximum number of seek attempts
    logPrefix: '[YT Force Buffer]', // Log prefix for consistent identification
    debugMode: true              // Enable console logging for debugging
  };
  
  let videoElement = null;
  let originalPlaybackRate = 1;
  let originalPlaybackTime = 0;
  let isBuffering = false;
  let seekAttempts = 0;
  let bufferCheckInterval = null;
  let lastKnownQuality = null;
  let isShorts = false;
  let videoObserver = null;
  
  /**
   * Debug logger that only logs when debug mode is enabled
   */
  const debugLog = (...args) => {
    if (config.debugMode) {
      console.log(config.logPrefix, ...args);
    }
  };
  
  /**
   * Checks if the current page is a YouTube Shorts page
   * @returns {boolean} - Whether the current page is a Shorts page
   */
  const checkIfShorts = () => {
    return window.location.href.includes('youtube.com/shorts');
  };
  
  /**
   * Gets the current video quality if possible
   * @returns {string|null} - The current video quality or null if unavailable
   */
  const getCurrentVideoQuality = () => {
    try {
      // Try to get quality from YouTube's player API if accessible
      const playerElement = document.querySelector('.html5-video-player');
      if (playerElement && playerElement.getPlaybackQuality) {
        return playerElement.getPlaybackQuality();
      }
      
      // Fallback: try to estimate from video height
      if (videoElement) {
        const videoHeight = videoElement.videoHeight;
        if (videoHeight >= 1080) return '1080p';
        if (videoHeight >= 720) return '720p';
        if (videoHeight >= 480) return '480p';
        if (videoHeight >= 360) return '360p';
        if (videoHeight >= 240) return '240p';
        return `${videoHeight}p`;
      }
    } catch (error) {
      debugLog('Error getting video quality:', error);
    }
    return null;
  };
  
  /**
   * Checks if the video is fully buffered
   * @param {HTMLVideoElement} video - The video element to check
   * @returns {boolean} - Whether the video is fully buffered
   */
  const isVideoFullyBuffered = (video) => {
    if (!video || !video.buffered || video.buffered.length === 0) {
      return false;
    }
    
    // Get the buffered range that contains the current time
    const currentTime = video.currentTime;
    const duration = video.duration;
    
    // If we can't determine duration, we can't know if it's fully buffered
    if (isNaN(duration) || !isFinite(duration)) {
      return false;
    }
    
    // For each buffered range, check if we have buffered to near the end
    for (let i = 0; i < video.buffered.length; i++) {
      const start = video.buffered.start(i);
      const end = video.buffered.end(i);
      
      // If this range covers from current position to near the end, video is fully buffered
      if (start <= currentTime && end >= duration - 1) {
        return true;
      }
    }
    
    return false;
  };
  
  /**
   * Gets the furthest buffered time for the video
   * @param {HTMLVideoElement} video - The video element
   * @returns {number} - The furthest buffered time in seconds
   */
  const getFurthestBufferedTime = (video) => {
    if (!video || !video.buffered || video.buffered.length === 0) {
      return 0;
    }
    
    // Find the furthest buffered end time
    let maxBufferedEnd = 0;
    for (let i = 0; i < video.buffered.length; i++) {
      const end = video.buffered.end(i);
      if (end > maxBufferedEnd) {
        maxBufferedEnd = end;
      }
    }
    
    return maxBufferedEnd;
  };
  
  /**
   * Determines the appropriate seek step size based on video duration and type
   * @param {HTMLVideoElement} video - The video element
   * @returns {number} - Seek step size in seconds
   */
  const getSeekStepSize = (video) => {
    if (!video) return config.seekStepSize;
    
    // For Shorts, use smaller seek step size
    if (isShorts) return config.shortsSeekStepSize;
    
    // For regular videos, adapt based on duration
    const duration = video.duration;
    if (isNaN(duration) || !isFinite(duration)) return config.seekStepSize;
    
    // Adaptive seek step size based on duration
    if (duration < 60) return 5;  // Short videos: 5 seconds
    if (duration < 300) return 15; // Medium videos: 15 seconds
    return config.seekStepSize;    // Long videos: default (30 seconds)
  };
  
  /**
   * Forces video buffering by manipulating the playback speed and using seeking
   */
  const forceBuffering = () => {
    if (!videoElement || isVideoFullyBuffered(videoElement) || seekAttempts >= config.maxSeekAttempts) {
      stopBuffering();
      return;
    }
    
    // Check for quality changes
    const currentQuality = getCurrentVideoQuality();
    if (lastKnownQuality && currentQuality && lastKnownQuality !== currentQuality) {
      debugLog(`Quality changed from ${lastKnownQuality} to ${currentQuality}, restarting buffer process`);
      // Reset buffering and start over with new quality
      stopBuffering();
      lastKnownQuality = currentQuality;
      startBuffering();
      return;
    }
    
    // Store current quality
    if (currentQuality) {
      lastKnownQuality = currentQuality;
    }
    
    if (!isBuffering) {
      // Store original state
      originalPlaybackRate = videoElement.playbackRate;
      originalPlaybackTime = videoElement.currentTime;
      isBuffering = true;
      
      // Pause the video while buffering
      if (!videoElement.paused) {
        videoElement.pause();
      }
      
      // Log buffering start with current quality
      debugLog(`Starting buffering process${currentQuality ? ` (${currentQuality})` : ''}`);
    }
    
    const duration = videoElement.duration;
    const furthestBufferedTime = getFurthestBufferedTime(videoElement);
    const remainingTime = duration - furthestBufferedTime;
    const bufferPercentage = Math.round((furthestBufferedTime/duration)*100);
    
    debugLog(`Buffering: ${Math.round(furthestBufferedTime)}s / ${Math.round(duration)}s (${bufferPercentage}%)`);
    
    // If we have less than 1 second remaining or have reached max attempts, we're done
    if (remainingTime <= 1 || seekAttempts >= config.maxSeekAttempts) {
      debugLog('Buffering complete or max attempts reached');
      stopBuffering();
      return;
    }
    
    // Get adaptive seek step size
    const seekStep = getSeekStepSize(videoElement);
    
    // Calculate next seek position
    const nextSeekPosition = Math.min(furthestBufferedTime + seekStep, duration - 0.1);
    
    // Advanced handling for all video formats
    try {
      // Store current position
      const currentPosition = videoElement.currentTime;
      
      // Seek ahead to force buffer
      videoElement.currentTime = nextSeekPosition;
      
      // Wait briefly for buffering to start
      setTimeout(() => {
        // Return to original position
        if (videoElement) {
          videoElement.currentTime = currentPosition;
        }
        seekAttempts++;
      }, 150);
    } catch (error) {
      debugLog('Error during seek:', error);
      stopBuffering();
    }
  };
  
  /**
   * Starts the buffering process
   */
  const startBuffering = () => {
    if (!videoElement || isBuffering) return;
    
    originalPlaybackTime = videoElement.currentTime;
    originalPlaybackRate = videoElement.playbackRate;
    isBuffering = true;
    seekAttempts = 0;
    
    const currentQuality = getCurrentVideoQuality();
    debugLog(`Starting force buffering${currentQuality ? ` (${currentQuality})` : ''}`);
    
    // Notify background script that buffering has started
    try {
      chrome.runtime.sendMessage({
        type: 'BUFFER_STATUS',
        data: { 
          status: 'started', 
          quality: currentQuality,
          isShorts: isShorts
        }
      });
    } catch (error) {
      // Ignore errors from disconnected port
    }
    
    forceBuffering();
  };
  
  /**
   * Stops the buffering process and restores original playback state
   */
  const stopBuffering = () => {
    if (!isBuffering) {
      return;
    }
    
    debugLog('Stopping buffer forcing');
    
    // Restore original state
    if (videoElement) {
      videoElement.currentTime = originalPlaybackTime;
      videoElement.playbackRate = originalPlaybackRate;
    }
    
    // Reset buffering state
    isBuffering = false;
    seekAttempts = 0;
    
    const currentQuality = getCurrentVideoQuality();
    
    // Notify background script that buffering is complete
    try {
      chrome.runtime.sendMessage({
        type: 'BUFFER_STATUS',
        data: { 
          status: 'complete',
          quality: currentQuality,
          isShorts: isShorts
        }
      });
    } catch (error) {
      // Ignore errors from disconnected port
    }
  };
  
  /**
   * Starts monitoring the video buffer
   */
  const startBufferMonitoring = (video) => {
    if (!video || bufferCheckInterval) {
      return;
    }
    
    videoElement = video;
    isShorts = checkIfShorts();
    lastKnownQuality = getCurrentVideoQuality();
    
    debugLog(`Starting buffer monitoring${isShorts ? ' (Shorts video)' : ''}${lastKnownQuality ? ` (${lastKnownQuality})` : ''}`);
    
    // Monitor for quality changes directly on the video element
    video.addEventListener('resize', () => {
      const newQuality = getCurrentVideoQuality();
      if (lastKnownQuality && newQuality && lastKnownQuality !== newQuality) {
        debugLog(`Quality changed from ${lastKnownQuality} to ${newQuality}`);
        lastKnownQuality = newQuality;
        
        // If we're already buffering, restart the process with new quality
        if (isBuffering) {
          stopBuffering();
          startBuffering();
        }
      }
    });
    
    bufferCheckInterval = setInterval(() => {
      // Only force buffering when video is playing and not already fully buffered
      if (videoElement && !isVideoFullyBuffered(videoElement)) {
        forceBuffering();
      } else if (isBuffering) {
        stopBuffering();
      }
    }, config.checkInterval);
  };
  
  /**
   * Stops monitoring the video buffer
   */
  const stopBufferMonitoring = () => {
    if (bufferCheckInterval) {
      clearInterval(bufferCheckInterval);
      bufferCheckInterval = null;
    }
    
    if (isBuffering) {
      stopBuffering();
    }
    
    videoElement = null;
    debugLog('Stopped buffer monitoring');
  };
  
  /**
   * Sets up a mutation observer to detect when video elements are added or removed
   */
  const setupVideoObserver = () => {
    debugLog('Setting up video observer');
    
    // First, check if there's already a video element
    const existingVideo = document.querySelector('video');
    if (existingVideo) {
      startBufferMonitoring(existingVideo);
    }
    
    // Set up mutation observer to detect when videos are added or changed
    videoObserver = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        // Check for added nodes
        if (mutation.addedNodes.length > 0) {
          mutation.addedNodes.forEach((node) => {
            // Direct video element
            if (node.nodeName === 'VIDEO') {
              startBufferMonitoring(node);
            }
            // Video element within added DOM tree
            else if (node.querySelector) {
              const video = node.querySelector('video');
              if (video) {
                startBufferMonitoring(video);
              }
            }
          });
        }
        
        // Check if our monitored video was removed
        if (videoElement && mutation.removedNodes.length > 0) {
          mutation.removedNodes.forEach((node) => {
            if (node === videoElement || (node.contains && node.contains(videoElement))) {
              stopBufferMonitoring();
            }
          });
        }
      });
    });
    
    // Start observing the document
    videoObserver.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
    
    return videoObserver;
  };
  
  /**
   * Handles page navigation/URL changes
   */
  const handleURLChange = () => {
    const currentIsShorts = checkIfShorts();
    
    // If shorts status has changed, update and restart
    if (isShorts !== currentIsShorts) {
      debugLog(`Detected navigation to ${currentIsShorts ? 'Shorts' : 'regular video'} page`);
      isShorts = currentIsShorts;
      
      // Reset and restart monitoring
      stopBufferMonitoring();
      setupVideoObserver();
    }
  };
  
  /**
   * Initializes the extension
   */
  const initialize = () => {
    debugLog('Initializing YouTube Force Buffer');
    
    // Only run on YouTube video or shorts pages
    if (!window.location.href.includes('youtube.com/watch') && 
        !window.location.href.includes('youtube.com/shorts')) {
      debugLog('Not a YouTube video or shorts page, exiting');
      return;
    }
    
    isShorts = checkIfShorts();
    debugLog(`Detected ${isShorts ? 'YouTube Shorts' : 'regular YouTube video'} page`);
    
    // Set up video element observer
    videoObserver = setupVideoObserver();
    
    // Listen for URL changes (for Single Page Application navigation)
    const handleURLChanges = () => {
      let lastUrl = location.href;
      new MutationObserver(() => {
        if (location.href !== lastUrl) {
          lastUrl = location.href;
          handleURLChange();
        }
      }).observe(document, { subtree: true, childList: true });
    };
    
    handleURLChanges();
    
    // Clean up when navigating away
    window.addEventListener('beforeunload', () => {
      stopBufferMonitoring();
      if (videoObserver) {
        videoObserver.disconnect();
      }
    });
  };
  
  // Start the extension
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
  } else {
    initialize();
  }
})();

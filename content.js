
/**
 * YouTube Force Buffer - Content Script
 * Forces complete video buffering on YouTube videos and Shorts
 * 
 * This extension uses advanced techniques to force YouTube videos to buffer completely,
 * working around YouTube's anti-buffering measures.
 */

(function() {
  'use strict';
  
  // Configuration
  const config = {
    checkInterval: 1000,           // How often to check video buffer status (ms)
    shortVideoThreshold: 300,      // Videos under this length (seconds) are considered short
    adaptiveSeekMinimum: 5,        // Minimum seek step size (seconds)
    adaptiveSeekMaximum: 60,       // Maximum seek step size (seconds)
    shortsSeekStepSize: 5,         // Smaller seek step size for Shorts (seconds)
    maxSeekAttempts: 500,          // Maximum number of seek attempts (increased from 100)
    logPrefix: '[YT Force Buffer]', // Log prefix for consistent identification
    debugMode: true,               // Enable console logging for debugging
    retryDelayIncrement: 50,       // Incremental delay for retries (ms)
    connectionSpeedSampleSize: 5,  // Number of samples to determine connection speed
    qualityChangeThreshold: 500    // Time to wait after quality change (ms)
  };
  
  // State management
  let state = {
    videoElement: null,
    originalPlaybackRate: 1,
    originalPlaybackTime: 0,
    isBuffering: false,
    seekAttempts: 0,
    bufferCheckInterval: null,
    lastKnownQuality: null,
    isShorts: false,
    videoObserver: null,
    connectionSpeedSamples: [],
    lastBufferEnd: 0,
    lastBufferTime: 0,
    consecutiveFailedAttempts: 0,
    qualityChangeDetected: false,
    bufferingStrategy: 'normal', // normal, aggressive, conservative
    seekStepMultiplier: 1,
    reconnectAttempts: 0
  };

  // Connection speed tracking
  const connectionTracker = {
    samples: [],
    lastSampleTime: 0,
    lastBufferedBytes: 0,

    addSample(bytesPerSecond) {
      this.samples.push(bytesPerSecond);
      if (this.samples.length > config.connectionSpeedSampleSize) {
        this.samples.shift();
      }
    },

    getAverageSpeed() {
      if (this.samples.length === 0) return 0;
      const sum = this.samples.reduce((acc, val) => acc + val, 0);
      return sum / this.samples.length;
    },

    reset() {
      this.samples = [];
      this.lastSampleTime = 0;
      this.lastBufferedBytes = 0;
    },

    update(video) {
      if (!video || !video.buffered || video.buffered.length === 0) return;

      const now = Date.now();
      const bufferedBytes = calculateBufferedBytes(video);

      if (this.lastSampleTime > 0) {
        const elapsedTime = (now - this.lastSampleTime) / 1000; // convert to seconds
        if (elapsedTime > 0 && bufferedBytes > this.lastBufferedBytes) {
          const bytesPerSecond = (bufferedBytes - this.lastBufferedBytes) / elapsedTime;
          this.addSample(bytesPerSecond);
        }
      }

      this.lastSampleTime = now;
      this.lastBufferedBytes = bufferedBytes;
    }
  };
  
  /**
   * Estimates the buffered bytes based on video properties
   * @param {HTMLVideoElement} video - The video element
   * @returns {number} - Estimated buffered bytes
   */
  const calculateBufferedBytes = (video) => {
    if (!video || !video.buffered || video.buffered.length === 0) {
      return 0;
    }

    const videoHeight = video.videoHeight || 720;
    const videoWidth = video.videoWidth || 1280;
    const duration = video.duration || 0;
    
    // Estimate bitrate based on resolution
    let bitrateFactor = 0.5; // Default
    if (videoHeight >= 1080) bitrateFactor = 1.5;
    else if (videoHeight >= 720) bitrateFactor = 1.0;
    else if (videoHeight >= 480) bitrateFactor = 0.7;
    
    // Calculate bytes per second of video
    const bytesPerSecond = bitrateFactor * videoWidth * videoHeight / 8;
    
    // Calculate total buffered duration
    let bufferedDuration = 0;
    for (let i = 0; i < video.buffered.length; i++) {
      bufferedDuration += (video.buffered.end(i) - video.buffered.start(i));
    }
    
    return bytesPerSecond * bufferedDuration;
  };
  
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
      // First try to get quality from YouTube's player API
      const playerElement = document.querySelector('.html5-video-player');
      if (playerElement && playerElement.getPlaybackQuality) {
        return playerElement.getPlaybackQuality();
      }
      
      // Try to get from quality menu if available
      const qualityMenuItem = document.querySelector('.ytp-settings-button + .ytp-panel .ytp-quality-menu .ytp-menuitem[aria-checked="true"]');
      if (qualityMenuItem) {
        return qualityMenuItem.textContent.trim();
      }
      
      // Fallback: try to estimate from video height
      if (state.videoElement) {
        const videoHeight = state.videoElement.videoHeight;
        if (videoHeight >= 2160) return '4K/2160p';
        if (videoHeight >= 1440) return '1440p';
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
      // We consider 0.5 seconds from the end as "fully buffered"
      if (start <= currentTime && end >= duration - 0.5) {
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
   * Calculate buffer speed in MB/s
   * @param {HTMLVideoElement} video - The video element
   * @returns {number} - Buffer speed in MB/s
   */
  const calculateBufferSpeed = (video) => {
    if (!video || !state.lastBufferEnd || !state.lastBufferTime) {
      return 0;
    }
    
    const currentBufferEnd = getFurthestBufferedTime(video);
    const currentTime = Date.now();
    const timeDiff = (currentTime - state.lastBufferTime) / 1000;
    
    if (timeDiff <= 0) {
      return 0;
    }
    
    const bufferDiff = currentBufferEnd - state.lastBufferEnd;
    
    // Update for next calculation
    state.lastBufferEnd = currentBufferEnd;
    state.lastBufferTime = currentTime;
    
    return bufferDiff / timeDiff;
  };
  
  /**
   * Determines the appropriate seek step size based on video duration, type, and connection speed
   * @param {HTMLVideoElement} video - The video element
   * @returns {number} - Seek step size in seconds
   */
  const getSeekStepSize = (video) => {
    if (!video) return config.adaptiveSeekMinimum;
    
    // For Shorts, use smaller seek step size
    if (state.isShorts) return config.shortsSeekStepSize;
    
    // For regular videos, adapt based on duration and connection speed
    const duration = video.duration;
    if (isNaN(duration) || !isFinite(duration)) return config.adaptiveSeekMinimum;
    
    // Base seek step on video duration
    let baseSeekStep;
    if (duration < 60) {
      baseSeekStep = 5;  // Very short videos: 5 seconds
    } else if (duration < 300) {
      baseSeekStep = 10; // Short videos: 10 seconds
    } else if (duration < 900) {
      baseSeekStep = 20; // Medium videos: 20 seconds
    } else if (duration < 1800) {
      baseSeekStep = 30; // Long videos: 30 seconds
    } else {
      baseSeekStep = 45; // Very long videos: 45 seconds
    }
    
    // Adjust based on connection speed
    const bufferSpeed = calculateBufferSpeed(video);
    let speedMultiplier = 1;
    
    if (bufferSpeed > 5) {
      speedMultiplier = 1.5; // Very fast connection
    } else if (bufferSpeed > 2) {
      speedMultiplier = 1.2; // Fast connection
    } else if (bufferSpeed < 0.5) {
      speedMultiplier = 0.6; // Slow connection
    } else if (bufferSpeed < 1) {
      speedMultiplier = 0.8; // Moderately slow connection
    }
    
    // Apply strategy multiplier
    const strategyMultiplier = state.seekStepMultiplier;
    
    // Calculate final seek step
    const finalSeekStep = baseSeekStep * speedMultiplier * strategyMultiplier;
    
    // Clamp to min/max
    return Math.max(
      config.adaptiveSeekMinimum,
      Math.min(config.adaptiveSeekMaximum, finalSeekStep)
    );
  };
  
  /**
   * Detects quality changes in the video
   * @returns {boolean} - Whether a quality change was detected
   */
  const detectQualityChange = () => {
    const currentQuality = getCurrentVideoQuality();
    if (currentQuality && state.lastKnownQuality && currentQuality !== state.lastKnownQuality) {
      debugLog(`Quality changed from ${state.lastKnownQuality} to ${currentQuality}`);
      state.lastKnownQuality = currentQuality;
      state.qualityChangeDetected = true;
      
      // Reset buffering strategy when quality changes
      resetBufferingStrategy();
      
      // Notify background script about quality change
      try {
        chrome.runtime.sendMessage({
          type: 'BUFFER_STATUS',
          data: { 
            status: 'quality_change',
            quality: currentQuality,
            isShorts: state.isShorts,
            from: state.lastKnownQuality,
            to: currentQuality
          }
        });
      } catch (error) {
        // Ignore errors from disconnected port
      }
      
      return true;
    }
    return false;
  };
  
  /**
   * Updates the buffering strategy based on success or failure of previous attempts
   * @param {boolean} success - Whether the previous buffering attempt was successful
   */
  const updateBufferingStrategy = (success) => {
    if (success) {
      // Reset consecutive failures on success
      state.consecutiveFailedAttempts = 0;
      
      // If we've been in aggressive mode and succeeded, gradually move back to normal
      if (state.bufferingStrategy === 'aggressive' && state.seekStepMultiplier > 1) {
        state.seekStepMultiplier -= 0.1;
        if (state.seekStepMultiplier < 1) {
          state.seekStepMultiplier = 1;
          state.bufferingStrategy = 'normal';
          debugLog('Buffering strategy reverted to normal mode');
        }
      }
    } else {
      // Increment failures
      state.consecutiveFailedAttempts++;
      
      // Adjust strategy based on number of failures
      if (state.consecutiveFailedAttempts >= 10) {
        // Aggressive mode: increase seek step size
        state.bufferingStrategy = 'aggressive';
        state.seekStepMultiplier = 2.0;
        debugLog('Switching to aggressive buffering strategy');
      } else if (state.consecutiveFailedAttempts >= 5) {
        // More aggressive but not maximum
        state.bufferingStrategy = 'aggressive';
        state.seekStepMultiplier = 1.5;
        debugLog('Increasing buffering aggressiveness');
      }
    }
  };
  
  /**
   * Resets the buffering strategy to normal
   */
  const resetBufferingStrategy = () => {
    state.bufferingStrategy = 'normal';
    state.seekStepMultiplier = 1;
    state.consecutiveFailedAttempts = 0;
    debugLog('Buffering strategy reset to normal');
  };
  
  /**
   * Forces video buffering by manipulating the playback speed and using seeking
   */
  const forceBuffering = () => {
    const video = state.videoElement;
    
    if (!video || isVideoFullyBuffered(video) || state.seekAttempts >= config.maxSeekAttempts) {
      stopBuffering();
      return;
    }
    
    // Check for quality changes
    if (detectQualityChange() && state.isBuffering) {
      // On quality change, restart buffering process
      debugLog('Quality changed, restarting buffer process');
      stopBuffering();
      setTimeout(() => {
        startBuffering();
      }, config.qualityChangeThreshold);
      return;
    }
    
    // Update connection speed data
    connectionTracker.update(video);
    
    if (!state.isBuffering) {
      // Store original state
      state.originalPlaybackRate = video.playbackRate;
      state.originalPlaybackTime = video.currentTime;
      state.isBuffering = true;
      
      // Initialize buffer tracking
      state.lastBufferEnd = getFurthestBufferedTime(video);
      state.lastBufferTime = Date.now();
      
      // Pause the video while buffering
      if (!video.paused) {
        video.pause();
      }
      
      const currentQuality = getCurrentVideoQuality();
      
      // Log buffering start with current quality
      debugLog(`Starting buffering process${currentQuality ? ` (${currentQuality})` : ''}`);
    }
    
    const duration = video.duration;
    const furthestBufferedTime = getFurthestBufferedTime(video);
    const remainingTime = duration - furthestBufferedTime;
    const bufferPercentage = Math.round((furthestBufferedTime/duration)*100);
    const bufferSpeed = calculateBufferSpeed(video);
    
    // Log detailed buffering status
    if (state.seekAttempts % 5 === 0 || bufferPercentage % 10 === 0) {
      debugLog(`Buffering: ${Math.round(furthestBufferedTime)}s / ${Math.round(duration)}s (${bufferPercentage}%), Speed: ${bufferSpeed.toFixed(2)}s/s, Strategy: ${state.bufferingStrategy}`);
      
      // Send status update to background script
      try {
        chrome.runtime.sendMessage({
          type: 'BUFFER_STATUS',
          data: { 
            status: 'progress',
            quality: state.lastKnownQuality,
            isShorts: state.isShorts,
            progress: bufferPercentage,
            speed: bufferSpeed.toFixed(2),
            remainingTime: Math.round(remainingTime)
          }
        });
      } catch (error) {
        // Ignore errors from disconnected port
      }
    }
    
    // If we have less than 0.5 second remaining or have reached max attempts, we're done
    if (remainingTime <= 0.5 || state.seekAttempts >= config.maxSeekAttempts) {
      debugLog('Buffering complete or max attempts reached');
      stopBuffering();
      return;
    }
    
    // Get adaptive seek step size
    const seekStep = getSeekStepSize(video);
    
    // Calculate next seek position
    const nextSeekPosition = Math.min(furthestBufferedTime + seekStep, duration - 0.1);
    
    // Track previous buffer position to check if we're making progress
    const previousBufferedTime = furthestBufferedTime;
    
    // Advanced handling for all video formats
    try {
      // Store current position
      const currentPosition = video.currentTime;
      
      // Seek ahead to force buffer
      video.currentTime = nextSeekPosition;
      
      // Wait briefly for buffering to start
      setTimeout(() => {
        try {
          if (!video) return;
          
          // Check if we made progress
          const newFurthestBuffered = getFurthestBufferedTime(video);
          const madeProgress = newFurthestBuffered > previousBufferedTime + 1;
          
          // Update buffering strategy based on results
          updateBufferingStrategy(madeProgress);
          
          // Return to original position
          video.currentTime = currentPosition;
          
          state.seekAttempts++;
          
          // If we've had too many failed attempts, introduce a delay to potentially recover
          if (state.consecutiveFailedAttempts > 5 && state.seekAttempts % 5 === 0) {
            debugLog('Multiple failed buffering attempts, introducing delay to recover');
            
            // Wait a bit longer before next attempt
            setTimeout(() => {
              forceBuffering();
            }, 500);
          }
        } catch (innerError) {
          debugLog('Error during seek callback:', innerError);
          state.seekAttempts++;
        }
      }, 150 + (state.consecutiveFailedAttempts * config.retryDelayIncrement));
    } catch (outerError) {
      debugLog('Error during seek:', outerError);
      state.seekAttempts++;
      
      // If we encounter errors, try to recover
      state.consecutiveFailedAttempts++;
      
      if (state.consecutiveFailedAttempts >= 10) {
        debugLog('Too many consecutive errors, stopping buffer process');
        stopBuffering();
      }
    }
  };
  
  /**
   * Starts the buffering process
   */
  const startBuffering = () => {
    const video = state.videoElement;
    if (!video || state.isBuffering) return;
    
    state.originalPlaybackTime = video.currentTime;
    state.originalPlaybackRate = video.playbackRate;
    state.isBuffering = true;
    state.seekAttempts = 0;
    state.consecutiveFailedAttempts = 0;
    resetBufferingStrategy();
    
    const currentQuality = getCurrentVideoQuality();
    state.lastKnownQuality = currentQuality;
    debugLog(`Starting force buffering${currentQuality ? ` (${currentQuality})` : ''}`);
    
    // Notify background script that buffering has started
    try {
      chrome.runtime.sendMessage({
        type: 'BUFFER_STATUS',
        data: { 
          status: 'started', 
          quality: currentQuality,
          isShorts: state.isShorts
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
    if (!state.isBuffering) {
      return;
    }
    
    debugLog('Stopping buffer forcing');
    
    // Restore original state
    const video = state.videoElement;
    if (video) {
      video.currentTime = state.originalPlaybackTime;
      video.playbackRate = state.originalPlaybackRate;
    }
    
    // Reset buffering state
    state.isBuffering = false;
    state.qualityChangeDetected = false;
    resetBufferingStrategy();
    
    const currentQuality = getCurrentVideoQuality();
    
    // Notify background script that buffering is complete
    try {
      chrome.runtime.sendMessage({
        type: 'BUFFER_STATUS',
        data: { 
          status: 'complete',
          quality: currentQuality,
          isShorts: state.isShorts,
          attempts: state.seekAttempts
        }
      });
    } catch (error) {
      // Ignore errors from disconnected port
    }
    
    // Reset tracking variables
    state.seekAttempts = 0;
    connectionTracker.reset();
  };
  
  /**
   * Starts monitoring the video buffer
   */
  const startBufferMonitoring = (video) => {
    if (!video || state.bufferCheckInterval) {
      return;
    }
    
    state.videoElement = video;
    state.isShorts = checkIfShorts();
    state.lastKnownQuality = getCurrentVideoQuality();
    
    debugLog(`Starting buffer monitoring${state.isShorts ? ' (Shorts video)' : ''}${state.lastKnownQuality ? ` (${state.lastKnownQuality})` : ''}`);
    
    // Setup monitoring for video quality changes
    const setupQualityChangeDetection = () => {
      // Monitor for resize events which can indicate quality changes
      video.addEventListener('resize', () => {
        const newQuality = getCurrentVideoQuality();
        if (state.lastKnownQuality && newQuality && state.lastKnownQuality !== newQuality) {
          debugLog(`Quality changed from ${state.lastKnownQuality} to ${newQuality}`);
          state.lastKnownQuality = newQuality;
          state.qualityChangeDetected = true;
          
          // If we're already buffering, restart the process with new quality
          if (state.isBuffering) {
            stopBuffering();
            setTimeout(() => {
              startBuffering();
            }, config.qualityChangeThreshold);
          }
        }
      });
      
      // Check for YouTube quality menu clicks
      const observer = new MutationObserver(() => {
        setTimeout(detectQualityChange, 100);
      });
      
      // Observe quality menu button for click events
      const qualityButton = document.querySelector('.ytp-settings-button');
      if (qualityButton) {
        observer.observe(qualityButton, { attributes: true });
      }
    };
    
    // Setup detection for quality changes
    setupQualityChangeDetection();
    
    // Main buffer check interval
    state.bufferCheckInterval = setInterval(() => {
      // Only force buffering when video is not already fully buffered
      if (state.videoElement && !isVideoFullyBuffered(state.videoElement)) {
        if (!state.isBuffering) {
          startBuffering();
        } else {
          forceBuffering();
        }
      } else if (state.isBuffering) {
        stopBuffering();
      }
    }, config.checkInterval);
  };
  
  /**
   * Stops monitoring the video buffer
   */
  const stopBufferMonitoring = () => {
    if (state.bufferCheckInterval) {
      clearInterval(state.bufferCheckInterval);
      state.bufferCheckInterval = null;
    }
    
    if (state.isBuffering) {
      stopBuffering();
    }
    
    state.videoElement = null;
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
    state.videoObserver = new MutationObserver((mutations) => {
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
        if (state.videoElement && mutation.removedNodes.length > 0) {
          mutation.removedNodes.forEach((node) => {
            if (node === state.videoElement || (node.contains && node.contains(state.videoElement))) {
              stopBufferMonitoring();
            }
          });
        }
      });
    });
    
    // Start observing the document
    state.videoObserver.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
    
    return state.videoObserver;
  };
  
  /**
   * Handles page navigation/URL changes
   */
  const handleURLChange = () => {
    const currentIsShorts = checkIfShorts();
    
    // If shorts status has changed, update and restart
    if (state.isShorts !== currentIsShorts) {
      debugLog(`Detected navigation to ${currentIsShorts ? 'Shorts' : 'regular video'} page`);
      state.isShorts = currentIsShorts;
      
      // Reset and restart monitoring
      stopBufferMonitoring();
      setupVideoObserver();
    }
    
    // Always check if we should be running based on URL
    if (!window.location.href.includes('youtube.com/watch') && 
        !window.location.href.includes('youtube.com/shorts')) {
      debugLog('Not a YouTube video or shorts page, stopping monitoring');
      stopBufferMonitoring();
    } else if (!state.bufferCheckInterval) {
      debugLog('Entered a video page, starting monitoring');
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
      debugLog('Not a YouTube video or shorts page, will monitor for navigation');
      // We'll still set up URL change detection to initialize later
    } else {
      state.isShorts = checkIfShorts();
      debugLog(`Detected ${state.isShorts ? 'YouTube Shorts' : 'regular YouTube video'} page`);
      
      // Set up video element observer
      state.videoObserver = setupVideoObserver();
    }
    
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
      if (state.videoObserver) {
        state.videoObserver.disconnect();
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

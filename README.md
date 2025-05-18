# YouTube Force Buffer

## Overview
YouTube Force Buffer is a browser extension that forces YouTube videos and Shorts to buffer completely, allowing smooth playback without interruptions. It works by intelligently seeking through the video to trigger YouTube's buffering system while avoiding detection by YouTube's anti-buffer measures.

## Features
- **Complete Video Buffering**: Forces videos to buffer entirely regardless of YouTube's default behavior
- **Shorts Support**: Works with both regular YouTube videos and YouTube Shorts
- **Quality Change Detection**: Automatically detects and handles video quality changes
- **Adaptive Buffering**: Adjusts buffering strategy based on video length, connection speed, and buffering success
- **Detailed Logging**: Comprehensive console logging for monitoring buffering progress
- **Maximum Compatibility**: Works with various YouTube player states and configurations

## How It Works
The extension uses advanced techniques to overcome YouTube's built-in limits on video buffering:

1. **Smart Detection**: Identifies when you're viewing YouTube videos or Shorts
2. **Adaptive Seeking**: Intelligently seeks ahead in the video to trigger buffering
3. **Progress Monitoring**: Continuously monitors buffering progress and adjusts strategy
4. **Quality Tracking**: Detects quality changes and adapts the buffering process accordingly
5. **Connection Optimization**: Adjusts buffering strategy based on your connection speed

## Installation

### From Chrome Web Store
*Coming soon!*

### Manual Installation
1. Download or clone this repository
2. Open Chrome/Edge/Brave and navigate to `chrome://extensions/`
3. Enable "Developer Mode" (toggle in the top right)
4. Click "Load Unpacked" and select the extension folder
5. The extension will now be active on YouTube

## Usage
Simply navigate to any YouTube video or Shorts page. The extension works automatically in the background - no configuration needed!

You can monitor the extension's activity in your browser's developer console:
1. Right-click on the YouTube page and select "Inspect" or press F12
2. Go to the "Console" tab
3. Look for messages with the prefix `[YT Force Buffer]`

## Configuration
The extension uses smart defaults, but you can modify its behavior by editing the `config` object in `content.js`:

```javascript
const config = {
  checkInterval: 1000,           // How often to check buffer status (ms)
  shortVideoThreshold: 300,      // Videos under this length are considered short
  adaptiveSeekMinimum: 5,        // Minimum seek step size (seconds)
  adaptiveSeekMaximum: 60,       // Maximum seek step size (seconds)
  shortsSeekStepSize: 5,         // Seek step size for Shorts (seconds)
  maxSeekAttempts: 500,          // Maximum seek attempts
  debugMode: true,               // Enable console logging
  // ... other options
};
```

## Limitations

### YouTube Updates
YouTube regularly updates its player, which may affect the extension's functionality. If YouTube changes its buffering mechanism or player structure, an update may be required.

### Browser Compatibility
This extension is designed for Chromium-based browsers (Chrome, Edge, Brave, etc.). It may not work with Firefox or other browsers.

### Performance Impact
Forcing videos to buffer completely may use more bandwidth and system resources than YouTube's default behavior.

## Troubleshooting

### Extension Not Working
- Ensure the extension is enabled
- Try refreshing the YouTube page
- Check the console for error messages
- Make sure you're on a YouTube video or Shorts page

### Buffering Stops or Fails
- The video might already be fully buffered
- YouTube may be limiting buffering for your connection
- Try refreshing the page and allowing the extension to restart

### High CPU Usage
- Reduce the `checkInterval` value in the configuration
- Disable other extensions that might be interacting with YouTube

## Contributing
Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License
This project is licensed under the MIT License - see the LICENSE file for details.

## Disclaimer
This extension is for educational and personal use only. Use at your own risk. The developers are not responsible for any issues that may arise from using this extension, including but not limited to increased bandwidth usage, potential YouTube Terms of Service violations, or any adverse effects on your YouTube account or experience.

## Acknowledgments
- Thanks to all contributors and users who provide feedback
- This project is not affiliated with or endorsed by YouTube or Google

---

Made with ❤️ for uninterrupted viewing experiences

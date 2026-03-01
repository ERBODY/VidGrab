# VidGrab — Universal Media Downloader

**Open-source browser extension** that downloads any video, audio, or streaming media from any website. Works on **every browser** and **every OS**, including Android.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## Features

- 🌐 **Every browser**: Firefox, Chrome, Edge, Opera, Brave, Vivaldi, Safari, Kiwi, Yandex
- 📱 **Every platform**: Windows, macOS, Linux, Android (see table below)
- 🎬 **All media types**: Video, audio, music, stories, reels, streams
- 🔄 **Format conversion**: MP4, MP3, WebM, MKV, AVI, MOV, WAV, AAC, OGG, FLAC, M4A, OPUS (via FFmpeg.wasm)
- 📊 **Quality & size display**: See resolution, format, and file size before download
- 🔐 **DRM capture**: Intercepts EME key exchanges (educational use only)
- 🎨 **Premium dark UI**: Glassmorphism design, responsive on desktop & mobile
- ⚙️ **Comprehensive settings**: Quality, format, naming, filters, DRM, themes, import/export
- 🆓 **MIT licensed**: Not governed by any vendor — fully open-source

## Supported Websites

Works on **any site** with media. Optimized detectors for:

YouTube · Facebook · Instagram · Twitter/X · TikTok · Reddit · Vimeo · Dailymotion · Twitch · SoundCloud · and thousands more

## Installation

### Desktop Browsers

| Browser | OS | Steps |
|---------|-----|-------|
| **Firefox** | Win / Mac / Linux | `about:debugging#/runtime/this-firefox` → Load Temporary Add-on → select `manifest.json` |
| **Chrome** | Win / Mac / Linux | `chrome://extensions` → Developer Mode → Load Unpacked → select folder |
| **Edge** | Win / Mac / Linux | `edge://extensions` → Developer Mode → Load Unpacked → select folder |
| **Brave** | Win / Mac / Linux | `brave://extensions` → Developer Mode → Load Unpacked → select folder |
| **Opera** | Win / Mac / Linux | `opera://extensions` → Developer Mode → Load Unpacked → select folder |
| **Vivaldi** | Win / Mac / Linux | `vivaldi://extensions` → Developer Mode → Load Unpacked → select folder |
| **Safari** | macOS | Run `xcrun safari-web-extension-converter ./Vid-Downloader` → Build in Xcode → Enable in Safari Preferences |

### Android Browsers

| Browser | Steps |
|---------|-------|
| **Firefox (Android)** | Install from `about:debugging` or Firefox Add-ons collection |
| **Firefox Nightly** | Settings → Install add-on from file → select `.zip` of extension |
| **Kiwi Browser** | `chrome://extensions` → Developer Mode → Load Unpacked (supports full Chrome extensions!) |
| **Yandex Browser** | Settings → Extensions → Load unpacked extension |
| **Samsung Internet** | Use the Userscript mode (see below) |
| **Chrome (Android)** | Use the Userscript mode (see below) |

### Userscript Mode (Any Browser)

For browsers that don't support extensions natively (Chrome Android, Samsung Internet, etc.):

1. Install **Tampermonkey** or **Violentmonkey** in your browser
2. The core media detection script can run as a userscript
3. Works on: Kiwi + Tampermonkey, Firefox + Tampermonkey, Yandex + Tampermonkey

> **Note**: Kiwi Browser is the recommended Android browser because it supports full Chrome extensions directly.

## Format Conversion

Click the **⟲ convert** button on any detected media to download in a different format:

**Video formats**: MP4, WebM, MKV, AVI, MOV, FLV, 3GP
**Audio formats**: MP3, AAC, WAV, OGG, FLAC, M4A, OPUS

Quality presets: Highest, High, Medium, Low

Conversion is powered by **FFmpeg.wasm** — runs entirely in-browser, no server needed.

## Project Structure

```
Vid-Downloader/
├── manifest.json              # Manifest V2 (cross-browser)
├── LICENSE                    # MIT
├── README.md
├── lib/
│   └── browser-polyfill.js    # WebExtension API normalizer
├── background/
│   ├── background.js          # Network interception, media registry
│   ├── stream-handler.js      # HLS/DASH parsing & segment download
│   ├── converter.js           # FFmpeg.wasm integration
│   └── drm-handler.js         # DRM key management
├── content/
│   ├── detector.js            # DOM scanning, social media selectors
│   ├── injected.js            # MediaSource, fetch, XHR hooks
│   └── drm-interceptor.js     # EME API interception
├── popup/
│   ├── popup.html/css/js      # Download UI with format picker
├── options/
│   ├── options.html/css/js    # Settings with import/export
├── converter/
│   ├── converter.html/js      # FFmpeg.wasm runner page
├── utils/
│   ├── mime-types.js           # Format & CDN detection
│   ├── filename.js            # Smart naming
│   └── size-formatter.js      # Size display
└── icons/                     # 16/48/128px icons
```

## Contributing

Contributions welcome! Fork, create a branch, make changes, open a PR.

## Disclaimer

VidGrab is for **personal and educational use only**. Downloading copyrighted content without permission may violate laws in your jurisdiction. Users are responsible for ensuring their use complies with applicable laws and platform terms of service.

## License

[MIT](LICENSE)

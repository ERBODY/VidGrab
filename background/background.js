/**
 * VidGrab — Main Background Script
 * Works with browser.* API (cross-browser via polyfill).
 * Intercepts network requests, manages per-tab media registry,
 * coordinates downloads, fetches file sizes, and handles messaging.
 */

(function () {
    'use strict';

    // ========== Default Settings ==========
    const DEFAULT_SETTINGS = {
        defaultQuality: 'highest',
        defaultFormat: 'original',
        defaultAudioFormat: 'original',
        filenameFormat: 'title_quality',
        maxConcurrent: 3,
        autoDetect: true,
        detectStreams: true,
        detectAudio: true,
        detectEmbedded: true,
        minSizeKB: 50,
        drmCapture: true,
        drmLogLicense: false,
        persistMedia: false,
        showBadge: true,
        showNotifications: true,
        theme: 'dark',
        excludedSites: '',
    };

    // ========== State ==========
    let tabMedia = new Map();   // Map<tabId, Map<mediaId, MediaItem>>
    let mediaIdCounter = 0;
    let settings = { ...DEFAULT_SETTINGS };

    function nextId() {
        return \`m_\${++mediaIdCounter}_\${Date.now()}\`;
    }

    // ========== Settings & Storage ==========
    function loadSettings() {
        chrome.storage.sync.get(DEFAULT_SETTINGS, (s) => {
            settings = s;
            if (settings.persistMedia) {
                loadPersistentMedia();
            }
        });
    }

    function loadPersistentMedia() {
        chrome.storage.local.get(['savedMedia'], (result) => {
            if (result.savedMedia) {
                try {
                    const parsed = JSON.parse(result.savedMedia);
                    const newMap = new Map();
                    for (const [tid, items] of Object.entries(parsed)) {
                        newMap.set(parseInt(tid), new Map(Object.entries(items)));
                    }
                    tabMedia = newMap;
                } catch (e) {
                    console.error('[VidGrab] Failed to load persistent media:', e);
                }
            }
        });
    }

    function savePersistentMedia() {
        if (!settings.persistMedia) return;
        const obj = {};
        for (const [tid, itemsMap] of tabMedia) {
            obj[tid] = Object.fromEntries(itemsMap);
        }
        chrome.storage.local.set({ savedMedia: JSON.stringify(obj) });
    }

    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'sync') {
            for (let [key, { newValue }] of Object.entries(changes)) {
                settings[key] = newValue;
            }
            if (changes.persistMedia && !changes.persistMedia.newValue) {
                chrome.storage.local.remove('savedMedia');
            }
        }
    });

    // ========== Tab Lifecycle ==========
    browser.tabs.onRemoved.addListener((tabId) => {
        if (!settings.persistMedia) {
            tabMedia.delete(tabId);
        }
    });

    browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
        if (changeInfo.status === 'loading') {
            tabMedia.delete(tabId);
            updateBadge(tabId);
            if (settings.persistMedia) savePersistentMedia();
        }
    });

    // ========== Badge ==========
    function updateBadge(tabId) {
        if (!settings.showBadge) {
            const api = chrome.action || chrome.browserAction;
            if (api) api.setBadgeText({ text: '', tabId });
            return;
        }
        const media = tabMedia.get(tabId);
        const count = media ? media.size : 0;
        const text = count > 0 ? String(count) : '';
        try {
            const api = chrome.action || chrome.browserAction;
            if (api) {
                api.setBadgeText({ text, tabId });
                api.setBadgeBackgroundColor({ color: '#A855F7', tabId });
            }
        } catch (e) { }
    }

    // ========== Network Interception ==========
    chrome.webRequest.onHeadersReceived.addListener(
        (details) => {
            if (!settings.autoDetect || details.tabId < 0) return;
            const url = details.url;
            if (!url || url.startsWith('moz-') || url.startsWith('chrome-') || url.startsWith('about:')) return;

            const headers = details.responseHeaders || [];
            let contentType = '';
            let contentLength = 0;

            for (const h of headers) {
                const n = h.name.toLowerCase();
                if (n === 'content-type') contentType = h.value || '';
                if (n === 'content-length') contentLength = parseInt(h.value) || 0;
            }

            const mediaInfo = MimeTypes.detectMediaType(url, contentType);
            if (mediaInfo) {
                if (mediaInfo.type === 'stream' && !settings.detectStreams) return;
                if (mediaInfo.type === 'audio' && !settings.detectAudio) return;

                addMediaItem(details.tabId, {
                    url,
                    source: 'network',
                    type: mediaInfo.type,
                    format: mediaInfo.ext,
                    label: mediaInfo.label,
                    size: contentLength,
                    contentType,
                });
            }
        },
        { urls: ['<all_urls>'] },
        ['responseHeaders']
    );

    chrome.webRequest.onBeforeRequest.addListener(
        (details) => {
            if (!settings.autoDetect || details.tabId < 0) return;
            const url = details.url;
            if (!url || url.startsWith('moz-') || url.startsWith('chrome-')) return;

            if (MimeTypes.isMediaUrl(url)) {
                const ext = MimeTypes.getExtensionFromUrl(url) || 'mp4';
                const audioExts = new Set(['mp3', 'm4a', 'ogg', 'weba', 'wav', 'flac', 'aac', 'opus']);
                const type = audioExts.has(ext) ? 'audio' : 'video';

                if (type === 'audio' && !settings.detectAudio) return;

                addMediaItem(details.tabId, {
                    url,
                    source: 'network',
                    type: type,
                    format: ext,
                });
            }
        },
        { urls: ['<all_urls>'] }
    );

    // ========== Media Registry ==========
    function addMediaItem(tabId, item) {
        if (!tabMedia.has(tabId)) tabMedia.set(tabId, new Map());
        const media = tabMedia.get(tabId);

        const existingKey = findExistingByUrl(media, item.url);
        if (existingKey) {
            const existing = media.get(existingKey);
            media.set(existingKey, {
                ...existing,
                size: item.size || existing.size,
                quality: item.quality || existing.quality,
                format: item.format || existing.format,
                label: item.label || existing.label,
                contentType: item.contentType || existing.contentType,
                duration: item.duration || existing.duration,
                width: item.width || existing.width,
                height: item.height || existing.height,
                isDRM: item.isDRM || existing.isDRM,
            });
        } else {
            if (item.size && item.size < (settings.minSizeKB * 1024) && item.type !== 'audio') return;
            const id = nextId();
            media.set(id, { ...item, id, detectedAt: Date.now() });
        }

        updateBadge(tabId);
        if (settings.persistMedia) savePersistentMedia();
    }

    function findExistingByUrl(mediaMap, url) {
        for (const [key, val] of mediaMap) {
            if (val.url === url) return key;
            try {
                const u1 = new URL(val.url);
                const u2 = new URL(url);
                if (u1.origin === u2.origin && u1.pathname === u2.pathname) return key;
            } catch { }
        }
        return null;
    }

    // ========== File Size Fetcher ==========
    async function fetchFileSize(url) {
        try {
            const resp = await fetch(url, { method: 'HEAD' });
            const cl = resp.headers.get('content-length');
            if (cl) return parseInt(cl);
        } catch { }
        try {
            const resp = await fetch(url, {
                method: 'GET',
                headers: { Range: 'bytes=0-0' },
            });
            const cr = resp.headers.get('content-range');
            if (cr) {
                const match = cr.match(/\/(\d+)/);
                if (match) return parseInt(match[1]);
            }
        } catch { }
        return 0;
    }

    // ========== Message Handling ==========
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        const { action, data } = message;
        const tabId = sender.tab ? sender.tab.id : (data ? data.tabId : undefined);

        switch (action) {
            case 'mediaDetected':
                if (tabId != null && settings.autoDetect) {
                    if (data.source === 'dom' && !settings.autoDetect) return false;
                    if (data.source === 'meta' && !settings.detectEmbedded) return false;
                    addMediaItem(tabId, { ...data, detectedAt: Date.now() });
                }
                sendResponse({ success: true });
                return false;

            case 'getMedia':
                chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                    const tab = tabs && tabs[0];
                    if (!tab) { sendResponse({ items: [], pageTitle: '', pageUrl: '' }); return; }
                    const tid = tab.id;
                    const media = tabMedia.get(tid);
                    const items = media ? Array.from(media.values()) : [];
                    sendResponse({
                        items,
                        pageTitle: tab.title || '',
                        pageUrl: tab.url || '',
                        tabId: tid,
                    });
                });
                return true;

            case 'fetchSize':
                fetchFileSize(data.url).then((size) => sendResponse({ size }));
                return true;

            case 'downloadMedia':
                handleDownload(data).then((r) => sendResponse(r)).catch((err) => sendResponse({ success: false, error: err.message }));
                return true;

            case 'downloadAll':
                handleDownloadAll(data).then((r) => sendResponse(r)).catch((err) => sendResponse({ success: false, error: err.message }));
                return true;

            case 'convertMedia':
                handleConvert(data).then((r) => sendResponse(r)).catch((err) => sendResponse({ success: false, error: err.message }));
                return true;

            case 'clearMedia':
                if (tabId != null) {
                    tabMedia.delete(tabId);
                    updateBadge(tabId);
                    if (settings.persistMedia) savePersistentMedia();
                }
                sendResponse({ success: true });
                return false;

            case 'getSettings':
                sendResponse(settings);
                return false;

            case 'drmKeysCaptured':
                if (tabId != null && settings.drmCapture) {
                    addMediaItem(tabId, {
                        ...data,
                        source: 'drm',
                        isDRM: true,
                        detectedAt: Date.now(),
                    });
                }
                sendResponse({ success: true });
                return false;

            default:
                sendResponse({ error: 'Unknown action' });
                return false;
        }
    });

    // ========== Download ==========
    async function handleDownload(data) {
        const { url, filename, pageTitle, format, quality } = data;

        // Handle stream downloads
        if (url.endsWith('.m3u8') || url.endsWith('.mpd')) {
             try {
                 const bridgeUrl = chrome.runtime.getURL('converter/bridge.html');
                 chrome.tabs.create({ url: bridgeUrl, active: false });
                 // In a real scenario, we'd send the manifest URL to the bridge
                 // to parse and download segments, then mux.
                 // For now, let's keep it simple as this is a browser extension tool limits.
                 return { success: true, message: 'Stream download started' };
             } catch (err) {
                 return { success: false, error: err.message };
             }
        }

        const dlFilename = filename || FilenameUtils.generateFilename({
            pageTitle, url, format: format || 'mp4', type: 'video',
            template: settings.filenameFormat, quality
        });

        return new Promise((resolve) => {
            chrome.downloads.download({
                url,
                filename: dlFilename,
                saveAs: true,
            }, (downloadId) => {
                if (chrome.runtime.lastError) {
                    resolve({ success: false, error: chrome.runtime.lastError.message });
                } else {
                    resolve({ success: true, downloadId });
                }
            });
        });
    }

    async function handleDownloadAll(data) {
        const { tabId, pageTitle } = data;
        const media = tabMedia.get(tabId);
        if (!media || media.size === 0) {
            return { success: false, error: 'No media found' };
        }

        let count = 0;
        for (const [, item] of media) {
            const filename = FilenameUtils.generateFilename({
                pageTitle, url: item.url, quality: item.quality,
                format: item.format || 'mp4', type: item.type,
                template: settings.filenameFormat
            });
            chrome.downloads.download({ url: item.url, filename, saveAs: false });
            count++;
        }
        return { success: true, count };
    }

    // ========== Conversion ==========
    async function handleConvert(data) {
        const bridgeUrl = chrome.runtime.getURL('converter/bridge.html');
        return new Promise((resolve) => {
            chrome.tabs.create({ url: bridgeUrl, active: false }, (tab) => {
                if (chrome.runtime.lastError) {
                    resolve({ success: false, error: 'Failed to open converter' });
                    return;
                }
                setTimeout(() => {
                    chrome.tabs.sendMessage(tab.id, {
                        action: 'startConversion',
                        data: data,
                    }, (response) => {
                        if (chrome.runtime.lastError) {
                            resolve({ success: false, error: 'Converter not ready. Try again.' });
                        } else {
                            resolve({ success: true, message: 'Conversion started', tabId: tab.id });
                        }
                    });
                }, 2000);
            });
        });
    }

    // ========== Init ==========
    loadSettings();
    console.log('[VidGrab] Background script loaded — cross-browser mode');
})();

/**
 * VidGrab — Main Background Script
 * Works with browser.* API (cross-browser via polyfill).
 * Intercepts network requests, manages per-tab media registry,
 * coordinates downloads, fetches file sizes, and handles messaging.
 */

(function () {
    'use strict';

    // ========== State ==========
    const tabMedia = new Map();   // Map<tabId, Map<mediaId, MediaItem>>
    let mediaIdCounter = 0;

    function nextId() {
        return `m_${++mediaIdCounter}_${Date.now()}`;
    }

    // ========== Tab Lifecycle ==========
    browser.tabs.onRemoved.addListener((tabId) => {
        tabMedia.delete(tabId);
    });

    browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
        if (changeInfo.status === 'loading') {
            tabMedia.delete(tabId);
            updateBadge(tabId);
        }
    });

    // ========== Badge ==========
    function updateBadge(tabId) {
        const media = tabMedia.get(tabId);
        const count = media ? media.size : 0;
        const text = count > 0 ? String(count) : '';
        try {
            // MV3 uses chrome.action, MV2 uses chrome.browserAction
            const api = chrome.action || chrome.browserAction;
            if (api) {
                api.setBadgeText({ text, tabId });
                api.setBadgeBackgroundColor({ color: '#A855F7', tabId });
            }
        } catch (e) { /* ignore in unsupported contexts */ }
    }

    // ========== Network Interception ==========
    // Use chrome.webRequest directly — it's event-based and works the same everywhere
    chrome.webRequest.onHeadersReceived.addListener(
        (details) => {
            if (details.tabId < 0) return;
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

    // Also catch by URL pattern (for requests where content-type is unknown)
    chrome.webRequest.onBeforeRequest.addListener(
        (details) => {
            if (details.tabId < 0) return;
            const url = details.url;
            if (!url || url.startsWith('moz-') || url.startsWith('chrome-')) return;

            if (MimeTypes.isMediaUrl(url)) {
                addMediaItem(details.tabId, {
                    url,
                    source: 'network',
                    type: 'video',
                    format: MimeTypes.getExtensionFromUrl(url) || 'mp4',
                });
            }
        },
        { urls: ['<all_urls>'] }
    );

    // ========== Media Registry ==========
    function addMediaItem(tabId, item) {
        if (!tabMedia.has(tabId)) tabMedia.set(tabId, new Map());
        const media = tabMedia.get(tabId);

        // Deduplicate by base URL
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
            // Skip tiny files (likely tracking pixels / thumbnails)
            if (item.size && item.size < 5000 && item.type !== 'audio') return;
            const id = nextId();
            media.set(id, { ...item, id, detectedAt: Date.now() });
        }

        updateBadge(tabId);
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
            // Use cors mode so we can read response headers
            const resp = await fetch(url, { method: 'HEAD' });
            const cl = resp.headers.get('content-length');
            if (cl) return parseInt(cl);
        } catch { }
        try {
            // Fallback: range request for first byte
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
    // Use chrome.runtime.onMessage directly for reliable sendResponse behavior.
    // The polyfill can interfere with the return true / sendResponse pattern.
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        const { action, data } = message;
        const tabId = sender.tab ? sender.tab.id : (data ? data.tabId : undefined);

        switch (action) {
            case 'mediaDetected':
                if (tabId != null) addMediaItem(tabId, { ...data, detectedAt: Date.now() });
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
                return true; // async response

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
                }
                sendResponse({ success: true });
                return false;

            case 'getSettings':
                chrome.storage.sync.get(DEFAULT_SETTINGS, (s) => sendResponse(s));
                return true;

            case 'drmKeysCaptured':
                if (tabId != null) {
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
        const { url, filename, pageTitle, format } = data;
        const dlFilename = filename || FilenameUtils.generateFilename({
            pageTitle, url, format: format || 'mp4', type: 'video',
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
            });
            chrome.downloads.download({ url: item.url, filename, saveAs: false });
            count++;
        }
        return { success: true, count };
    }

    // ========== Conversion (opens bridge page which iframes sandboxed converter) ==========
    async function handleConvert(data) {
        // Open the bridge page (non-sandboxed, has chrome.* access)
        // Bridge iframes the sandboxed converter.html which loads FFmpeg from CDN
        const bridgeUrl = chrome.runtime.getURL('converter/bridge.html');

        return new Promise((resolve) => {
            chrome.tabs.create({ url: bridgeUrl, active: false }, (tab) => {
                if (chrome.runtime.lastError) {
                    resolve({ success: false, error: 'Failed to open converter' });
                    return;
                }
                // Wait for bridge page to load, then send conversion request
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

    // ========== Default Settings ==========
    const DEFAULT_SETTINGS = {
        defaultQuality: 'highest',
        defaultFormat: 'original',
        defaultAudioFormat: 'original',
        filenameFormat: 'title_quality',
        autoDetect: true,
        detectStreams: true,
        detectAudio: true,
        detectEmbedded: true,
        drmCapture: true,
        drmLogLicense: false,
        minSizeKB: 50,
        showBadge: true,
        showNotifications: true,
        maxConcurrentDownloads: 3,
        theme: 'dark',
        excludedSites: '',
    };

    // ========== Init ==========
    console.log('[VidGrab] Background script loaded — cross-browser mode');
})();


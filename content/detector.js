/**
 * VidGrab — Content Script: Enhanced Media Detector
 * Scans DOM and Shadow DOM for all media elements, monitors dynamic changes,
 * extracts full metadata. Works cross-browser via browser.* polyfill.
 */

(() => {
    'use strict';

    if (window.__vidgrab_detector_v2) {
        if (typeof window.__vidgrab_scan === 'function') window.__vidgrab_scan();
        return;
    }
    window.__vidgrab_detector_v2 = true;

    const DETECTED = new Set();
    const MIN_DURATION = 0.5;

    // Export scan function for popup rescan
    window.__vidgrab_scan = (force = true) => {
        if (force) DETECTED.clear();
        scanAll();
    };

    // Listen to background/popup direct messages
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        if (msg.action === 'triggerRescan') {
            window.__vidgrab_scan(true);
            sendResponse({ success: true });
        }
    });

    // ========== Report to background ==========
    function report(data) {
        if (!data.url || DETECTED.has(data.url)) return;
        DETECTED.add(data.url);

        try {
            chrome.runtime.sendMessage({
                action: 'mediaDetected',
                data: {
                    ...data,
                    pageTitle: document.title,
                    pageUrl: window.location.href,
                    source: data.source || 'dom',
                },
            });
        } catch { }
    }

    // ========== Shadow DOM Support ==========
    function scanNode(node) {
        if (node.shadowRoot) {
            scanTree(node.shadowRoot);
            observer.observe(node.shadowRoot, { childList: true, subtree: true });
        }

        if (node.tagName === 'VIDEO' || node.tagName === 'AUDIO') {
            processMedia(node);
        } else if (node.tagName === 'SOURCE') {
            const src = node.src || node.getAttribute('src');
            if (src && !src.startsWith('blob:')) {
                const parent = node.closest('video, audio');
                report({
                    url: src,
                    type: parent?.tagName === 'AUDIO' ? 'audio' : 'video',
                    format: extFromUrl(src),
                    source: 'dom',
                });
            }
        } else if (node.tagName === 'EMBED' || node.tagName === 'OBJECT') {
            const src = node.src || node.getAttribute('data') || node.getAttribute('src');
            if (src && isMediaExt(src)) {
                report({ url: src, type: 'video', format: extFromUrl(src), source: 'embed' });
            }
        }
    }

    function scanTree(root) {
        root.querySelectorAll('video, audio, source, embed, object').forEach(scanNode);
        // Find all elements with potential shadow roots
        const all = root.querySelectorAll('*');
        for (let i = 0; i < all.length; i++) {
            if (all[i].shadowRoot) {
                scanTree(all[i].shadowRoot);
            }
        }
    }

    // ========== Scan media elements ==========
    function scanAll() {
        scanTree(document);

        // Open Graph and Twitter meta tags
        document.querySelectorAll('meta[property*="video"], meta[property*="audio"], meta[name*="video"], meta[name*="audio"], meta[name="twitter:player:stream"]').forEach((el) => {
            const url = el.getAttribute('content');
            if (url && (isMediaExt(url) || url.includes('video') || url.includes('audio'))) {
                const isAudio = el.getAttribute('property')?.includes('audio') || el.getAttribute('name')?.includes('audio');
                report({ url, type: isAudio ? 'audio' : 'video', format: extFromUrl(url), source: 'meta' });
            }
        });

        // JSON-LD structured data
        document.querySelectorAll('script[type="application/ld+json"]').forEach((el) => {
            try {
                const data = JSON.parse(el.textContent);
                extractFromJsonLD(data);
            } catch { }
        });

        scanSocialMedia();
    }

    function processMedia(el) {
        const src = el.currentSrc || el.src;
        if (!src) return;
        if (el.duration && el.duration < MIN_DURATION) return;

        const type = el.tagName === 'AUDIO' ? 'audio' : 'video';
        const info = {
            url: src,
            type,
            format: extFromUrl(src),
            width: el.videoWidth || 0,
            height: el.videoHeight || 0,
            duration: el.duration || 0,
            source: 'dom',
        };

        if (info.width && info.height) {
            info.quality = \`\${info.height}p\`;
            info.resolution = \`\${info.width}x\${info.height}\`;
        }

        report(info);
    }

    // ========== Social Media Selectors ==========
    function scanSocialMedia() {
        const host = window.location.hostname;

        // Instagram
        if (host.includes('instagram.com')) {
            document.querySelectorAll('video').forEach(processMedia);
        }

        // TikTok
        if (host.includes('tiktok.com')) {
            document.querySelectorAll('video').forEach(processMedia);
        }

        // Twitter/X
        if (host.includes('twitter.com') || host.includes('x.com')) {
            document.querySelectorAll('video').forEach(processMedia);
        }

        // YouTube (some desktop cases)
        if (host.includes('youtube.com')) {
             const video = document.querySelector('video.html5-main-video');
             if (video) processMedia(video);
        }
    }

    // ========== JSON-LD Extraction ==========
    function extractFromJsonLD(data) {
        if (Array.isArray(data)) {
            data.forEach(extractFromJsonLD);
            return;
        }
        if (!data || typeof data !== 'object') return;
        if (data.contentUrl) {
            report({ url: data.contentUrl, type: data['@type']?.includes('Audio') ? 'audio' : 'video', source: 'json-ld' });
        }
        if (data.embedUrl) {
            report({ url: data.embedUrl, type: 'video', source: 'json-ld' });
        }
        // Deep scan for video objects
        for (const key in data) {
            if (typeof data[key] === 'object') extractFromJsonLD(data[key]);
        }
    }

    // ========== MutationObserver ==========
    const observer = new MutationObserver((mutations) => {
        for (const m of mutations) {
            for (const node of m.addedNodes) {
                if (node.nodeType !== 1) continue;
                scanNode(node);
                node.querySelectorAll?.('video, audio, source, embed, object').forEach(scanNode);
            }
        }
    });

    // ========== Inject page-level script ==========
    function injectPageScript() {
        try {
            const script = document.createElement('script');
            script.src = chrome.runtime.getURL('content/injected.js');
            script.onload = () => script.remove();
            (document.head || document.documentElement).appendChild(script);
        } catch { }
    }

    window.addEventListener('message', (e) => {
        if (e.source !== window || e.data?.type !== 'VIDGRAB_MEDIA') return;
        report(e.data.payload);
    });

    // ========== Helpers ==========
    function extFromUrl(url) {
        try { return new URL(url).pathname.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() || ''; } catch { return ''; }
    }

    const MEDIA_EXTS = new Set(['mp4', 'webm', 'mkv', 'avi', 'mov', 'flv', '3gp', 'm4v', 'ogv', 'ts', 'm3u8', 'mpd', 'mp3', 'm4a', 'ogg', 'wav', 'flac', 'aac', 'weba', 'opus']);
    function isMediaExt(url) {
        return MEDIA_EXTS.has(extFromUrl(url));
    }

    // ========== Init ==========
    observer.observe(document.documentElement, { childList: true, subtree: true });
    scanAll();
    if (document.readyState !== 'complete') window.addEventListener('load', scanAll);

    // Periodic scan for SPAs
    setInterval(scanSocialMedia, 2000);

    injectPageScript();
})();

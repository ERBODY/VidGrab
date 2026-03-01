/**
 * VidGrab — Content Script: Enhanced Media Detector
 * Scans DOM for all media elements, monitors dynamic changes,
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
        if (force) DETECTED.clear(); // Clear so it re-reports to ephemeral background SW
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

    // ========== Scan media elements ==========
    function scanAll() {
        // Video & audio elements
        document.querySelectorAll('video, audio').forEach(processMedia);

        // Source elements
        document.querySelectorAll('source').forEach((el) => {
            const src = el.src || el.getAttribute('src');
            if (src && !src.startsWith('blob:')) {
                const parent = el.closest('video, audio');
                report({
                    url: src,
                    type: parent?.tagName === 'AUDIO' ? 'audio' : 'video',
                    format: extFromUrl(src),
                    source: 'dom',
                });
            }
        });

        // Embed & object elements (Flash-era, some sites still use)
        document.querySelectorAll('embed[src], object[data]').forEach((el) => {
            const src = el.src || el.getAttribute('data') || el.getAttribute('src');
            if (src && isMediaExt(src)) {
                report({ url: src, type: 'video', format: extFromUrl(src), source: 'embed' });
            }
        });

        // Open Graph and Twitter meta tags (social media video embeds)
        document.querySelectorAll('meta[property="og:video"], meta[property="og:video:url"], meta[property="og:audio"], meta[name="twitter:player:stream"]').forEach((el) => {
            const url = el.getAttribute('content');
            if (url) {
                const isAudio = el.getAttribute('property')?.includes('audio');
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

        // Social media-specific selectors
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
            info.quality = `${info.height}p`;
            info.resolution = `${info.width}x${info.height}`;
        }

        report(info);
    }

    // ========== Social Media Selectors ==========
    function scanSocialMedia() {
        const host = window.location.hostname;

        // Instagram stories & reels
        if (host.includes('instagram.com')) {
            document.querySelectorAll('video[src], video source[src]').forEach((el) => {
                const src = el.src || el.getAttribute('src');
                if (src) report({ url: src, type: 'video', format: 'mp4', source: 'instagram' });
            });
        }

        // Facebook
        if (host.includes('facebook.com') || host.includes('fb.com')) {
            document.querySelectorAll('video[src]').forEach((el) => {
                if (el.src) report({ url: el.src, type: 'video', format: 'mp4', source: 'facebook' });
            });
        }

        // Twitter/X
        if (host.includes('twitter.com') || host.includes('x.com')) {
            document.querySelectorAll('video[src], video source[src]').forEach((el) => {
                const src = el.src || el.getAttribute('src');
                if (src) report({ url: src, type: 'video', format: 'mp4', source: 'twitter' });
            });
        }

        // TikTok
        if (host.includes('tiktok.com')) {
            document.querySelectorAll('video[src]').forEach((el) => {
                if (el.src) report({ url: el.src, type: 'video', format: 'mp4', source: 'tiktok' });
            });
        }

        // Reddit
        if (host.includes('reddit.com') || host.includes('redd.it')) {
            document.querySelectorAll('video[src], source[src]').forEach((el) => {
                const src = el.src || el.getAttribute('src');
                if (src) report({ url: src, type: 'video', source: 'reddit' });
            });
        }

        // SoundCloud (audio)
        if (host.includes('soundcloud.com')) {
            document.querySelectorAll('audio[src]').forEach((el) => {
                if (el.src) report({ url: el.src, type: 'audio', format: 'mp3', source: 'soundcloud' });
            });
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
    }

    // ========== MutationObserver ==========
    const observer = new MutationObserver((mutations) => {
        for (const m of mutations) {
            for (const node of m.addedNodes) {
                if (node.nodeType !== 1) continue;
                if (node.tagName === 'VIDEO' || node.tagName === 'AUDIO') {
                    processMedia(node);
                    watch(node);
                }
                node.querySelectorAll?.('video, audio').forEach((el) => { processMedia(el); watch(el); });
            }
        }
    });

    function watch(el) {
        el.addEventListener('loadedmetadata', () => processMedia(el));
        el.addEventListener('canplay', () => processMedia(el), { once: true });
    }

    // ========== Inject page-level script ==========
    function injectPageScript() {
        try {
            const script = document.createElement('script');
            script.src = chrome.runtime.getURL('content/injected.js');
            script.onload = () => script.remove();

            const append = () => {
                const target = document.head || document.documentElement;
                if (target) {
                    target.appendChild(script);
                } else {
                    setTimeout(append, 10);
                }
            };
            append();
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

    // Periodic scan for SPAs (stops after 30s)
    let n = 0;
    const iv = setInterval(() => { scanAll(); if (++n >= 30) clearInterval(iv); }, 1000);

    injectPageScript();
})();

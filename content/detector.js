/**
 * VidGrab — Content Script: Enhanced Media Detector
 * Scans DOM, Shadow DOM, and Page Globals for all media elements.
 * Specialized handling for YouTube player response.
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
        }
    }

    function scanTree(root) {
        root.querySelectorAll('video, audio, source, embed, object').forEach(scanNode);
        const all = root.querySelectorAll('*');
        for (let i = 0; i < all.length; i++) {
            if (all[i].shadowRoot) {
                scanTree(all[i].shadowRoot);
            }
        }
    }

    // ========== YouTube & Global Metadata ==========
    function scanGlobals() {
        // We inject a small script to grab YouTube's player response
        const script = document.createElement('script');
        script.textContent = \`(function() {
            try {
                const pr = window.ytInitialPlayerResponse || (window.ytplayer && window.ytplayer.config && window.ytplayer.config.args && window.ytplayer.config.args.player_response);
                if (pr) {
                    const data = typeof pr === 'string' ? JSON.parse(pr) : pr;
                    window.postMessage({ type: 'VIDGRAB_YT_DATA', payload: data }, '*');
                }
            } catch(e) {}
        })();\`;
        (document.head || document.documentElement).appendChild(script);
        script.remove();
    }

    window.addEventListener('message', (e) => {
        if (e.source !== window) return;
        if (e.data?.type === 'VIDGRAB_YT_DATA') {
            handleYTResponse(e.data.payload);
        }
        if (e.data?.type === 'VIDGRAB_MEDIA') {
            report(e.data.payload);
        }
    });

    function handleYTResponse(data) {
        if (!data || !data.streamingData) return;
        const formats = [
            ...(data.streamingData.formats || []),
            ...(data.streamingData.adaptiveFormats || [])
        ];

        formats.forEach(f => {
            if (f.url || f.signatureCipher) {
                let url = f.url;
                if (!url && f.signatureCipher) {
                   const params = new URLSearchParams(f.signatureCipher);
                   url = params.get('url');
                }
                if (!url) return;

                const mime = f.mimeType || '';
                const isVideo = mime.includes('video');
                const info = {
                    url: url,
                    type: isVideo ? 'video' : 'audio',
                    format: mime.split('/')[1]?.split(';')[0] || 'mp4',
                    quality: f.qualityLabel || f.audioQuality || (f.width ? f.height + 'p' : ''),
                    width: f.width,
                    height: f.height,
                    size: parseInt(f.contentLength) || 0,
                    source: 'youtube-api'
                };
                report(info);
            }
        });
    }

    // ========== Scan media elements ==========
    function scanAll() {
        scanTree(document);
        scanGlobals();

        // Open Graph and Twitter meta tags
        document.querySelectorAll('meta[property*="video"], meta[property*="audio"], meta[name*="video"], meta[name*="audio"], meta[name="twitter:player:stream"]').forEach((el) => {
            const url = el.getAttribute('content');
            if (url && (isMediaExt(url) || url.includes('video') || url.includes('audio'))) {
                const isAudio = el.getAttribute('property')?.includes('audio') || el.getAttribute('name')?.includes('audio');
                report({ url, type: isAudio ? 'audio' : 'video', format: extFromUrl(url), source: 'meta' });
            }
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
        if (host.includes('youtube.com')) {
             const video = document.querySelector('video.html5-main-video');
             if (video) processMedia(video);
        }
        // General scan for video/audio tags on any site
        document.querySelectorAll('video, audio').forEach(processMedia);
    }

    // ========== MutationObserver ==========
    const observer = new MutationObserver((mutations) => {
        for (const m of mutations) {
            for (const node of m.addedNodes) {
                if (node.nodeType !== 1) continue;
                scanNode(node);
                node.querySelectorAll?.('video, audio, source').forEach(scanNode);
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
        } catch (e) { }
    }

    // ========== Helpers ==========
    function extFromUrl(url) {
        try {
            const u = new URL(url);
            const ext = u.pathname.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
            if (ext) return ext;
            const mime = u.searchParams.get('mime');
            if (mime) return mime.split('/')[1]?.split(';')[0];
        } catch { }
        return '';
    }

    const MEDIA_EXTS = new Set(['mp4', 'webm', 'mkv', 'avi', 'mov', 'flv', '3gp', 'm4v', 'ogv', 'ts', 'm3u8', 'mpd', 'mp3', 'm4a', 'ogg', 'wav', 'flac', 'aac', 'weba', 'opus']);
    function isMediaExt(url) {
        const ext = extFromUrl(url);
        return MEDIA_EXTS.has(ext) || url.includes('videoplayback');
    }

    // ========== Init ==========
    observer.observe(document.documentElement, { childList: true, subtree: true });
    scanAll();
    if (document.readyState !== 'complete') window.addEventListener('load', scanAll);

    setInterval(scanAll, 5000);
    injectPageScript();
})();

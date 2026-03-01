/**
 * VidGrab — Injected Page Script (Enhanced)
 * Runs in page context to intercept MediaSource, fetch, XHR,
 * createObjectURL, and HTMLMediaElement.src for comprehensive detection.
 */

(() => {
    'use strict';
    if (window.__vidgrab_injected_v2) return;
    window.__vidgrab_injected_v2 = true;

    function notify(payload) {
        window.postMessage({ type: 'VIDGRAB_MEDIA', payload }, '*');
    }

    // ========== MediaSource Interception ==========
    const OrigMS = window.MediaSource || window.WebKitMediaSource;
    if (OrigMS) {
        const origAddSB = OrigMS.prototype.addSourceBuffer;
        OrigMS.prototype.addSourceBuffer = function (mimeType) {
            try {
                const isV = mimeType.startsWith('video/');
                const isA = mimeType.startsWith('audio/');
                if (isV || isA) {
                    notify({
                        url: window.location.href,
                        type: isV ? 'video' : 'audio',
                        format: fmtFromMime(mimeType),
                        label: \`MediaSource (\${mimeType.split(';')[0]})\`,
                        source: 'mediasource',
                        mimeType,
                    });
                }
            } catch { }
            return origAddSB.call(this, mimeType);
        };
    }

    // ========== createObjectURL Interception ==========
    const origCreateURL = URL.createObjectURL;
    URL.createObjectURL = function (obj) {
        const blobUrl = origCreateURL.call(this, obj);
        try {
            if (obj instanceof Blob) {
                const type = obj.type || '';
                if (type.startsWith('video/') || type.startsWith('audio/')) {
                    notify({
                        url: blobUrl,
                        type: type.startsWith('audio/') ? 'audio' : 'video',
                        format: fmtFromMime(type),
                        label: \`Blob (\${type})\`,
                        size: obj.size,
                        source: 'blob',
                    });
                }
            }
        } catch { }
        return blobUrl;
    };

    // ========== HTMLMediaElement.src Interception ==========
    function hookSrcSetter(proto, type) {
        const desc = Object.getOwnPropertyDescriptor(proto, 'src') ||
            Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
        if (desc && desc.set) {
            const origSet = desc.set;
            Object.defineProperty(proto, 'src', {
                ...desc,
                set(val) {
                    if (val && typeof val === 'string') {
                        notify({ url: val, type, format: extFromUrl(val), source: 'src-setter' });
                    }
                    origSet.call(this, val);
                },
            });
        }
    }

    try { hookSrcSetter(HTMLVideoElement.prototype, 'video'); } catch { }
    try { hookSrcSetter(HTMLAudioElement.prototype, 'audio'); } catch { }

    // ========== fetch Interception ==========
    const origFetch = window.fetch;
    window.fetch = function (...args) {
        const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url);
        if (url && isMediaUrl(String(url))) {
            notify({ url: String(url), type: guessType(String(url)), format: extFromUrl(String(url)), source: 'fetch' });
        }
        return origFetch.apply(this, args);
    };

    // ========== XHR Interception ==========
    const origOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
        if (url && isMediaUrl(String(url))) {
            notify({ url: String(url), type: guessType(String(url)), format: extFromUrl(String(url)), source: 'xhr' });
        }
        return origOpen.call(this, method, url, ...rest);
    };

    // ========== Helpers ==========
    function extFromUrl(url) {
        try { return new URL(url, location.href).pathname.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() || ''; } catch { return ''; }
    }

    function fmtFromMime(mime) {
        const m = { 'video/mp4': 'mp4', 'video/webm': 'webm', 'audio/mp4': 'm4a', 'audio/webm': 'weba', 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg' };
        return m[mime.split(';')[0].trim()] || mime.split('/')[1]?.split(';')[0] || '';
    }

    function guessType(url) {
        const audioExts = new Set(['mp3', 'm4a', 'aac', 'ogg', 'wav', 'flac', 'weba', 'opus']);
        const ext = extFromUrl(url);
        return audioExts.has(ext) ? 'audio' : 'video';
    }

    const PATTERNS = [
        /\.mp4(\?|#|$)/i, /\.webm(\?|#|$)/i, /\.m3u8(\?|#|$)/i, /\.mpd(\?|#|$)/i,
        /\.ts(\?|#|$)/i, /\.flv(\?|#|$)/i, /\.mkv(\?|#|$)/i, /\.mov(\?|#|$)/i,
        /\.m4a(\?|#|$)/i, /\.mp3(\?|#|$)/i, /\.ogg(\?|#|$)/i, /\.wav(\?|#|$)/i,
        /\.aac(\?|#|$)/i, /\.flac(\?|#|$)/i, /\.opus(\?|#|$)/i,
        /videoplayback/i, /googlevideo\.com/i, /fbcdn.*video/i, /cdninstagram.*video/i,
        /video.*twimg\.com/i, /tiktokcdn/i, /sndcdn\.com/i, /soundcloud/i,
        /vimeocdn/i, /dailymotion/i, /reddit.*\.mp4/i,
    ];

    function isMediaUrl(url) {
        if (!url || typeof url !== 'string') return false;
        return PATTERNS.some((p) => p.test(url));
    }
})();

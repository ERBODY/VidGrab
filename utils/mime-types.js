/**
 * VidGrab — MIME Types & Media Detection (Enhanced)
 * Expanded format support, broader CDN patterns.
 */

(function () {
    'use strict';

    const MEDIA_MIME_TYPES = {
        'video/mp4': { ext: 'mp4', type: 'video', label: 'MP4' },
        'video/webm': { ext: 'webm', type: 'video', label: 'WebM' },
        'video/ogg': { ext: 'ogv', type: 'video', label: 'OGG Video' },
        'video/x-flv': { ext: 'flv', type: 'video', label: 'FLV' },
        'video/x-matroska': { ext: 'mkv', type: 'video', label: 'MKV' },
        'video/3gpp': { ext: '3gp', type: 'video', label: '3GP' },
        'video/quicktime': { ext: 'mov', type: 'video', label: 'MOV' },
        'video/x-msvideo': { ext: 'avi', type: 'video', label: 'AVI' },
        'video/mp2t': { ext: 'ts', type: 'video', label: 'MPEG-TS' },
        'video/x-ms-wmv': { ext: 'wmv', type: 'video', label: 'WMV' },
        'video/x-m4v': { ext: 'm4v', type: 'video', label: 'M4V' },
        'audio/mpeg': { ext: 'mp3', type: 'audio', label: 'MP3' },
        'audio/mp4': { ext: 'm4a', type: 'audio', label: 'M4A' },
        'audio/ogg': { ext: 'ogg', type: 'audio', label: 'OGG' },
        'audio/webm': { ext: 'weba', type: 'audio', label: 'WebM Audio' },
        'audio/wav': { ext: 'wav', type: 'audio', label: 'WAV' },
        'audio/x-wav': { ext: 'wav', type: 'audio', label: 'WAV' },
        'audio/flac': { ext: 'flac', type: 'audio', label: 'FLAC' },
        'audio/aac': { ext: 'aac', type: 'audio', label: 'AAC' },
        'audio/opus': { ext: 'opus', type: 'audio', label: 'OPUS' },
        'audio/x-m4a': { ext: 'm4a', type: 'audio', label: 'M4A' },
        'application/vnd.apple.mpegurl': { ext: 'm3u8', type: 'stream', label: 'HLS' },
        'application/x-mpegurl': { ext: 'm3u8', type: 'stream', label: 'HLS' },
        'application/dash+xml': { ext: 'mpd', type: 'stream', label: 'DASH' },
        'audio/x-mpegurl': { ext: 'm3u8', type: 'stream', label: 'HLS Audio' },
    };

    const MEDIA_EXTENSIONS = new Set([
        'mp4', 'webm', 'ogv', 'flv', 'mkv', '3gp', 'mov', 'avi', 'ts', 'wmv', 'm4v', 'mpg', 'mpeg',
        'mp3', 'm4a', 'ogg', 'weba', 'wav', 'flac', 'aac', 'opus',
        'm3u8', 'mpd',
    ]);

    const MEDIA_URL_PATTERNS = [
        /\.mp4(\?|#|$)/i, /\.webm(\?|#|$)/i, /\.m3u8(\?|#|$)/i, /\.mpd(\?|#|$)/i,
        /\.ts(\?|#|$)/i, /\.flv(\?|#|$)/i, /\.mkv(\?|#|$)/i, /\.mov(\?|#|$)/i,
        /\.avi(\?|#|$)/i, /\.wmv(\?|#|$)/i, /\.m4v(\?|#|$)/i,
        /\.mp3(\?|#|$)/i, /\.m4a(\?|#|$)/i, /\.ogg(\?|#|$)/i, /\.wav(\?|#|$)/i,
        /\.flac(\?|#|$)/i, /\.aac(\?|#|$)/i, /\.opus(\?|#|$)/i,
        /videoplayback/i, /googlevideo\.com/i, /fbcdn.*video/i, /cdninstagram.*video/i,
        /video.*twimg\.com/i, /tiktokcdn/i, /sndcdn\.com/i, /vimeocdn/i,
        /dailymotion/i, /reddit.*\.mp4/i, /\.redd\.it.*\.mp4/i,
        /bitmovin/i, /akamaihd\.net.*video/i, /cloudfront.*video/i,
        /jwplayer/i, /brightcove/i, /vimeo.*\.mp4/i,
    ];

    const IGNORE_PATTERNS = [
        /google-analytics/i, /doubleclick/i, /facebook\.com\/tr/i,
        /\.gif(\?|$)/i, /\.png(\?|$)/i, /\.jpg(\?|$)/i, /\.jpeg(\?|$)/i,
        /\.svg(\?|$)/i, /\.ico(\?|$)/i, /\.css(\?|$)/i, /\.woff/i,
    ];

    function getMediaInfoFromMime(mime) {
        if (!mime) return null;
        return MEDIA_MIME_TYPES[mime.split(';')[0].trim().toLowerCase()] || null;
    }

    function getExtensionFromUrl(url) {
        try {
            const m = new URL(url).pathname.match(/\.([a-zA-Z0-9]+)(?:\?|#|$)/);
            return m ? m[1].toLowerCase() : null;
        } catch { return null; }
    }

    function isMediaUrl(url) {
        if (!url) return false;
        if (IGNORE_PATTERNS.some((p) => p.test(url))) return false;
        return MEDIA_URL_PATTERNS.some((p) => p.test(url));
    }

    function detectMediaType(url, contentType) {
        const mimeInfo = getMediaInfoFromMime(contentType);
        if (mimeInfo) return mimeInfo;
        const ext = getExtensionFromUrl(url);
        if (ext && MEDIA_EXTENSIONS.has(ext)) {
            const audioExts = new Set(['mp3', 'm4a', 'ogg', 'weba', 'wav', 'flac', 'aac', 'opus']);
            const streamExts = new Set(['m3u8', 'mpd']);
            let type = 'video';
            if (audioExts.has(ext)) type = 'audio';
            if (streamExts.has(ext)) type = 'stream';
            return { ext, type, label: ext.toUpperCase() };
        }
        if (isMediaUrl(url)) return { ext: ext || 'mp4', type: 'video', label: 'Video' };
        return null;
    }

    if (typeof globalThis !== 'undefined') {
        globalThis.MimeTypes = { MEDIA_MIME_TYPES, MEDIA_EXTENSIONS, getMediaInfoFromMime, getExtensionFromUrl, isMediaUrl, detectMediaType };
    }
})();

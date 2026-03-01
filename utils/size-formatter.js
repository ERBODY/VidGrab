/**
 * Format bytes to a human-readable string
 */
function formatSize(bytes) {
    if (!bytes || bytes === 0) return 'Unknown';
    if (bytes < 0) return 'Unknown';

    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const k = 1024;
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    const size = (bytes / Math.pow(k, i)).toFixed(i > 0 ? 1 : 0);

    return `${size} ${units[i]}`;
}

/**
 * Estimate file size from Content-Length header or bitrate
 */
function estimateSize(contentLength, duration, bitrate) {
    if (contentLength && contentLength > 0) {
        return contentLength;
    }
    if (duration && bitrate) {
        return Math.round((bitrate * duration) / 8);
    }
    return 0;
}

/**
 * Format duration in seconds to HH:MM:SS or MM:SS
 */
function formatDuration(seconds) {
    if (!seconds || seconds <= 0) return '';
    seconds = Math.round(seconds);
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;

    if (h > 0) {
        return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    return `${m}:${String(s).padStart(2, '0')}`;
}

// Export
if (typeof globalThis !== 'undefined') {
    globalThis.SizeFormatter = {
        formatSize,
        estimateSize,
        formatDuration,
    };
}

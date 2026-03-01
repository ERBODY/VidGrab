/**
 * VidGrab — Filename Utilities (Enhanced)
 * Smart naming with multiple templates, date/timestamp options.
 */

(function () {
    'use strict';

    function sanitize(name) {
        if (!name) return 'download';
        return name
            .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
            .replace(/\s+/g, '_')
            .replace(/_{2,}/g, '_')
            .replace(/^[.\s]+|[.\s]+$/g, '')
            .substring(0, 200);
    }

    function getNameFromUrl(url) {
        try {
            const u = new URL(url);
            const seg = u.pathname.split('/').filter(Boolean).pop() || '';
            const name = decodeURIComponent(seg).replace(/\.[^.]+$/, '');
            return name.length > 3 ? name : u.hostname.replace(/^www\./, '');
        } catch { return 'video'; }
    }

    function dateStamp() {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    function timeStamp() {
        const d = new Date();
        return `${dateStamp()}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`;
    }

    /**
     * Generate filename based on template setting.
     * @param {Object} opts - { pageTitle, url, quality, format, type, template }
     */
    function generateFilename(opts) {
        const { pageTitle, url, quality, format, type, template } = opts;
        const ext = format || 'mp4';
        let base = '';

        switch (template) {
            case 'title':
                base = sanitize(pageTitle || getNameFromUrl(url || ''));
                break;
            case 'original':
                base = sanitize(getNameFromUrl(url || '') || pageTitle || 'download');
                break;
            case 'title_date':
                base = sanitize(pageTitle || getNameFromUrl(url || '')) + '_' + dateStamp();
                break;
            case 'timestamp':
                base = 'vidgrab_' + timeStamp();
                break;
            case 'title_quality':
            default:
                base = sanitize(pageTitle || getNameFromUrl(url || ''));
                if (quality) base += `_${quality}`;
                break;
        }

        if (type === 'audio' && !base.includes('audio')) base += '_audio';
        return `${base}.${ext}`;
    }

    if (typeof globalThis !== 'undefined') {
        globalThis.FilenameUtils = { sanitize, getNameFromUrl, generateFilename, dateStamp, timeStamp };
    }
})();

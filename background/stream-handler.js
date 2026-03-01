/**
 * VidGrab — Stream Handler (Enhanced)
 * HLS/DASH parsing with segment download and quality selection.
 */

(function () {
    'use strict';

    const StreamHandler = {
        /**
         * Parse an HLS M3U8 playlist
         */
        async parseHLS(m3u8Url) {
            try {
                const response = await fetch(m3u8Url);
                const text = await response.text();
                const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
                const baseUrl = m3u8Url.substring(0, m3u8Url.lastIndexOf('/') + 1);
                const variants = [];
                const segments = [];
                let currentVariant = null;

                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i];
                    if (line.startsWith('#EXT-X-STREAM-INF:')) {
                        const attrs = parseHLSAttrs(line);
                        currentVariant = {
                            bandwidth: parseInt(attrs.BANDWIDTH) || 0,
                            resolution: attrs.RESOLUTION || '',
                            codecs: attrs.CODECS || '',
                            url: '',
                        };
                    } else if (currentVariant && !line.startsWith('#')) {
                        currentVariant.url = resolveUrl(baseUrl, line);
                        currentVariant.quality = qualityLabel(currentVariant.resolution, currentVariant.bandwidth);
                        variants.push(currentVariant);
                        currentVariant = null;
                    }

                    if (line.startsWith('#EXTINF:')) {
                        const duration = parseFloat(line.split(':')[1]) || 0;
                        const segUrl = lines[i + 1];
                        if (segUrl && !segUrl.startsWith('#')) {
                            segments.push({ url: resolveUrl(baseUrl, segUrl), duration });
                        }
                    }
                }

                return {
                    type: 'hls', isMaster: variants.length > 0,
                    variants, segments,
                    totalDuration: segments.reduce((s, seg) => s + seg.duration, 0),
                };
            } catch (err) {
                console.error('[VidGrab] HLS parse error:', err);
                return null;
            }
        },

        /**
         * Parse a DASH MPD manifest
         */
        async parseDASH(mpdUrl) {
            try {
                const response = await fetch(mpdUrl);
                const text = await response.text();
                const baseUrl = mpdUrl.substring(0, mpdUrl.lastIndexOf('/') + 1);
                const representations = [];

                // Regex-based XML parsing (MV3 service workers don't have DOMParser)
                const repRegex = /<Representation\b([^>]*)(?:\/>|>([\s\S]*?)<\/Representation>)/gi;
                const adaptRegex = /<AdaptationSet\b([^>]*)>([\s\S]*?)<\/AdaptationSet>/gi;

                let adaptMatch;
                while ((adaptMatch = adaptRegex.exec(text))) {
                    const adaptAttrs = adaptMatch[1];
                    const adaptContent = adaptMatch[2];
                    const adaptMime = getAttr(adaptAttrs, 'mimeType') || '';
                    const adaptCodecs = getAttr(adaptAttrs, 'codecs') || '';

                    let repMatch;
                    const localRepRegex = /<Representation\b([^>]*)(?:\/>|>([\s\S]*?)<\/Representation>)/gi;
                    while ((repMatch = localRepRegex.exec(adaptContent))) {
                        const attrs = repMatch[1];
                        const repContent = repMatch[2] || '';
                        const bw = parseInt(getAttr(attrs, 'bandwidth')) || 0;
                        const w = parseInt(getAttr(attrs, 'width')) || 0;
                        const h = parseInt(getAttr(attrs, 'height')) || 0;
                        const mime = getAttr(attrs, 'mimeType') || adaptMime;
                        const codecs = getAttr(attrs, 'codecs') || adaptCodecs;

                        let segUrls = [];
                        const baseUrlMatch = repContent.match(/<BaseURL[^>]*>([^<]+)<\/BaseURL>/i);
                        if (baseUrlMatch) segUrls.push(resolveUrl(baseUrl, baseUrlMatch[1].trim()));

                        const segUrlRegex = /<SegmentURL\b[^>]*media="([^"]*)"[^>]*\/?>/gi;
                        let segMatch;
                        while ((segMatch = segUrlRegex.exec(repContent))) {
                            segUrls.push(resolveUrl(baseUrl, segMatch[1]));
                        }

                        representations.push({
                            bandwidth: bw, width: w, height: h,
                            resolution: w && h ? `${w}x${h}` : '',
                            mimeType: mime, codecs,
                            quality: qualityLabel(`${w}x${h}`, bw),
                            type: mime.startsWith('audio') ? 'audio' : 'video',
                            segments: segUrls,
                        });
                    }
                }

                return { type: 'dash', representations };
            } catch (err) {
                console.error('[VidGrab] DASH parse error:', err);
                return null;
            }
        },

        /**
         * Download all segments of a stream and concatenate into a single blob
         */
        async downloadSegments(segmentUrls, onProgress) {
            const chunks = [];
            let loaded = 0;
            for (let i = 0; i < segmentUrls.length; i++) {
                try {
                    const resp = await fetch(segmentUrls[i]);
                    const data = await resp.arrayBuffer();
                    chunks.push(new Uint8Array(data));
                    loaded++;
                    if (onProgress) onProgress(loaded / segmentUrls.length);
                } catch (err) {
                    console.warn(`[VidGrab] Segment ${i} failed:`, err);
                }
            }

            const totalLen = chunks.reduce((s, c) => s + c.length, 0);
            const result = new Uint8Array(totalLen);
            let offset = 0;
            for (const c of chunks) {
                result.set(c, offset);
                offset += c.length;
            }

            return new Blob([result], { type: 'video/mp2t' });
        },

        qualityLabel,
    };

    // ========== Helpers ==========
    function parseHLSAttrs(line) {
        const attrs = {};
        const str = line.substring(line.indexOf(':') + 1);
        const re = /([A-Z\-]+)=(?:"([^"]*)"|([\w.]+))/g;
        let m;
        while ((m = re.exec(str))) attrs[m[1]] = m[2] || m[3];
        return attrs;
    }

    function getAttr(attrString, name) {
        const re = new RegExp(name + '="([^"]*)"', 'i');
        const m = attrString.match(re);
        return m ? m[1] : '';
    }

    function resolveUrl(base, rel) {
        if (!rel) return '';
        if (rel.startsWith('http://') || rel.startsWith('https://')) return rel;
        if (rel.startsWith('/')) {
            try { return new URL(rel, base).href; } catch { return base + rel; }
        }
        return base + rel;
    }

    function qualityLabel(resolution, bandwidth) {
        if (resolution) {
            const h = parseInt(resolution.split('x')[1]);
            if (h >= 2160) return '4K';
            if (h >= 1440) return '1440p';
            if (h >= 1080) return '1080p';
            if (h >= 720) return '720p';
            if (h >= 480) return '480p';
            if (h >= 360) return '360p';
            if (h >= 240) return '240p';
            if (h > 0) return `${h}p`;
        }
        if (bandwidth) {
            const mbps = bandwidth / 1000000;
            if (mbps >= 5) return 'High';
            if (mbps >= 2) return 'Medium';
            return 'Low';
        }
        return '';
    }

    if (typeof globalThis !== 'undefined') globalThis.StreamHandler = StreamHandler;
})();

/**
 * VidGrab — FFmpeg.wasm Converter (Sandboxed)
 * Runs inside a sandboxed iframe. Can load external CDN scripts.
 * Cannot use chrome.* APIs — communicates via window.parent.postMessage.
 */

(async function () {
    'use strict';

    let ffmpeg = null;
    let ffmpegLoaded = false;
    let ffmpegLoading = false;

    // ========== Load FFmpeg.wasm from CDN ==========
    async function loadFFmpeg() {
        if (ffmpegLoaded) return true;
        if (ffmpegLoading) {
            while (ffmpegLoading) await new Promise(r => setTimeout(r, 200));
            return ffmpegLoaded;
        }
        ffmpegLoading = true;

        try {
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/umd/ffmpeg.min.js';
            document.head.appendChild(script);

            await new Promise((resolve, reject) => {
                script.onload = resolve;
                script.onerror = () => reject(new Error('Failed to load FFmpeg from CDN'));
            });

            const FFmpegLib = window.FFmpegWASM || window.FFmpeg;
            if (!FFmpegLib) throw new Error('FFmpeg global not found');

            if (FFmpegLib.FFmpeg) {
                ffmpeg = new FFmpegLib.FFmpeg();
            } else if (typeof FFmpegLib === 'function') {
                ffmpeg = new FFmpegLib();
            } else {
                throw new Error('Cannot instantiate FFmpeg');
            }

            if (ffmpeg.on) {
                ffmpeg.on('progress', ({ progress, time }) => {
                    notifyParent('VIDGRAB_CONVERT_PROGRESS', {
                        progress: Math.round((progress || 0) * 100), time,
                    });
                });
                ffmpeg.on('log', ({ message }) => console.log('[FFmpeg]', message));
            }

            await ffmpeg.load({
                coreURL: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.js',
                wasmURL: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.wasm',
            });

            ffmpegLoaded = true;
            ffmpegLoading = false;
            console.log('[VidGrab Converter] FFmpeg.wasm loaded');
            return true;
        } catch (err) {
            ffmpegLoading = false;
            console.error('[VidGrab Converter] FFmpeg load failed:', err);
            return false;
        }
    }

    // ========== Notify parent (bridge) page ==========
    function notifyParent(type, payload) {
        window.parent.postMessage({ type, payload }, '*');
    }

    // ========== Convert ==========
    async function convertMedia(job) {
        const loaded = await loadFFmpeg();
        if (!loaded || !ffmpeg) throw new Error('FFmpeg not available');

        const { url, outputFormat, quality, id, filename } = job;

        // Fetch source
        const response = await fetch(url);
        if (!response.ok) throw new Error('Fetch failed: ' + response.status);
        const inputData = new Uint8Array(await response.arrayBuffer());

        const inputExt = (url.match(/\.([a-z0-9]+)(\?|#|$)/i) || [])[1] || 'mp4';
        const inputName = 'input.' + inputExt;
        const outputName = 'output.' + outputFormat;

        await ffmpeg.writeFile(inputName, inputData);

        const args = buildArgs(inputName, outputName, outputFormat, quality);
        console.log('[Converter] ffmpeg', args.join(' '));
        await ffmpeg.exec(args);

        const outputData = await ffmpeg.readFile(outputName);
        if (!outputData || outputData.length === 0) throw new Error('Conversion produced empty output');

        const MIME = {
            mp4: 'video/mp4', webm: 'video/webm', mkv: 'video/x-matroska',
            avi: 'video/x-msvideo', mov: 'video/quicktime', flv: 'video/x-flv',
            '3gp': 'video/3gpp',
            mp3: 'audio/mpeg', aac: 'audio/aac', wav: 'audio/wav',
            ogg: 'audio/ogg', flac: 'audio/flac', m4a: 'audio/mp4',
            opus: 'audio/opus', weba: 'audio/webm',
        };

        const dlName = ((filename || 'vidgrab_converted').replace(/\.[^.]+$/, '')) + '.' + outputFormat;

        // Send converted data back to bridge as ArrayBuffer (transferable)
        const buffer = outputData.buffer;
        notifyParent('VIDGRAB_CONVERT_DONE', {
            arrayBuffer: buffer,
            mimeType: MIME[outputFormat] || 'application/octet-stream',
            filename: dlName,
            id: id,
        });

        // Cleanup
        try { await ffmpeg.deleteFile(inputName); } catch (e) { }
        try { await ffmpeg.deleteFile(outputName); } catch (e) { }
    }

    function buildArgs(input, output, format, quality) {
        const args = ['-i', input];
        const Q = { highest: { v: '8000k', a: '320k' }, high: { v: '5000k', a: '256k' }, medium: { v: '2500k', a: '192k' }, low: { v: '1000k', a: '128k' }, lowest: { v: '500k', a: '96k' } };
        const q = Q[quality] || Q.high;
        const AUDIO = new Set(['mp3', 'aac', 'wav', 'ogg', 'flac', 'm4a', 'opus', 'weba']);

        if (AUDIO.has(format)) {
            args.push('-vn');
            switch (format) {
                case 'mp3': args.push('-c:a', 'libmp3lame', '-b:a', q.a); break;
                case 'aac': args.push('-c:a', 'aac', '-b:a', q.a); break;
                case 'wav': args.push('-c:a', 'pcm_s16le'); break;
                case 'ogg': args.push('-c:a', 'libvorbis', '-b:a', q.a); break;
                case 'flac': args.push('-c:a', 'flac'); break;
                case 'm4a': args.push('-c:a', 'aac', '-b:a', q.a); break;
                case 'opus': args.push('-c:a', 'libopus', '-b:a', q.a); break;
                case 'weba': args.push('-c:a', 'libvorbis', '-b:a', q.a); break;
            }
        } else {
            switch (format) {
                case 'mp4': args.push('-c:v', 'libx264', '-b:v', q.v, '-c:a', 'aac', '-b:a', q.a, '-movflags', '+faststart'); break;
                case 'webm': args.push('-c:v', 'libvpx', '-b:v', q.v, '-c:a', 'libvorbis', '-b:a', q.a); break;
                case 'mkv': args.push('-c', 'copy'); break;
                case 'avi': args.push('-c:v', 'mpeg4', '-b:v', q.v, '-c:a', 'mp3', '-b:a', q.a); break;
                case 'mov': args.push('-c:v', 'libx264', '-b:v', q.v, '-c:a', 'aac', '-b:a', q.a); break;
                default: args.push('-c', 'copy'); break;
            }
        }
        args.push('-y', output);
        return args;
    }

    // ========== Listen for conversion requests from parent (bridge) ==========
    window.addEventListener('message', (event) => {
        if (!event.data || event.data.type !== 'VIDGRAB_CONVERT_REQUEST') return;

        convertMedia(event.data.data)
            .catch((err) => {
                console.error('[Converter] Error:', err);
                notifyParent('VIDGRAB_CONVERT_ERROR', {
                    id: event.data.data.id,
                    error: err.message,
                });
            });
    });

    console.log('[VidGrab Converter] Sandbox ready');
})();

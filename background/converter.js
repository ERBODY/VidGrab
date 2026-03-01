/**
 * VidGrab — Background Converter
 * Manages FFmpeg.wasm loading and format conversion via a hidden converter page.
 * Supported conversions: video-to-video, video-to-audio, audio-to-audio.
 */

(function () {
    'use strict';

    let converterTab = null;
    const conversionQueue = [];
    let isConverting = false;

    const SUPPORTED_OUTPUT_FORMATS = {
        video: ['mp4', 'webm', 'mkv', 'avi', 'mov', 'flv', '3gp'],
        audio: ['mp3', 'aac', 'wav', 'ogg', 'flac', 'weba', 'm4a'],
    };

    const FORMAT_ARGS = {
        mp4: ['-c:v', 'libx264', '-c:a', 'aac', '-movflags', '+faststart'],
        webm: ['-c:v', 'libvpx', '-c:a', 'libvorbis'],
        mkv: ['-c:v', 'copy', '-c:a', 'copy'],
        avi: ['-c:v', 'mpeg4', '-c:a', 'mp3'],
        mov: ['-c:v', 'libx264', '-c:a', 'aac'],
        flv: ['-c:v', 'flv1', '-c:a', 'mp3'],
        '3gp': ['-c:v', 'h263', '-c:a', 'aac', '-s', '352x288'],
        mp3: ['-vn', '-c:a', 'libmp3lame', '-q:a', '2'],
        aac: ['-vn', '-c:a', 'aac', '-b:a', '192k'],
        wav: ['-vn', '-c:a', 'pcm_s16le'],
        ogg: ['-vn', '-c:a', 'libvorbis', '-q:a', '6'],
        flac: ['-vn', '-c:a', 'flac'],
        weba: ['-vn', '-c:a', 'libvorbis'],
        m4a: ['-vn', '-c:a', 'aac', '-b:a', '192k'],
    };

    const QUALITY_PRESETS = {
        highest: { videoBitrate: '8M', audioBitrate: '320k' },
        high: { videoBitrate: '5M', audioBitrate: '256k' },
        medium: { videoBitrate: '2.5M', audioBitrate: '192k' },
        low: { videoBitrate: '1M', audioBitrate: '128k' },
        lowest: { videoBitrate: '500k', audioBitrate: '96k' },
    };

    const Converter = {
        SUPPORTED_OUTPUT_FORMATS,
        FORMAT_ARGS,
        QUALITY_PRESETS,

        /**
         * Check if a conversion is possible
         */
        canConvert(inputFormat, outputFormat) {
            const allFormats = [...SUPPORTED_OUTPUT_FORMATS.video, ...SUPPORTED_OUTPUT_FORMATS.audio];
            return allFormats.includes(outputFormat);
        },

        /**
         * Get available output formats for a given input type
         */
        getOutputFormats(inputType) {
            if (inputType === 'audio') {
                return SUPPORTED_OUTPUT_FORMATS.audio;
            }
            return [...SUPPORTED_OUTPUT_FORMATS.video, ...SUPPORTED_OUTPUT_FORMATS.audio];
        },

        /**
         * Build FFmpeg command args for a conversion
         */
        buildArgs(inputFile, outputFormat, quality) {
            const preset = QUALITY_PRESETS[quality] || QUALITY_PRESETS.high;
            const formatArgs = FORMAT_ARGS[outputFormat] || ['-c', 'copy'];
            const outputFile = inputFile.replace(/\.[^.]+$/, `.${outputFormat}`);

            const args = ['-i', inputFile];

            // Add quality settings for video formats
            const isVideoOutput = SUPPORTED_OUTPUT_FORMATS.video.includes(outputFormat);
            if (isVideoOutput) {
                args.push('-b:v', preset.videoBitrate);
            }
            args.push(...formatArgs);

            // Audio bitrate for audio formats
            const isAudioOnly = SUPPORTED_OUTPUT_FORMATS.audio.includes(outputFormat);
            if (isAudioOnly && !formatArgs.includes('-b:a') && !formatArgs.includes('-q:a')) {
                args.push('-b:a', preset.audioBitrate);
            }

            args.push(outputFile);
            return { args, outputFile };
        },

        /**
         * Queue a conversion job
         */
        queueConversion(job) {
            conversionQueue.push({
                ...job,
                id: `conv_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
                status: 'queued',
                progress: 0,
            });
            processQueue();
            return conversionQueue[conversionQueue.length - 1].id;
        },

        /**
         * Get conversion status
         */
        getStatus(conversionId) {
            return conversionQueue.find((j) => j.id === conversionId);
        },
    };

    async function processQueue() {
        if (isConverting || conversionQueue.length === 0) return;
        const job = conversionQueue.find((j) => j.status === 'queued');
        if (!job) return;

        isConverting = true;
        job.status = 'converting';

        try {
            // Send conversion request to converter page via messaging
            // The converter page handles the actual FFmpeg.wasm execution
            const converterUrl = chrome.runtime.getURL('converter/converter.html');

            // Broadcast to the converter page
            chrome.runtime.sendMessage({
                action: 'startConversion',
                data: {
                    id: job.id,
                    url: job.url,
                    outputFormat: job.outputFormat,
                    quality: job.quality || 'high',
                    filename: job.filename,
                },
            });
            // Converter page might not be open — that's ok

        } catch (err) {
            job.status = 'error';
            job.error = err.message;
        }

        isConverting = false;
    }

    // Listen for converter page responses
    chrome.runtime.onMessage.addListener((msg) => {
        if (msg.action === 'conversionProgress') {
            const job = conversionQueue.find((j) => j.id === msg.data.id);
            if (job) {
                job.progress = msg.data.progress;
                job.status = msg.data.status || 'converting';
            }
        }
        if (msg.action === 'conversionComplete') {
            const job = conversionQueue.find((j) => j.id === msg.data.id);
            if (job) {
                job.status = 'complete';
                job.progress = 100;
                job.outputUrl = msg.data.outputUrl;
            }
        }
    });

    // Export
    if (typeof globalThis !== 'undefined') {
        globalThis.Converter = Converter;
    }
})();

/**
 * VidGrab — Converter Bridge Script
 * Runs on bridge.html (extension page with chrome.* access).
 * Relays conversion requests to the sandboxed converter.html iframe,
 * and handles downloads from the converted output.
 */

(() => {
    'use strict';

    const sandbox = document.getElementById('sandbox');

    // Listen for messages from the background script
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        if (msg.action === 'startConversion') {
            // Relay conversion request to the sandbox iframe
            sandbox.contentWindow.postMessage({
                type: 'VIDGRAB_CONVERT_REQUEST',
                data: msg.data,
            }, '*');
            sendResponse({ queued: true });
        }
    });

    // Listen for messages from the sandbox iframe
    window.addEventListener('message', (event) => {
        if (!event.data || !event.data.type) return;

        switch (event.data.type) {
            case 'VIDGRAB_CONVERT_PROGRESS':
                // Forward progress to background
                chrome.runtime.sendMessage({
                    action: 'conversionProgress',
                    data: event.data.payload,
                });
                break;

            case 'VIDGRAB_CONVERT_DONE':
                // Sandbox sends converted file as ArrayBuffer + metadata
                const { arrayBuffer, mimeType, filename, id } = event.data.payload;
                const blob = new Blob([arrayBuffer], { type: mimeType });
                const blobUrl = URL.createObjectURL(blob);

                chrome.downloads.download({
                    url: blobUrl,
                    filename: filename,
                    saveAs: true,
                }, (downloadId) => {
                    if (chrome.runtime.lastError) {
                        console.error('[VidGrab Bridge] Download error:', chrome.runtime.lastError.message);
                    }
                    // Notify background
                    chrome.runtime.sendMessage({
                        action: 'conversionComplete',
                        data: { id, success: !chrome.runtime.lastError },
                    });
                });
                break;

            case 'VIDGRAB_CONVERT_ERROR':
                chrome.runtime.sendMessage({
                    action: 'conversionComplete',
                    data: {
                        id: event.data.payload.id,
                        success: false,
                        error: event.data.payload.error,
                    },
                });
                break;
        }
    });

    console.log('[VidGrab Bridge] Ready');
})();

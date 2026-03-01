/**
 * VidGrab — DRM Handler (Background)
 * Manages DRM key capture data from content scripts,
 * coordinates decrypted stream assembly.
 */

(function () {
    'use strict';

    // Store captured DRM sessions per tab
    const drmSessions = new Map(); // Map<tabId, Array<DRMSession>>

    const DRMHandler = {
        /**
         * Store a captured DRM key session
         */
        addSession(tabId, sessionData) {
            if (!drmSessions.has(tabId)) drmSessions.set(tabId, []);
            const sessions = drmSessions.get(tabId);

            // Avoid duplicates
            const exists = sessions.some(
                (s) => s.keySystem === sessionData.keySystem && s.sessionId === sessionData.sessionId
            );
            if (!exists) {
                sessions.push({
                    ...sessionData,
                    capturedAt: Date.now(),
                });
            }
        },

        /**
         * Get all DRM sessions for a tab
         */
        getSessions(tabId) {
            return drmSessions.get(tabId) || [];
        },

        /**
         * Clear DRM data for a tab
         */
        clearTab(tabId) {
            drmSessions.delete(tabId);
        },

        /**
         * Extract decryption keys from a ClearKey license response
         */
        parseClearKeyResponse(responseBytes) {
            try {
                const decoder = new TextDecoder();
                const json = JSON.parse(decoder.decode(responseBytes));
                if (json.keys && Array.isArray(json.keys)) {
                    return json.keys.map((k) => ({
                        kid: k.kid,
                        key: k.k,
                        type: k.kty || 'oct',
                    }));
                }
            } catch { }
            return [];
        },

        /**
         * Parse PSSH box to extract key IDs
         */
        parsePSSH(initData) {
            try {
                const view = new DataView(initData.buffer || initData);
                const keyIds = [];

                let offset = 0;
                while (offset < view.byteLength) {
                    const boxSize = view.getUint32(offset);
                    const boxType = String.fromCharCode(
                        view.getUint8(offset + 4),
                        view.getUint8(offset + 5),
                        view.getUint8(offset + 6),
                        view.getUint8(offset + 7)
                    );

                    if (boxType === 'pssh') {
                        // Extract system ID (16 bytes at offset+12)
                        const systemId = Array.from(new Uint8Array(initData, offset + 12, 16))
                            .map((b) => b.toString(16).padStart(2, '0'))
                            .join('');

                        keyIds.push({ systemId, offset, size: boxSize });
                    }

                    offset += boxSize;
                    if (boxSize === 0) break;
                }

                return keyIds;
            } catch {
                return [];
            }
        },

        /**
         * Build decryption info object for a captured session
         */
        getDecryptionInfo(tabId) {
            const sessions = drmSessions.get(tabId) || [];
            return sessions.map((s) => ({
                keySystem: s.keySystem,
                keys: s.keys || [],
                psshData: s.psshData || null,
                licenseUrl: s.licenseUrl || '',
            }));
        },
    };

    // Clean up on tab close
    chrome.tabs.onRemoved.addListener((tabId) => {
        DRMHandler.clearTab(tabId);
    });

    chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
        if (changeInfo.status === 'loading') {
            DRMHandler.clearTab(tabId);
        }
    });

    // Export globally
    if (typeof globalThis !== 'undefined') {
        globalThis.DRMHandler = DRMHandler;
    }
})();

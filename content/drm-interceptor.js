/**
 * VidGrab — DRM Interceptor (Content Script)
 * This content script INJECTS DRM hooks into the page context
 * and relays captured data to the background script.
 *
 * EME APIs (navigator.requestMediaKeySystemAccess, MediaKeys, etc.)
 * can only be intercepted from the PAGE context, not content script context.
 */

(() => {
    'use strict';
    if (window.__vidgrab_drm_v2) return;
    window.__vidgrab_drm_v2 = true;

    // Listen for DRM data from the injected page script
    window.addEventListener('message', (event) => {
        if (event.source !== window) return;
        if (event.data && event.data.type === 'VIDGRAB_DRM') {
            try {
                chrome.runtime.sendMessage({
                    action: 'drmKeysCaptured',
                    data: {
                        ...event.data.payload,
                        pageUrl: window.location.href,
                        pageTitle: document.title,
                    },
                });
            } catch { }
        }
    });

    // Inject the DRM hooks into the page context
    function injectDRMScript() {
        const script = document.createElement('script');
        script.textContent = `(${drmPageScript.toString()})();`;

        const append = () => {
            const target = document.head || document.documentElement;
            if (target) {
                target.appendChild(script);
                script.remove();
            } else {
                setTimeout(append, 10);
            }
        };
        append();
    }

    /**
     * This function runs in the PAGE context (not content script).
     * It has direct access to navigator.requestMediaKeySystemAccess and EME APIs.
     */
    function drmPageScript() {
        if (window.__vidgrab_drm_page) return;
        window.__vidgrab_drm_page = true;

        function notifyDRM(payload) {
            window.postMessage({ type: 'VIDGRAB_DRM', payload }, '*');
        }

        function arrayToBase64(arr) {
            let s = '';
            for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
            return btoa(s);
        }

        function arrayToHex(arr) {
            return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
        }

        // ========== requestMediaKeySystemAccess ==========
        if (navigator.requestMediaKeySystemAccess) {
            const orig = navigator.requestMediaKeySystemAccess.bind(navigator);
            navigator.requestMediaKeySystemAccess = async function (keySystem, configs) {
                console.log('[VidGrab DRM] Key system requested:', keySystem);

                notifyDRM({
                    url: location.href,
                    type: 'video',
                    label: 'DRM (' + keySystem + ')',
                    source: 'drm',
                    isDRM: true,
                    drm: { keySystem: keySystem },
                });

                const access = await orig(keySystem, configs);
                return wrapAccess(access, keySystem);
            };
        }

        function wrapAccess(access, keySystem) {
            const origCreate = access.createMediaKeys.bind(access);
            access.createMediaKeys = async function () {
                const mk = await origCreate();
                return wrapMediaKeys(mk, keySystem);
            };
            return access;
        }

        function wrapMediaKeys(mk, keySystem) {
            const origSession = mk.createSession.bind(mk);
            mk.createSession = function (sessionType) {
                const session = origSession(sessionType || 'temporary');
                return wrapSession(session, keySystem);
            };
            return mk;
        }

        function wrapSession(session, keySystem) {
            // Intercept generateRequest (captures PSSH / init data)
            const origGenReq = session.generateRequest.bind(session);
            session.generateRequest = async function (initDataType, initData) {
                try {
                    var arr = new Uint8Array(initData);
                    console.log('[VidGrab DRM] Init data (' + initDataType + '):', arr.length, 'bytes');
                    notifyDRM({
                        url: location.href, type: 'video', source: 'drm-init',
                        label: 'DRM Init (' + keySystem + ')', isDRM: true,
                        drm: { keySystem: keySystem, initDataType: initDataType, pssh: arrayToBase64(arr) },
                    });
                } catch (e) { }
                return origGenReq(initDataType, initData);
            };

            // Intercept update (captures license response / keys)
            const origUpdate = session.update.bind(session);
            session.update = async function (response) {
                try {
                    var resp = new Uint8Array(response);
                    console.log('[VidGrab DRM] License response:', resp.length, 'bytes (' + keySystem + ')');

                    var keys = null;
                    if (keySystem === 'org.w3.clearkey') {
                        try {
                            var json = JSON.parse(new TextDecoder().decode(resp));
                            keys = json.keys || json;
                            console.log('[VidGrab DRM] ClearKey keys:', keys);
                        } catch (e) { }
                    }
                    if (keySystem.indexOf('widevine') !== -1) {
                        keys = { raw: arrayToBase64(resp), format: 'widevine-license' };
                    }

                    notifyDRM({
                        url: location.href, type: 'video', source: 'drm-keys',
                        label: 'DRM Keys (' + keySystem + ')', isDRM: true,
                        drm: { keySystem: keySystem, keys: keys, responseSize: resp.length },
                    });
                } catch (e) { }
                return origUpdate(response);
            };

            // Key status changes
            session.addEventListener('keystatuseschange', function () {
                try {
                    var statuses = [];
                    session.keyStatuses.forEach(function (status, keyId) {
                        statuses.push({ keyId: arrayToHex(new Uint8Array(keyId)), status: status });
                    });
                    if (statuses.length > 0) console.log('[VidGrab DRM] Key statuses:', statuses);
                } catch (e) { }
            });

            return session;
        }

        // ========== Intercept license server fetch requests ==========
        var LICENSE_RE = [
            /\/license/i, /\/widevine/i, /\/drm/i, /\/getlicense/i,
            /license\.service/i, /pallycon/i, /buydrm/i, /drmtoday/i, /ezdrm/i
        ];
        function isLicenseUrl(url) {
            for (var i = 0; i < LICENSE_RE.length; i++) { if (LICENSE_RE[i].test(url)) return true; }
            return false;
        }

        var origFetch = window.fetch;
        window.fetch = function () {
            try {
                var url = typeof arguments[0] === 'string' ? arguments[0] : (arguments[0] && arguments[0].url);
                if (url && isLicenseUrl(url)) {
                    console.log('[VidGrab DRM] License request:', url);
                    notifyDRM({ url: location.href, type: 'video', source: 'drm-license', label: 'DRM License Request', isDRM: true, drm: { licenseUrl: url } });
                }
            } catch (e) { }
            return origFetch.apply(this, arguments);
        };

        console.log('%c[VidGrab DRM]%c Active — EME interception (educational)',
            'color:#A855F7;font-weight:bold', 'color:#888');
    }

    // Inject immediately
    injectDRMScript();
})();

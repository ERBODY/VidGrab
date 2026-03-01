/**
 * WebExtension Browser API Polyfill
 * Normalizes chrome.* → browser.* for cross-browser compatibility.
 * Based on Mozilla's webextension-polyfill (simplified for VidGrab).
 *
 * Works on: Firefox, Chrome, Edge, Opera, Brave, Safari
 */

(function (globalThis) {
    'use strict';

    if (typeof globalThis.browser !== 'undefined' && globalThis.browser.runtime) {
        return;
    }

    if (typeof globalThis.chrome === 'undefined' || !globalThis.chrome.runtime) {
        return;
    }

    const chrome = globalThis.chrome;

    function wrapAsync(fn, context) {
        return function (...args) {
            return new Promise((resolve, reject) => {
                fn.call(context, ...args, (...results) => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                    } else {
                        resolve(results.length <= 1 ? results[0] : results);
                    }
                });
            });
        };
    }

    function wrapNamespace(namespace, asyncMethods) {
        if (!namespace) return namespace;
        const wrapped = {};
        for (const key of Object.keys(namespace)) {
            const value = namespace[key];
            if (typeof value === 'function' && asyncMethods.includes(key)) {
                wrapped[key] = wrapAsync(value, namespace);
            } else if (typeof value === 'object' && value !== null && value.addListener) {
                wrapped[key] = value;
            } else {
                wrapped[key] = value;
            }
        }
        return wrapped;
    }

    const browser = {};

    if (chrome.runtime) {
        browser.runtime = wrapNamespace(chrome.runtime, [
            'sendMessage', 'getBackgroundPage', 'openOptionsPage',
            'setUninstallURL', 'getBrowserInfo',
        ]);
        browser.runtime.id = chrome.runtime.id;
        browser.runtime.getManifest = chrome.runtime.getManifest;
        browser.runtime.getURL = chrome.runtime.getURL;
        browser.runtime.onMessage = chrome.runtime.onMessage;
        browser.runtime.onInstalled = chrome.runtime.onInstalled;
        browser.runtime.lastError = chrome.runtime.lastError;
        browser.runtime.connect = chrome.runtime.connect;
        browser.runtime.onConnect = chrome.runtime.onConnect;
    }

    if (chrome.tabs) {
        browser.tabs = wrapNamespace(chrome.tabs, [
            'get', 'getCurrent', 'query', 'create', 'update',
            'remove', 'reload', 'sendMessage', 'executeScript',
            'insertCSS', 'removeCSS',
        ]);
        browser.tabs.onUpdated = chrome.tabs.onUpdated;
        browser.tabs.onRemoved = chrome.tabs.onRemoved;
        browser.tabs.onActivated = chrome.tabs.onActivated;
    }

    if (chrome.storage) {
        browser.storage = {
            local: chrome.storage.local ? wrapNamespace(chrome.storage.local, ['get', 'set', 'remove', 'clear']) : undefined,
            sync: chrome.storage.sync ? wrapNamespace(chrome.storage.sync, ['get', 'set', 'remove', 'clear']) : undefined,
            onChanged: chrome.storage.onChanged,
        };
    }

    if (chrome.downloads) {
        browser.downloads = wrapNamespace(chrome.downloads, [
            'download', 'search', 'pause', 'resume', 'cancel',
            'erase', 'removeFile', 'getFileIcon',
        ]);
        if (chrome.downloads.onChanged) browser.downloads.onChanged = chrome.downloads.onChanged;
        if (chrome.downloads.onCreated) browser.downloads.onCreated = chrome.downloads.onCreated;
    }

    if (chrome.webRequest) {
        browser.webRequest = chrome.webRequest;
    }

    if (chrome.browserAction) {
        browser.browserAction = wrapNamespace(chrome.browserAction, [
            'setIcon', 'setTitle', 'setBadgeText', 'setBadgeBackgroundColor',
            'getPopup', 'setPopup',
        ]);
    } else if (chrome.action) {
        browser.browserAction = wrapNamespace(chrome.action, [
            'setIcon', 'setTitle', 'setBadgeText', 'setBadgeBackgroundColor',
            'getPopup', 'setPopup',
        ]);
    }

    if (chrome.scripting) {
        browser.scripting = wrapNamespace(chrome.scripting, [
            'executeScript', 'insertCSS', 'removeCSS',
        ]);
    }

    if (chrome.i18n) {
        browser.i18n = chrome.i18n;
    }

    if (chrome.notifications) {
        browser.notifications = wrapNamespace(chrome.notifications, [
            'create', 'update', 'clear', 'getAll',
        ]);
    }

    globalThis.browser = browser;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this));

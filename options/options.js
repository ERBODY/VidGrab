/**
 * VidGrab — Options Script v2
 * Extended settings with import/export, uses chrome.storage directly for reliability.
 */

(() => {
    'use strict';

    const DEFAULTS = {
        defaultQuality: 'highest',
        defaultFormat: 'original',
        defaultAudioFormat: 'original',
        filenameFormat: 'title_quality',
        maxConcurrent: 3,
        autoDetect: true,
        detectStreams: true,
        detectAudio: true,
        detectEmbedded: true,
        minSizeKB: 50,
        drmCapture: true,
        drmLogLicense: false,
        persistMedia: false,
        showBadge: true,
        showNotifications: true,
        theme: 'dark',
        excludedSites: '',
    };

    const FIELDS = {
        defaultQuality: 'select', defaultFormat: 'select', defaultAudioFormat: 'select',
        filenameFormat: 'select', maxConcurrent: 'number', autoDetect: 'checkbox',
        detectStreams: 'checkbox', detectAudio: 'checkbox', detectEmbedded: 'checkbox',
        minSizeKB: 'number', drmCapture: 'checkbox', drmLogLicense: 'checkbox',
        persistMedia: 'checkbox', showBadge: 'checkbox', showNotifications: 'checkbox',
        theme: 'select', excludedSites: 'textarea',
    };

    function load() {
        chrome.storage.sync.get(DEFAULTS, (settings) => {
            if (chrome.runtime.lastError) {
                console.error('[VidGrab Options] Load error:', chrome.runtime.lastError.message);
                return;
            }
            for (const [key, type] of Object.entries(FIELDS)) {
                const el = document.getElementById(key);
                if (!el) continue;
                if (type === 'checkbox') el.checked = settings[key];
                else el.value = settings[key];
            }
        });
    }

    function save(e) {
        e.preventDefault();
        const settings = {};
        for (const [key, type] of Object.entries(FIELDS)) {
            const el = document.getElementById(key);
            if (!el) continue;
            if (type === 'checkbox') settings[key] = el.checked;
            else if (type === 'number') settings[key] = parseInt(el.value) || DEFAULTS[key];
            else settings[key] = el.value;
        }
        chrome.storage.sync.set(settings, () => {
            if (chrome.runtime.lastError) {
                toast('Error: ' + chrome.runtime.lastError.message, 'error');
            } else {
                toast('Settings saved!', 'success');
            }
        });
    }

    function reset() {
        chrome.storage.sync.set(DEFAULTS, () => {
            load();
            toast('Reset to defaults', 'success');
        });
    }

    // ========== Import / Export ==========
    function exportSettings() {
        chrome.storage.sync.get(DEFAULTS, (settings) => {
            const json = JSON.stringify(settings, null, 2);
            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = 'vidgrab-settings.json'; a.click();
            URL.revokeObjectURL(url);
            toast('Settings exported', 'success');
        });
    }

    function importSettings() {
        document.getElementById('importFile').click();
    }

    document.getElementById('importFile').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            try {
                const settings = JSON.parse(ev.target.result);
                chrome.storage.sync.set({ ...DEFAULTS, ...settings }, () => {
                    load();
                    toast('Settings imported!', 'success');
                });
            } catch (err) {
                toast('Invalid settings file', 'error');
            }
        };
        reader.readAsText(file);
    });

    // ========== Toast ==========
    function toast(msg, type) {
        document.querySelectorAll('.toast').forEach((t) => t.remove());
        const t = document.createElement('div');
        t.className = 'toast ' + (type || '');
        t.textContent = msg;
        document.body.appendChild(t);
        requestAnimationFrame(() => t.classList.add('show'));
        setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 2000);
    }

    // ========== Events ==========
    document.getElementById('settingsForm').addEventListener('submit', save);
    document.getElementById('resetBtn').addEventListener('click', reset);
    document.getElementById('exportBtn').addEventListener('click', exportSettings);
    document.getElementById('importBtn').addEventListener('click', importSettings);

    load();
})();

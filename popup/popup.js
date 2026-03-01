/**
 * VidGrab — Popup Script v2
 * Cross-browser, format conversion, file sizes, filtering, responsive.
 * Uses chrome.runtime directly for reliable messaging with background script.
 */

(() => {
    'use strict';

    const $ = (s) => document.querySelector(s);
    const $$ = (s) => document.querySelectorAll(s);

    const mediaList = $('#mediaList');
    const mediaCount = $('#mediaCount');
    const loadingState = $('#loadingState');
    const emptyState = $('#emptyState');
    const pageHost = $('#pageHost');
    const formatModal = $('#formatModal');
    const formatGrid = $('#formatGrid');

    let allMedia = [];
    let pageTitle = '';
    let pageUrl = '';
    let currentTabId = null;
    let activeFilter = 'all';
    let formatTarget = null;

    // ========== SVG Icons ==========
    const IC = {
        video: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="23 7 16 12 23 17"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>`,
        audio: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`,
        stream: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/></svg>`,
        drm: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`,
        dl: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
        check: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>`,
        convert: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>`,
    };

    // ========== Load Media ==========
    let initialLoad = true;

    function loadMedia() {
        showLoading();
        chrome.runtime.sendMessage({ action: 'getMedia' }, (resp) => {
            if (chrome.runtime.lastError) { showEmpty(); return; }
            allMedia = (resp && resp.items) || [];
            pageTitle = (resp && resp.pageTitle) || '';
            pageUrl = (resp && resp.pageUrl) || '';
            currentTabId = resp && resp.tabId;

            try { pageHost.textContent = new URL(pageUrl).hostname; } catch (e) { pageHost.textContent = ''; }
            mediaCount.textContent = allMedia.length;

            if (allMedia.length === 0) {
                // If background memory cleared (MV3 ephemeral worker), force a rescan once automagically
                if (initialLoad && currentTabId) {
                    initialLoad = false;
                    chrome.tabs.sendMessage(currentTabId, { action: 'triggerRescan' }, () => {
                        setTimeout(loadMedia, 300); // Reload popup state after rescan
                    });
                } else {
                    showEmpty();
                }
            } else {
                initialLoad = false;
                // Fetch file sizes for items that don't have them
                allMedia.forEach((item) => {
                    if (!item.size && item.url && !item.url.startsWith('blob:')) {
                        chrome.runtime.sendMessage({ action: 'fetchSize', data: { url: item.url } }, (r) => {
                            if (r && r.size) {
                                item.size = r.size;
                                renderMedia();
                            }
                        });
                    }
                });
                renderMedia();
            }
        });
    }

    // ========== Render ==========
    function renderMedia() {
        loadingState.classList.add('hidden');
        emptyState.classList.add('hidden');
        mediaList.querySelectorAll('.media-card').forEach((c) => c.remove());

        let filtered = allMedia;
        if (activeFilter !== 'all') {
            if (activeFilter === 'drm') {
                filtered = allMedia.filter((m) => m.isDRM);
            } else {
                filtered = allMedia.filter((m) => m.type === activeFilter && !m.isDRM);
            }
        }

        const order = { video: 0, stream: 1, audio: 2 };
        filtered.sort((a, b) => (order[a.type] || 3) - (order[b.type] || 3));

        if (filtered.length === 0) {
            showEmpty();
            return;
        }

        filtered.forEach((item, i) => {
            const card = createCard(item, i);
            mediaList.appendChild(card);
        });
    }

    function createCard(item, idx) {
        const card = document.createElement('div');
        card.className = 'media-card';
        card.style.animationDelay = `${idx * 40}ms`;

        const type = item.isDRM ? 'drm' : (item.type || 'video');
        const title = item.label || urlTitle(item.url);

        let tags = '';
        if (item.format) tags += `<span class="tag fmt">${esc(item.format.toUpperCase())}</span>`;
        if (item.quality) tags += `<span class="tag qual">${esc(item.quality)}</span>`;
        if (item.size > 0) tags += `<span class="tag sz">${fmtSize(item.size)}</span>`;
        if (item.isDRM) tags += `<span class="tag drm-t">DRM</span>`;
        if (item.source) tags += `<span class="tag src">${esc(item.source)}</span>`;
        if (item.duration > 0) tags += `<span class="tag sz">${fmtDur(item.duration)}</span>`;

        card.innerHTML = `
      <div class="m-icon ${type}">${IC[type] || IC.video}</div>
      <div class="m-info">
        <div class="m-title" title="${escA(item.url)}">${esc(title)}</div>
        <div class="m-meta">${tags}</div>
      </div>
      <div class="m-actions">
        <button class="fmt-pick-btn" title="Download as...">${IC.convert}</button>
        <button class="dl-btn" title="Download">${IC.dl}</button>
      </div>`;

        card.querySelector('.dl-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            downloadItem(item, card.querySelector('.dl-btn'));
        });

        card.querySelector('.fmt-pick-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            openFormatPicker(item);
        });

        return card;
    }

    // ========== Download ==========
    function downloadItem(item, btn) {
        btn.innerHTML = `<div class="spinner" style="width:14px;height:14px;border-width:2px"></div>`;
        const fn = genFilename(item);

        chrome.runtime.sendMessage({
            action: 'downloadMedia',
            data: { url: item.url, filename: fn, pageTitle, format: item.format },
        }, (r) => {
            if (r && r.success) {
                btn.classList.add('done');
                btn.innerHTML = IC.check;
                toast('Download started!', 'success');
            } else {
                btn.innerHTML = IC.dl;
                toast((r && r.error) || 'Download failed', 'error');
            }
        });
    }

    // ========== Format Picker ==========
    function openFormatPicker(item) {
        formatTarget = item;
        formatModal.classList.remove('hidden');
    }

    function closeFormatPicker() {
        formatModal.classList.add('hidden');
        formatTarget = null;
    }

    $('#modalClose').addEventListener('click', closeFormatPicker);
    $('.modal-backdrop').addEventListener('click', closeFormatPicker);

    formatGrid.querySelectorAll('.fmt-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
            if (!formatTarget) return;
            const fmt = btn.dataset.fmt;
            const quality = $('#convertQuality').value;
            const needsConversion = fmt !== (formatTarget.format || '');

            if (needsConversion) {
                toast('Converting to ' + fmt.toUpperCase() + '...', '');
                chrome.runtime.sendMessage({
                    action: 'convertMedia',
                    data: {
                        url: formatTarget.url,
                        outputFormat: fmt,
                        quality,
                        filename: genFilename(formatTarget),
                    },
                }, (r) => {
                    if (r && (r.success || r.message)) {
                        toast('Conversion to ' + fmt.toUpperCase() + ' started', 'success');
                    } else {
                        toast('Conversion failed', 'error');
                    }
                });
            } else {
                chrome.runtime.sendMessage({
                    action: 'downloadMedia',
                    data: {
                        url: formatTarget.url,
                        filename: genFilename({ ...formatTarget, format: fmt }),
                        pageTitle,
                        format: fmt,
                    },
                });
                toast('Download started!', 'success');
            }
            closeFormatPicker();
        });
    });

    // ========== Filters ==========
    $$('.filter-tab').forEach((tab) => {
        tab.addEventListener('click', () => {
            $$('.filter-tab').forEach((t) => t.classList.remove('active'));
            tab.classList.add('active');
            activeFilter = tab.dataset.filter;
            renderMedia();
        });
    });

    // ========== Buttons ==========
    $('#settingsBtn').addEventListener('click', () => {
        chrome.runtime.openOptionsPage();
    });

    $('#refreshBtn').addEventListener('click', () => {
        toast('Rescanning...', '');
        if (currentTabId) {
            chrome.scripting.executeScript({
                target: { tabId: currentTabId },
                files: ['content/detector.js'],
            }).catch(() => { });
        }
        setTimeout(loadMedia, 600);
    });

    $('#downloadAllBtn').addEventListener('click', () => {
        if (allMedia.length === 0) return toast('No media', 'error');
        chrome.runtime.sendMessage({
            action: 'downloadAll',
            data: { tabId: currentTabId, pageTitle },
        }, (r) => {
            if (r && r.success) toast('Downloading ' + r.count + ' file(s)', 'success');
            else toast((r && r.error) || 'Failed', 'error');
        });
    });

    // ========== Helpers ==========
    function showLoading() { loadingState.classList.remove('hidden'); emptyState.classList.add('hidden'); }
    function showEmpty() { loadingState.classList.add('hidden'); emptyState.classList.remove('hidden'); }

    function urlTitle(url) {
        if (!url) return 'Unknown media';
        try {
            const u = new URL(url);
            const seg = u.pathname.split('/').filter(Boolean).pop() || u.hostname;
            let name = decodeURIComponent(seg).replace(/[-_]+/g, ' ').replace(/\.[^.]+$/, '');
            return name.length > 45 ? name.substring(0, 42) + '...' : name || u.hostname;
        } catch (e) { return url.substring(0, 45); }
    }

    function genFilename(item) {
        let name = (pageTitle || 'download').replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/\s+/g, '_').substring(0, 120);
        if (item.quality) name += '_' + item.quality;
        return name + '.' + (item.format || 'mp4');
    }

    function fmtSize(b) {
        if (!b || b <= 0) return '';
        const u = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(b) / Math.log(1024));
        return (b / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + u[i];
    }

    function fmtDur(s) {
        if (!s) return '';
        s = Math.round(s);
        const m = Math.floor(s / 60), sec = s % 60;
        return m + ':' + String(sec).padStart(2, '0');
    }

    function esc(s) { if (!s) return ''; const e = document.createElement('span'); e.textContent = s; return e.innerHTML; }
    function escA(s) { return (s || '').replace(/"/g, '&quot;'); }

    function toast(msg, type) {
        document.querySelectorAll('.toast').forEach((t) => t.remove());
        const t = document.createElement('div');
        t.className = 'toast ' + (type || '');
        t.textContent = msg;
        document.body.appendChild(t);
        requestAnimationFrame(() => t.classList.add('show'));
        setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 2500);
    }

    // ========== Init ==========
    loadMedia();
})();

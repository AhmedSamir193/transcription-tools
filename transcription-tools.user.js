// ==UserScript==
// @name         Transcription Tools - scroll + tags + spacing check + writing rules + tag check + time calc + full review + live review
// @namespace    annotation-tools
// @version      17
// @match        *://*/*
// @grant        none
// @updateURL    https://raw.githubusercontent.com/AhmedSamir193/transcription-tools/main/transcription-tools.user.js
// @downloadURL  https://raw.githubusercontent.com/AhmedSamir193/transcription-tools/main/transcription-tools.user.js
// ==/UserScript==

(function() {
    'use strict';

    // Load the "Cairo" font (a clean, modern Arabic font) once so all the tool's UI (panels, tooltips, buttons) uses it
    (function loadCairoFont() {
        if (document.getElementById('tx-cairo-font-link')) return;
        const link = document.createElement('link');
        link.id = 'tx-cairo-font-link';
        link.rel = 'stylesheet';
        link.href = 'https://fonts.googleapis.com/css2?family=Cairo:wght@400;500;600;700;800&display=swap';
        document.head.appendChild(link);
    })();

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // ==================== Helper functions: ignore diacritics/French elision ====================
    const FRENCH_LATIN_RANGE = 'À-ÖØ-öø-ÿ';
    const latinTokenRegex = new RegExp('[A-Za-z' + FRENCH_LATIN_RANGE + ']+(?:\'[A-Za-z' + FRENCH_LATIN_RANGE + ']+)*', 'g');

    function countPureEnglishWords(raw) {
        const tokens = raw.match(latinTokenRegex) || [];
        return tokens.filter(t => /^[A-Za-z]+$/.test(t));
    }

    function stripFrenchElisions(raw) {
        return raw.replace(new RegExp('([A-Za-z' + FRENCH_LATIN_RANGE + '])\'([A-Za-z' + FRENCH_LATIN_RANGE + '])', 'g'), '$1$2');
    }

    // ==================== Taming the site watermark (repeated account number) - v20.0 ====================
    // The site stamps a number (like the account ID) repeated as a watermark across the page, which is useful for security/tracking
    // so we won't remove it, but its current look (almost the same contrast as normal text) strains the eyes and visually clashes with the content.
    // Here we auto-detect these watermark elements (long repeated number text scattered oddly across the page) and make them
    // very faint and clearly background (not normal text), without affecting anything else on the page.
    function ensureWatermarkStyles() {
        if (document.getElementById('tx-watermark-style')) return;
        const style = document.createElement('style');
        style.id = 'tx-watermark-style';
        style.textContent = `
            .tx-watermark-tamed {
                opacity: 0.05 !important;
                color: rgba(148,163,184,0.5) !important;
                filter: blur(0.4px) saturate(60%) !important;
                text-shadow: none !important;
                mix-blend-mode: overlay !important;
                pointer-events: none !important;
                user-select: none !important;
            }
        `;
        document.head.appendChild(style);
    }

    // Looks for any text element that's a long repeated number (8+ digits) - that's usually the watermark's shape
    // (an account ID repeated dozens of times on the page), without touching any normal number inside the table or content.
    const WATERMARK_NUMERIC_PATTERN = /^\d{8,}$/;
    function tameSiteWatermark() {
        if (!document.body) return;
        ensureWatermarkStyles();
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
        const candidateParents = new Map(); // نص العلامة -> عدد التكرار
        const nodesByText = new Map();
        let node;
        while ((node = walker.nextNode())) {
            const text = (node.nodeValue || '').trim();
            if (!text || !WATERMARK_NUMERIC_PATTERN.test(text)) continue;
            const el = node.parentElement;
            if (!el || el.closest('#tx-floating-menu, .tx-panel-overlay, #tx-timer-widget, .tx-help-btn, textarea, input')) continue;
            candidateParents.set(text, (candidateParents.get(text) || 0) + 1);
            if (!nodesByText.has(text)) nodesByText.set(text, []);
            nodesByText.get(text).push(el);
        }
        // We only treat it as a watermark if the same number repeats a lot on the page (not a normal number that happened to appear once)
        candidateParents.forEach((count, text) => {
            if (count < 3) return;
            nodesByText.get(text).forEach(el => {
                if (!el.classList.contains('tx-watermark-tamed')) el.classList.add('tx-watermark-tamed');
            });
        });
    }

    // Instead of scanning the whole page every 2 seconds regardless of whether anything changed, we use a MutationObserver
    // like the rest of the script's features: it catches any page change (new task, scroll, etc.) instantly, and we do simple debouncing
    // (150ms) so if several changes happen back to back, we run one check instead of a check per change.
    // We also exclude changes coming from the tool's own UI (like the timer counter ticking every second, or
    // toasts) since those can never bring in a new watermark, so there's no need to run a full page scan because of them.
    let watermarkScanQueued = false;
    function isMutationFromOwnUI(mutation) {
        let node = mutation.target;
        if (node && node.nodeType === Node.TEXT_NODE) node = node.parentElement;
        return !!(node && node.closest && node.closest('[id^="tx-"], [class*="tx-"]'));
    }
    function queueWatermarkScan(mutations) {
        if (watermarkScanQueued) return;
        if (mutations.every(isMutationFromOwnUI)) return;
        watermarkScanQueued = true;
        setTimeout(() => { watermarkScanQueued = false; tameSiteWatermark(); }, 150);
    }

    function startWatermarkObserver() {
        if (!document.body) { setTimeout(startWatermarkObserver, 200); return; }
        tameSiteWatermark();
        const observer = new MutationObserver(queueWatermarkScan);
        observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    }
    startWatermarkObserver();

    // ==================== Results UI - dark glassmorphism (v10.0) ====================
    function ensurePanelStyles() {
        if (document.getElementById('tx-panel-style')) return;
        const style = document.createElement('style');
        style.id = 'tx-panel-style';
        style.textContent = `
            .tx-panel-overlay {
                position: fixed; inset: 0; background: rgba(6,6,10,0.5);
                backdrop-filter: blur(6px); z-index: 200000;
                display: flex; align-items: center; justify-content: center;
                animation: tx-fade-in 0.18s ease;
            }
            @keyframes tx-fade-in { from { opacity: 0; } to { opacity: 1; } }
            @keyframes tx-pop-in { from { transform: scale(0.94) translateY(10px); opacity: 0; } to { transform: scale(1) translateY(0); opacity: 1; } }
            .tx-panel-box {
                width: 640px; max-width: 92vw; max-height: 82vh;
                background: linear-gradient(165deg, rgba(32,32,42,0.78), rgba(14,14,19,0.88));
                backdrop-filter: blur(26px) saturate(180%);
                -webkit-backdrop-filter: blur(26px) saturate(180%);
                border: 1px solid rgba(255,255,255,0.12);
                border-radius: 20px;
                box-shadow: 0 20px 60px rgba(0,0,0,0.6), 0 0 40px rgba(124,58,237,0.14), inset 0 1px 0 rgba(255,255,255,0.08);
                display: flex; flex-direction: column;
                overflow: hidden;
                font-family: 'Cairo', 'Segoe UI', Tahoma, sans-serif;
                direction: rtl;
                animation: tx-pop-in 0.22s cubic-bezier(0.2,0.8,0.2,1);
                position: relative;
            }
            .tx-panel-box::before {
                content: '';
                position: absolute; top: 0; left: 14%; right: 14%; height: 1px;
                background: linear-gradient(90deg, transparent, rgba(255,255,255,0.5), transparent);
                pointer-events: none;
            }
            .tx-panel-header {
                display: flex; align-items: center; justify-content: space-between;
                padding: 14px 16px; border-bottom: 1px solid rgba(255,255,255,0.06);
            }
            .tx-panel-title { color: #fff; font-size: 14px; font-weight: 700; display: flex; align-items: center; gap: 8px; }
            .tx-panel-badge {
                background: rgba(255,255,255,0.1); color: #cbd5e1; font-size: 11px;
                padding: 2px 9px; border-radius: 20px; font-weight: 700;
            }
            .tx-panel-badge.pulse { background: rgba(239,68,68,0.22); color: #fca5a5; animation: tx-badge-pulse 1.8s infinite; }
            @keyframes tx-badge-pulse {
                0% { box-shadow: 0 0 0 0 rgba(239,68,68,0.45); }
                70% { box-shadow: 0 0 0 7px rgba(239,68,68,0); }
                100% { box-shadow: 0 0 0 0 rgba(239,68,68,0); }
            }
            .tx-panel-actions { display: flex; align-items: center; gap: 8px; }
            .tx-panel-btn {
                border: none; border-radius: 10px; padding: 7px 13px; font-size: 11.5px; font-weight: 700;
                cursor: pointer; transition: all 0.15s ease; color: #fff;
            }
            .tx-panel-btn.copy {
                background: linear-gradient(135deg, rgba(124,58,237,0.55), rgba(99,102,241,0.4));
                border: 1px solid rgba(255,255,255,0.14);
            }
            .tx-panel-btn.copy:hover { filter: brightness(1.2); box-shadow: 0 0 14px rgba(124,58,237,0.35); }
            .tx-panel-btn.fix { background: linear-gradient(135deg, rgba(16,185,129,0.6), rgba(5,150,105,0.45)); border: 1px solid rgba(255,255,255,0.14); }
            .tx-panel-btn.fix:hover { filter: brightness(1.15); box-shadow: 0 0 14px rgba(16,185,129,0.35); }
            .tx-panel-btn:disabled { opacity: 0.55; cursor: not-allowed; filter: none !important; box-shadow: none !important; }
            .tx-panel-btn.close-icon {
                width: 28px; height: 28px; padding: 0; border-radius: 50%;
                background: rgba(255,255,255,0.06); color: #cbd5e1; font-size: 13px;
                display: flex; align-items: center; justify-content: center;
                border: 1px solid rgba(255,255,255,0.1);
            }
            .tx-panel-btn.close-icon:hover { background: rgba(239,68,68,0.18); color: #f87171; border-color: rgba(239,68,68,0.4); }
            .tx-panel-body { padding: 12px 16px 16px; overflow-y: auto; flex: 1; scrollbar-width: thin; scrollbar-color: rgba(167,139,250,0.4) transparent; }
            .tx-panel-body:focus, .tx-panel-body:focus-visible { outline: none !important; box-shadow: none !important; }
            .tx-panel-empty {
                color: #34d399; font-size: 13px; text-align: center; padding: 30px 18px; font-weight: 700;
                background: rgba(16,185,129,0.08); border: 1px solid rgba(16,185,129,0.2); border-radius: 16px;
            }
            .tx-panel-heading {
                color: #fbbf24; font-size: 12.5px; font-weight: 700; margin: 14px 0 8px;
                display: flex; align-items: center; gap: 6px;
            }
            .tx-panel-heading:first-child { margin-top: 0; }
            .tx-panel-item {
                display: flex; align-items: center; justify-content: space-between; gap: 8px;
                background: rgba(255,255,255,0.035);
                border-right: 3px solid rgba(148,163,184,0.4);
                border-radius: 10px; padding: 8px 10px; margin-bottom: 6px;
                color: #e2e8f0; font-size: 12.5px; line-height: 1.6;
                transition: all 0.15s ease;
            }
            .tx-panel-item.warn { border-right-color: #ef4444; background: rgba(239,68,68,0.07); }
            .tx-panel-item.info { border-right-color: #38bdf8; background: rgba(56,189,248,0.07); }
            .tx-panel-item.ok { border-right-color: #22c55e; background: rgba(34,197,94,0.07); }
            .tx-panel-item:hover { background: rgba(255,255,255,0.065); }
            .tx-panel-item.jumpable { cursor: pointer; }
            .tx-panel-item.jumpable:hover { border-right-color: #a78bfa; box-shadow: inset 0 0 0 1px rgba(167,139,250,0.35); }
            .tx-panel-item-text { flex: 1; }
            .tx-item-copy {
                opacity: 0; flex-shrink: 0; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.14);
                border-radius: 7px; color: #e2e8f0; font-size: 10.5px; padding: 3px 7px; cursor: pointer; transition: all 0.15s ease;
            }
            .tx-panel-item:hover .tx-item-copy { opacity: 1; }
            .tx-item-copy:hover { background: rgba(124,58,237,0.4); border-color: rgba(167,139,250,0.55); }
            .tx-panel-num {
                display: inline-block; background: rgba(255,255,255,0.12); color: #fff;
                padding: 1px 7px; border-radius: 6px; font-weight: 700; font-size: 11.5px;
            }
            .tx-panel-body::-webkit-scrollbar { width: 6px; }
            .tx-panel-body::-webkit-scrollbar-track { background: transparent; }
            .tx-panel-body::-webkit-scrollbar-thumb { background: rgba(167,139,250,0.35); border-radius: 10px; }
            .tx-panel-body::-webkit-scrollbar-thumb:hover { background: rgba(167,139,250,0.55); }

            /* توست بأسلوب Dynamic Island */
            .tx-panel-toast {
                position: fixed; bottom: 30px; left: 50%; transform: translateX(-50%);
                display: flex; align-items: center; gap: 10px;
                background: linear-gradient(160deg, rgba(20,20,26,0.86), rgba(10,10,14,0.93));
                backdrop-filter: blur(20px) saturate(180%);
                -webkit-backdrop-filter: blur(20px) saturate(180%);
                border: 1px solid rgba(16,185,129,0.4);
                border-radius: 50px; padding: 11px 20px 11px 16px;
                z-index: 300000; overflow: hidden;
                box-shadow: 0 12px 30px rgba(0,0,0,0.5), 0 0 25px rgba(16,185,129,0.22), inset 0 1px 0 rgba(255,255,255,0.08);
                direction: rtl; font-family: 'Cairo', 'Segoe UI', Tahoma, sans-serif;
                animation: tx-toast-spring 0.4s cubic-bezier(0.34,1.56,0.64,1);
            }
            .tx-panel-toast.error { border-color: rgba(239,68,68,0.45); box-shadow: 0 12px 30px rgba(0,0,0,0.5), 0 0 25px rgba(239,68,68,0.22), inset 0 1px 0 rgba(255,255,255,0.08); }
            @keyframes tx-toast-spring { from { transform: translate(-50%,26px) scale(0.92); opacity: 0; } to { transform: translate(-50%,0) scale(1); opacity: 1; } }
            .tx-toast-icon {
                width: 22px; height: 22px; border-radius: 50%; flex-shrink: 0;
                display: flex; align-items: center; justify-content: center; font-size: 12px;
                background: rgba(16,185,129,0.16); color: #10B981;
            }
            .tx-panel-toast.error .tx-toast-icon { background: rgba(239,68,68,0.16); color: #f87171; }
            .tx-toast-text-wrap { display: flex; flex-direction: column; line-height: 1.35; }
            .tx-toast-text-main { color: #fff; font-weight: 700; font-size: 12.5px; }
            .tx-toast-num { color: #10B981; font-weight: 800; }
            .tx-panel-toast.error .tx-toast-num { color: #f87171; }
            .tx-toast-text-sub { color: rgba(255,255,255,0.55); font-size: 0.85em; margin-top: 1px; }
            .tx-toast-progress {
                position: absolute; bottom: 0; right: 0; height: 2px; width: 100%;
                background: #10B981; animation: tx-toast-shrink 2.6s linear forwards;
            }
            .tx-panel-toast.error .tx-toast-progress { background: #f87171; }
            @keyframes tx-toast-shrink { from { width: 100%; } to { width: 0%; } }
        `;
        document.head.appendChild(style);
    }

    function escapeHtml(str) {
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function highlightNumbers(text) {
        return text.replace(/\d+(\.\d+)?/g, m => '<span class="tx-panel-num">' + m + '</span>');
    }

    function classifyItem(text) {
        if (/✅/.test(text)) return 'ok';
        if (/(🚫|❌|⏱️|🔗|🔢|✏️|٪|📐|#️⃣|🔤|📏|⚪)/.test(text)) return 'warn';
        return 'info';
    }

    // ==================== Segment highlight - soft glowing outline (v12.0) ====================
    function ensureRowHighlightStyles() {
        if (document.getElementById('tx-row-highlight-style')) return;
        const style = document.createElement('style');
        style.id = 'tx-row-highlight-style';
        style.textContent = `
            tr.tx-row-error, tr.tx-row-ok, tr.tx-row-warn {
                outline-offset: -1px;
                border-radius: 8px;
                transition: outline-color 0.25s ease, background-color 0.3s ease;
            }
            tr.tx-row-error {
                outline: 1.5px solid rgba(239, 68, 68, 0.55) !important;
                background-color: rgba(239, 68, 68, 0.045) !important;
            }
            tr.tx-row-warn {
                outline: 1.5px solid rgba(234, 179, 8, 0.55) !important;
                background-color: rgba(234, 179, 8, 0.045) !important;
            }
            tr.tx-row-ok {
                outline: 1.5px solid rgba(34, 197, 94, 0.55) !important;
                background-color: rgba(34, 197, 94, 0.045) !important;
                animation: tx-row-ok-fade 4s ease forwards;
            }
            @keyframes tx-row-ok-fade {
                0% { outline-color: rgba(34,197,94,0.75); background-color: rgba(34,197,94,0.07); }
                100% { outline-color: rgba(34,197,94,0.2); background-color: rgba(34,197,94,0.01); }
            }

            .tx-save-dot {
                display: inline-block; width: 7px; height: 7px; border-radius: 50%;
                margin-inline-start: 6px; vertical-align: middle;
                background: #64748b;
                transition: background 0.25s ease, box-shadow 0.25s ease;
            }
            .tx-save-dot.tx-dot-typing {
                background: #eab308; box-shadow: 0 0 6px rgba(234,179,8,0.7);
                animation: tx-dot-pulse 1s ease-in-out infinite;
            }
            .tx-save-dot.tx-dot-saved {
                background: #22c55e; box-shadow: 0 0 6px rgba(34,197,94,0.6);
            }
            @keyframes tx-dot-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
        `;
        document.head.appendChild(style);
    }
    ensureRowHighlightStyles();

    function setRowStatus(row, status) {
        row.style.outline = '';
        row.classList.remove('tx-row-error', 'tx-row-warn', 'tx-row-ok');
        if (status === 'error') row.classList.add('tx-row-error');
        else if (status === 'warn') row.classList.add('tx-row-warn');
        else if (status === 'ok') row.classList.add('tx-row-ok');
    }

    // ==================== Auto-save indicator - Smart Auto-Save Indicator (v12.0) ====================
    function getOrCreateSaveDot(row) {
        const numberCell = row.querySelector('.number');
        if (!numberCell) return null;
        let dot = numberCell.querySelector('.tx-save-dot');
        if (!dot) {
            dot = document.createElement('span');
            dot.className = 'tx-save-dot';
            numberCell.appendChild(dot);
        }
        return dot;
    }

    function setSaveDotState(row, state) {
        const dot = getOrCreateSaveDot(row);
        if (!dot) return;
        dot.classList.remove('tx-dot-typing', 'tx-dot-saved');
        if (state === 'typing') dot.classList.add('tx-dot-typing');
        else if (state === 'saved') dot.classList.add('tx-dot-saved');
    }

    function showToast(message, isError, durationMs) {
        const duration = durationMs || 2600;
        ensurePanelStyles();
        const toast = document.createElement('div');
        toast.className = 'tx-panel-toast' + (isError ? ' error' : '');

        const icon = document.createElement('span');
        icon.className = 'tx-toast-icon';
        icon.textContent = isError ? '✕' : '✓';

        const textWrap = document.createElement('div');
        textWrap.className = 'tx-toast-text-wrap';

        const dashSplitIndex = message.indexOf(' - ');
        const mainText = dashSplitIndex === -1 ? message : message.slice(0, dashSplitIndex);
        const subText = dashSplitIndex === -1 ? '' : message.slice(dashSplitIndex + 3);

        const mainDiv = document.createElement('div');
        mainDiv.className = 'tx-toast-text-main';
        mainDiv.innerHTML = escapeHtml(mainText).replace(/\d+(\.\d+)?/g, m => '<span class="tx-toast-num">' + m + '</span>');
        textWrap.appendChild(mainDiv);

        if (subText) {
            const subDiv = document.createElement('div');
            subDiv.className = 'tx-toast-text-sub';
            subDiv.textContent = subText;
            textWrap.appendChild(subDiv);
        }

        const progress = document.createElement('div');
        progress.className = 'tx-toast-progress';
        progress.style.animationDuration = (duration / 1000) + 's';

        toast.appendChild(icon);
        toast.appendChild(textWrap);
        toast.appendChild(progress);
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), duration);
    }

    function extractSerialFromString(str) {
        if (!str) return null;
        const m = String(str).match(/سيجمنت\s+(\d+)/);
        return m ? parseInt(m[1], 10) : null;
    }

    // ==================== Glass confirm dialog (replacement for the ugly window.confirm) (v15.0) ====================
    function ensureConfirmStyles() {
        if (document.getElementById('tx-confirm-style')) return;
        const style = document.createElement('style');
        style.id = 'tx-confirm-style';
        style.textContent = `
            .tx-confirm-box {
                width: 420px; max-width: 90vw;
                background: linear-gradient(165deg, rgba(32,32,42,0.85), rgba(14,14,19,0.92));
                backdrop-filter: blur(26px) saturate(180%);
                -webkit-backdrop-filter: blur(26px) saturate(180%);
                border: 1px solid rgba(255,255,255,0.14);
                border-radius: 20px;
                box-shadow: 0 20px 60px rgba(0,0,0,0.6), 0 0 40px rgba(124,58,237,0.16), inset 0 1px 0 rgba(255,255,255,0.08);
                padding: 22px 22px 18px;
                font-family: 'Cairo', 'Segoe UI', Tahoma, sans-serif;
                direction: rtl; color: #e2e8f0;
                animation: tx-pop-in 0.2s cubic-bezier(0.2,0.8,0.2,1);
                position: relative;
            }
            .tx-confirm-box::before {
                content: '';
                position: absolute; top: 0; left: 14%; right: 14%; height: 1px;
                background: linear-gradient(90deg, transparent, rgba(255,255,255,0.5), transparent);
                pointer-events: none;
            }
            .tx-confirm-msg { font-size: 13.5px; line-height: 1.9; white-space: pre-line; margin-bottom: 20px; }
            .tx-confirm-actions { display: flex; justify-content: flex-end; gap: 10px; }
            .tx-confirm-btn { border: none; border-radius: 10px; padding: 9px 20px; font-size: 12.5px; font-weight: 700; cursor: pointer; transition: all 0.15s ease; color: #fff; }
            .tx-confirm-btn.ok { background: linear-gradient(135deg, rgba(16,185,129,0.65), rgba(5,150,105,0.5)); border: 1px solid rgba(255,255,255,0.14); }
            .tx-confirm-btn.ok:hover { filter: brightness(1.15); box-shadow: 0 0 14px rgba(16,185,129,0.35); }
            .tx-confirm-btn.cancel { background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.14); }
            .tx-confirm-btn.cancel:hover { background: rgba(255,255,255,0.16); }
        `;
        document.head.appendChild(style);
    }

    // Returns a Promise<boolean> - true if confirm was pressed, false if cancel/outside click/Escape
    function showGlassConfirm(message, options) {
        ensurePanelStyles();
        ensureConfirmStyles();
        return new Promise((resolve) => {
            const overlay = document.createElement('div');
            overlay.className = 'tx-panel-overlay';

            const box = document.createElement('div');
            box.className = 'tx-confirm-box';

            const msg = document.createElement('div');
            msg.className = 'tx-confirm-msg';
            msg.textContent = message;

            const actions = document.createElement('div');
            actions.className = 'tx-confirm-actions';

            const cancelBtn = document.createElement('button');
            cancelBtn.className = 'tx-confirm-btn cancel';
            cancelBtn.textContent = (options && options.cancelLabel) || 'إلغاء';

            const okBtn = document.createElement('button');
            okBtn.className = 'tx-confirm-btn ok';
            okBtn.textContent = (options && options.okLabel) || 'تأكيد';

            function cleanup(result) {
                overlay.remove();
                document.removeEventListener('keydown', escHandler);
                resolve(result);
            }
            function escHandler(e) { if (e.key === 'Escape') cleanup(false); }

            cancelBtn.onclick = () => cleanup(false);
            okBtn.onclick = () => cleanup(true);
            overlay.onclick = (e) => { if (e.target === overlay) cleanup(false); };
            document.addEventListener('keydown', escHandler);

            actions.appendChild(cancelBtn);
            actions.appendChild(okBtn);
            box.appendChild(msg);
            box.appendChild(actions);
            overlay.appendChild(box);
            document.body.appendChild(overlay);
            okBtn.focus();
        });
    }

    function buildItemElement(item, rawLinesArr, serial, closeOverlayFn) {
        const itemText = typeof item === 'string' ? item : item.text;
        const itemType = typeof item === 'string' ? classifyItem(itemText) : (item.type || classifyItem(itemText));
        const div = document.createElement('div');
        div.className = 'tx-panel-item ' + itemType;

        const textSpan = document.createElement('span');
        textSpan.className = 'tx-panel-item-text';
        textSpan.innerHTML = highlightNumbers(escapeHtml(itemText));

        const copyItemBtn = document.createElement('button');
        copyItemBtn.className = 'tx-item-copy';
        copyItemBtn.textContent = '📋 نسخ';
        copyItemBtn.title = 'نسخ السطر ده بس';
        copyItemBtn.onclick = (e) => {
            e.stopPropagation();
            const ok = fallbackCopy(itemText);
            showToast(ok ? 'تم نسخ السطر ✅' : 'فشل النسخ ❌', !ok);
        };

        if (typeof serial === 'number' && !isNaN(serial)) {
            div.classList.add('jumpable');
            div.title = 'دوس عشان تروح للسيجمنت ده وتشغّله في المشغل';
            div.onclick = () => {
                if (closeOverlayFn) closeOverlayFn();
                jumpToSegment(serial);
            };
        }

        div.appendChild(textSpan);
        div.appendChild(copyItemBtn);
        if (rawLinesArr) rawLinesArr.push(itemText);
        return div;
    }

    // sections: [{ heading: 'heading text' or null, items: ['text' or {text, type}] }]
    function showResultsPanel(title, sections, emptyMessage, extraAction) {
        ensurePanelStyles();

        const totalItems = sections.reduce((sum, s) => sum + s.items.length, 0);

        const overlay = document.createElement('div');
        overlay.className = 'tx-panel-overlay';
        overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

        const box = document.createElement('div');
        box.className = 'tx-panel-box';

        const header = document.createElement('div');
        header.className = 'tx-panel-header';

        const titleDiv = document.createElement('div');
        titleDiv.className = 'tx-panel-title';
        titleDiv.innerHTML = title + (totalItems > 0 ? ' <span class="tx-panel-badge pulse">' + totalItems + '</span>' : '');

        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'tx-panel-actions';

        let fixBtn = null;
        if (extraAction && totalItems > 0) {
            fixBtn = document.createElement('button');
            fixBtn.className = 'tx-panel-btn fix';
            fixBtn.textContent = extraAction.label || '🔧 تصليح تلقائي';
            actionsDiv.appendChild(fixBtn);
        }

        const copyBtn = document.createElement('button');
        copyBtn.className = 'tx-panel-btn copy';
        copyBtn.textContent = '📋 نسخ';
        actionsDiv.appendChild(copyBtn);

        const closeBtn = document.createElement('button');
        closeBtn.className = 'tx-panel-btn close-icon';
        closeBtn.textContent = '✕';
        actionsDiv.appendChild(closeBtn);

        header.appendChild(titleDiv);
        header.appendChild(actionsDiv);

        const body = document.createElement('div');
        body.className = 'tx-panel-body';

        const rawLines = [];

        if (totalItems === 0) {
            body.innerHTML = '<div class="tx-panel-empty">✅ ' + escapeHtml(emptyMessage || 'تمام — مفيش أي مشاكل') + '</div>';
        } else {
            sections.forEach(sec => {
                if (sec.heading) {
                    const h = document.createElement('div');
                    h.className = 'tx-panel-heading';
                    h.textContent = sec.heading;
                    body.appendChild(h);
                    rawLines.push('━━━ ' + sec.heading + ' ━━━');
                }
                const headingSerial = extractSerialFromString(sec.heading);
                sec.items.forEach(item => {
                    const itemTextForSerial = typeof item === 'string' ? item : item.text;
                    const explicitSerial = (typeof item === 'object' && typeof item.serial === 'number') ? item.serial : null;
                    const serial = explicitSerial !== null ? explicitSerial : (extractSerialFromString(itemTextForSerial) ?? headingSerial);
                    body.appendChild(buildItemElement(item, rawLines, serial, () => overlay.remove()));
                });
            });
        }

        box.appendChild(header);
        box.appendChild(body);
        overlay.appendChild(box);
        document.body.appendChild(overlay);

        const rawText = rawLines.length > 0 ? rawLines.join('\n') : (emptyMessage || 'تمام — مفيش أي مشاكل');

        closeBtn.onclick = () => overlay.remove();
        copyBtn.onclick = () => {
            const ok = fallbackCopy(rawText);
            showToast(ok ? 'تم نسخ النتائج ✅' : 'فشل النسخ ❌', !ok);
        };
        if (fixBtn) {
            fixBtn.onclick = async () => {
                if (extraAction.confirmMessage) {
                    const ok = await showGlassConfirm(extraAction.confirmMessage);
                    if (!ok) return;
                }
                fixBtn.disabled = true;
                fixBtn.textContent = extraAction.loadingLabel || '⏳ جاري التصليح...';
                try {
                    const count = await runBatchOperation('fix', () => extraAction.onClick());
                    overlay.remove();
                    const msg = typeof extraAction.successMessage === 'function'
                        ? extraAction.successMessage(count)
                        : ('تم تصليح ' + (count || 0) + ' سيجمنت ✅ - جرب تعمل الفحص تاني للتأكيد');
                    showToast(msg);
                } catch (err) {
                    console.error('[AutoFix] خطأ:', err);
                    fixBtn.disabled = false;
                    fixBtn.textContent = extraAction.label || '🔧 تصليح تلقائي';
                    showToast('حصل خطأ أثناء التصليح ❌', true);
                }
            };
        }

        function escHandler(e) {
            if (e.key === 'Escape') {
                overlay.remove();
                document.removeEventListener('keydown', escHandler);
            }
        }
        document.addEventListener('keydown', escHandler);
    }

    // Goes through the segments whose numbers are in serialSet (across all pages/scroll) and applies fixFn to their text
    async function fixSegmentsBySerial(serialSet, fixFn) {
        const remaining = new Set(serialSet);
        let fixedCount = 0;

        function tryFixVisible() {
            const rows = document.querySelectorAll('#changyuliu_table > tr');
            rows.forEach(row => {
                const serialCell = row.querySelector('.number');
                const textarea = row.querySelector('.textContent .mark-content-textarea');
                if (!serialCell || !textarea) return;

                const serial = parseInt(serialCell.textContent.trim(), 10);
                if (!remaining.has(serial)) return;

                const raw = textarea.value !== undefined ? textarea.value : textarea.textContent;
                const fixed = fixFn(raw || '', serial);
                if (fixed !== raw) {
                    setNativeTextareaValue(textarea, fixed);
                    fixedCount++;
                }
                remaining.delete(serial);
            });
        }

        // We check what's currently visible first, before any navigation - covers the case where no navigation or scroll is needed (all rows already visible)
        tryFixVisible();

        const navButtons = findNavButtons();
        if (navButtons.length > 0) {
            for (const navBtn of navButtons) {
                if (remaining.size === 0) break;
                navBtn.click();
                await sleep(500);
                tryFixVisible();
            }
        } else if (remaining.size > 0) {
            const container = document.querySelector('#changyuliu_table')?.closest('[style*="overflow"]');
            if (container) {
                container.scrollTop = 0;
                await sleep(300);
                let stableCount = 0;
                let prevRemaining = remaining.size;

                while (stableCount < 2 && remaining.size > 0) {
                    tryFixVisible();
                    container.scrollTop += container.clientHeight * 0.6;
                    await sleep(400);

                    if (remaining.size === prevRemaining) stableCount++;
                    else stableCount = 0;
                    prevRemaining = remaining.size;
                }
            }
        }

        return fixedCount;
    }

    // ==================== "Full review" panel — iOS-style segmented tabs (v10.0) ====================
    function ensureReviewStyles() {
        if (document.getElementById('tx-review-style')) return;
        const style = document.createElement('style');
        style.id = 'tx-review-style';
        style.textContent = `
            .tx-review-tabbar {
                display: flex; flex-wrap: wrap; gap: 6px; padding: 6px;
                margin: 12px 16px 0;
                background: rgba(255,255,255,0.04);
                border-radius: 14px;
            }
            .tx-review-tab {
                background: transparent; color: #94a3b8; border: none;
                padding: 8px 13px; border-radius: 10px; font-size: 11.5px; font-weight: 700;
                cursor: pointer; white-space: nowrap; transition: all 0.15s ease;
                font-family: 'Cairo', 'Segoe UI', Tahoma, sans-serif;
                flex: 0 0 auto;
            }
            .tx-review-tab:hover { color: #e2e8f0; }
            .tx-review-tab.active {
                background: linear-gradient(135deg, rgba(124,58,237,0.55), rgba(20,20,26,0.65));
                color: #fff;
                box-shadow: inset 0 0 0 1px rgba(167,139,250,0.4), 0 0 12px rgba(124,58,237,0.3);
            }
            .tx-review-tab-badge {
                background: #ef4444; color: #fff; border-radius: 20px;
                padding: 1px 7px; font-size: 10.5px; margin-inline-start: 4px; font-weight: 700;
            }
            .tx-review-tab.active .tx-review-tab-badge { animation: tx-badge-pulse 1.8s infinite; }
        `;
        document.head.appendChild(style);
    }

    // tabs: [{ id, label, sections, emptyMessage, fixAction, excludeFromTotal }]
    function showReviewPanel(tabs) {
        ensurePanelStyles();
        ensureReviewStyles();

        let activeTabId = tabs[0].id;
        const totalAll = tabs.reduce((sum, t) => sum + (t.excludeFromTotal ? 0 : t.sections.reduce((s2, sec) => s2 + sec.items.length, 0)), 0);

        const overlay = document.createElement('div');
        overlay.className = 'tx-panel-overlay';
        overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

        const box = document.createElement('div');
        box.className = 'tx-panel-box';
        box.style.width = '700px';

        const header = document.createElement('div');
        header.className = 'tx-panel-header';

        const titleDiv = document.createElement('div');
        titleDiv.className = 'tx-panel-title';
        titleDiv.innerHTML = '🚀 المراجعة الشاملة' + (totalAll > 0 ? ' <span class="tx-panel-badge pulse">' + totalAll + '</span>' : '');

        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'tx-panel-actions';

        let fixAllBtn = null;
        if (totalAll > 0 && tabs.some(t => typeof t.fixAction === 'function')) {
            fixAllBtn = document.createElement('button');
            fixAllBtn.className = 'tx-panel-btn fix';
            fixAllBtn.textContent = '🔧 تصليح الكل';
            actionsDiv.appendChild(fixAllBtn);
        }

        const copyBtn = document.createElement('button');
        copyBtn.className = 'tx-panel-btn copy';
        copyBtn.textContent = '📋 نسخ الكل';
        actionsDiv.appendChild(copyBtn);

        const closeBtn = document.createElement('button');
        closeBtn.className = 'tx-panel-btn close-icon';
        closeBtn.textContent = '✕';
        actionsDiv.appendChild(closeBtn);

        header.appendChild(titleDiv);
        header.appendChild(actionsDiv);

        const tabBar = document.createElement('div');
        tabBar.className = 'tx-review-tabbar';
        const tabButtons = {};

        const body = document.createElement('div');
        body.className = 'tx-panel-body';

        function renderActiveTab() {
            Object.keys(tabButtons).forEach(id => tabButtons[id].classList.toggle('active', id === activeTabId));
            body.innerHTML = '';
            const tab = tabs.find(t => t.id === activeTabId);
            const count = tab.sections.reduce((s, sec) => s + sec.items.length, 0);

            if (count === 0) {
                body.innerHTML = '<div class="tx-panel-empty">✅ ' + escapeHtml(tab.emptyMessage || 'مفيش أي مشاكل') + '</div>';
                return;
            }

            tab.sections.forEach(sec => {
                if (sec.heading) {
                    const h = document.createElement('div');
                    h.className = 'tx-panel-heading';
                    h.textContent = sec.heading;
                    body.appendChild(h);
                }
                const headingSerial = extractSerialFromString(sec.heading);
                sec.items.forEach(item => {
                    const itemTextForSerial = typeof item === 'string' ? item : item.text;
                    const explicitSerial = (typeof item === 'object' && typeof item.serial === 'number') ? item.serial : null;
                    const serial = explicitSerial !== null ? explicitSerial : (extractSerialFromString(itemTextForSerial) ?? headingSerial);
                    body.appendChild(buildItemElement(item, null, serial, () => overlay.remove()));
                });
            });
        }

        tabs.forEach(tab => {
            const count = tab.sections.reduce((s, sec) => s + sec.items.length, 0);
            const tb = document.createElement('button');
            tb.className = 'tx-review-tab' + (tab.id === activeTabId ? ' active' : '');
            tb.innerHTML = tab.label + (count > 0 && !tab.excludeFromTotal ? ' <span class="tx-review-tab-badge">' + count + '</span>' : '');
            tb.onclick = () => { activeTabId = tab.id; renderActiveTab(); };
            tabBar.appendChild(tb);
            tabButtons[tab.id] = tb;
        });

        renderActiveTab();

        box.appendChild(header);
        box.appendChild(tabBar);
        box.appendChild(body);
        overlay.appendChild(box);
        document.body.appendChild(overlay);

        closeBtn.onclick = () => overlay.remove();
        copyBtn.onclick = () => {
            const lines = [];
            tabs.forEach(tab => {
                lines.push('==== ' + tab.label + ' ====');
                if (tab.sections.length === 0) {
                    lines.push(tab.emptyMessage || 'مفيش أي مشاكل');
                } else {
                    tab.sections.forEach(sec => {
                        if (sec.heading) lines.push('━━━ ' + sec.heading + ' ━━━');
                        sec.items.forEach(item => lines.push(typeof item === 'string' ? item : item.text));
                    });
                }
                lines.push('');
            });
            const ok = fallbackCopy(lines.join('\n'));
            showToast(ok ? 'تم نسخ كل النتائج ✅' : 'فشل النسخ ❌', !ok);
        };

        if (fixAllBtn) {
            fixAllBtn.onclick = async () => {
                fixAllBtn.disabled = true;
                fixAllBtn.textContent = '⏳ جاري تصليح كل حاجة...';
                let totalFixed = 0;
                await runBatchOperation('fix-all', async () => {
                    for (const tab of tabs) {
                        if (typeof tab.fixAction === 'function') {
                            try {
                                totalFixed += (await tab.fixAction()) || 0;
                            } catch (err) {
                                console.error('[Review Fix] خطأ في ' + tab.id + ':', err);
                            }
                        }
                    }
                });
                overlay.remove();
                showToast('تم تصليح ' + totalFixed + ' سيجمنت في المراجعة الشاملة ✅ - يفضل تعمل الفحص تاني للتأكيد');
            };
        }

        function escHandler(e) {
            if (e.key === 'Escape') {
                overlay.remove();
                document.removeEventListener('keydown', escHandler);
            }
        }
        document.addEventListener('keydown', escHandler);
    }

    // ==================== Dedup functions (prevent the same segment/error showing twice) (v13.0) ====================
    // Happens when the same segment gets read more than once across overlapping navigation/scroll pages
    function dedupeBySerial(arr) {
        const seen = new Set();
        return arr.filter(item => {
            const serial = typeof item === 'object' ? item.serial : item;
            if (seen.has(serial)) return false;
            seen.add(serial);
            return true;
        });
    }

    // Merges all "writing rules" results for the same segment into one item, and drops duplicate error messages within the same segment
    function dedupeWritingResults(results) {
        const map = new Map();
        results.forEach(r => {
            if (!map.has(r.serial)) map.set(r.serial, new Set());
            r.issues.forEach(i => map.get(r.serial).add(i));
        });
        return Array.from(map.keys()).sort((a, b) => a - b).map(serial => ({ serial, issues: Array.from(map.get(serial)) }));
    }

    // Collects segment numbers with issues + each issue's text, from the "full review" tabs result
    // Used for keyboard navigation (Alt+↓/↑) and for the "what's wrong" tooltip on the floating nav button
    function computeProblemDataFromTabs(tabs) {
        const serialsSet = new Set();
        const messages = new Map();
        tabs.forEach(tab => {
            if (tab.excludeFromTotal) return;
            tab.sections.forEach(sec => {
                const headingSerial = extractSerialFromString(sec.heading);
                sec.items.forEach(item => {
                    const itemText = typeof item === 'string' ? item : item.text;
                    const explicitSerial = (typeof item === 'object' && typeof item.serial === 'number') ? item.serial : null;
                    const serial = explicitSerial !== null ? explicitSerial : (extractSerialFromString(itemText) ?? headingSerial);
                    if (typeof serial === 'number' && !isNaN(serial)) {
                        serialsSet.add(serial);
                        if (!messages.has(serial)) messages.set(serial, []);
                        // Strip the segment number from the start of the message if present, so the tooltip stays clean.
                        // If the whole text was just "segment N" with no extra detail, take the description from the group's
                        // heading (sec.heading), which has the real explanation - so the tooltip doesn't end up empty
                        // and just repeating the segment number (the issue shown in the screenshot).
                        const cleaned = String(itemText).replace(/^سيجمنت\s+\d+\s*[-—:]?\s*/, '').trim();
                        const finalMsg = cleaned || sec.heading || itemText;
                        if (!messages.get(serial).includes(finalMsg)) messages.get(serial).push(finalMsg);
                    }
                });
            });
        });
        return { serials: Array.from(serialsSet).sort((a, b) => a - b), messages };
    }

    // Runs all the checks together and shows them in one tabbed panel
    async function runFullReview(btn) {
        await pickDialect();

        btn.textContent = '⏳ جاري المراجعة الشاملة...';
        btn.disabled = true;

        const allLeadTrail = new Set();
        const allDoubleSpace = new Set();
        {
            const navButtons = findNavButtons();
            checkWhitespaceIssues(); // نفحص المرئي حالياً كمان
            {
                const r0 = checkWhitespaceIssues();
                r0.leadTrailIssues.forEach(s => allLeadTrail.add(s));
                r0.doubleSpaceIssues.forEach(s => allDoubleSpace.add(s));
            }
            if (navButtons.length > 0) {
                for (const navBtn of navButtons) {
                    navBtn.click();
                    await sleep(500);
                    const result = checkWhitespaceIssues();
                    result.leadTrailIssues.forEach(s => allLeadTrail.add(s));
                    result.doubleSpaceIssues.forEach(s => allDoubleSpace.add(s));
                }
            }
        }

        let allEnglishIssues = [];
        const allTashkeelIssues = new Set();
        {
            const navButtons = findNavButtons();
            if (navButtons.length > 0) {
                for (const navBtn of navButtons) {
                    navBtn.click();
                    await sleep(500);
                    const result = checkEnglishAndTashkeel();
                    allEnglishIssues.push(...result.englishIssues);
                    result.tashkeelIssues.forEach(s => allTashkeelIssues.add(s));
                }
            } else {
                const result = checkEnglishAndTashkeel();
                allEnglishIssues.push(...result.englishIssues);
                result.tashkeelIssues.forEach(s => allTashkeelIssues.add(s));
            }
        }
        allEnglishIssues = dedupeBySerial(allEnglishIssues);

        let allWritingResults = [];
        {
            const navButtons = findNavButtons();
            if (navButtons.length > 0) {
                for (const navBtn of navButtons) {
                    navBtn.click();
                    await sleep(500);
                    allWritingResults.push(...scanWritingRules());
                }
            } else {
                allWritingResults.push(...scanWritingRules());
            }
        }
        allWritingResults = dedupeWritingResults(allWritingResults);

        const tagInfo = await collectAllRowInfo();
        const sortedSerials = Object.keys(tagInfo).map(Number).sort((a, b) => a - b);
        const adjacentDuplicates = [];
        const missingAttrTags = [];
        const shortDurationTags = [];
        const multipleTagsPerSegment = [];
        const taggedWithText = [];

        let totalTagSeconds = 0, tagCount = 0;
        const perTagTotals = {};
        let totalSpeechSeconds = 0, speechCount = 0;

        for (let i = 0; i < sortedSerials.length; i++) {
            const cur = tagInfo[sortedSerials[i]];
            const isTagShaped = /^<[A-Za-z]+>$/.test(cur.text);

            if (isTagShaped && !cur.hasAttrTag) missingAttrTags.push(cur.serial);
            if (cur.hasAttrTag && cur.attrTagTexts.length > 1) multipleTagsPerSegment.push({ serial: cur.serial, tags: cur.attrTagTexts.join(', ') });
            if (cur.hasAttrTag && cur.attrTagTexts.includes('<NOISE>')) {
                const duration = getRegionDuration(cur.regionId);
                if (duration !== null && duration < 0.5) shortDurationTags.push({ serial: cur.serial, duration });
            }
            if (cur.hasAttrTag && cur.text && !isTagShaped) taggedWithText.push({ serial: cur.serial, text: cur.text });

            if (i < sortedSerials.length - 1) {
                const next = tagInfo[sortedSerials[i + 1]];
                const nextIsTagShaped = /^<[A-Za-z]+>$/.test(next.text);
                if (isTagShaped && nextIsTagShaped && cur.text === next.text && cur.hasAttrTag && next.hasAttrTag) {
                    adjacentDuplicates.push([cur.serial, next.serial, cur.text]);
                }
            }

            if (isTagShaped && cur.hasAttrTag) {
                const duration = getRegionDuration(cur.regionId);
                if (duration !== null) {
                    totalTagSeconds += duration;
                    tagCount++;
                    perTagTotals[cur.text] = (perTagTotals[cur.text] || 0) + duration;
                }
            }

            if (!isTagShaped && !cur.hasAttrTag && cur.text) {
                const duration = getRegionDuration(cur.regionId);
                if (duration !== null) {
                    totalSpeechSeconds += duration;
                    speechCount++;
                }
            }
        }

        btn.textContent = '🚀 مراجعة شاملة';
        btn.disabled = false;

        cacheQATagProblems(missingAttrTags, shortDurationTags);

        const totalMinutesTag = Math.floor(totalTagSeconds / 60);
        const remSecondsTag = (totalTagSeconds % 60).toFixed(1);
        const totalMinutesSpeech = Math.floor(totalSpeechSeconds / 60);
        const remSecondsSpeech = (totalSpeechSeconds % 60).toFixed(1);

        const overviewSections = [
            {
                heading: null,
                items: [
                    { text: '🗣️ زمن الكلام الفعلي: ' + totalSpeechSeconds.toFixed(1) + ' ثانية (' + totalMinutesSpeech + ' دقيقة و ' + remSecondsSpeech + ' ثانية) — ' + speechCount + ' سيجمنت', type: 'ok' },
                    { text: '⏱️ زمن التاجات: ' + totalTagSeconds.toFixed(1) + ' ثانية (' + totalMinutesTag + ' دقيقة و ' + remSecondsTag + ' ثانية) — ' + tagCount + ' سيجمنت', type: 'ok' }
                ]
            }
        ];
        if (Object.keys(perTagTotals).length > 0) {
            overviewSections.push({
                heading: 'تفصيل زمن التاجات حسب النوع',
                items: Object.keys(perTagTotals).map(tag => ({ text: tag + ': ' + perTagTotals[tag].toFixed(1) + ' ثانية', type: 'info' }))
            });
        }

        const whitespaceSections = [];
        if (allLeadTrail.size > 0) whitespaceSections.push({ heading: '📏 مسافة زيادة في أول/آخر السيجمنت', items: Array.from(allLeadTrail).sort((a, b) => a - b).map(s => ({ text: 'سيجمنت ' + s, type: 'warn' })) });
        if (allDoubleSpace.size > 0) whitespaceSections.push({ heading: '📏 مسافة مزدوجة بين كلمتين جوه السيجمنت', items: Array.from(allDoubleSpace).sort((a, b) => a - b).map(s => ({ text: 'سيجمنت ' + s, type: 'warn' })) });

        const engTashSections = [];
        if (allEnglishIssues.length > 0) engTashSections.push({ heading: '🔤 سيجمنتات فيها 3 كلمات إنجليزي أو أكتر', items: allEnglishIssues.map(item => ({ text: 'سيجمنت ' + item.serial + ' — ' + item.count + ' كلمة: ' + item.words, type: 'warn' })) });
        if (allTashkeelIssues.size > 0) engTashSections.push({ heading: '🚫 سيجمنتات فيها تشكيل عربي', items: Array.from(allTashkeelIssues).sort((a, b) => a - b).map(s => ({ text: 'سيجمنت ' + s, type: 'warn' })) });

        const writingSections = allWritingResults.map(r => ({ heading: 'سيجمنت ' + r.serial, items: r.issues }));

        const tagSections = [];
        if (adjacentDuplicates.length > 0) tagSections.push({ heading: '🔗 تاجات متتالية من نفس النوع (مرشحة للدمج)', items: adjacentDuplicates.map(([a, b, tag]) => ({ text: 'سيجمنت ' + a + ' و ' + b + ' (' + tag + ')', type: 'warn' })) });
        if (missingAttrTags.length > 0) tagSections.push({ heading: '❌ سيجمنتات فيها نص تاج بدون Attribute', items: missingAttrTags.map(s => ({ text: 'سيجمنت ' + s, type: 'warn' })) });
        if (shortDurationTags.length > 0) tagSections.push({ heading: '⏱️ تاجات NOISE أقل من نص ثانية', items: shortDurationTags.map(item => ({ text: 'سيجمنت ' + item.serial + ' (' + item.duration.toFixed(3) + 's)', type: 'warn' })) });
        if (multipleTagsPerSegment.length > 0) tagSections.push({ heading: '🔢 سيجمنتات فيها أكتر من تاج واحد', items: multipleTagsPerSegment.map(item => ({ text: 'سيجمنت ' + item.serial + ' (' + item.tags + ')', type: 'warn' })) });
        if (taggedWithText.length > 0) tagSections.push({ heading: '📝 سيجمنتات فيها تاج + جملة كلام مع بعض', items: taggedWithText.map(item => ({ text: 'سيجمنت ' + item.serial, type: 'warn' })) });

        const tabs = [
            { id: 'overview', label: '📊 نظرة عامة', sections: overviewSections, emptyMessage: 'لا يوجد بيانات', excludeFromTotal: true, fixAction: null },
            {
                id: 'whitespace', label: '🔍 المسافات', sections: whitespaceSections, emptyMessage: 'مفيش أي مشاكل مسافات',
                fixAction: whitespaceSections.length > 0 ? async () => {
                    const serials = new Set([...allLeadTrail, ...allDoubleSpace]);
                    return await fixSegmentsBySerial(serials, (raw) => raw.trim().replace(/\s{2,}/g, ' '));
                } : null
            },
            {
                id: 'engtash', label: '🈯 إنجليزي/تشكيل', sections: engTashSections, emptyMessage: 'مفيش سيجمنتات فيها 3 كلمات إنجليزي أو أي تشكيل عربي',
                fixAction: allTashkeelIssues.size > 0 ? async () => {
                    return await fixSegmentsBySerial(allTashkeelIssues, (raw) => raw.replace(/[\u064B-\u0652]/g, ''));
                } : null
            },
            {
                id: 'writing', label: '📐 قواعد الكتابة', sections: writingSections, emptyMessage: 'مفيش أي مخالفات',
                fixAction: writingSections.length > 0 ? async () => {
                    const serials = new Set(allWritingResults.map(r => r.serial));
                    return await fixSegmentsBySerial(serials, autoFixWritingIssues);
                } : null
            },
            {
                id: 'tags', label: '⚠️ التاجات', sections: tagSections, emptyMessage: 'مفيش أي مشاكل في التاجات',
                fixAction: null
            }
        ];

        setReviewProblemData(computeProblemDataFromTabs(tabs));
        cacheReviewTabs(tabs);
        showReviewPanel(tabs);

        // Standing reminder: any "full review" means you're getting close to submitting, so don't forget to log the task in the stats
        setTimeout(() => showToast('متنساش: لما تخلّص التصليح وتقرب تسلّم، دوس ✅ إنهاء التاسك أو F4 عشان يتسجل في إحصائية اليوم 📊', false, 7000), 600);
    }

    let fullReviewBtnRef = null;
    function addFullReviewButton() {
        const btn = document.createElement('button');
        btn.textContent = '🚀 مراجعة شاملة';
        btn.style.cssText = 'position:fixed;bottom:120px;left:20px;z-index:99999;background:#7c3aed;color:#fff;border:none;padding:10px 16px;font-size:14px;font-weight:bold;cursor:pointer;';
        btn.onclick = () => runFullReview(btn);
        document.body.appendChild(btn);
        fullReviewBtnRef = btn;
    }

    // Helper: finds the site's own pagination buttons (labelled like "1 - 50") so other features
    // (full review, tag check, timing calc, etc.) can page through every row of a task.
    function findNavButtons() {
        const all = Array.from(document.querySelectorAll('div, span, button, a'));
        return all.filter(el => {
            const txt = el.textContent.trim();
            return /^\d+\s*-\s*\d+$/.test(txt) && el.children.length === 0;
        });
    }

    function fallbackCopy(text) {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        let success = false;
        try { success = document.execCommand('copy'); } catch (e) { success = false; }
        document.body.removeChild(ta);
        return success;
    }

    // ==================== Internal multi-clipboard (Smart Clipboard Ring) ====================
    // Listens for any copy that happens on the page (regular select-and-copy, or copy via the tool's own buttons -
    // both go through the normal 'copy' event) and stores the last 10 distinct texts. Ctrl+Shift+V while inside any
    // text field opens a small menu under the cursor, pick with arrow keys + Enter, and it pastes instantly where you're typing.
    const CLIPBOARD_RING_MAX = 10;
    let clipboardRing = [];
    let lastMouseX = 0, lastMouseY = 0;

    document.addEventListener('mousemove', (e) => { lastMouseX = e.clientX; lastMouseY = e.clientY; });

    function pushClipboardRing(text) {
        text = (text || '').trim();
        if (!text) return;
        clipboardRing = clipboardRing.filter(t => t !== text);
        clipboardRing.unshift(text);
        if (clipboardRing.length > CLIPBOARD_RING_MAX) clipboardRing.length = CLIPBOARD_RING_MAX;
    }

    document.addEventListener('copy', () => {
        // We read the text from the actual selection at copy time - tied to activeElement, because text inputs
        // (textarea/input) don't use the normal Selection API for their internal text.
        let text = '';
        const active = document.activeElement;
        if (active && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT')) {
            const s = active.selectionStart, en = active.selectionEnd;
            if (typeof s === 'number' && typeof en === 'number' && en > s) {
                text = active.value.slice(s, en);
            } else {
                text = active.value || '';
            }
        } else {
            try { text = (document.getSelection() || '').toString(); } catch (e) { /* تجاهل */ }
        }
        pushClipboardRing(text);
    }, true);

    function setNativeFieldValue(el, value) {
        const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
        setter.call(el, value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function insertTextAtCursor(el, text) {
        if (!el || (el.tagName !== 'TEXTAREA' && el.tagName !== 'INPUT')) return;
        const start = typeof el.selectionStart === 'number' ? el.selectionStart : el.value.length;
        const end = typeof el.selectionEnd === 'number' ? el.selectionEnd : el.value.length;
        const newVal = el.value.slice(0, start) + text + el.value.slice(end);
        setNativeFieldValue(el, newVal);
        const pos = start + text.length;
        try { el.selectionStart = el.selectionEnd = pos; } catch (e) { /* تجاهل */ }
    }

    function ensureClipboardRingStyles() {
        if (document.getElementById('tx-clip-ring-style')) return;
        const style = document.createElement('style');
        style.id = 'tx-clip-ring-style';
        style.textContent = `
            .tx-clip-menu {
                position: fixed; z-index: 200010; width: 250px; max-height: 260px; overflow-y: auto;
                background: linear-gradient(165deg, rgba(32,32,42,0.92), rgba(14,14,19,0.96));
                backdrop-filter: blur(20px) saturate(180%);
                -webkit-backdrop-filter: blur(20px) saturate(180%);
                border: 1px solid rgba(167,139,250,0.3); border-radius: 14px;
                padding: 6px; box-shadow: 0 16px 40px rgba(0,0,0,0.55), 0 0 24px rgba(124,58,237,0.25);
                font-family: 'Cairo', 'Segoe UI', Tahoma, sans-serif; direction: rtl;
                animation: tx-pop-in 0.15s ease;
            }
            .tx-clip-menu.tx-clip-closing { animation: tx-clip-fade-out 0.14s ease forwards; }
            @keyframes tx-clip-fade-out { to { opacity: 0; transform: scale(0.96); } }
            .tx-clip-item {
                padding: 7px 10px; border-radius: 9px; color: #e2e8f0; font-size: 12px;
                white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
                cursor: pointer; transition: background 0.12s ease; margin-bottom: 2px;
            }
            .tx-clip-item:hover { background: rgba(255,255,255,0.08); }
            .tx-clip-item.tx-clip-selected { background: rgba(124,58,237,0.4); color: #fff; }
        `;
        document.head.appendChild(style);
    }

    function showClipboardRingMenu(targetEl) {
        if (!clipboardRing.length) {
            showToast('لسه مفيش حاجة اتنسخت في الصفحة دي عشان تختار منها', true);
            return;
        }
        ensureClipboardRingStyles();
        document.querySelectorAll('.tx-clip-menu').forEach(m => m.remove());

        const menu = document.createElement('div');
        menu.className = 'tx-clip-menu';
        const left = Math.min(lastMouseX, window.innerWidth - 262);
        const top = Math.min(lastMouseY, window.innerHeight - 270);
        menu.style.left = Math.max(4, left) + 'px';
        menu.style.top = Math.max(4, top) + 'px';

        let selectedIndex = 0;
        const items = clipboardRing.map((text, i) => {
            const item = document.createElement('div');
            item.className = 'tx-clip-item' + (i === 0 ? ' tx-clip-selected' : '');
            item.textContent = text.length > 55 ? text.slice(0, 55) + '…' : text;
            item.title = text;
            item.onclick = () => choose(i);
            menu.appendChild(item);
            return item;
        });

        function highlight() {
            items.forEach((it, i) => it.classList.toggle('tx-clip-selected', i === selectedIndex));
            items[selectedIndex].scrollIntoView({ block: 'nearest' });
        }

        function closeMenu() {
            menu.classList.add('tx-clip-closing');
            setTimeout(() => menu.remove(), 150);
            document.removeEventListener('keydown', keyHandler, true);
            document.removeEventListener('mousedown', outsideHandler, true);
        }

        function choose(i) {
            insertTextAtCursor(targetEl, clipboardRing[i]);
            closeMenu();
        }

        function keyHandler(e) {
            if (e.key === 'ArrowDown') { e.preventDefault(); selectedIndex = Math.min(items.length - 1, selectedIndex + 1); highlight(); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); selectedIndex = Math.max(0, selectedIndex - 1); highlight(); }
            else if (e.key === 'Enter') { e.preventDefault(); choose(selectedIndex); }
            else if (e.key === 'Escape') { e.preventDefault(); closeMenu(); }
        }

        function outsideHandler(e) {
            if (!menu.contains(e.target)) closeMenu();
        }

        document.addEventListener('keydown', keyHandler, true);
        setTimeout(() => document.addEventListener('mousedown', outsideHandler, true), 0);
        document.body.appendChild(menu);
    }

    // ==================== Part 2: smart horizontal scroll ====================
    function findScrollableTarget(waveformContainer) {
        const candidates = waveformContainer.querySelectorAll('*');
        for (const el of candidates) {
            if (el.scrollWidth > el.clientWidth + 5) {
                return el;
            }
        }
        return waveformContainer.querySelector('wave') || waveformContainer;
    }

    function setupWaveformScroll() {
        const waveformContainer = document.querySelector('#waveform');
        if (!waveformContainer) return false;
        if (waveformContainer.dataset.scrollBound) return true;

        waveformContainer.addEventListener('wheel', (e) => {
            const target = findScrollableTarget(waveformContainer);
            if (!target) return;
            e.preventDefault();
            e.stopPropagation();
            target.scrollLeft += e.deltaY;
        }, { passive: false });

        let touchStartX = 0, touchStartScroll = 0, touchTarget = null;
        waveformContainer.addEventListener('touchstart', (e) => {
            touchTarget = findScrollableTarget(waveformContainer);
            touchStartX = e.touches[0].pageX;
            touchStartScroll = touchTarget ? touchTarget.scrollLeft : 0;
        }, { passive: true });

        waveformContainer.addEventListener('touchmove', (e) => {
            if (!touchTarget) return;
            e.preventDefault();
            const delta = (touchStartX - e.touches[0].pageX) * 1.5;
            touchTarget.scrollLeft = touchStartScroll + delta;
        }, { passive: false });

        waveformContainer.dataset.scrollBound = 'true';
        console.log('[Scroll] تم تفعيل السكرول الأفقي على #waveform ✅');
        return true;
    }

    // Note: the site is an SPA (Vue) - navigating from task to task without a full page refresh swaps
    // elements like #waveform / #changyuliu_table for new DOM elements. If we stopped the periodic check after the first success,
    // we wouldn't be able to reattach to the new element. So we leave it running the whole time (very cheap when nothing changed).
    setInterval(() => { setupWaveformScroll(); }, 800);

    // ==================== Part 4: extra spaces + double space check ====================
    function checkWhitespaceIssues() {
        const rows = document.querySelectorAll('#changyuliu_table > tr');
        const leadTrailIssues = [];
        const doubleSpaceIssues = [];
        const doubleSpaceRegex = /[^\s،؛:؟!.]\s{2,}[^\s،؛:؟!.]/;

        rows.forEach(row => {
            const serialCell = row.querySelector('.number');
            const contentCell = row.querySelector('.textContent .mark-content-textarea');
            if (!serialCell || !contentCell) return;

            const serial = parseInt(serialCell.textContent.trim(), 10);
            const raw = contentCell.value !== undefined ? contentCell.value : contentCell.textContent;

            let hasIssue = false;

            if (raw && /^\s|\s$/.test(raw)) {
                leadTrailIssues.push(serial);
                hasIssue = true;
            }

            if (raw && doubleSpaceRegex.test(raw)) {
                doubleSpaceIssues.push(serial);
                hasIssue = true;
            }

            setRowStatus(row, hasIssue ? 'error' : null);
        });

        return { leadTrailIssues, doubleSpaceIssues };
    }

    async function auditWhitespace(btn) {
        btn.textContent = '⏳ جاري الفحص...';
        btn.disabled = true;

        const navButtons = findNavButtons();
        const allLeadTrail = new Set();
        const allDoubleSpace = new Set();

        const r0 = checkWhitespaceIssues();
        r0.leadTrailIssues.forEach(s => allLeadTrail.add(s));
        r0.doubleSpaceIssues.forEach(s => allDoubleSpace.add(s));

        if (navButtons.length > 0) {
            for (const navBtn of navButtons) {
                navBtn.click();
                await sleep(500);
                const result = checkWhitespaceIssues();
                result.leadTrailIssues.forEach(s => allLeadTrail.add(s));
                result.doubleSpaceIssues.forEach(s => allDoubleSpace.add(s));
            }
        }

        btn.textContent = '🔍 فحص المسافات';
        btn.disabled = false;

        const sections = [];
        if (allLeadTrail.size > 0) {
            sections.push({
                heading: '📏 مسافة زيادة في أول/آخر السيجمنت',
                items: Array.from(allLeadTrail).sort((a, b) => a - b).map(s => ({ text: 'سيجمنت ' + s, type: 'warn' }))
            });
        }
        if (allDoubleSpace.size > 0) {
            sections.push({
                heading: '📏 مسافة مزدوجة بين كلمتين جوه السيجمنت',
                items: Array.from(allDoubleSpace).sort((a, b) => a - b).map(s => ({ text: 'سيجمنت ' + s, type: 'warn' }))
            });
        }

        showResultsPanel('🔍 فحص المسافات', sections, 'مفيش أي مشاكل مسافات', {
            label: '🔧 تصليح المسافات',
            onClick: async () => {
                const serialsToFix = new Set([...allLeadTrail, ...allDoubleSpace]);
                return await fixSegmentsBySerial(serialsToFix, (raw) => raw.trim().replace(/\s{2,}/g, ' '));
            }
        });
    }

    function addWhitespaceButton() {
        const btn = document.createElement('button');
        btn.textContent = '🔍 فحص المسافات';
        btn.style.cssText = 'position:fixed;bottom:20px;right:180px;z-index:99999;background:#3b82f6;color:#fff;border:none;padding:10px 16px;font-size:14px;font-weight:bold;cursor:pointer;';
        btn.onclick = () => auditWhitespace(btn);
        document.body.appendChild(btn);
    }

    // ==================== Part 4.5: extra English + Arabic diacritics check ====================
    function checkEnglishAndTashkeel() {
        const rows = document.querySelectorAll('#changyuliu_table > tr');
        const englishIssues = [];
        const tashkeelIssues = [];
        const tashkeelRegex = /[\u064B-\u0652]/;

        rows.forEach(row => {
            const serialCell = row.querySelector('.number');
            const contentCell = row.querySelector('.textContent .mark-content-textarea');
            if (!serialCell || !contentCell) return;

            const serial = parseInt(serialCell.textContent.trim(), 10);
            const raw = (contentCell.value || contentCell.textContent || '').trim();
            if (!raw) return;

            const englishWords = countPureEnglishWords(raw);
            const hasTashkeel = tashkeelRegex.test(raw);
            const hasThreeEnglishWords = englishWords.length >= 3;

            if (hasThreeEnglishWords || hasTashkeel) {
                if (hasThreeEnglishWords) englishIssues.push({ serial, count: englishWords.length, words: englishWords.join(', ') });
                if (hasTashkeel) tashkeelIssues.push(serial);
                setRowStatus(row, 'warn');
            } else {
                setRowStatus(row, null);
            }
        });

        return { englishIssues, tashkeelIssues };
    }

    async function auditEnglishAndTashkeel(btn) {
        btn.textContent = '⏳ جاري الفحص...';
        btn.disabled = true;

        const navButtons = findNavButtons();
        let allEnglishIssues = [];
        const allTashkeelIssues = new Set();

        const r0 = checkEnglishAndTashkeel();
        allEnglishIssues.push(...r0.englishIssues);
        r0.tashkeelIssues.forEach(s => allTashkeelIssues.add(s));

        if (navButtons.length > 0) {
            for (const navBtn of navButtons) {
                navBtn.click();
                await sleep(500);
                const result = checkEnglishAndTashkeel();
                allEnglishIssues.push(...result.englishIssues);
                result.tashkeelIssues.forEach(s => allTashkeelIssues.add(s));
            }
        }
        allEnglishIssues = dedupeBySerial(allEnglishIssues);

        btn.textContent = '🈯 فحص إنجليزي/تشكيل';
        btn.disabled = false;

        const sections = [];
        if (allEnglishIssues.length > 0) {
            sections.push({
                heading: '🔤 سيجمنتات فيها 3 كلمات إنجليزي أو أكتر',
                items: allEnglishIssues.map(item => ({
                    text: 'سيجمنت ' + item.serial + ' — ' + item.count + ' كلمة: ' + item.words,
                    type: 'warn'
                }))
            });
        }
        if (allTashkeelIssues.size > 0) {
            sections.push({
                heading: '🚫 سيجمنتات فيها تشكيل عربي',
                items: Array.from(allTashkeelIssues).sort((a, b) => a - b).map(s => ({ text: 'سيجمنت ' + s, type: 'warn' }))
            });
        }

        showResultsPanel('🈯 فحص إنجليزي/تشكيل', sections, 'مفيش سيجمنتات فيها 3 كلمات إنجليزي أو أي تشكيل عربي',
            allTashkeelIssues.size > 0 ? {
                label: '🔧 صلح التشكيل بس',
                onClick: async () => {
                    return await fixSegmentsBySerial(allTashkeelIssues, (raw) => raw.replace(/[\u064B-\u0652]/g, ''));
                }
            } : null
        );
    }

    function addEnglishTashkeelButton() {
        const btn = document.createElement('button');
        btn.textContent = '🈯 فحص إنجليزي/تشكيل';
        btn.style.cssText = 'position:fixed;bottom:70px;right:180px;z-index:99999;background:#eab308;color:#000;border:none;padding:10px 16px;font-size:14px;font-weight:bold;cursor:pointer;';
        btn.onclick = () => auditEnglishAndTashkeel(btn);
        document.body.appendChild(btn);
    }

    // ==================== Part 4.6: grammar check (writing rules + common spelling) ====================
    // Currently selected dialect (chosen from the "pick dialect" modal before any check) - default is Egyptian
    let currentDialect = 'مصري'; // مصري | لبناني | تونسي

    const allowedArabicEnglish = ['اوكي', 'أوكي', 'جيم', 'انستجرام', 'إنستجرام', 'يوتيوب', 'فيسبوك', 'تويتر', 'كمبيوتر', 'تاكسي', 'سوفنير', 'جيجا', 'كاريزما', 'اوتوبيس', 'تليفون'];
    const blacklistArabicEnglish = { 'هوسبيتال': 'hospital', 'سكول': 'school', 'مول': 'mall', 'بوليش': 'polish', 'واتساب': 'whatsapp', 'ماركت': 'market' };

    // English words written in Latin letters that should actually be written in Arabic (the opposite of the list above) - per the common-mistakes list
    const ENGLISH_TO_ARABIC_MAP = {
        'youtube': 'يوتيوب', 'instagram': 'انستجرام', 'facebook': 'فيسبوك', 'game': 'جيم',
        'computer': 'كمبيوتر', 'charisma': 'كاريزما', 'taxi': 'تاكسي', 'souvenir': 'سوفنير',
        'giga': 'جيجا', 'okay': 'أوكي'
    };

    // "Casing" fix for known English words (must stay English, just in the right form) - case-sensitive exact match
    const ENGLISH_CASING_FIX_MAP = {
        'Hospital': 'hospital', 'School': 'school', 'Mall': 'mall',
        'iphone': 'iPhone', 'playstation': 'PlayStation', 'ipad': 'iPad',
        'pc': 'PC', 'mtv': 'MTV', 'vr': 'VR', 'bts': 'BTS', 'usa': 'USA'
    };

    // General spelling maps (hamzas + taa marbuta/haa + alef maksura + common joined/split words)
    // These apply to all dialects - except words with a dialect-specific exception (like "shay'" and "mithl" in Lebanese), which get excluded automatically below
    // ⚠️ Note: "ali ⬅️ ala" can get confused with a person's name ("Ali"), so double-check any fix on it by eye
    const HAMZA_SPELLING_MAP = {
        'الى': 'إلى', 'الا': 'إلا', 'ان': 'إن', 'ابراهيم': 'إبراهيم', 'احمد': 'أحمد', 'افضل': 'أفضل',
        'اكل': 'أكل', 'اسلام': 'إسلام', 'اخر': 'آخر', 'امن': 'آمن', 'اسيا': 'آسيا',
        'شىء': 'شيء', 'شئ': 'شيء',
        'إفتح': 'افتح', 'إكتب': 'اكتب', 'إشتغل': 'اشتغل', 'إفتحولي': 'افتحولي', 'فإخترت': 'فاخترت',
        'انا': 'أنا', 'بايطاليا': 'بإيطاليا',
        'ناخذ': 'ناخد', 'حاخد': 'هاخد', 'هاخذ': 'هاخد', 'اخد': 'آخد', 'تاكل': 'تأكل',
        'اي': 'أي', 'ايه': 'إيه', 'اذا': 'إذا', 'امتى': 'إمتى', 'ازاي': 'إزاي', 'احنا': 'إحنا',
        'انت': 'إنت', 'انتي': 'إنتي', 'انتم': 'إنتم', 'انه': 'إنه', 'انها': 'إنها',
        'اول': 'أول', 'ام': 'أم', 'اب': 'أب', 'اخ': 'أخ', 'اخت': 'أخت',
        'اسبوع': 'أسبوع', 'ايام': 'أيام', 'اغنيه': 'أغنية', 'افلام': 'أفلام', 'الوان': 'ألوان', 'اشياء': 'أشياء',
        'امريكا': 'أمريكا', 'اوروبا': 'أوروبا', 'ايطاليا': 'إيطاليا', 'اسبانيا': 'إسبانيا', 'المانيا': 'ألمانيا',
        'استراليا': 'أستراليا', 'افريقيا': 'إفريقيا',
        'اريد': 'أريد', 'احب': 'أحب', 'اعرف': 'أعرف', 'افهم': 'أفهم', 'اسمع': 'أسمع', 'اقول': 'أقول',
        'إقرأ': 'اقرأ', 'إجلس': 'اجلس', 'إلعب': 'العب', 'إمشي': 'امش', 'إنتظر': 'انتظر', 'إستنى': 'استنى',
        'إستخدام': 'استخدام', 'إقتصاد': 'اقتصاد', 'إجتماع': 'اجتماع', 'إختبار': 'اختبار', 'إستثمار': 'استثمار',
        'إسم': 'اسم', 'إبن': 'ابن', 'إبنة': 'ابنة', 'إثنان': 'اثنان', 'إمرأة': 'امرأة',
        'ألكتاب': 'الكتاب', 'ألبيت': 'البيت',
        'يقرء': 'يقرأ', 'يبدء': 'يبدأ', 'يسئل': 'يسأل', 'مسأله': 'مسألة',
        'عبئ': 'عبء', 'دفئ': 'دفء', 'بطئ': 'بطيء'
    };
    const TAA_MARBUTA_ALEF_MAP = {
        'مدرسه': 'مدرسة', 'جامعه': 'جامعة', 'الحكومه': 'الحكومة', 'رحله': 'رحلة', 'قصه': 'قصة',
        'فقة': 'فقه', 'نبة': 'نبّه', 'شبة': 'شبّه', 'عليهة': 'عليه', 'فيهة': 'فيه',
        'سياره': 'سيارة', 'طياره': 'طيارة', 'عربيه': 'عربية', 'كبيره': 'كبيرة', 'صغيره': 'صغيرة',
        'كثيره': 'كثيرة', 'قليله': 'قليلة', 'طويله': 'طويلة', 'قصيره': 'قصيرة', 'جميله': 'جميلة',
        'حلوه': 'حلوة', 'وحشه': 'وحشة', 'جيده': 'جيدة', 'سيئه': 'سيئة', 'فكره': 'فكرة', 'مره': 'مرة',
        'حياه': 'حياة', 'مياة': 'مياه', 'اتجاة': 'اتجاه', 'انتباة': 'انتباه',
        'مشكله': 'مشكلة', 'طريقه': 'طريقة', 'نتيجه': 'نتيجة', 'حاجه': 'حاجة', 'شغله': 'شغلة',
        'قيمه': 'قيمة', 'نسبه': 'نسبة', 'شركه': 'شركة', 'مؤسسه': 'مؤسسة', 'وزاره': 'وزارة',
        'دوله': 'دولة', 'عاصمه': 'عاصمة', 'مدينه': 'مدينة', 'قريه': 'قرية', 'منطقه': 'منطقة',
        'محافظه': 'محافظة', 'صوره': 'صورة', 'ورقه': 'ورقة', 'صفحه': 'صفحة', 'شاشه': 'شاشة',
        'غرفه': 'غرفة', 'صاله': 'صالة', 'شقه': 'شقة', 'عائله': 'عائلة', 'عيله': 'عيلة',
        'روايه': 'رواية', 'حكايه': 'حكاية', 'كلمه': 'كلمة', 'جمله': 'جملة', 'فقره': 'فقرة',
        'مقاله': 'مقالة', 'مجله': 'مجلة', 'جريده': 'جريدة', 'ساعه': 'ساعة', 'دقيقه': 'دقيقة',
        'ثانيه': 'ثانية', 'سنه': 'سنة', 'فتره': 'فترة', 'مده': 'مدة', 'لحظه': 'لحظة', 'لعبه': 'لعبة',
        'مباراه': 'مباراة', 'بطوله': 'بطولة', 'كوره': 'كورة', 'زياده': 'زيادة', 'نهايه': 'نهاية',
        'بدايه': 'بداية', 'اجازة': 'إجازة', 'عطله': 'عطلة', 'اللة': 'الله', 'واللة': 'والله', 'باللة': 'بالله',
        'وجة': 'وجه', 'افواة': 'أفواه', 'أشباة': 'أشباه', 'متشابة': 'متشابه', 'اخرى': 'أخرى',
        'علي': 'على', 'إلي': 'إلى', 'حتي': 'حتى', 'متي': 'متى', 'موسي': 'موسى', 'عيسي': 'عيسى',
        'مستوي': 'مستوى', 'مستشفي': 'مستشفى', 'ذكري': 'ذكرى', 'شكوي': 'شكوى', 'مرضي': 'مرضى',
        'جرحي': 'جرحى', 'قتلي': 'قتلى', 'اسري': 'أسرى', 'دعوي': 'دعوى', 'اقصي': 'أقصى',
        'ادني': 'أدنى', 'اعلي': 'أعلى'
    };
    // Common joined/split words or missing alef (not dialect-specific)
    const MISC_WORD_MAP = {
        'اطلعو': 'اطلعوا', 'راحو': 'راحوا', 'جائو': 'جاءوا',
        'انكو': 'أنكم', 'معكو': 'معكم', 'عندكو': 'عندكم'
    };
    // Full general spelling map (checked as a whole token, with word boundaries)
    const missingHamzaMap = Object.assign({}, HAMZA_SPELLING_MAP, TAA_MARBUTA_ALEF_MAP, MISC_WORD_MAP);

    // Common multi-word phrases - matched by searching the text directly, not by single-token boundaries
    const PHRASE_FIXES = [
        [/ان\s*شاء\s*الله/g, 'إن شاء الله'],
        [/انشاء\s*الله/g, 'إن شاء الله'],
        [/انشاءالله/g, 'إن شاء الله'],
        [/الحمدلله/g, 'الحمد لله'],
        [/عليه\s+و\s+سلم/g, 'عليه وسلم'],
        [/ياخي/g, 'يا خي'],
        [/يالطيف/g, 'يا لطيف'],
        [/ياالله/g, 'يا الله'],
        [/واللهي/g, 'والله'],
        [/باللهي/g, 'بالله'],
        [/كي\s+فاش/g, 'كيفاش'],
        [/في\s+سع/g, 'فيسع'],
        [/توا\s+كا/g, 'تواكا']
    ];

    // Abbreviations with a fixed correction (not a general rule, each one is a special case) - like P.O. Box style abbreviations
    const ABBR_EXACT_MAP = {
        'ص.ب': 'ص.ب.', 'ش.م.خ.': 'ش.م.خ', 'ش.م.ع': 'ش.م.ع.', 'م.خ.م': 'م.خ.م.', 'ش.خ.م': 'ش.خ.م.'
    };

    // Titles like Mr./Dr./Eng. must be separated from the name by a space after the period (Mr.Ali ⬅️ Mr. Ali)
    const TITLE_ABBR_SPACING_REGEX = /(^|\s)(أ\.د|د\.م|أ|د|م)\.([\u0621-\u064A])/g;

    // French words common in the Tunisian dialect (if written in Arabic script, convert to French) - only active when the selected dialect is "Tunisian"
    const TUNISIAN_FRENCH_MAP = {
        'ديجا': 'Déjà', 'دونك': 'Donc', 'نورمالمون': 'Normalement', 'باردون': 'Pardon', 'توجور': 'Toujours',
        'بارسكو': 'Parce que', 'كوم سا': 'Comme ça', 'اكزكتمون': 'Exactement', 'كون ميم': 'Quand même',
        'فرانشمون': 'Franchement', 'بريف': 'Bref', 'اليه': 'Allez', 'شيك': 'Chic', 'بورتابل': 'Portable',
        'تليفون': 'Téléphone', 'شوماج': 'Chômage', 'ديركتمون': 'Directement', 'كويزين': 'Cuisine',
        'فاكانس': 'Vacances', 'ماشين': 'Machine', 'كارفور': 'Carrefour', 'تواليت': 'Toilette',
        'فريجيدير': 'Frigidaire', 'سالو': 'Salut', 'بيان سور': 'Bien sûr', 'بروبلام': 'Problème',
        'سوليسيون': 'Solution', 'اطونسيون': 'Attention', 'كونتيني': 'Continue', 'ستوب': 'Stop',
        'رونديفو': 'Rendez-vous', 'ويكاند': 'Week-end', 'ساندويتش': 'Sandwich', 'ريستورون': 'Restaurant',
        'امبيانس': 'Ambiance', 'فاتيجيه': 'Fatigué', 'شانس': 'Chance', 'فواتير': 'Voiture', 'ترافاي': 'Travail',
        'بيرو': 'Bureau', 'ريونيون': 'Réunion', 'نيميرو': 'Numéro', 'ادريس': 'Adresse', 'كارت': 'Carte',
        'بونك': 'Banque', 'دوكتور': 'Docteur', 'فارماسي': 'Pharmacie', 'اوبيتال': 'Hôpital',
        'انترنيت': 'Internet', 'ويفي': 'Wifi', 'اورديناتور': 'Ordinateur', 'سافا': 'Ça va', 'فوالا': 'Voilà',
        'دكور': "D'accord", 'بونجور': 'Bonjour', 'بونسوار': 'Bonsoir'
    };

    // Extra Tunisian French words (everyday expressions + tech/work + places/transport/home) - only active when dialect is "Tunisian"
    const TUNISIAN_FRENCH_MAP_EXTRA = {
        // descriptive/everyday expressions
        'نورمال': 'Normal', 'بيزار': 'Bizarre', 'قراف': 'Grave', 'سيريي': 'Sérieux',
        'جينيال': 'Génial', 'كاتستروف': 'Catastrophe', 'ديتاي': 'Détail', 'كاليتي': 'Qualité',
        'غارونتي': 'Garantie', 'اورجونس': 'Urgence', 'افوند': 'À fond', 'سيربلاص': 'Sur place',
        'بارازار': 'Par hasard', 'اونغرو': 'En gros', 'اونبان': 'En panne', 'بيل': 'Pile',
        // tech and work
        'كونكسيون': 'Connexion', 'ميساج': 'Message', 'شارجور': 'Chargeur', 'كابل': 'Câble',
        'ايكرون': 'Écran', 'دوسيه': 'Dossier', 'سيفي': 'CV', 'كونجي': 'Congé',
        'ستوك': 'Stock', 'ستاج': 'Stage', 'فورماسيون': 'Formation', 'كليون': 'Client',
        'ريزو': 'Réseau', 'كود': 'Code', 'باص': 'Mot de passe / Pass', 'بريم': 'Prime',
        // places, transport and home
        'بوسطة': 'Poste', 'مترو': 'Métro', 'طاكسي': 'Taxi', 'كار': 'Car / Autocar',
        'ستاسيون': 'Station', 'صالة': 'Salon / Salle', 'كولوار': 'Couloir', 'بلكون': 'Balcon',
        'دوش': 'Douche', 'بانو': 'Baignoire / Panneau', 'ريدو': 'Rideau', 'موبل': 'Meuble',
        'باكو': 'Paquet', 'ساشيه': 'Sachet', 'فكتور': 'Facture', 'تيكي': 'Ticket',
        'شيفور': 'Chauffeur', 'ميكانسيان': 'Mécanicien', 'بواتا': 'Boîte', 'ديبو': 'Dépôt'
    };
    // Merge the base map with the extra one into a single final map, actually used in checking/fixing
    Object.assign(TUNISIAN_FRENCH_MAP, TUNISIAN_FRENCH_MAP_EXTRA);

    // Spelling fixes specific to the Tunisian dialect (splitting wrongly-joined question words, merged negation, prepositions, common words)
    // Kept in a separate map (not TUNISIAN_FRENCH_MAP) since this is Arabic-to-Arabic correction, not a conversion to French
    const TUNISIAN_SPELLING_CORRECTIONS = {
        'دي ما': 'ديما', 'اش كون': 'شكون', 'إش كون': 'شكون', 'عليش': 'علاش', 'على اش': 'علاش',
        'كيف اش': 'كيفاش', 'وقت اش': 'وقتاش', 'قد اش': 'قداش', 'وينو': 'وينه', 'اش بيك': 'شبيك',
        'وشبيك': 'شبيك', 'ما عادش': 'ماعادش', 'معادش': 'ماعادش', 'ما نجمش': 'مانجمش',
        'منجمش': 'مانجمش', 'ما نعرفش': 'مانعرفش', 'منعرفش': 'مانعرفش', 'فما اش': 'فماش',
        'فميش': 'فماش', 'عل خاطر': 'على خاطر', 'علاخاطر': 'على خاطر', 'علخاطر': 'على خاطر',
        'بلحق': 'بالحق', 'ب الحق': 'بالحق', 'بارشا': 'برشا', 'برشة': 'برشا', 'نتاع': 'متاع',
        'تاوا': 'توا', 'توة': 'توا', 'يعيشيك': 'يعيشك', 'ياعيشك': 'يعيشك', 'كا هو': 'كهو',
        'كاهو': 'كهو', 'هاكاكه': 'هكاكة', 'هكدا': 'هكا', 'ايجه': 'ايجا', 'يجي': 'ايجا'
    };
    // Sorted longest (by word count) to shortest, so if two overlapping phrases exist, the longer/more precise one matches first
    const TUNISIAN_SPELLING_KEYS_SORTED = Object.keys(TUNISIAN_SPELLING_CORRECTIONS)
        .sort((a, b) => b.split(/\s+/).length - a.split(/\s+/).length || b.length - a.length);

    // Words specific to the Lebanese/Levantine dialect - take priority over the general map (shay' ⬅️ shi, mithl ⬅️ mitl)
    const LEBANESE_WORD_OVERRIDES = { 'شيء': 'شي', 'مثل': 'متل' };
    // The plural suffix "-hom" in Lebanese is written "-hen" (ma'ahom ⬅️ ma'ahen, kolhom ⬅️ kolhen) - applied to any word ending in "hom" preceded by at least one Arabic letter
    const LEBANESE_PLURAL_SUFFIX_REGEX = /([\u0621-\u064A])هم(?=\s|$)/g;

    function isFillerWordToken(token) {
        return FILLER_WORD_REGEX.test(token);
    }

    function normalizeSpaces(str) {
        return str.trim().replace(/\s+/g, ' ');
    }

    // Single filler words (one token) - caught whether inside a hashtag or not.
    // Instead of a fixed list (which was missing letters like "kaah" and others), we now use a general regex:
    // any single Arabic letter attached before "aah" (be-aah, te-aah, we-aah, fe-aah, ne-aah, ye-aah, ke-aah, ...), or "aah/ah" alone,
    // or "ah"/"aah" (one or more alefs + haa) - all treated exactly as filler, as requested.
    const FILLER_WORD_REGEX = /^(?:[\u0621-\u064A]?آه|أه|ا+ه)$/;
    // Filler phrases made of more than one word - caught as a single unit (added per your request: "al aah")
    const FILLER_PHRASES = ['ال آه'];

    // Confirms that hashtag content (or any text) is filler words/phrases only, with no real content inside
    function isAllFillerContent(content) {
        const trimmed = normalizeSpaces(content);
        if (!trimmed) return false;
        if (FILLER_PHRASES.includes(trimmed)) return true;
        const tokens = trimmed.split(' ').filter(Boolean);
        return tokens.length > 0 && tokens.every(t => isFillerWordToken(t));
    }

    // Ready-made alternation used in the regex to catch single filler words or filler phrases together
    function fillerAlternationSource() {
        const phraseParts = FILLER_PHRASES.map(p => p.replace(/\s+/g, '\\s+'));
        const wordPart = '[\\u0621-\\u064A]?آه|أه|ا+ه';
        return [...phraseParts, wordPart].join('|');
    }

    function findFillerHashtagIssues(text) {
        const issues = [];
        if (!text) return issues;

        const hashCount = (text.match(/#/g) || []).length;
        if (hashCount % 2 !== 0) {
            issues.push('عدد علامات # فردي (مش متزاوج) — فيه هاشتاج ناقص فتح أو قفل');
        }

        const groupRegex = /#([^#]*)#/g;
        const groups = [];
        let m;
        while ((m = groupRegex.exec(text)) !== null) {
            groups.push({ start: m.index, end: m.index + m[0].length, content: m[1] });
        }

        groups.forEach(g => {
            const content = g.content;
            if (/^\s|\s$/.test(content)) {
                issues.push('مسافة زايدة جوه الهاشتاج، المفروض تبقى لازقة: "#' + content.trim() + '#" مش "#' + content + '#"');
            }
            if (/\s{2,}/.test(content)) {
                issues.push('مسافة مزدوجة جوه الهاشتاج: "#' + content + '#"');
            }
            if (!isAllFillerContent(content)) {
                issues.push('محتوى الهاشتاج مش فيلر وردز صحيحة: "#' + content + '#"');
            }
        });

        let stripped = text;
        groups.slice().reverse().forEach(g => {
            stripped = stripped.slice(0, g.start) + ' '.repeat(g.end - g.start) + stripped.slice(g.end);
        });
        const fillerAlt = fillerAlternationSource();
        const bareRegex = new RegExp('(?:^|\\s)(' + fillerAlt + ')(?=\\s|$)', 'g');
        let fm;
        while ((fm = bareRegex.exec(stripped)) !== null) {
            issues.push('كلمة فيلر "' + fm[1] + '" من غير هاشتاج حواليها خالص');
        }

        for (let i = 0; i < groups.length - 1; i++) {
            const between = text.slice(groups[i].end, groups[i + 1].start);
            if (/^\s*$/.test(between)) {
                issues.push('مجموعتين هاشتاج متجاورتين لازم يتدمجوا في واحد: "#' + groups[i].content + '#' + between + '#' + groups[i + 1].content + '#" ← المفروض "#' + groups[i].content + ' ' + groups[i + 1].content + '#"');
            }
        }

        return issues;
    }

    // Returns all words excluded from the general map because of a dialect-specific exception (so we don't double-correct/conflict)
    function dialectExcludedGeneralWords() {
        if (currentDialect === 'لبناني') return Object.keys(LEBANESE_WORD_OVERRIDES);
        return [];
    }

    // Returns any text issues specific to the selected dialect (not covered by the general map)
    function findDialectIssues(raw) {
        const issues = [];
        if (currentDialect === 'لبناني') {
            if (/شيء/.test(raw)) issues.push('🗣️ لهجة لبناني/شامي: "شيء" المفروض تتكتب "شي"');
            if (/(^|\s)مثل(?=\s|$)/.test(raw)) issues.push('🗣️ لهجة لبناني/شامي: "مثل" المفروض تتكتب "متل"');
            if (LEBANESE_PLURAL_SUFFIX_REGEX.test(raw)) issues.push('🗣️ لهجة لبناني/شامي: نهاية الجمع بتبقى بالنون مش بالميم (زي "معهن" مش "معهم"، "كلهن" مش "كلهم")');
            LEBANESE_PLURAL_SUFFIX_REGEX.lastIndex = 0;
        } else if (currentDialect === 'تونسي') {
            Object.keys(TUNISIAN_FRENCH_MAP).forEach(wrong => {
                const re = new RegExp('(^|\\s)' + wrong.replace(/\s+/g, '\\s+') + '(?=\\s|$)');
                if (re.test(raw)) issues.push('🇹🇳 كلمة فرنسي دارجة مكتوبة عربي: "' + wrong + '" — المفروض: ' + TUNISIAN_FRENCH_MAP[wrong]);
            });
            TUNISIAN_SPELLING_KEYS_SORTED.forEach(wrong => {
                const re = new RegExp('(^|\\s)' + wrong.replace(/\s+/g, '\\s+') + '(?=\\s|$)');
                if (re.test(raw)) issues.push('🇹🇳 إملاء تونسي غلط: "' + wrong + '" — المفروض: ' + TUNISIAN_SPELLING_CORRECTIONS[wrong]);
            });
        }
        return issues;
    }

    function applyDialectFixes(raw) {
        let fixed = raw;
        if (currentDialect === 'لبناني') {
            fixed = fixed.replace(/شيء/g, 'شي');
            fixed = fixed.replace(/(^|\s)مثل(?=\s|$)/g, '$1متل');
            fixed = fixed.replace(LEBANESE_PLURAL_SUFFIX_REGEX, '$1هن');
        } else if (currentDialect === 'تونسي') {
            TUNISIAN_SPELLING_KEYS_SORTED.forEach(wrong => {
                const re = new RegExp('(^|\\s)' + wrong.replace(/\s+/g, '\\s+') + '(?=\\s|$)', 'g');
                fixed = fixed.replace(re, '$1' + TUNISIAN_SPELLING_CORRECTIONS[wrong]);
            });
            Object.keys(TUNISIAN_FRENCH_MAP).forEach(wrong => {
                const re = new RegExp('(^|\\s)' + wrong.replace(/\s+/g, '\\s+') + '(?=\\s|$)', 'g');
                fixed = fixed.replace(re, '$1' + TUNISIAN_FRENCH_MAP[wrong]);
            });
        }
        return fixed;
    }

    // Converts an exact multiple of 1000/1000000/1000000000 into its correct Arabic dual/plural/singular wording
    // (like "10 thousand", "100 thousand", "10 million") - returns null if the number isn't an exact multiple (so we don't mess with normal numbers like phone numbers)
    function formatArabicRoundNumber(n) {
        function unit(count, singular, dual, plural) {
            if (count === 2) return dual;
            if (count >= 3 && count <= 10) return count + ' ' + plural;
            return count + ' ' + singular;
        }
        if (n % 1000000000 === 0 && n / 1000000000 >= 1) return unit(n / 1000000000, 'مليار', 'ملياران', 'مليارات');
        if (n % 1000000 === 0 && n / 1000000 >= 1) return unit(n / 1000000, 'مليون', 'مليونان', 'ملايين');
        if (n % 1000 === 0 && n / 1000 >= 3) return unit(n / 1000, 'ألف', 'ألفان', 'آلاف');
        return null;
    }

    function checkWritingRules(raw, hasAttrTag) {
        const issues = [];

        if (!raw && !hasAttrTag) {
            return ['⚪ سيجمنت فاضي تماماً — مفيش نص ولا تاج'];
        }
        if (!raw) return issues;

        if (/[!:;'"]/.test(stripFrenchElisions(raw))) issues.push('🚫 علامة ترقيم ممنوعة (! : ; \' ")');
        if (/,/.test(raw)) issues.push('🚫 فاصلة إنجليزية (,) — المفروض فاصلة عربية (،)');
        if (/\u064B/.test(raw)) issues.push('🚫 تنوين فتح (ً) في النص — المفروض يتشال (زي "جداً" ⬅️ "جدا")');
        if (/[٠-٩]/.test(raw)) issues.push('🔢 أرقام هندية بدل الغربية');

        // Percent sign: correct form is for % (regular) to come right after the number with no space (like 90%)
        const percentTokens = raw.match(/[%％]\s*\d+|\d+\s*[%％]/g) || [];
        percentTokens.forEach(tok => {
            if (!/^\d+%$/.test(tok)) issues.push('٪ صيغة % غلط: "' + tok + '" — الصح إن العلامة % (العادية) تيجي بعد الرقم ملزوقة، زي 90%');
        });

        if (/(?:في|و)\s+\d/.test(raw)) issues.push('📏 مسافة بين حرف جر/واو والرقم');
        if (/ال\s+\d/.test(raw)) issues.push('📏 مسافة بين "ال" والرقم');
        if (/ال\s+[A-Za-z]/.test(raw)) issues.push('📏 مسافة بين "ال" وكلمة إنجليزية');
        if (/ب\s+\d/.test(raw)) issues.push('📏 مسافة بين "ب" والرقم');
        if (/لل\s+\d/.test(raw)) issues.push('📏 مسافة بين "لل" والرقم');
        if (/هال\s+[\u0621-\u064A]/.test(raw)) issues.push('📏 مسافة بين "هال" والكلمة اللي بعدها');
        if (/\d\s+كيلوغرام(?=\s|$)/.test(raw)) issues.push('📐 "كيلوغرام" بعد رقم لازم تختصر لـ كغ');
        if (/\d\s+متر(?=\s|$)(?!\s*مكعب)/.test(raw)) issues.push('📐 "متر" بعد رقم لازم تختصر لـ م');
        if (/\d\s+لتر(?=\s|$)/.test(raw)) issues.push('📐 "لتر" بعد رقم لازم تختصر لـ ل');
        if (/\d\s+درجة\s+مئوية(?=\s|$)/.test(raw)) issues.push('📐 "درجة مئوية" بعد رقم لازم تختصر لـ °م');
        if (/\d\s+فولت(?=\s|$)/.test(raw)) issues.push('📐 "فولت" بعد رقم لازم تختصر لـ ف');
        if (/\d\s+كيلومتر\s+في\s+الساعة/.test(raw)) issues.push('📐 "كيلومتر في الساعة" لازم تختصر لـ كم/س');
        if (/\d\s+متر\s+في\s+الثانية/.test(raw)) issues.push('📐 "متر في الثانية" لازم تختصر لـ م/ث');
        if (/\d\s+كيلوواط\s+ساعة/.test(raw)) issues.push('📐 "كيلوواط ساعة" لازم تختصر لـ ك.و.س');
        if (/\d\s+متر\s+مربع/.test(raw)) issues.push('📐 "متر مربع" لازم تختصر لـ م²');
        if (/\d\s+م\s+مكعب\b/.test(raw)) issues.push('📐 "م مكعب" لازم تتكتب كاملة "متر مكعب"');
        if (/\$/.test(raw)) issues.push('💲 علامة $ — المفروض تتكتب "دولار"');
        if (/\d+\/\d+=\d+/.test(raw)) issues.push('➗ علامة القسمة (/) في معادلة لازم تتكتب ÷');

        // Large round numbers (thousands/millions/billions) - should be written out in Arabic wording, not as a raw long digit string
        const bigNumTokens = raw.match(/\b\d{4,}\b/g) || [];
        bigNumTokens.forEach(tok => {
            const n = parseInt(tok, 10);
            const formatted = formatArabicRoundNumber(n);
            if (formatted) issues.push('🔢 "' + tok + '" رقم مدوّر لازم يتكتب "' + formatted + '"');
        });

        const words = raw.split(/[\s،.؟]+/).filter(w => w.length > 0);
        const dialectExcluded = dialectExcludedGeneralWords();
        words.forEach(w => {
            if (blacklistArabicEnglish[w] && !allowedArabicEnglish.includes(w)) {
                issues.push('🔤 "' + w + '" كلمة إنجليزية مكتوبة عربي — المفروض: ' + blacklistArabicEnglish[w]);
            }
            if (ENGLISH_TO_ARABIC_MAP[w.toLowerCase()]) {
                issues.push('🔤 "' + w + '" المفروض تتكتب عربي: ' + ENGLISH_TO_ARABIC_MAP[w.toLowerCase()]);
            }
            if (Object.prototype.hasOwnProperty.call(ENGLISH_CASING_FIX_MAP, w)) {
                issues.push('🔤 "' + w + '" حالة الأحرف غلط — المفروض: ' + ENGLISH_CASING_FIX_MAP[w]);
            }
            if (missingHamzaMap[w] && !dialectExcluded.includes(missingHamzaMap[w]) && !dialectExcluded.includes(w)) {
                issues.push('✏️ "' + w + '" إملاء غلط — المفروض: ' + missingHamzaMap[w]);
            }
            if (ABBR_EXACT_MAP[w]) {
                issues.push('✏️ "' + w + '" اختصار غلط — المفروض: ' + ABBR_EXACT_MAP[w]);
            }
        });

        PHRASE_FIXES.forEach(([re, correct]) => {
            re.lastIndex = 0;
            if (re.test(raw)) issues.push('✏️ فيه جزء من النص محتاج يتصحح لـ: "' + correct + '"');
        });

        if (TITLE_ABBR_SPACING_REGEX.test(raw)) issues.push('📏 لقب مختصر (أ./د./م.) لازم يتفصل عن الاسم بمسافة بعد النقطة');
        TITLE_ABBR_SPACING_REGEX.lastIndex = 0;

        findDialectIssues(raw).forEach(i => issues.push(i));

        findFillerHashtagIssues(raw).forEach(i => issues.push('#️⃣ ' + i));

        // Laughter written as repeated "ه" (e.g. "ههه") must always be exactly three - not two, not four or more
        const laughRuns = raw.match(/ه{2,}/g) || [];
        laughRuns.forEach(run => {
            if (run.length !== 3) issues.push('😂 "' + run + '" باترن الضحك غلط — لازم يتكتب "ههه" بالظبط (تلات حروف "ه" مش أكتر ولا أقل)');
        });

        return issues;
    }

    const INDIAN_DIGITS_MAP = { '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9' };

    function autoFixWritingIssues(raw) {
        if (!raw) return raw;
        let fixed = raw;

        fixed = fixed.replace(/[٠-٩]/g, d => INDIAN_DIGITS_MAP[d]);

        {
            const placeholder = '\u0001';
            let protectedText = fixed.replace(
                new RegExp('([A-Za-z' + FRENCH_LATIN_RANGE + '])\'([A-Za-z' + FRENCH_LATIN_RANGE + '])', 'g'),
                '$1' + placeholder + '$2'
            );
            protectedText = protectedText.replace(/[!:;'"]/g, '');
            fixed = protectedText.split(placeholder).join('\'');
        }

        fixed = fixed.replace(/,/g, '،');
        fixed = fixed.replace(/[.]\s*$/, '');
        fixed = fixed.replace(/\u064B/g, '');

        // Percent sign: normalize any form (% or ％, before or after the number, with or without a space) to the standard %-right-after-number form
        fixed = fixed.replace(/[%％]\s*(\d+)/g, '$1%');
        fixed = fixed.replace(/(\d+)\s*[%％]/g, '$1%');

        fixed = fixed.replace(/(في|و)\s+(\d)/g, '$1$2');
        fixed = fixed.replace(/ال\s+(\d)/g, 'ال$1');
        fixed = fixed.replace(/ال\s+([A-Za-z])/g, 'ال$1');
        fixed = fixed.replace(/ب\s+(\d)/g, 'ب$1');
        fixed = fixed.replace(/لل\s+(\d)/g, 'لل$1');
        fixed = fixed.replace(/هال\s+([\u0621-\u064A])/g, 'هال$1');

        fixed = fixed.replace(/(\d)\s+كيلوغرام(?=\s|$)/g, '$1 كغ');
        fixed = fixed.replace(/(\d)\s+متر(?=\s|$)(?!\s*مكعب)/g, '$1 م');
        fixed = fixed.replace(/(\d)\s+لتر(?=\s|$)/g, '$1 ل');
        fixed = fixed.replace(/(\d)\s+درجة\s+مئوية(?=\s|$)/g, '$1 °م');
        fixed = fixed.replace(/(\d)\s+فولت(?=\s|$)/g, '$1 ف');
        fixed = fixed.replace(/(\d)\s+كيلومتر\s+في\s+الساعة/g, '$1 كم/س');
        fixed = fixed.replace(/(\d)\s+متر\s+في\s+الثانية/g, '$1 م/ث');
        fixed = fixed.replace(/(\d)\s+كيلوواط\s+ساعة/g, '$1 ك.و.س');
        fixed = fixed.replace(/(\d)\s+متر\s+مربع/g, '$1 م²');
        fixed = fixed.replace(/(\d)\s+م\s+مكعب\b/g, '$1 متر مكعب');
        fixed = fixed.replace(/\$/g, 'دولار');
        fixed = fixed.replace(/(\d+)\/(\d+)(=\d+)/g, '$1÷$2$3');

        // Large round numbers into their Arabic wording
        fixed = fixed.replace(/\b\d{4,}\b/g, (tok) => {
            const n = parseInt(tok, 10);
            const formatted = formatArabicRoundNumber(n);
            return formatted || tok;
        });

        const dialectExcluded = dialectExcludedGeneralWords();
        Object.keys(missingHamzaMap).forEach(wrong => {
            if (dialectExcluded.includes(wrong) || dialectExcluded.includes(missingHamzaMap[wrong])) return;
            const right = missingHamzaMap[wrong];
            fixed = fixed.replace(new RegExp('(^|\\s)' + wrong + '(?=\\s|$)', 'g'), '$1' + right);
        });

        Object.keys(blacklistArabicEnglish).forEach(wrong => {
            if (allowedArabicEnglish.includes(wrong)) return;
            const right = blacklistArabicEnglish[wrong];
            fixed = fixed.replace(new RegExp('(^|\\s)' + wrong + '(?=\\s|$)', 'g'), '$1' + right);
        });

        Object.keys(ENGLISH_TO_ARABIC_MAP).forEach(wrong => {
            const right = ENGLISH_TO_ARABIC_MAP[wrong];
            fixed = fixed.replace(new RegExp('(^|\\s)' + wrong + '(?=\\s|$)', 'gi'), '$1' + right);
        });

        Object.keys(ENGLISH_CASING_FIX_MAP).forEach(wrong => {
            const right = ENGLISH_CASING_FIX_MAP[wrong];
            fixed = fixed.replace(new RegExp('(^|\\s)' + wrong + '(?=\\s|$)', 'g'), '$1' + right);
        });

        Object.keys(ABBR_EXACT_MAP).forEach(wrong => {
            const right = ABBR_EXACT_MAP[wrong];
            fixed = fixed.replace(new RegExp('(^|\\s)' + wrong.replace(/\./g, '\\.') + '(?=\\s|$)', 'g'), '$1' + right);
        });

        PHRASE_FIXES.forEach(([re, correct]) => {
            fixed = fixed.replace(re, correct);
        });

        fixed = fixed.replace(TITLE_ABBR_SPACING_REGEX, '$1$2. $3');

        fixed = applyDialectFixes(fixed);

        let prevPass;
        do {
            prevPass = fixed;
            fixed = fixed.replace(/#([^#]*)#(\s*)#([^#]*)#/g, (m, a, sp, b) => '#' + a.trim() + ' ' + b.trim() + '#');
        } while (fixed !== prevPass);

        fixed = fixed.replace(/#([^#]*)#/g, (m, content) => '#' + content.trim().replace(/\s{2,}/g, ' ') + '#');

        {
            const hashGroups = [];
            let protectedFixed = fixed.replace(/#([^#]*)#/g, (m) => {
                hashGroups.push(m);
                return '\u0002' + (hashGroups.length - 1) + '\u0002';
            });
            const fillerAlt = fillerAlternationSource();
            const bareRegex = new RegExp('(^|\\s)(' + fillerAlt + ')(?=\\s|$)', 'g');
            protectedFixed = protectedFixed.replace(bareRegex, '$1#$2#');
            fixed = protectedFixed.replace(/\u0002(\d+)\u0002/g, (m, idx) => hashGroups[parseInt(idx, 10)]);
        }

        return fixed;
    }

    function scanWritingRules() {
        const rows = document.querySelectorAll('#changyuliu_table > tr');
        const results = [];

        rows.forEach(row => {
            const serialCell = row.querySelector('.number');
            const contentCell = row.querySelector('.textContent .mark-content-textarea');
            const attrCell = row.querySelector('.attr');
            if (!serialCell || !contentCell) return;

            const serial = parseInt(serialCell.textContent.trim(), 10);
            const raw = (contentCell.value || contentCell.textContent || '').trim();
            const hasAttrTag = attrCell ? attrCell.querySelectorAll('.p1').length > 0 : false;

            const issues = checkWritingRules(raw, hasAttrTag);
            if (issues.length > 0) {
                results.push({ serial, issues });
                setRowStatus(row, 'warn');
            } else {
                setRowStatus(row, null);
            }
        });

        return results;
    }

    // Dialect-pick modal - shown before "grammar check" and "full review" so the check applies the right dialect's rules
    function ensureDialectPickerStyles() {
        if (document.getElementById('tx-dialect-style')) return;
        const style = document.createElement('style');
        style.id = 'tx-dialect-style';
        style.textContent = `
            .tx-dialect-options { display:flex; flex-direction:column; gap:10px; margin-bottom:18px; }
            .tx-dialect-btn {
                border:1px solid rgba(255,255,255,0.14); border-radius:10px; padding:12px 16px;
                background:rgba(255,255,255,0.06); color:#e2e8f0; font-family:'Cairo','Segoe UI',Tahoma,sans-serif;
                font-size:13.5px; font-weight:700; cursor:pointer; text-align:right; transition: all .15s ease;
            }
            .tx-dialect-btn:hover { background:rgba(124,58,237,0.25); border-color:rgba(124,58,237,0.5); }
            .tx-dialect-btn.selected { background:rgba(16,185,129,0.22); border-color:rgba(16,185,129,0.55); }
        `;
        document.head.appendChild(style);
    }

    // Returns a Promise that resolves with the dialect you picked (and saves it in currentDialect until you change it again)
    function pickDialect() {
        ensurePanelStyles();
        ensureConfirmStyles();
        ensureDialectPickerStyles();
        return new Promise((resolve) => {
            const overlay = document.createElement('div');
            overlay.className = 'tx-panel-overlay';

            const box = document.createElement('div');
            box.className = 'tx-confirm-box';

            const msg = document.createElement('div');
            msg.className = 'tx-confirm-msg';
            msg.textContent = 'اختار لهجة التاسك عشان الفحص يطبّق قواعد الكتابة الصح ليها:';

            const optionsWrap = document.createElement('div');
            optionsWrap.className = 'tx-dialect-options';

            const options = [
                { id: 'مصري', label: '🇪🇬 مصري' },
                { id: 'لبناني', label: '🇱🇧 لبناني / شامي' },
                { id: 'تونسي', label: '🇹🇳 تونسي' }
            ];

            function cleanup(result) {
                overlay.remove();
                document.removeEventListener('keydown', escHandler);
                resolve(result);
            }
            function escHandler(e) { if (e.key === 'Escape') cleanup(currentDialect); }

            options.forEach(opt => {
                const b = document.createElement('button');
                b.className = 'tx-dialect-btn' + (opt.id === currentDialect ? ' selected' : '');
                b.textContent = opt.label;
                b.onclick = () => { currentDialect = opt.id; cleanup(opt.id); };
                optionsWrap.appendChild(b);
            });

            overlay.onclick = (e) => { if (e.target === overlay) cleanup(currentDialect); };
            document.addEventListener('keydown', escHandler);

            box.appendChild(msg);
            box.appendChild(optionsWrap);
            overlay.appendChild(box);
            document.body.appendChild(overlay);
        });
    }

    async function auditWritingRules(btn) {
        await pickDialect();

        btn.textContent = '⏳ جاري الفحص...';
        btn.disabled = true;

        const navButtons = findNavButtons();
        let allResults = [...scanWritingRules()];

        if (navButtons.length > 0) {
            for (const navBtn of navButtons) {
                navBtn.click();
                await sleep(500);
                allResults.push(...scanWritingRules());
            }
        }
        allResults = dedupeWritingResults(allResults);

        btn.textContent = '📐 فحص القواعد';
        btn.disabled = false;

        const sections = allResults.map(r => ({
            heading: 'سيجمنت ' + r.serial,
            items: r.issues
        }));

        showResultsPanel('📐 فحص القواعد (' + currentDialect + ')', sections, 'مفيش أي مخالفات', {
            label: '🔧 تصليح تلقائي',
            onClick: async () => {
                const serialsToFix = new Set(allResults.map(r => r.serial));
                return await fixSegmentsBySerial(serialsToFix, autoFixWritingIssues);
            }
        });
    }

    function addWritingRulesButton() {
        const btn = document.createElement('button');
        btn.textContent = '📐 فحص القواعد';
        btn.style.cssText = 'position:fixed;bottom:65px;right:330px;z-index:99999;background:#92400e;color:#fff;border:none;padding:6px 12px;font-size:12px;font-weight:bold;cursor:pointer;';
        btn.onclick = () => auditWritingRules(btn);
        document.body.appendChild(btn);
    }

    // Sets a textarea's value the "native" way (via the prototype setter) so the site's own
    // framework picks up the change - used by the auto-fix feature above.
    function setNativeTextareaValue(el, value) {
        const proto = window.HTMLTextAreaElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
        setter.call(el, value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // ==================== Part 7: tag consistency check ====================
    function getRowInfo(row) {
        const serialCell = row.querySelector('.number');
        const textarea = row.querySelector('.textContent .mark-content-textarea');
        const attrCell = row.querySelector('.attr');
        if (!serialCell || !textarea) return null;

        const serial = parseInt(serialCell.textContent.trim(), 10);
        if (isNaN(serial)) return null;

        const text = (textarea.value || textarea.textContent || '').trim();
        const attrPills = attrCell ? Array.from(attrCell.querySelectorAll('.p1')) : [];
        const hasAttrTag = attrPills.length > 0;
        const attrTagTexts = attrPills.map(el => (el.getAttribute('title') || el.textContent || '').trim());
        const regionId = row.id;

        return { serial, text, hasAttrTag, attrTagTexts, regionId };
    }

    async function collectAllRowInfo() {
        const navButtons = findNavButtons();
        let allInfo = {};

        if (navButtons.length > 0) {
            for (const btn of navButtons) {
                btn.click();
                await sleep(500);
                const rows = document.querySelectorAll('#changyuliu_table > tr');
                rows.forEach(row => {
                    const info = getRowInfo(row);
                    if (info) allInfo[info.serial] = info;
                });
            }
        } else {
            const container = document.querySelector('#changyuliu_table')?.closest('[style*="overflow"]');
            if (container) {
                container.scrollTop = 0;
                await sleep(300);
                let stableCount = 0;
                let prevCount = 0;

                while (stableCount < 2) {
                    const rows = document.querySelectorAll('#changyuliu_table > tr');
                    rows.forEach(row => {
                        const info = getRowInfo(row);
                        if (info) allInfo[info.serial] = info;
                    });
                    container.scrollTop += container.clientHeight * 0.6;
                    await sleep(400);

                    const count = Object.keys(allInfo).length;
                    if (count === prevCount) stableCount++;
                    else stableCount = 0;
                    prevCount = count;
                }
            } else {
                const rows = document.querySelectorAll('#changyuliu_table > tr');
                rows.forEach(row => {
                    const info = getRowInfo(row);
                    if (info) allInfo[info.serial] = info;
                });
            }
        }

        return allInfo;
    }

    function getRegionDuration(regionId) {
        const region = document.querySelector('region.wavesurfer-region[data-id="' + regionId + '"]');
        if (!region) return null;
        try {
            const dataTime = JSON.parse(region.getAttribute('data-time'));
            const seconds = parseFloat(dataTime.all);
            return isNaN(seconds) ? null : seconds;
        } catch (e) {
            return null;
        }
    }

    // ==================== Jump straight to a segment from the results panel (v11.0) ====================
    function getSerialFromRow(row) {
        const serialCell = row.querySelector('.number');
        if (!serialCell) return null;
        const n = parseInt(serialCell.textContent.trim(), 10);
        return isNaN(n) ? null : n;
    }

    async function locateRowBySerial(serial) {
        function findVisible() {
            const rows = document.querySelectorAll('#changyuliu_table > tr');
            for (const row of rows) {
                if (getSerialFromRow(row) === serial) return row;
            }
            return null;
        }

        let found = findVisible();
        if (found) return found;

        const navButtons = findNavButtons();
        if (navButtons.length > 0) {
            for (const navBtn of navButtons) {
                navBtn.click();
                await sleep(450);
                found = findVisible();
                if (found) return found;
            }
        } else {
            const container = document.querySelector('#changyuliu_table')?.closest('[style*="overflow"]');
            if (container) {
                container.scrollTop = 0;
                await sleep(250);
                let stableCount = 0;
                let prevTop = -1;
                while (stableCount < 2) {
                    found = findVisible();
                    if (found) return found;
                    container.scrollTop += container.clientHeight * 0.6;
                    await sleep(350);
                    if (container.scrollTop === prevTop) stableCount++;
                    else stableCount = 0;
                    prevTop = container.scrollTop;
                }
            }
        }
        return null;
    }

    async function jumpToSegment(serial, silent) {
        const row = await locateRowBySerial(serial);
        if (!row) {
            if (!silent) showToast('معرفتش ألاقي سيجمنت ' + serial, true);
            return false;
        }

        row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        row.style.transition = 'box-shadow 0.3s ease';
        row.style.boxShadow = '0 0 0 3px rgba(167,139,250,0.75)';
        setTimeout(() => { row.style.boxShadow = ''; }, 1600);

        try {
            const region = document.querySelector('region.wavesurfer-region[data-id="' + row.id + '"]');
            if (region) {
                const waveformContainer = document.querySelector('#waveform');
                if (waveformContainer) {
                    const scrollTarget = findScrollableTarget(waveformContainer);
                    if (scrollTarget) {
                        scrollTarget.scrollLeft = Math.max(0, region.offsetLeft - scrollTarget.clientWidth / 2);
                    }
                }
                region.dispatchEvent(new MouseEvent('click', { bubbles: true }));

                const audioEl = document.querySelector('audio');
                if (audioEl) {
                    try {
                        const dataTime = JSON.parse(region.getAttribute('data-time'));
                        const startSeconds = parseFloat(dataTime.start ?? dataTime.all);
                        if (!isNaN(startSeconds)) audioEl.currentTime = startSeconds;
                    } catch (e) { /* شكل data-time مختلف - بنتجاهل بأمان */ }
                }
            }
        } catch (err) {
            console.warn('[Jump] معرفتش أنقل الصوت للتايم استامب:', err);
        }

        if (!silent) showToast('اتنقلت لسيجمنت ' + serial + ' 🎯');
        return true;
    }

    // ==================== Keyboard navigation between errors (Alt+↓ / Alt+↑) + floating widget (v13.0) ====================
    let lastReviewProblemSerials = [];
    let lastReviewProblemSerialsSet = new Set(); // نسخة Set من نفس البيانات فوق - أسرع في lookup للماركرز جوه الجدول
    let lastReviewProblemMessages = new Map(); // serial -> [رسائل المشاكل]
    let currentErrorNavIndex = -1;

    function setReviewProblemData(problemData) {
        lastReviewProblemSerials = problemData.serials;
        lastReviewProblemSerialsSet = new Set(problemData.serials);
        lastReviewProblemMessages = problemData.messages;
        currentErrorNavIndex = -1;
        updateErrorNavCount();
        updateRowErrorMarkers();
    }

    // Adds (or updates) a segment in the "check issues" list directly from the live check - it doesn't need to
    // have already shown up in "🚀 full review", so the red marker (!) next to the segment number works right from the
    // moment you type and hit an issue, and clicking it shows you the right message immediately.
    function addSerialToReviewProblems(serial, messages) {
        if (!lastReviewProblemSerialsSet.has(serial)) {
            lastReviewProblemSerials.push(serial);
            lastReviewProblemSerialsSet.add(serial);
            updateErrorNavCount();
        }
        lastReviewProblemMessages.set(serial, messages && messages.length ? messages : ['فيه مشكلة في السيجمنت ده']);
    }

    // Removes a single segment from the last "full review" issues list (when fixed live) - without running a new full review
    function clearSerialFromReviewProblems(serial) {
        if (!lastReviewProblemSerialsSet.has(serial)) return;
        lastReviewProblemSerialsSet.delete(serial);
        lastReviewProblemSerials = lastReviewProblemSerials.filter(s => s !== serial);
        lastReviewProblemMessages.delete(serial);
        currentErrorNavIndex = -1;
        updateErrorNavCount();
    }

    async function goToErrorRelative(direction) {
        if (lastReviewProblemSerials.length === 0) {
            showToast('مفيش نتيجة فحص شامل متسجلة - اعمل "🚀 مراجعة شاملة" الأول عشان تقدر تتنقل بين الأخطاء', true);
            return;
        }
        currentErrorNavIndex += direction;
        if (currentErrorNavIndex < 0) currentErrorNavIndex = lastReviewProblemSerials.length - 1;
        if (currentErrorNavIndex >= lastReviewProblemSerials.length) currentErrorNavIndex = 0;

        const serial = lastReviewProblemSerials[currentErrorNavIndex];
        const found = await jumpToSegment(serial, true);
        if (found) {
            showToast('خطأ ' + (currentErrorNavIndex + 1) + ' من ' + lastReviewProblemSerials.length + ' - سيجمنت ' + serial);
            showErrorNavTooltip(serial);
        } else {
            showToast('معرفتش ألاقي سيجمنت ' + serial, true);
        }
    }

    // ---- Very transparent floating widget: groups errors and shows the issue in a small tooltip on click ----
    function ensureErrorNavStyles() {
        if (document.getElementById('tx-errnav-style')) return;
        const style = document.createElement('style');
        style.id = 'tx-errnav-style';
        style.textContent = `
            .tx-errnav {
                position: fixed; top: 14px; left: 50%; transform: translateX(-50%); z-index: 99997;
                display: flex; align-items: center; gap: 4px;
                background: rgba(20,14,14,0.14);
                backdrop-filter: blur(4px) saturate(140%);
                -webkit-backdrop-filter: blur(4px) saturate(140%);
                border: 1px solid rgba(255,99,71,0.14);
                border-radius: 30px; padding: 5px 8px;
                opacity: 0.32; transition: opacity 0.3s ease, box-shadow 0.3s ease, background 0.3s ease, transform 0.15s ease;
                font-family: 'Cairo', 'Segoe UI', Tahoma, sans-serif;
                direction: rtl;
                box-shadow: 0 0 6px rgba(255,99,71,0.22);
            }
            .tx-errnav:hover {
                opacity: 1;
                background: rgba(24,16,16,0.5);
                border-color: rgba(255,99,71,0.32);
                box-shadow: 0 6px 20px rgba(0,0,0,0.3), 0 0 14px rgba(255,99,71,0.4);
            }
            .tx-errnav.tx-errnav-empty { opacity: 0.12; pointer-events: none; }
            .tx-errnav-btn {
                background: transparent; border: none; color: #ff9d85; font-size: 12px;
                cursor: pointer; padding: 3px 7px; border-radius: 8px; font-weight: 700;
                transition: background 0.15s ease, transform 0.1s ease;
                line-height: 1;
                text-shadow: 0 0 6px rgba(255,99,71,0.4);
            }
            .tx-errnav-btn:hover { background: rgba(255,99,71,0.14); text-shadow: 0 0 10px rgba(255,99,71,0.65); }
            .tx-errnav-btn:active { transform: scale(0.9); }
            .tx-errnav-count {
                color: #ffb4a2; font-size: 11px; font-weight: 700; min-width: 16px; text-align: center;
                text-shadow: 0 0 6px rgba(255,99,71,0.4);
            }
            .tx-errnav-tooltip {
                position: fixed; top: 54px; left: 50%; transform: translateX(-50%); z-index: 99999;
                max-width: 300px;
                background: rgba(20,14,14,0.42);
                backdrop-filter: blur(14px) saturate(160%);
                -webkit-backdrop-filter: blur(14px) saturate(160%);
                border: 1px solid rgba(255,99,71,0.22);
                border-radius: 14px; padding: 10px 12px;
                color: #f1e8e6; font-size: 12px; line-height: 1.6;
                direction: rtl; font-family: 'Cairo', 'Segoe UI', Tahoma, sans-serif;
                box-shadow: 0 14px 34px rgba(0,0,0,0.4), 0 0 16px rgba(255,99,71,0.22);
                animation: tx-pop-in 0.18s ease;
                opacity: 1;
                transition: opacity 0.6s ease, transform 0.6s ease;
            }
            .tx-errnav-tooltip.tx-fade-out { opacity: 0; transform: translateX(-50%) translateY(6px); }
            .tx-errnav-tooltip-title { color: #ffb08a; font-weight: 700; margin-bottom: 6px; text-shadow: 0 0 6px rgba(255,99,71,0.35); }
            .tx-errnav-tooltip-item { margin-bottom: 4px; padding-right: 4px; border-right: 2px solid rgba(255,99,71,0.35); padding-right: 8px; }
            .tx-errnav-tooltip-item:last-child { margin-bottom: 0; }
        `;
        document.head.appendChild(style);
    }

    let errorNavTooltipTimer = null;
    function showErrorNavTooltip(serial) {
        ensureErrorNavStyles();
        const existing = document.getElementById('tx-errnav-tooltip');
        if (existing) existing.remove();

        const messages = (lastReviewProblemMessages.get(serial) || ['فيه مشكلة في السيجمنت ده، افتح "🚀 مراجعة شاملة" للتفاصيل']).slice(0, 6);
        const box = document.createElement('div');
        box.id = 'tx-errnav-tooltip';
        box.className = 'tx-errnav-tooltip';
        box.innerHTML = '<div class="tx-errnav-tooltip-title">⚠️ سيجمنت ' + serial + '</div>' +
            messages.map(m => '<div class="tx-errnav-tooltip-item">' + escapeHtml(m) + '</div>').join('');
        document.body.appendChild(box);

        if (errorNavTooltipTimer) clearTimeout(errorNavTooltipTimer);
        errorNavTooltipTimer = setTimeout(() => {
            box.classList.add('tx-fade-out');
            setTimeout(() => box.remove(), 650);
        }, 2000);
        box.addEventListener('click', () => box.remove());
    }

    function updateErrorNavCount() {
        const wrap = document.getElementById('tx-errnav-widget');
        const countEl = document.getElementById('tx-errnav-count');
        if (countEl) countEl.textContent = lastReviewProblemSerials.length > 0 ? String(lastReviewProblemSerials.length) : '—';
        if (wrap) wrap.classList.toggle('tx-errnav-empty', lastReviewProblemSerials.length === 0);
    }

    function addErrorNavWidget() {
        ensureErrorNavStyles();
        const wrap = document.createElement('div');
        wrap.id = 'tx-errnav-widget';
        wrap.className = 'tx-errnav tx-errnav-empty';
        wrap.title = 'التنقل بين أخطاء آخر مراجعة شاملة';

        const upBtn = document.createElement('button');
        upBtn.className = 'tx-errnav-btn';
        upBtn.textContent = '▲';
        upBtn.title = 'الخطأ اللي قبله';
        upBtn.onclick = () => goToErrorRelative(-1);

        const countSpan = document.createElement('span');
        countSpan.id = 'tx-errnav-count';
        countSpan.className = 'tx-errnav-count';
        countSpan.textContent = '—';

        const downBtn = document.createElement('button');
        downBtn.className = 'tx-errnav-btn';
        downBtn.textContent = '▼';
        downBtn.title = 'الخطأ اللي بعده';
        downBtn.onclick = () => goToErrorRelative(1);

        wrap.appendChild(upBtn);
        wrap.appendChild(countSpan);
        wrap.appendChild(downBtn);
        document.body.appendChild(wrap);
    }

    // ==================== Hidden/transparent marker inside every segment with an error (v14.0) ====================
    // A tiny, very transparent dot placed next to the number of any segment logged as an issue in the last "full review",
    // it becomes clearly visible on row hover, and clicking it pops up a small glass tooltip right next to it stating the issue.
    function ensureRowErrorMarkerStyles() {
        if (document.getElementById('tx-row-errmarker-style')) return;
        const style = document.createElement('style');
        style.id = 'tx-row-errmarker-style';
        style.textContent = `
            .tx-row-err-marker {
                display: inline-flex; align-items: center; justify-content: center;
                width: 15px; height: 15px; border-radius: 50%;
                margin-inline-start: 6px; vertical-align: middle;
                cursor: pointer; font-size: 9.5px; font-weight: 900; line-height: 1;
                color: #fca5a5;
                background: rgba(239,68,68,0.10);
                border: 1px solid rgba(239,68,68,0.22);
                backdrop-filter: blur(6px) saturate(160%);
                -webkit-backdrop-filter: blur(6px) saturate(160%);
                opacity: 0.22;
                transition: opacity 0.2s ease, background 0.2s ease, transform 0.15s ease, box-shadow 0.2s ease;
            }
            tr:hover .tx-row-err-marker {
                opacity: 0.9;
            }
            .tx-row-err-marker:hover {
                opacity: 1 !important;
                background: rgba(239,68,68,0.34);
                box-shadow: 0 0 10px rgba(239,68,68,0.35);
                transform: scale(1.18);
            }
            .tx-row-err-tooltip {
                position: fixed; z-index: 100001;
                max-width: 300px;
                background: linear-gradient(165deg, rgba(32,32,42,0.88), rgba(14,14,19,0.94));
                backdrop-filter: blur(22px) saturate(180%);
                -webkit-backdrop-filter: blur(22px) saturate(180%);
                border: 1px solid rgba(255,255,255,0.14);
                border-radius: 14px; padding: 10px 12px;
                color: #e2e8f0; font-size: 12px; line-height: 1.6;
                direction: rtl; font-family: 'Cairo', 'Segoe UI', Tahoma, sans-serif;
                box-shadow: 0 14px 34px rgba(0,0,0,0.5), 0 0 20px rgba(239,68,68,0.16);
                animation: tx-pop-in 0.16s ease;
                cursor: pointer;
                opacity: 1;
                transition: opacity 0.6s ease, transform 0.6s ease;
            }
            .tx-row-err-tooltip.tx-fade-out { opacity: 0; transform: translateY(6px); }
            .tx-row-err-tooltip .tx-errnav-tooltip-title { color: #fbbf24; font-weight: 700; margin-bottom: 6px; }
            .tx-row-err-tooltip .tx-errnav-tooltip-item { margin-bottom: 4px; padding-right: 8px; border-right: 2px solid rgba(239,68,68,0.4); }
            .tx-row-err-tooltip .tx-errnav-tooltip-item:last-child { margin-bottom: 0; }
        `;
        document.head.appendChild(style);
    }

    let rowErrTooltipTimer = null;
    function showRowErrorTooltip(markerEl, serial) {
        ensureRowErrorMarkerStyles();
        const existing = document.getElementById('tx-row-err-tooltip');
        if (existing) existing.remove();

        const messages = (lastReviewProblemMessages.get(serial) || ['فيه مشكلة في السيجمنت ده، افتح "🚀 مراجعة شاملة" للتفاصيل']).slice(0, 6);
        const rect = markerEl.getBoundingClientRect();

        const box = document.createElement('div');
        box.id = 'tx-row-err-tooltip';
        box.className = 'tx-row-err-tooltip';
        box.innerHTML = '<div class="tx-errnav-tooltip-title">⚠️ سيجمنت ' + serial + '</div>' +
            messages.map(m => '<div class="tx-errnav-tooltip-item">' + escapeHtml(m) + '</div>').join('');
        document.body.appendChild(box);

        // We position it after it's added to the DOM so we know its real width and avoid it going off-screen
        const boxWidth = box.offsetWidth || 300;
        const boxHeight = box.offsetHeight || 80;
        let top = rect.bottom + 8;
        if (top + boxHeight > window.innerHeight - 10) top = Math.max(10, rect.top - boxHeight - 8);
        let left = rect.left - boxWidth + 16;
        if (left < 10) left = Math.min(window.innerWidth - boxWidth - 10, rect.left);
        box.style.top = top + 'px';
        box.style.left = left + 'px';

        if (rowErrTooltipTimer) clearTimeout(rowErrTooltipTimer);
        rowErrTooltipTimer = setTimeout(() => {
            box.classList.add('tx-fade-out');
            setTimeout(() => box.remove(), 650);
        }, 2000);
        box.addEventListener('click', () => box.remove());
    }

    function getOrCreateRowErrorMarker(row) {
        const numberCell = row.querySelector('.number');
        if (!numberCell) return null;
        let marker = numberCell.querySelector('.tx-row-err-marker');
        if (!marker) {
            ensureRowErrorMarkerStyles();
            marker = document.createElement('span');
            marker.className = 'tx-row-err-marker';
            marker.textContent = '!';
            marker.title = 'اضغط عشان تشوف المشكلة في السيجمنت ده';
            marker.addEventListener('click', (e) => {
                e.stopPropagation();
                const serial = getSerialFromRow(row);
                if (serial !== null) showRowErrorTooltip(marker, serial);
            });
            numberCell.appendChild(marker);
        }
        return marker;
    }

    function removeRowErrorMarker(row) {
        const numberCell = row.querySelector('.number');
        const marker = numberCell ? numberCell.querySelector('.tx-row-err-marker') : null;
        if (marker) marker.remove();
    }

    // Goes through all currently visible rows and adds/removes the marker based on the last "full review" result
    function updateRowErrorMarkers() {
        const rows = document.querySelectorAll('#changyuliu_table > tr');
        rows.forEach(row => {
            const serial = getSerialFromRow(row);
            if (serial !== null && lastReviewProblemSerialsSet.has(serial)) {
                getOrCreateRowErrorMarker(row);
            } else {
                removeRowErrorMarker(row);
            }
        });
    }

    async function checkTagConsistency(btn) {
        btn.textContent = '⏳ جاري الفحص...';
        btn.disabled = true;

        const allInfo = await collectAllRowInfo();
        const sortedSerials = Object.keys(allInfo).map(Number).sort((a, b) => a - b);

        const adjacentDuplicates = [];
        const missingAttrTags = [];
        const shortDurationTags = [];
        const multipleTagsPerSegment = [];
        const taggedWithText = [];

        for (let i = 0; i < sortedSerials.length; i++) {
            const cur = allInfo[sortedSerials[i]];
            const isTagShaped = /^<[A-Za-z]+>$/.test(cur.text);

            if (isTagShaped && !cur.hasAttrTag) {
                missingAttrTags.push(cur.serial);
            }

            if (cur.hasAttrTag && cur.attrTagTexts.length > 1) {
                multipleTagsPerSegment.push({ serial: cur.serial, tags: cur.attrTagTexts.join(', ') });
            }

            if (cur.hasAttrTag && cur.attrTagTexts.includes('<NOISE>')) {
                const duration = getRegionDuration(cur.regionId);
                if (duration !== null && duration < 0.5) {
                    shortDurationTags.push({ serial: cur.serial, duration });
                }
            }

            if (cur.hasAttrTag && cur.text && !isTagShaped) {
                taggedWithText.push({ serial: cur.serial, text: cur.text });
            }

            if (i < sortedSerials.length - 1) {
                const next = allInfo[sortedSerials[i + 1]];
                const nextIsTagShaped = /^<[A-Za-z]+>$/.test(next.text);
                if (isTagShaped && nextIsTagShaped && cur.text === next.text && cur.hasAttrTag && next.hasAttrTag) {
                    adjacentDuplicates.push([cur.serial, next.serial, cur.text]);
                }
            }
        }

        btn.textContent = '⚠️ فحص التاجات';
        btn.disabled = false;

        cacheQATagProblems(missingAttrTags, shortDurationTags);

        const allProblemSerials = new Set([
            ...missingAttrTags,
            ...shortDurationTags.map(i => i.serial),
            ...multipleTagsPerSegment.map(i => i.serial),
            ...taggedWithText.map(i => i.serial),
            ...adjacentDuplicates.flatMap(([a, b]) => [a, b])
        ]);
        document.querySelectorAll('#changyuliu_table > tr').forEach(row => {
            const serialCell = row.querySelector('.number');
            if (!serialCell) return;
            const serial = parseInt(serialCell.textContent.trim(), 10);
            setRowStatus(row, allProblemSerials.has(serial) ? 'error' : null);
        });

        const sections = [];
        if (adjacentDuplicates.length > 0) {
            sections.push({
                heading: '🔗 تاجات متتالية من نفس النوع (مرشحة للدمج)',
                items: adjacentDuplicates.map(([a, b, tag]) => ({ text: 'سيجمنت ' + a + ' و ' + b + ' (' + tag + ')', type: 'warn' }))
            });
        }
        if (missingAttrTags.length > 0) {
            sections.push({
                heading: '❌ سيجمنتات فيها نص تاج بدون Attribute',
                items: missingAttrTags.map(s => ({ text: 'سيجمنت ' + s, type: 'warn' }))
            });
        }
        if (shortDurationTags.length > 0) {
            sections.push({
                heading: '⏱️ تاجات NOISE أقل من نص ثانية',
                items: shortDurationTags.map(item => ({ text: 'سيجمنت ' + item.serial + ' (' + item.duration.toFixed(3) + 's)', type: 'warn' }))
            });
        }
        if (multipleTagsPerSegment.length > 0) {
            sections.push({
                heading: '🔢 سيجمنتات فيها أكتر من تاج واحد',
                items: multipleTagsPerSegment.map(item => ({ text: 'سيجمنت ' + item.serial + ' (' + item.tags + ')', type: 'warn' }))
            });
        }
        if (taggedWithText.length > 0) {
            sections.push({
                heading: '📝 سيجمنتات فيها تاج + جملة كلام مع بعض',
                items: taggedWithText.map(item => ({ text: 'سيجمنت ' + item.serial, type: 'warn' }))
            });
        }

        showResultsPanel('⚠️ فحص التاجات', sections, 'مفيش أي مشاكل في التاجات');
    }

    let tagCheckBtnRef = null;
    function addTagCheckButton() {
        const btn = document.createElement('button');
        btn.textContent = '⚠️ فحص التاجات';
        btn.style.cssText = 'position:fixed;bottom:20px;left:200px;z-index:99999;background:#dc2626;color:#fff;border:none;padding:10px 16px;font-size:14px;font-weight:bold;cursor:pointer;';
        btn.onclick = () => checkTagConsistency(btn);
        document.body.appendChild(btn);
        tagCheckBtnRef = btn;
    }

    // ==================== Part 8: undo/redo for manual edits (v13.0) ====================
    // Every manual edit (one line) is logged as a separate undo step, so you can step back exactly as you went.
    // Bulk operations (paste into all segments, auto-fix a batch of segments) are logged as a single undo step
    // that groups all the segments that changed - so if you regret it after pasting, one Ctrl+Z undoes all of them at once.
    const undoStack = [];
    const redoStack = [];
    const lastKnownValues = new Map(); // serial -> آخر قيمة معروفة
    let isApplyingUndoRedo = false;
    let batchCollector = null; // لو مش null، بيبقى فيه Array بيتجمع فيه تغييرات العملية الجماعية الحالية
    let undoBtnRef = null;
    let redoBtnRef = null;

    function updateUndoRedoButtons() {
        if (undoBtnRef) undoBtnRef.disabled = undoStack.length === 0;
        if (redoBtnRef) redoBtnRef.disabled = redoStack.length === 0;
    }

    // Wraps around any operation that edits more than one segment at once (paste, auto-fix...) and groups them into one undo step
    async function runBatchOperation(label, fn) {
        const collector = [];
        const previousCollector = batchCollector;
        batchCollector = collector;
        let result;
        try {
            result = await fn();
        } finally {
            batchCollector = previousCollector;
        }

        if (collector.length > 0 && !previousCollector) {
            const merged = new Map();
            collector.forEach(c => {
                if (!merged.has(c.serial)) merged.set(c.serial, { serial: c.serial, oldValue: c.oldValue, newValue: c.newValue });
                else merged.get(c.serial).newValue = c.newValue;
            });
            undoStack.push({ batch: true, label, changes: Array.from(merged.values()) });
            if (undoStack.length > 150) undoStack.shift();
            redoStack.length = 0;
            updateUndoRedoButtons();
        } else if (collector.length > 0 && previousCollector) {
            // Nested inside another batch - add these to the same outer group
            previousCollector.push(...collector);
        }

        return result;
    }

    const pendingEdits = new Map(); // serial -> { oldValue, timer, row, textarea }
    const EDIT_DEBOUNCE_MS = 700;

    function finalizeEdit(serial) {
        const entry = pendingEdits.get(serial);
        if (!entry) return;
        pendingEdits.delete(serial);
        if (entry.timer) clearTimeout(entry.timer);

        const textarea = entry.textarea;
        const newValue = textarea.value !== undefined ? textarea.value : textarea.textContent;
        const oldValue = entry.oldValue;

        if (oldValue !== newValue && !isApplyingUndoRedo) {
            if (batchCollector) {
                batchCollector.push({ serial, oldValue, newValue });
            } else {
                undoStack.push({ serial, oldValue, newValue });
                if (undoStack.length > 150) undoStack.shift();
                redoStack.length = 0;
                updateUndoRedoButtons();
            }
            // Logs this segment as "touched" for the current task (used in the end-of-task stats - part 9.5)
            currentTaskTouchedSerials.add(serial);
        }
        lastKnownValues.set(serial, newValue);
        if (entry.row) setSaveDotState(entry.row, 'saved');
    }

    function scheduleOrCommitEdit(row, textarea, immediate) {
        const serial = getSerialFromRow(row);
        if (serial === null) return;
        const currentValue = textarea.value !== undefined ? textarea.value : textarea.textContent;

        backupData[serial] = currentValue;
        setSaveDotState(row, 'typing');

        let entry = pendingEdits.get(serial);
        if (!entry) {
            const baseline = lastKnownValues.has(serial) ? lastKnownValues.get(serial) : currentValue;
            entry = { oldValue: baseline, timer: null, row, textarea };
            pendingEdits.set(serial, entry);
            recordQABaselineIfNeeded(serial, baseline);
        }
        entry.row = row;
        entry.textarea = textarea;
        if (entry.timer) { clearTimeout(entry.timer); entry.timer = null; }

        if (immediate) {
            finalizeEdit(serial);
        } else {
            entry.timer = setTimeout(() => finalizeEdit(serial), EDIT_DEBOUNCE_MS);
        }
    }

    // Steps back just one step - if the previous operation was a bulk one (paste/auto-fix), it undoes it all at once,
    // and if it was a single manual edit, it undoes just that. Press again to undo the one before it, and so on, exactly as requested.
    async function undoLastEdit() {
        if (undoStack.length === 0) { showToast('مفيش تعديلات نرجع فيها', true); return; }
        const action = undoStack.pop();
        redoStack.push(action);
        updateUndoRedoButtons();

        isApplyingUndoRedo = true;
        try {
            if (action.batch) {
                const serialsSet = new Set(action.changes.map(c => c.serial));
                const valueMap = new Map(action.changes.map(c => [c.serial, c.oldValue]));
                await fixSegmentsBySerial(serialsSet, (raw, serial) => valueMap.has(serial) ? valueMap.get(serial) : raw);
                action.changes.forEach(c => {
                    lastKnownValues.set(c.serial, c.oldValue);
                    backupData[c.serial] = c.oldValue;
                });
                showToast('تم التراجع عن دفعة كاملة (' + action.changes.length + ' سيجمنت) ↩️ - اضغط تاني عشان ترجع للخطوة اللي قبلها');
            } else {
                await fixSegmentsBySerial(new Set([action.serial]), () => action.oldValue);
                lastKnownValues.set(action.serial, action.oldValue);
                backupData[action.serial] = action.oldValue;
                showToast('تم التراجع عن آخر تعديل - سيجمنت ' + action.serial + ' ↩️');
            }
        } finally {
            isApplyingUndoRedo = false;
        }
    }

    async function redoLastEdit() {
        if (redoStack.length === 0) { showToast('مفيش حاجة نعيدها', true); return; }
        const action = redoStack.pop();
        undoStack.push(action);
        updateUndoRedoButtons();

        isApplyingUndoRedo = true;
        try {
            if (action.batch) {
                const serialsSet = new Set(action.changes.map(c => c.serial));
                const valueMap = new Map(action.changes.map(c => [c.serial, c.newValue]));
                await fixSegmentsBySerial(serialsSet, (raw, serial) => valueMap.has(serial) ? valueMap.get(serial) : raw);
                action.changes.forEach(c => {
                    lastKnownValues.set(c.serial, c.newValue);
                    backupData[c.serial] = c.newValue;
                });
                showToast('تم إعادة الدفعة الكاملة (' + action.changes.length + ' سيجمنت) ↪️');
            } else {
                await fixSegmentsBySerial(new Set([action.serial]), () => action.newValue);
                lastKnownValues.set(action.serial, action.newValue);
                backupData[action.serial] = action.newValue;
                showToast('تم إعادة التعديل - سيجمنت ' + action.serial + ' ↪️');
            }
        } finally {
            isApplyingUndoRedo = false;
        }
    }

    function addUndoButton() {
        const btn = document.createElement('button');
        btn.textContent = '↩️ تراجع';
        btn.disabled = true;
        btn.style.cssText = 'position:fixed;bottom:120px;right:20px;z-index:99999;background:#475569;color:#fff;border:none;padding:10px 16px;font-size:14px;font-weight:bold;cursor:pointer;';
        btn.onclick = () => undoLastEdit();
        document.body.appendChild(btn);
        undoBtnRef = btn;
    }

    function addRedoButton() {
        const btn = document.createElement('button');
        btn.textContent = '↪️ إعادة';
        btn.disabled = true;
        btn.style.cssText = 'position:fixed;bottom:120px;right:200px;z-index:99999;background:#475569;color:#fff;border:none;padding:10px 16px;font-size:14px;font-weight:bold;cursor:pointer;';
        btn.onclick = () => redoLastEdit();
        document.body.appendChild(btn);
        redoBtnRef = btn;
    }

    function initEditTracking() {
        const table = document.querySelector('#changyuliu_table');
        if (!table) return false;
        if (table.dataset.editTrackBound) return true;

        // We record the "clean" original value the moment you start typing in a segment - before the first character you type, not the
        // first time you type in it. This matters because if capture only happened on the first "input" event, the recorded value would
        // already be missing the character just typed, so undo would restore text missing one character from the original. Now we capture
        // the real value before any edit at all.
        table.addEventListener('focusin', (e) => {
            const textarea = e.target.closest('.mark-content-textarea');
            const row = e.target.closest('tr');
            if (!textarea || !row) return;
            const serial = getSerialFromRow(row);
            if (serial === null || lastKnownValues.has(serial)) return;
            const val = textarea.value !== undefined ? textarea.value : textarea.textContent;
            lastKnownValues.set(serial, val || '');
        }, true);

        table.addEventListener('input', (e) => {
            const textarea = e.target.closest('.mark-content-textarea');
            const row = e.target.closest('tr');
            if (textarea && row) { scheduleOrCommitEdit(row, textarea, false); hasUnsavedChangesSinceLastSave = true; }
        }, true);

        table.addEventListener('change', (e) => {
            const textarea = e.target.closest('.mark-content-textarea');
            const row = e.target.closest('tr');
            if (textarea && row) { scheduleOrCommitEdit(row, textarea, true); hasUnsavedChangesSinceLastSave = true; }
        }, true);

        // 'focusout' (unlike 'blur') bubbles, so it reaches us here at the table level, and works correctly whether
        // it's a real textarea or a contenteditable element (which has no 'change' event at all).
        // Makes sure any segment you leave gets logged as an undo step immediately the moment you move to the next one - it won't wait for the
        // 700ms debounce, and it won't miss the step if you move quickly between several segments in a row.
        table.addEventListener('focusout', (e) => {
            const textarea = e.target.closest('.mark-content-textarea');
            const row = e.target.closest('tr');
            if (textarea && row) scheduleOrCommitEdit(row, textarea, true);
        }, true);

        table.dataset.editTrackBound = 'true';
        console.log('[EditTracking] تم تفعيل تتبع التعديلات (Undo/Redo دفعات + Backup) ✅');
        return true;
    }

    setInterval(() => { initEditTracking(); }, 800);

    // ==================== Part 9: auto-recovery backup ====================
    const BACKUP_KEY = 'tx_auto_backup_v1';
    let backupData = {};

    function persistBackup() {
        if (Object.keys(backupData).length === 0) return;
        try {
            localStorage.setItem(BACKUP_KEY, JSON.stringify({
                timestamp: Date.now(),
                url: location.href,
                data: backupData
            }));
        } catch (e) {
            console.warn('[Backup] فشل حفظ النسخة الاحتياطية:', e);
        }
    }

    function loadExistingBackup() {
        try {
            const raw = localStorage.getItem(BACKUP_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch (e) {
            return null;
        }
    }

    setInterval(persistBackup, 60000);
    window.addEventListener('beforeunload', persistBackup);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') persistBackup();
    });

    async function restoreFromBackup() {
        const backup = loadExistingBackup();
        if (!backup || !backup.data || Object.keys(backup.data).length === 0) {
            showToast('مفيش نسخة احتياطية متاحة لحد دلوقتي', true);
            return;
        }
        const ageMinutes = Math.max(0, Math.round((Date.now() - backup.timestamp) / 60000));
        const count = Object.keys(backup.data).length;
        const confirmed = await showGlassConfirm('هيتم استرجاع ' + count + ' سيجمنت من نسخة احتياطية عمرها حوالي ' + ageMinutes + ' دقيقة، وهيتكتب فوق أي تعديل حالي في نفس السيجمنتات. تكمل؟');
        if (!confirmed) return;

        isApplyingUndoRedo = true;
        try {
            const serialsSet = new Set(Object.keys(backup.data).map(Number));
            const fixedCount = await fixSegmentsBySerial(serialsSet, (raw, serial) => {
                return Object.prototype.hasOwnProperty.call(backup.data, serial) ? backup.data[serial] : raw;
            });
            showToast('تم استرجاع ' + fixedCount + ' سيجمنت من النسخة الاحتياطية ✅');
        } finally {
            isApplyingUndoRedo = false;
        }
    }

    function addRestoreBackupButton() {
        const btn = document.createElement('button');
        btn.textContent = '🩹 استرجاع الشغل';
        btn.style.cssText = 'position:fixed;bottom:165px;left:20px;z-index:99999;background:#334155;color:#fff;border:none;padding:10px 16px;font-size:14px;font-weight:bold;cursor:pointer;';
        btn.onclick = () => restoreFromBackup();
        document.body.appendChild(btn);
    }

    // ==================== Part 9.5: daily productivity stats - counted per task only when it finishes (v13.0) ====================
    // Note on the fix: the old stats used to add a number for every character/partial edit (even if the same segment was edited
    // more than once), which inflated the numbers inaccurately. Now the count happens only once, when you press
    // "✅ finish task" at the end of each task, and it counts total segments + speech time + tag time for the whole task
    // (not the number of edits), so the number reflects the actual task no matter if a segment was edited once or ten times.
    const DAILY_STATS_KEY = 'tx_daily_stats_v1';
    const currentTaskTouchedSerials = new Set(); // بيتجمع فيه أرقام السيجمنتات اللي اتلمست في التاسك المفتوح حالياً (معلوماتي بس)

    function getTodayKey() {
        const d = new Date();
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }

    function loadDailyStats() {
        let data = null;
        try {
            const raw = localStorage.getItem(DAILY_STATS_KEY);
            data = raw ? JSON.parse(raw) : null;
        } catch (e) { data = null; }

        const today = getTodayKey();
        if (!data || data.date !== today) {
            data = { date: today, segmentsEdited: 0, speechSeconds: 0, tagSeconds: 0, tasksFinished: 0, workedSeconds: 0 };
            try { localStorage.setItem(DAILY_STATS_KEY, JSON.stringify(data)); } catch (e) { /* تجاهل */ }
        }
        if (typeof data.tasksFinished !== 'number') data.tasksFinished = 0;
        if (typeof data.workedSeconds !== 'number') data.workedSeconds = 0;
        return data;
    }

    function saveDailyStats(data) {
        try { localStorage.setItem(DAILY_STATS_KEY, JSON.stringify(data)); } catch (e) { /* تجاهل */ }
    }

    // Resets the whole day's stats and starts fresh (used by the "🔄 reset numbers" button inside the stats panel)
    function resetDailyStats() {
        const data = { date: getTodayKey(), segmentsEdited: 0, speechSeconds: 0, tagSeconds: 0, tasksFinished: 0, workedSeconds: 0 };
        saveDailyStats(data);
        currentTaskTouchedSerials.clear();
    }

    // Read when you press "✅ finish task": clears the whole current task (all its pages) at once, and counts
    // the total transcribed segments + speech time + real tag time, and adds them to the day's stats once.
    async function finishCurrentTask(btn) {
        btn.textContent = '⏳ جاري احتساب التاسك...';
        btn.disabled = true;

        const allInfo = await collectAllRowInfo();
        const sortedSerials = Object.keys(allInfo).map(Number).sort((a, b) => a - b);

        let totalTagSeconds = 0, tagCount = 0;
        let totalSpeechSeconds = 0, speechCount = 0;

        sortedSerials.forEach(s => {
            const cur = allInfo[s];
            const isTagShaped = /^<[A-Za-z]+>$/.test(cur.text);

            if (isTagShaped && cur.hasAttrTag) {
                const d = getRegionDuration(cur.regionId);
                if (d !== null) { totalTagSeconds += d; tagCount++; }
            }
            if (!isTagShaped && !cur.hasAttrTag && cur.text) {
                const d = getRegionDuration(cur.regionId);
                if (d !== null) { totalSpeechSeconds += d; speechCount++; }
            }
        });

        const totalSegments = speechCount + tagCount;
        const timerElapsedSeconds = Math.max(0, (Date.now() - taskTimerStart - taskTimerPausedAccumMs - (taskTimerPaused ? (Date.now() - taskTimerPausedAt) : 0)) / 1000);

        const previewSpeechMin = Math.floor(totalSpeechSeconds / 60);
        const previewSpeechRem = (totalSpeechSeconds % 60).toFixed(1);
        const previewTagMin = Math.floor(totalTagSeconds / 60);
        const previewTagRem = (totalTagSeconds % 60).toFixed(1);
        const previewWorkedMin = Math.floor(timerElapsedSeconds / 60);
        const previewWorkedRem = Math.floor(timerElapsedSeconds % 60);
        const confirmed = await showGlassConfirm(
            'هيتضاف للإحصائية دلوقتي:\n' +
            '- ' + totalSegments + ' سيجمنت\n' +
            '- زمن كلام: ' + previewSpeechMin + ' د ' + previewSpeechRem + ' ث\n' +
            '- زمن تاجات: ' + previewTagMin + ' د ' + previewTagRem + ' ث\n' +
            '- وقت الشغل الفعلي (من التايمر): ' + previewWorkedMin + ' د ' + previewWorkedRem + ' ث\n\n' +
            'لو الأرقام دي مش مطابقة للتاسك اللي خلّصته، اضغط إلغاء وراجع الصفحة.',
            { okLabel: 'تأكيد', cancelLabel: 'إلغاء' }
        );
        if (!confirmed) {
            btn.textContent = '✅ إنهاء التاسك';
            btn.disabled = false;
            return;
        }

        const data = loadDailyStats();
        data.segmentsEdited += totalSegments;
        data.speechSeconds += totalSpeechSeconds;
        data.tagSeconds += totalTagSeconds;
        data.workedSeconds += timerElapsedSeconds;
        data.tasksFinished += 1;
        saveDailyStats(data);

        currentTaskTouchedSerials.clear();
        resetQABaseline();
        resetTaskTimer();
        celebrateFinishTask(data.tasksFinished);

        btn.textContent = '✅ إنهاء التاسك';
        btn.disabled = false;

        const speechMin = Math.floor(totalSpeechSeconds / 60);
        const speechRem = (totalSpeechSeconds % 60).toFixed(1);
        showToast('تم تسجيل التاسك ✅ - ' + totalSegments + ' سيجمنت / ' + speechMin + ' د ' + speechRem + ' ث كلام - اتضاف لإحصائية اليوم، والتايمر بدأ من جديد ⏱️');
    }

    let finishTaskBtnRef = null;
    function addFinishTaskButton() {
        const btn = document.createElement('button');
        btn.textContent = '✅ إنهاء التاسك';
        btn.style.cssText = 'position:fixed;bottom:165px;left:770px;z-index:99999;background:#15803d;color:#fff;border:none;padding:10px 16px;font-size:14px;font-weight:bold;cursor:pointer;';
        btn.onclick = () => finishCurrentTask(btn);
        document.body.appendChild(btn);
        finishTaskBtnRef = btn;
    }

    function showDailyStatsPanel() {
        const data = loadDailyStats();
        const speechMin = Math.floor(data.speechSeconds / 60);
        const speechRem = (data.speechSeconds % 60).toFixed(1);
        const tagMin = Math.floor(data.tagSeconds / 60);
        const tagRem = (data.tagSeconds % 60).toFixed(1);
        const workedMin = Math.floor(data.workedSeconds / 60);
        const workedRem = Math.floor(data.workedSeconds % 60);

        const sections = [{
            heading: null,
            items: [
                { text: '✅ عدد التاسكات اللي خلّصتها النهاردة: ' + data.tasksFinished, type: 'ok' },
                { text: '✏️ إجمالي السيجمنتات المُفرّغة النهاردة: ' + data.segmentsEdited, type: 'ok' },
                { text: '🗣️ زمن الكلام اللي فرّغته النهاردة: ' + data.speechSeconds.toFixed(1) + ' ثانية (' + speechMin + ' دقيقة و ' + speechRem + ' ثانية)', type: 'ok' },
                { text: '⏱️ زمن التاجات اللي عملتها النهاردة: ' + data.tagSeconds.toFixed(1) + ' ثانية (' + tagMin + ' دقيقة و ' + tagRem + ' ثانية)', type: 'ok' },
                { text: '⏳ وقت الشغل الفعلي النهاردة (من التايمر): ' + workedMin + ' دقيقة و ' + workedRem + ' ثانية', type: 'ok' },
                { text: 'ℹ️ الأرقام دي بتتحدث بس لما تدوس "✅ إنهاء التاسك" في آخر كل تاسك - عشان تبقى دقيقة ومحسوبة مرة واحدة لكل تاسك', type: 'info' }
            ]
        }];

        showResultsPanel('📊 إحصائية إنتاجية اليوم (' + data.date + ')', sections, 'لسه مفيش أي تاسكات اتسجّلت النهاردة', {
            label: '🔄 تصفير الأرقام',
            loadingLabel: '⏳ جاري التصفير...',
            confirmMessage: 'هيتصفّر كل رقم في إحصائية النهاردة (عدد التاسكات، السيجمنتات، زمن الكلام والتاجات) وتبدأ من الصفر. الإجراء ده مش قابل للتراجع. متأكد؟',
            onClick: async () => { resetDailyStats(); return 0; },
            successMessage: () => 'تم تصفير إحصائية اليوم ✅ - هتبدأ التجميع من الصفر تاني'
        });
    }

    function addDailyStatsButton() {
        const btn = document.createElement('button');
        btn.textContent = '📊 إحصائية اليوم';
        btn.style.cssText = 'position:fixed;bottom:165px;left:200px;z-index:99999;background:#0e7490;color:#fff;border:none;padding:10px 16px;font-size:14px;font-weight:bold;cursor:pointer;';
        btn.onclick = () => showDailyStatsPanel();
        document.body.appendChild(btn);
    }

    // ==================== Part 9.6: store the last "full review" result locally (v11.0) ====================
    const REVIEW_CACHE_KEY = 'tx_last_review_cache_v1';

    function cacheReviewTabs(tabs) {
        try {
            const serializableTabs = tabs.map(t => ({
                id: t.id, label: t.label, sections: t.sections,
                emptyMessage: t.emptyMessage, excludeFromTotal: !!t.excludeFromTotal
            }));
            localStorage.setItem(REVIEW_CACHE_KEY, JSON.stringify({ timestamp: Date.now(), tabs: serializableTabs }));
        } catch (e) {
            console.warn('[ReviewCache] فشل حفظ نتيجة الفحص الشامل:', e);
        }
    }

    function loadCachedReview() {
        try {
            const raw = localStorage.getItem(REVIEW_CACHE_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch (e) {
            return null;
        }
    }

    function showCachedReview() {
        const cached = loadCachedReview();
        if (!cached || !cached.tabs) {
            showToast('مفيش مراجعة شاملة محفوظة قبل كده', true);
            return;
        }
        const ageMinutes = Math.max(0, Math.round((Date.now() - cached.timestamp) / 60000));
        const tabs = cached.tabs.map(t => ({ ...t, fixAction: null }));

        const overviewTab = tabs.find(t => t.id === 'overview');
        const timeNote = { heading: null, items: [{ text: '🕒 النتيجة دي محفوظة من ' + ageMinutes + ' دقيقة (مش لايف) - اعمل "🚀 مراجعة شاملة" لو عايز نتيجة محدّثة', type: 'info' }] };
        if (overviewTab) {
            overviewTab.sections = [timeNote, ...overviewTab.sections];
        } else {
            tabs.unshift({ id: 'cache-note', label: '🕒 آخر مراجعة', sections: [timeNote], emptyMessage: '', excludeFromTotal: true, fixAction: null });
        }

        setReviewProblemData(computeProblemDataFromTabs(tabs));

        showReviewPanel(tabs);
    }

    function addCachedReviewButton() {
        const btn = document.createElement('button');
        btn.textContent = '📂 آخر مراجعة';
        btn.style.cssText = 'position:fixed;bottom:165px;left:380px;z-index:99999;background:#6d28d9;color:#fff;border:none;padding:10px 16px;font-size:14px;font-weight:bold;cursor:pointer;';
        btn.onclick = () => showCachedReview();
        document.body.appendChild(btn);
    }

    // ==================== Smart QA Error Reporter (v19.0) ====================
    // Records the original text of every segment the first time you touch it with an edit (before you change it), and keeps it saved for the whole task.
    // Any time you press "🧪 QA check" it compares the original text with the current final text for every edited segment,
    // and gives you a categorized report (tags/spacing/grammar → spelling → other edits) you can export as a file to send to the transcriber.
    const QA_BASELINE_KEY = 'tx_qa_baseline_v1';
    const QA_REPORT_CACHE_KEY = 'tx_qa_report_cache_v1';

    function loadQABaselineFromStorage() {
        try {
            const raw = localStorage.getItem(QA_BASELINE_KEY);
            if (raw) {
                const data = JSON.parse(raw);
                if (data && data.url === location.href && data.baseline) return data.baseline;
            }
        } catch (e) { /* تجاهل */ }
        return {};
    }

    const qaBaseline = loadQABaselineFromStorage(); // serial(string) -> النص الأصلي قبل أول تعديل في التاسك ده

    function persistQABaseline() {
        try { localStorage.setItem(QA_BASELINE_KEY, JSON.stringify({ url: location.href, baseline: qaBaseline })); } catch (e) { /* تجاهل */ }
    }

    function recordQABaselineIfNeeded(serial, originalValue) {
        const key = String(serial);
        if (!(key in qaBaseline)) {
            qaBaseline[key] = originalValue;
            persistQABaseline();
        }
    }

    function resetQABaseline() {
        Object.keys(qaBaseline).forEach(k => delete qaBaseline[k]);
        persistQABaseline();
    }

    // ---- Cache of tag issues (tag missing an attribute / NOISE tag under half a second) detected from "⚠️ tag check"
    // or "🚀 full review" - lets "🧪 QA check" catch that the issue got fixed even if the fix was
    // by moving the tag boundary on the player (not by typing new text in the segment), so it wouldn't show up in a normal text comparison
    const QA_TAG_PROBLEMS_KEY = 'tx_qa_tag_problems_v1';

    function cacheQATagProblems(missingAttrTags, shortDurationTags) {
        try {
            localStorage.setItem(QA_TAG_PROBLEMS_KEY, JSON.stringify({
                url: location.href,
                missingAttrTags: missingAttrTags || [],
                shortDurationTags: (shortDurationTags || []).map(i => ({ serial: i.serial, duration: i.duration }))
            }));
        } catch (e) { /* تجاهل */ }
    }

    function loadQATagProblemsFromStorage() {
        try {
            const raw = localStorage.getItem(QA_TAG_PROBLEMS_KEY);
            if (raw) {
                const data = JSON.parse(raw);
                if (data && data.url === location.href) return data;
            }
        } catch (e) { /* تجاهل */ }
        return null;
    }

    // ---- Adds a single tag issue (caught live while typing) to the tag issues cache right away - without waiting
    // for the user to press "⚠️ tag check" or "🚀 full review" first. This way "🧪 QA check" can catch
    // that this issue got fixed later, even if it was never in an old cache to begin with.
    function mergeQATagProblem(kind, serial, duration) {
        try {
            const existing = loadQATagProblemsFromStorage() || {};
            const missingAttrTags = existing.missingAttrTags || [];
            const shortDurationTags = existing.shortDurationTags || [];
            if (kind === 'missingAttr') {
                if (!missingAttrTags.includes(serial)) missingAttrTags.push(serial);
            } else if (kind === 'shortDuration') {
                const idx = shortDurationTags.findIndex(i => i.serial === serial);
                if (idx === -1) shortDurationTags.push({ serial, duration });
                else shortDurationTags[idx].duration = duration; // نحدّث المدة الأصلية لو اتغيّرت
            }
            cacheQATagProblems(missingAttrTags, shortDurationTags);
        } catch (e) { /* تجاهل */ }
    }

    // ---- Word-level diff (LCS) - returns only the differences (replace/delete/insert) ----
    function wordDiff(oldText, newText) {
        const oldWords = (oldText || '').split(/\s+/).filter(Boolean);
        const newWords = (newText || '').split(/\s+/).filter(Boolean);
        const n = oldWords.length, m = newWords.length;
        const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
        for (let i = 1; i <= n; i++) {
            for (let j = 1; j <= m; j++) {
                dp[i][j] = oldWords[i - 1] === newWords[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
            }
        }
        const ops = [];
        let i = n, j = m;
        while (i > 0 && j > 0) {
            if (oldWords[i - 1] === newWords[j - 1]) { ops.push({ type: 'same' }); i--; j--; }
            else if (dp[i - 1][j] >= dp[i][j - 1]) { ops.push({ type: 'delete', word: oldWords[i - 1] }); i--; }
            else { ops.push({ type: 'insert', word: newWords[j - 1] }); j--; }
        }
        while (i > 0) { ops.push({ type: 'delete', word: oldWords[i - 1] }); i--; }
        while (j > 0) { ops.push({ type: 'insert', word: newWords[j - 1] }); j--; }
        ops.reverse();

        const merged = [];
        for (let k = 0; k < ops.length; k++) {
            if (ops[k].type === 'delete' && ops[k + 1] && ops[k + 1].type === 'insert') {
                merged.push({ type: 'replace', oldWord: ops[k].word, newWord: ops[k + 1].word });
                k++;
            } else if (ops[k].type === 'delete') {
                merged.push({ type: 'delete', oldWord: ops[k].word });
            } else if (ops[k].type === 'insert') {
                merged.push({ type: 'insert', newWord: ops[k].word });
            }
        }
        return merged;
    }

    // Returns the grammatically correct "count + time(s)" Arabic phrase based on number/counted-noun rules:
    // 1 = "once", 2 = "twice", 3-10 = "X times", 11+ = "X time"
    function formatArabicTimes(count) {
        if (count === 1) return 'مرة واحدة';
        if (count === 2) return 'مرتين';
        if (count >= 3 && count <= 10) return count + ' مرات';
        return count + ' مرة';
    }

    // Tries to classify the type of difference between two similarly-shaped words (same letters except one) - the most common Arabic spelling mistakes
    function classifyWordChange(oldWord, newWord) {
        if (oldWord === newWord || oldWord.length !== newWord.length) return null;
        const groups = [['ا', 'أ', 'إ', 'آ'], ['ة', 'ه'], ['ي', 'ى']];
        const labels = ['hamza', 'ta_ha', 'ya_alef'];
        for (let g = 0; g < groups.length; g++) {
            const set = groups[g];
            let onlyThisGroupDiffers = true;
            for (let k = 0; k < oldWord.length; k++) {
                if (oldWord[k] === newWord[k]) continue;
                if (!set.includes(oldWord[k]) || !set.includes(newWord[k])) { onlyThisGroupDiffers = false; break; }
            }
            if (onlyThisGroupDiffers) return labels[g];
        }
        return null;
    }

    const QA_LABELS = { hamza: 'تصحيح همزة', ta_ha: 'تصحيح تاء مربوطة/هاء', ya_alef: 'تصحيح ياء/ألف مقصورة' };

    // Cleans the text of "cosmetic" differences that aren't real (extra spaces at start/end, double spaces, invisible
    // characters like Zero-Width Space/BOM that can get stuck in by accident during copy/paste, and NFC/NFD Unicode representation differences)
    // - this is exactly what stops "deleted a word and retyped the exact same one" from being counted as an error or a new edit,
    // since the real comparison (is there an actual difference in meaning/content?) happens on this cleaned version, not the raw text.
    function normalizeForQACompare(s) {
        return (s || '')
            .normalize('NFC')
            .replace(/[\u200B-\u200F\u202A-\u202E\uFEFF]/g, '')
            .trim()
            .replace(/\s+/g, ' ');
    }

    // Returns true only if there's a real difference (after cleaning) between the two texts - this is the single source of truth for "was this actually edited or not"
    function hasRealTextChange(oldText, newText) {
        return normalizeForQACompare(oldText) !== normalizeForQACompare(newText);
    }

    // Compares one segment (original text vs final text) and returns all notes, categorized by priority
    function analyzeSegmentQA(serial, originalText, finalText) {
        const entry = { serial, originalText, finalText, criticalIssues: [], spellingIssues: [], otherChanges: [] };

        // 1) Grammar violations that existed in the original and got fixed in the final (reuses the existing writing-rules checker)
        const oldIssues = checkWritingRules(originalText, false);
        const newIssuesSet = new Set(checkWritingRules(finalText, false));
        oldIssues.forEach(issue => { if (!newIssuesSet.has(issue)) entry.criticalIssues.push('تم تصحيح مخالفة قواعد: ' + issue); });

        // 2) A tag's shape changed (text that looks like a tag, like <NOISE>, changed or got removed) - compared after cleaning so a hidden
        // extra space or invisible character we didn't add on purpose doesn't get counted as a fake "tag edit"
        const oldIsTag = /^<[A-Za-z]+>$/.test(normalizeForQACompare(originalText));
        const newIsTag = /^<[A-Za-z]+>$/.test(normalizeForQACompare(finalText));
        if ((oldIsTag || newIsTag) && hasRealTextChange(originalText, finalText)) {
            entry.criticalIssues.push('تعديل في شكل التاج: "' + originalText.trim() + '" ← "' + finalText.trim() + '"');
        }

        // 3) Word-level differences (spelling / replace / delete / insert) - we run the diff on the cleaned version
        // so a word that got deleted and retyped exactly the same (even with a hidden copy/paste character) doesn't get flagged as a difference
        wordDiff(normalizeForQACompare(originalText), normalizeForQACompare(finalText)).forEach(d => {
            if (d.type === 'replace') {
                const cls = classifyWordChange(d.oldWord, d.newWord);
                const text = (cls ? QA_LABELS[cls] : 'استبدال كلمة') + ': "' + d.oldWord + '" ← "' + d.newWord + '"';
                (cls ? entry.spellingIssues : entry.otherChanges).push(text);
            } else if (d.type === 'delete') {
                entry.otherChanges.push('حذف كلمة: "' + d.oldWord + '"');
            } else if (d.type === 'insert') {
                entry.otherChanges.push('إضافة كلمة: "' + d.newWord + '"');
            }
        });

        return entry;
    }

    function cacheQAReportData(segmentReports) {
        try { localStorage.setItem(QA_REPORT_CACHE_KEY, JSON.stringify({ timestamp: Date.now(), reports: segmentReports })); } catch (e) { /* تجاهل */ }
    }

    function loadCachedQAReport() {
        try {
            const raw = localStorage.getItem(QA_REPORT_CACHE_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch (e) { return null; }
    }

    async function generateQAReport(btn) {
        const baselineKeys = Object.keys(qaBaseline);
        const tagProblems = loadQATagProblemsFromStorage();
        const hasTagProblemsToCheck = !!(tagProblems && ((tagProblems.missingAttrTags || []).length > 0 || (tagProblems.shortDurationTags || []).length > 0));
        if (baselineKeys.length === 0 && !hasTagProblemsToCheck) {
            showToast('مفيش أي سيجمنتات اتعدلت في التاسك ده لحد دلوقتي - عدّل حاجة الأول وبعدين جرب تاني', true);
            return;
        }

        btn.textContent = '⏳ جاري تحليل الفروقات...';
        btn.disabled = true;

        const currentInfo = await collectAllRowInfo();
        const segmentReports = [];
        const bySerial = new Map();

        function getOrCreateEntry(serial) {
            let entry = bySerial.get(serial);
            if (!entry) {
                const cur = currentInfo[serial];
                const text = cur ? cur.text : '';
                entry = { serial, originalText: text, finalText: text, criticalIssues: [], spellingIssues: [], otherChanges: [] };
                bySerial.set(serial, entry);
                segmentReports.push(entry);
            }
            return entry;
        }

        baselineKeys.forEach(key => {
            const serial = Number(key);
            const originalText = qaBaseline[key];
            const cur = currentInfo[serial];
            const finalText = cur ? cur.text : originalText;
            if (!hasRealTextChange(originalText, finalText)) return;
            const analyzed = analyzeSegmentQA(serial, originalText, finalText);
            if (analyzed.criticalIssues.length + analyzed.spellingIssues.length + analyzed.otherChanges.length === 0) return;
            const entry = getOrCreateEntry(serial);
            entry.originalText = originalText;
            entry.finalText = finalText;
            entry.criticalIssues.push(...analyzed.criticalIssues);
            entry.spellingIssues.push(...analyzed.spellingIssues);
            entry.otherChanges.push(...analyzed.otherChanges);
        });

        // Catches a fixed tag issue (missing attribute / NOISE tag under half a second) even if the fix happened
        // without touching the segment's text itself (like adjusting the tag boundary from the player), since that wouldn't show up in a normal text comparison
        if (tagProblems) {
            (tagProblems.missingAttrTags || []).forEach(serial => {
                const cur = currentInfo[serial];
                if (!cur) return;
                const isTagShaped = /^<[A-Za-z]+>$/.test(cur.text);
                const stillMissing = isTagShaped && !cur.hasAttrTag;
                if (stillMissing) return;
                getOrCreateEntry(serial).criticalIssues.push('تم تصليح: تاج "' + cur.text + '" كان من غير Attribute متحدد له، وبقى ليه Attribute دلوقتي');
            });
            for (const item of (tagProblems.shortDurationTags || [])) {
                const serial = item.serial;
                const cur = currentInfo[serial];
                if (!cur) continue;
                const stillHasNoise = cur.hasAttrTag && cur.attrTagTexts.includes('<NOISE>');
                if (!stillHasNoise) {
                    getOrCreateEntry(serial).criticalIssues.push('تم تصليح: تاج "<NOISE>" كانت مدته أقل من نص ثانية (' + item.duration.toFixed(3) + 's)، واتشال أو اتغيّر خالص');
                    continue;
                }
                // Important: this segment's row element might not exist in the DOM right now if the page
                // changed after collectAllRowInfo ran over it (it scrolls through all pages and leaves the last one visible),
                // so we first make sure it's actually loaded before reading its duration - otherwise this used to return null and the fix wouldn't count
                // even if the tag really was extended from the player.
                await locateRowBySerial(serial);
                const curDuration = getRegionDuration(cur.regionId);
                if (curDuration === null || curDuration < 0.5) continue; // لسه قصيرة أو معرفناش نتأكد - متتحسبش تصليح
                getOrCreateEntry(serial).criticalIssues.push('تم تصليح: تاج "<NOISE>" كانت مدته أقل من نص ثانية (' + item.duration.toFixed(3) + 's)، وبقت مدته أطول دلوقتي (' + curDuration.toFixed(3) + 's)');
            }
        }

        segmentReports.sort((a, b) => a.serial - b.serial);

        btn.textContent = '🧪 فحص QA';
        btn.disabled = false;

        if (segmentReports.length === 0) {
            showToast('مفيش أي فروقات جوهرية بين الأصلي والنهائي لحد دلوقتي ✅');
            return;
        }

        cacheQAReportData(segmentReports);
        showQAReportPanel(segmentReports);
    }

    // ==================== Part 9.6.1: categorize recurring mistakes + ready-made message for the transcriber (v20.0) ====================
    // Takes the text of any note (from criticalIssues/spellingIssues/otherChanges) and figures out its general type
    // so we can group "most common weak points" instead of every note standing alone. Order matters: we check the most specific case first.
    function categorizeQAIssue(text) {
        if (text.includes('كان من غير Attribute متحدد له')) return { key: 'tag_missing_attr', label: '🏷️ تاج بدون Attribute محدد (زي NOISE بلا Attribute)' };
        if (text.includes('كانت مدته أقل من نص ثانية')) return { key: 'tag_short_duration', label: '⏱️ تاج NOISE مدته أقل من نص ثانية' };
        if (text.includes('تعديل في شكل التاج')) return { key: 'tags', label: '🔗 التاجات (زي NOISE وغيرها)' };
        if (text.includes('مسافة')) return { key: 'spacing', label: '📏 المسافات (بين الكلمات/الأرقام/الحروف)' };
        if (text.includes('همزة')) return { key: 'hamza', label: '🔤 إملاء الهمزة' };
        if (text.includes('تاء مربوطة') || text.includes(' هاء')) return { key: 'ta_ha', label: '🔤 التاء المربوطة/الهاء' };
        if (text.includes('ياء') || text.includes('ألف مقصورة')) return { key: 'ya_alef', label: '🔤 الياء/الألف المقصورة' };
        if (text.includes('🇹🇳') || text.includes('لهجة')) return { key: 'dialect', label: '🗣️ كلمات اللهجة (فرنسي دارج/لبناني/تونسي)' };
        if (text.includes('كلمة إنجليزية') || text.includes('تتكتب عربي') || text.includes('حالة الأحرف')) return { key: 'english_words', label: '🔤 كلمات إنجليزية مكتوبة غلط' };
        if (text.includes('#️⃣') || text.includes('هاشتاج') || text.includes('فيلر')) return { key: 'filler', label: '#️⃣ الفيلر وردز/الهاشتاجات' };
        if (text.includes('صيغة %') || text.includes('رقم مدوّر') || text.includes('أرقام هندية')) return { key: 'numbers', label: '🔢 الأرقام/النسب المئوية' };
        if (text.includes('علامة ترقيم') || text.includes('فاصلة') || text.includes('تنوين')) return { key: 'punctuation', label: '🚫 علامات الترقيم' };
        if (text.includes('إملاء غلط') || text.includes('اختصار غلط')) return { key: 'spelling_general', label: '✏️ إملاء عام' };
        if (text.includes('تصحيح مخالفة قواعد')) return { key: 'rules_general', label: '📐 قواعد كتابة عامة' };
        if (text.includes('استبدال كلمة')) return { key: 'word_replace', label: '✏️ استبدال كلمات (تعديل صياغة)' };
        if (text.includes('حذف كلمة')) return { key: 'word_delete', label: '✏️ حذف كلمات' };
        if (text.includes('إضافة كلمة')) return { key: 'word_add', label: '✏️ إضافة كلمات' };
        return { key: 'other', label: '✏️ تعديلات أخرى' };
    }

    // Tries to pull a short "concrete example" out of the note text (like "eno" ← "enno" or "<NOISE>" ← "<DEAF>")
    // so the message sent to the transcriber isn't vague (like "general spelling") and shows them exactly what the mistake looked like
    function extractExampleFromIssueText(text) {
        const quotes = text.match(/"([^"]*)"/g);
        if (quotes && quotes.length >= 2) return quotes[0] + ' ← ' + quotes[1];
        if (quotes && quotes.length === 1) return quotes[0];
        const idx = text.indexOf(': ');
        if (idx >= 0) {
            const rest = text.slice(idx + 2).trim();
            return rest.length > 0 && rest.length <= 60 ? rest : null;
        }
        return null;
    }

    // Gathers all notes from every segment into categories, and returns them sorted from most to least frequent, each category
    // comes with its repeat count, the segment numbers it appeared in (deduplicated), and concrete examples (up to 2) of what the mistake actually looked like
    function computeQAMistakePatterns(segmentReports) {
        const map = new Map(); // key -> { label, count, serials:Set, examples:[] }
        segmentReports.forEach(r => {
            [...r.criticalIssues, ...r.spellingIssues, ...r.otherChanges].forEach(issueText => {
                const { key, label } = categorizeQAIssue(issueText);
                if (!map.has(key)) map.set(key, { key, label, count: 0, serials: new Set(), examples: [] });
                const entry = map.get(key);
                entry.count++;
                entry.serials.add(r.serial);
                if (entry.examples.length < 2) {
                    const ex = extractExampleFromIssueText(issueText);
                    if (ex && !entry.examples.includes(ex)) entry.examples.push(ex);
                }
            });
        });
        return Array.from(map.values())
            .map(p => ({ key: p.key, label: p.label, count: p.count, serials: Array.from(p.serials).sort((a, b) => a - b), examples: p.examples }))
            .sort((a, b) => b.count - a.count);
    }

    // Returns the segment numbers as a short, readable string (not a long list that wastes the reader's time)
    function formatSerialsCompact(serials, maxShown) {
        const limit = maxShown || 12;
        if (serials.length <= limit) return serials.join('، ');
        return serials.slice(0, limit).join('، ') + ' ... (+' + (serials.length - limit) + ' كمان)';
    }

    // Several varied professional phrasings for the message - in the reviewer's own voice (singular, not plural), so each
    // new message comes out phrased differently from the last, instead of the same repeated text on every export
    const TRANSCRIBER_GREETINGS = [
        'السلام عليكم، تحية طيبة 🌹',
        'أهلاً بيك، تحية ليك 🌹',
        'السلام عليكم ورحمة الله وبركاته',
        'تحية طيبة وبعد،',
        'أهلاً وسهلاً بيك،',
        'السلام عليكم، وحياك الله 🌹'
    ];
    const TRANSCRIBER_INTROS = [
        'بعد ما راجعت شغلك في التاسك ده، لاحظت إن في كام نقطة بتتكرر معاك، وحابب ألفت نظرك ليها عشان تاخد بالك منها في التاسكات الجايه:',
        'راجعت التاسك ده، ولاحظت إن في بعض النقط بتتكرر معاك بشكل واضح، حابب أوضحهالك بالتفصيل عشان تنتبه ليها المرات الجايه:',
        'وأنا براجع شغلك في التاسك ده، لاحظت إن في كام نقطة متكررة حابب ألفت نظرك ليها، مع توضيح شكل كل واحدة فيهم:',
        'بعد المراجعة، لاحظت إن في شوية نقط بتتكرر معاك في أكتر من سيجمنت، وده تفصيلها عشان الصورة تبقى واضحة قدامك:',
        'راجعت الشغل بتاعك، ولاحظت النقط دي بتتكرر معاك، حابب أشرحهالك عشان تفهمها صح وتتجنبها بعد كده:'
    ];
    const TRANSCRIBER_CLOSINGS = [
        'ياريت تركّز عليها في شغلك الجاي، ده هيوفّر وقت المراجعة وهيرفع مستوى التسليم بتاعك. تسلم على مجهودك 🌹',
        'برجاء الانتباه للنقط دي في التاسكات الجايه، وده هيفرق كتير في جودة التسليم. تسلم على تعبك 🌹',
        'لو ركزت على النقط دي في المرات الجايه، هتوفّر وقت كبير في المراجعة. شكراً على مجهودك معانا 🌹',
        'أتمنى تاخد بالك من النقط دي المرة الجاية، وأي استفسار أنا موجود. تسلم إيدك 🌹',
        'حابب بس ألفت نظرك للنقط دي عشان الشغل الجاي يطلع أنضف، وتسلم على المجهود المبذول 🌹'
    ];

    const transcriberMessageState = { greeting: { last: -1 }, intro: { last: -1 }, closing: { last: -1 } };

    // Builds a ready-made message in Arabic, polite, in the reviewer's own voice (singular), summarizing the most common recurring weak points and where they are
    // with a concrete example of what the mistake actually looked like (not a vague description) - as one BULK block ready to copy and paste,
    // with a blank line for the reviewer to fill in the task number themselves. The phrasing differs every time the message is built.
    function buildTranscriberBulkMessage(patterns) {
        const top = patterns.filter(p => p.count > 0).slice(0, 8);
        if (top.length === 0) return '';
        const lines = [];
        lines.push(pickRandomNoRepeat(TRANSCRIBER_GREETINGS, transcriberMessageState.greeting));
        lines.push('');
        lines.push('رقم التاسك: __________');
        lines.push('');
        lines.push(pickRandomNoRepeat(TRANSCRIBER_INTROS, transcriberMessageState.intro));
        lines.push('');
        top.forEach((p, i) => {
            let line = (i + 1) + ') ' + p.label + ' — اتكررت ' + formatArabicTimes(p.count) + '، في السيجمنتات: ' + formatSerialsCompact(p.serials);
            if (p.examples && p.examples.length) line += '\n   مثال: ' + p.examples.join('، ');
            lines.push(line);
        });
        lines.push('');
        lines.push(pickRandomNoRepeat(TRANSCRIBER_CLOSINGS, transcriberMessageState.closing));
        return lines.join('\n');
    }

    // A note for the reviewer themselves (not the transcriber) - reminding them they can edit the report's wording however they like,
    // and add anything they noticed themselves that the tool couldn't catch, before sending it to the transcriber.
    function buildReviewerNote() {
        return 'ملحوظة ليك إنت (المراجع): التقرير ده وأي رسالة جواه اتبنوا آلياً كنقطة بداية بس - اتصرف فيهم زي ما يريحك، '
            + 'عدّل في الصياغة أو الأسلوب بما يتناسب مع طريقتك في التواصل، وضيف عليهم أي ملاحظات تانية لاحظتها بنفسك ولم تلقطها الأداة، '
            + 'قبل ما تبعت أي حاجة منهم للمفرغ.';
    }

    function showQAReportPanel(segmentReports) {
        const totalCritical = segmentReports.reduce((s, r) => s + r.criticalIssues.length, 0);
        const totalSpelling = segmentReports.reduce((s, r) => s + r.spellingIssues.length, 0);
        const totalOther = segmentReports.reduce((s, r) => s + r.otherChanges.length, 0);

        const overviewSections = [{
            heading: null,
            items: [
                { text: '📝 عدد السيجمنتات اللي اتعدلت: ' + segmentReports.length, type: 'info' },
                { text: '🚨 أخطاء حرجة (تاجات/مسافات/قواعد): ' + totalCritical, type: totalCritical > 0 ? 'warn' : 'ok' },
                { text: '🔤 أخطاء إملائية (همزات/تاء-هاء/ياء-ألف مقصورة): ' + totalSpelling, type: totalSpelling > 0 ? 'warn' : 'ok' },
                { text: '✏️ تعديلات أخرى (استبدال/حذف/إضافة كلمات): ' + totalOther, type: 'info' }
            ]
        }];

        const detailSections = segmentReports.map(r => ({
            heading: 'سيجمنت ' + r.serial,
            items: [
                { text: '📄 قبل: ' + r.originalText, type: 'info' },
                { text: '✅ بعد: ' + r.finalText, type: 'ok' },
                ...r.criticalIssues.map(i => ({ text: i, type: 'warn' })),
                ...r.spellingIssues.map(i => ({ text: i, type: 'warn' })),
                ...r.otherChanges.map(i => ({ text: i, type: 'info' }))
            ]
        }));

        const criticalSections = segmentReports.filter(r => r.criticalIssues.length > 0)
            .map(r => ({ heading: 'سيجمنت ' + r.serial, items: r.criticalIssues.map(i => ({ text: i, type: 'warn' })) }));
        const spellingSections = segmentReports.filter(r => r.spellingIssues.length > 0)
            .map(r => ({ heading: 'سيجمنت ' + r.serial, items: r.spellingIssues.map(i => ({ text: i, type: 'warn' })) }));
        const otherSections = segmentReports.filter(r => r.otherChanges.length > 0)
            .map(r => ({ heading: 'سيجمنت ' + r.serial, items: r.otherChanges.map(i => ({ text: i, type: 'info' })) }));

        // Most common recurring mistakes + ready-made message for the transcriber + note for the reviewer
        const mistakePatterns = computeQAMistakePatterns(segmentReports);
        const mistakesSections = [{
            heading: null,
            items: mistakePatterns.filter(p => p.count > 0).map(p => ({
                text: p.label + ' — اتكررت ' + formatArabicTimes(p.count) + ' (السيجمنتات: ' + formatSerialsCompact(p.serials) + ')',
                type: 'warn'
            }))
        }];
        const transcriberMessage = buildTranscriberBulkMessage(mistakePatterns);
        const messageSections = transcriberMessage
            ? [{ heading: null, items: [{ text: transcriberMessage, type: 'info' }] }]
            : [];
        const reviewerNoteSections = [{ heading: null, items: [{ text: buildReviewerNote(), type: 'ok' }] }];

        const tabs = [
            { id: 'overview', label: '📊 نظرة عامة', sections: overviewSections, emptyMessage: '', excludeFromTotal: true, fixAction: null },
            { id: 'details', label: '📋 تفاصيل كل سيجمنت', sections: detailSections, emptyMessage: 'مفيش فروقات', excludeFromTotal: true, fixAction: null },
            { id: 'critical', label: '🚨 أخطاء حرجة', sections: criticalSections, emptyMessage: 'مفيش أخطاء حرجة ✅', fixAction: null },
            { id: 'spelling', label: '🔤 إملائية', sections: spellingSections, emptyMessage: 'مفيش أخطاء إملائية ✅', fixAction: null },
            { id: 'other', label: '✏️ تعديلات أخرى', sections: otherSections, emptyMessage: 'مفيش تعديلات تانية', fixAction: null },
            { id: 'mistakes', label: '📌 أشهر الأخطاء المتكررة', sections: mistakesSections, emptyMessage: 'مفيش نمط متكرر واضح', excludeFromTotal: true, fixAction: null },
            { id: 'message', label: '✉️ رسالة جاهزة للمفرغ', sections: messageSections, emptyMessage: 'مفيش نقط كفاية لعمل رسالة لسه', excludeFromTotal: true, fixAction: null },
            { id: 'reviewernote', label: '📝 ملحوظة ليك', sections: reviewerNoteSections, emptyMessage: '', excludeFromTotal: true, fixAction: null }
        ];
        showReviewPanel(tabs);
    }

    function addQAReportButton() {
        const btn = document.createElement('button');
        btn.textContent = '🧪 فحص QA';
        btn.style.cssText = 'position:fixed;bottom:165px;left:940px;z-index:99999;background:#be185d;color:#fff;border:none;padding:10px 16px;font-size:14px;font-weight:bold;cursor:pointer;';
        btn.onclick = () => generateQAReport(btn);
        document.body.appendChild(btn);
    }

    function buildQAReportHtmlDoc(segmentReports) {
        const totalCritical = segmentReports.reduce((s, r) => s + r.criticalIssues.length, 0);
        const totalSpelling = segmentReports.reduce((s, r) => s + r.spellingIssues.length, 0);
        const totalOther = segmentReports.reduce((s, r) => s + r.otherChanges.length, 0);
        const now = new Date();

        let body = '';
        segmentReports.forEach(r => {
            const allReasons = [
                ...r.criticalIssues.map(t => ({ t, c: 'critical' })),
                ...r.spellingIssues.map(t => ({ t, c: 'spelling' })),
                ...r.otherChanges.map(t => ({ t, c: 'other' }))
            ];
            body += '<div class="seg-block"><h3>سيجمنت ' + r.serial + '</h3>' +
                '<div class="line orig">قبل: ' + escapeHtml(r.originalText) + '</div>' +
                '<div class="line final">بعد: ' + escapeHtml(r.finalText) + '</div>' +
                (allReasons.length ? ('<ul>' + allReasons.map(x => '<li class="' + x.c + '">' + escapeHtml(x.t) + '</li>').join('') + '</ul>') : '') +
                '</div>';
        });

        // Most common recurring mistakes
        const mistakePatterns = computeQAMistakePatterns(segmentReports).filter(p => p.count > 0);
        const mistakesHtml = mistakePatterns.length
            ? '<ol class="mistakes-list">' + mistakePatterns.map(p =>
                '<li><b>' + escapeHtml(p.label) + '</b> — اتكررت ' + escapeHtml(formatArabicTimes(p.count)) + ' <span class="locs">(السيجمنتات: ' + escapeHtml(formatSerialsCompact(p.serials)) + ')</span>' +
                (p.examples && p.examples.length ? ' <span class="locs">— مثال: ' + escapeHtml(p.examples.join('، ')) + '</span>' : '') +
                '</li>'
              ).join('') + '</ol>'
            : '<p class="muted">مفيش نمط متكرر واضح لحد دلوقتي.</p>';

        // Ready-made message for the transcriber (BULK) - in a textarea you can edit however you like, with a one-click copy button
        const transcriberMessage = buildTranscriberBulkMessage(mistakePatterns);
        const messageHtml = transcriberMessage
            ? '<div class="msg-wrap">' +
              '<textarea id="tx-msg-box" class="msg-box">' + escapeHtml(transcriberMessage) + '</textarea>' +
              '<div class="msg-toolbar"><button type="button" class="msg-copy-btn" onclick="txCopyMsg(this)"><span class="msg-copy-icon">📋</span><span class="msg-copy-label">نسخ الرسالة</span></button></div>' +
              '</div>' +
              '<p class="muted">تقدر تعدّل في نص الرسالة جوه المربع زي ما يريحك قبل ما تبعتها.</p>'
            : '<p class="muted">مفيش نقط كفاية لعمل رسالة لسه.</p>';

        const reviewerNoteHtml = '<p class="reviewer-note">' + escapeHtml(buildReviewerNote()) + '</p>';

        return '<!DOCTYPE html>\n<html lang="ar" dir="rtl"><head><meta charset="UTF-8">\n' +
            '<title>تقرير مراجعة الجودة (QA)</title>\n' +
            '<style>\n' +
            'body{font-family:"Cairo","Segoe UI",Tahoma,sans-serif;background:#0f0f14;color:#e5e7eb;padding:36px;direction:rtl;line-height:1.8;}\n' +
            'h1{color:#a78bfa;border-bottom:2px solid #7c3aed;padding-bottom:12px;margin-bottom:4px;}\n' +
            'h2{color:#c4b5fd;font-size:17px;margin:34px 0 12px;}\n' +
            '.meta{color:#94a3b8;font-size:13px;margin-bottom:20px;}\n' +
            '.stats{display:flex;gap:14px;margin:20px 0;flex-wrap:wrap;}\n' +
            '.stat{background:rgba(124,58,237,0.14);border:1px solid rgba(167,139,250,0.35);border-radius:14px;padding:14px 22px;min-width:150px;}\n' +
            '.stat b{display:block;font-size:22px;color:#c4b5fd;margin-top:4px;}\n' +
            '.seg-block{background:rgba(255,255,255,0.04);border-radius:14px;padding:16px 20px;margin-bottom:14px;}\n' +
            '.seg-block h3{color:#fbbf24;margin:0 0 8px;font-size:15px;}\n' +
            '.line{margin-bottom:4px;}\n' +
            '.line.orig{color:#fca5a5;text-decoration:line-through;}\n' +
            '.line.final{color:#86efac;margin-bottom:10px;}\n' +
            'ul{margin:0;padding-inline-start:20px;}\n' +
            'li{margin-bottom:4px;}\n' +
            'li.critical{color:#fca5a5;}\n' +
            'li.spelling{color:#fcd34d;}\n' +
            'li.other{color:#93c5fd;}\n' +
            '.mistakes-list{background:rgba(255,255,255,0.04);border-radius:14px;padding:16px 34px;}\n' +
            '.mistakes-list li{margin-bottom:8px;color:#fcd34d;}\n' +
            '.mistakes-list .locs{color:#94a3b8;font-weight:normal;font-size:13px;}\n' +
            '.msg-wrap{position:relative;}\n' +
            '.msg-box{width:100%;min-height:220px;box-sizing:border-box;background:linear-gradient(160deg, rgba(124,58,237,0.10), rgba(255,255,255,0.03));backdrop-filter:blur(16px) saturate(180%);-webkit-backdrop-filter:blur(16px) saturate(180%);color:#f1f5f9;border:1px solid rgba(167,139,250,0.4);border-radius:18px;padding:18px;font-family:inherit;font-size:14px;line-height:1.9;direction:rtl;resize:vertical;box-shadow:inset 0 1px 0 rgba(255,255,255,0.08), 0 10px 30px rgba(0,0,0,0.3), 0 0 30px rgba(124,58,237,0.1);transition:border-color 0.2s ease, box-shadow 0.2s ease;}\n' +
            '.msg-box:focus{outline:none;border-color:rgba(167,139,250,0.75);box-shadow:inset 0 1px 0 rgba(255,255,255,0.1), 0 10px 30px rgba(0,0,0,0.35), 0 0 0 3px rgba(124,58,237,0.22);}\n' +
            '.msg-box::-webkit-scrollbar{width:8px;}\n' +
            '.msg-box::-webkit-scrollbar-track{background:transparent;}\n' +
            '.msg-box::-webkit-scrollbar-thumb{background:rgba(167,139,250,0.4);border-radius:10px;}\n' +
            '.msg-box::-webkit-scrollbar-thumb:hover{background:rgba(167,139,250,0.6);}\n' +
            '.msg-toolbar{display:flex;justify-content:flex-start;margin-top:10px;}\n' +
            '.msg-copy-btn{display:flex;align-items:center;gap:6px;border:1px solid rgba(255,255,255,0.14);border-radius:10px;padding:9px 16px;font-family:inherit;font-size:13px;font-weight:700;color:#fff;cursor:pointer;background:linear-gradient(135deg,rgba(124,58,237,0.85),rgba(99,102,241,0.7));box-shadow:0 6px 16px rgba(124,58,237,0.25);transition:transform 0.15s ease,filter 0.15s ease,box-shadow 0.15s ease;}\n' +
            '.msg-copy-btn:hover{filter:brightness(1.12);box-shadow:0 8px 20px rgba(124,58,237,0.35);transform:translateY(-1px);}\n' +
            '.msg-copy-btn:active{transform:translateY(0);filter:brightness(0.95);}\n' +
            '.msg-copy-btn.msg-copied{background:linear-gradient(135deg,rgba(16,185,129,0.85),rgba(5,150,105,0.7));}\n' +
            '.reviewer-note{background:rgba(34,197,94,0.08);border:1px solid rgba(134,239,172,0.35);border-radius:14px;padding:14px 18px;color:#86efac;font-size:13.5px;}\n' +
            '.muted{color:#94a3b8;font-size:13px;}\n' +
            '@media print{body{background:#fff;color:#111;} .seg-block{background:#f4f4f6;} .line.orig{color:#b91c1c;} .line.final{color:#15803d;} .stat{background:#f0ebff;border-color:#c4b5fd;} .stat b{color:#5b21b6;} .mistakes-list{background:#f4f4f6;} .msg-box{background:#f9fafb;color:#111;} .reviewer-note{background:#ecfdf3;color:#166534;}}\n' +
            '</style></head><body>\n' +
            '<h1>🧪 تقرير مراجعة الجودة (QA)</h1>\n' +
            '<div class="meta">تاريخ التقرير: ' + escapeHtml(now.toLocaleString('ar-EG')) + '</div>\n' +
            '<div class="stats">\n' +
            '<div class="stat">سيجمنتات معدَّلة<b>' + segmentReports.length + '</b></div>\n' +
            '<div class="stat">أخطاء حرجة (تاجات/مسافات/قواعد)<b>' + totalCritical + '</b></div>\n' +
            '<div class="stat">أخطاء إملائية<b>' + totalSpelling + '</b></div>\n' +
            '<div class="stat">تعديلات أخرى<b>' + totalOther + '</b></div>\n' +
            '</div>\n' +
            reviewerNoteHtml + '\n' +
            '<h2>📌 أشهر الأخطاء المتكررة</h2>\n' + mistakesHtml + '\n' +
            '<h2>✉️ رسالة جاهزة للمفرغ (اتحدد الرقم يدوياً)</h2>\n' + messageHtml + '\n' +
            '<h2>📋 تفاصيل كل سيجمنت</h2>\n' + body +
            '<script>\n' +
            'function txCopyMsg(btn){\n' +
            '  var box = document.getElementById("tx-msg-box");\n' +
            '  var text = box.value;\n' +
            '  var label = btn.querySelector(".msg-copy-label");\n' +
            '  var icon = btn.querySelector(".msg-copy-icon");\n' +
            '  function showCopied(ok){\n' +
            '    icon.textContent = ok ? "✅" : "❌";\n' +
            '    label.textContent = ok ? "اتنسخت!" : "فشل النسخ";\n' +
            '    btn.classList.toggle("msg-copied", ok);\n' +
            '    setTimeout(function(){ icon.textContent = "📋"; label.textContent = "نسخ الرسالة"; btn.classList.remove("msg-copied"); }, 1800);\n' +
            '  }\n' +
            '  if (navigator.clipboard && window.isSecureContext) {\n' +
            '    navigator.clipboard.writeText(text).then(function(){ showCopied(true); }).catch(function(){ fallbackCopyMsg(box, showCopied); });\n' +
            '  } else {\n' +
            '    fallbackCopyMsg(box, showCopied);\n' +
            '  }\n' +
            '}\n' +
            'function fallbackCopyMsg(box, showCopied){\n' +
            '  try { box.select(); box.setSelectionRange(0, box.value.length); var ok = document.execCommand("copy"); showCopied(ok); }\n' +
            '  catch (e) { showCopied(false); }\n' +
            '}\n' +
            '</script>\n' +
            '</body></html>';
    }

    function exportQAReport() {
        const cached = loadCachedQAReport();
        if (!cached || !cached.reports || cached.reports.length === 0) {
            showToast('لازم تعمل "🧪 فحص QA" الأول قبل التصدير', true);
            return;
        }
        const html = buildQAReportHtmlDoc(cached.reports);
        const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'qa-report-' + getTodayKey() + '.html';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        showToast('اتحمّل تقرير الـ QA ✅ - جاهز تبعته للمفرغ');
    }

    function addExportQAReportButton() {
        const btn = document.createElement('button');
        btn.textContent = '📤 تصدير QA';
        btn.style.cssText = 'position:fixed;bottom:165px;left:1120px;z-index:99999;background:#9d174d;color:#fff;border:none;padding:10px 16px;font-size:14px;font-weight:bold;cursor:pointer;';
        btn.onclick = () => exportQAReport();
        document.body.appendChild(btn);
    }

    // ==================== Part 9.7: formatted QA report export - fully in English (v13.0) ====================
    // Per your request, the exported file is now entirely in English (title + stats + all the full-review details inside),
    // even though the tool's own UI still runs in Arabic. Translation only happens at export time, not on the live UI.
    const REPORT_TRANSLATIONS = [
        // tabs / main headings
        [/^📊\s*نظرة عامة$/, '📊 Overview'],
        [/^🔍\s*المسافات$/, '🔍 Whitespace'],
        [/^🈯\s*إنجليزي\/تشكيل$/, '🈯 English / Diacritics'],
        [/^📐\s*قواعد الكتابة$/, '📐 Writing Rules'],
        [/^⚠️\s*التاجات$/, '⚠️ Tags'],
        [/^🕒\s*آخر مراجعة$/, '🕒 Last Review'],

        // overview
        [/^🗣️\s*زمن الكلام الفعلي:\s*([\d.]+)\s*ثانية\s*\((\d+)\s*دقيقة و\s*([\d.]+)\s*ثانية\)\s*—\s*(\d+)\s*سيجمنت$/,
            '🗣️ Actual speech time: $1s ($2 min $3 sec) — $4 segments'],
        [/^⏱️\s*زمن التاجات:\s*([\d.]+)\s*ثانية\s*\((\d+)\s*دقيقة و\s*([\d.]+)\s*ثانية\)\s*—\s*(\d+)\s*سيجمنت$/,
            '⏱️ Tags time: $1s ($2 min $3 sec) — $4 segments'],
        [/^تفصيل زمن التاجات حسب النوع$/, 'Tag time breakdown by type'],

        // spacing
        [/^📏\s*مسافة زيادة في أول\/آخر السيجمنت$/, '📏 Leading/trailing whitespace'],
        [/^📏\s*مسافة مزدوجة بين كلمتين جوه السيجمنت$/, '📏 Double space between words inside a segment'],

        // English/diacritics
        [/^🔤\s*سيجمنتات فيها 3 كلمات إنجليزي أو أكتر$/, '🔤 Segments with 3+ English words'],
        [/^🚫\s*سيجمنتات فيها تشكيل عربي$/, '🚫 Segments with Arabic diacritics (tashkeel)'],

        // tags
        [/^🔗\s*تاجات متتالية من نفس النوع \(مرشحة للدمج\)$/, '🔗 Consecutive tags of the same type (merge candidates)'],
        [/^❌\s*سيجمنتات فيها نص تاج بدون Attribute$/, '❌ Tag-shaped text without an attribute'],
        [/^⏱️\s*تاجات NOISE أقل من نص ثانية$/, '⏱️ NOISE tags shorter than 0.5s'],
        [/^🔢\s*سيجمنتات فيها أكتر من تاج واحد$/, '🔢 Segments with more than one tag'],
        [/^📝\s*سيجمنتات فيها تاج \+ جملة كلام مع بعض$/, '📝 Segments mixing a tag with spoken text'],

        // empty messages
        [/^لا يوجد بيانات$/, 'No data'],
        [/^مفيش أي مشاكل مسافات$/, 'No whitespace issues'],
        [/^مفيش سيجمنتات فيها 3 كلمات إنجليزي أو أي تشكيل عربي$/, 'No segments with 3+ English words or Arabic diacritics'],
        [/^مفيش أي مخالفات$/, 'No violations'],
        [/^مفيش أي مشاكل في التاجات$/, 'No tag issues'],
        [/^مفيش أي مشاكل$/, 'No issues'],

        // generic items: "segment N" and "segment A and B (tag)" and "segment N — C words: words" and "segment N (extra)"
        [/^سيجمنت\s+(\d+)\s+و\s+(\d+)\s*\(([^)]*)\)$/, 'Segment $1 & $2 ($3)'],
        [/^سيجمنت\s+(\d+)\s*—\s*(\d+)\s*كلمة:\s*(.*)$/, 'Segment $1 — $2 word(s): $3'],
        [/^سيجمنت\s+(\d+)\s*\(([^)]*)\)$/, 'Segment $1 ($2)'],
        [/^سيجمنت\s+(\d+)$/, 'Segment $1'],

        // timestamp note for the stored version
        [/^🕒\s*النتيجة دي محفوظة من\s*(\d+)\s*دقيقة.*$/, '🕒 This cached result is $1 minute(s) old'],

        // writing rules - fixed messages
        [/^⚪\s*سيجمنت فاضي تماماً — مفيش نص ولا تاج$/, '⚪ Segment is completely empty — no text and no tag'],
        [/^🚫\s*علامة ترقيم ممنوعة \(! : ; ' "\)$/, '🚫 Disallowed punctuation mark (! : ; \' ")'],
        [/^🔢\s*أرقام هندية بدل الغربية$/, '🔢 Eastern Arabic digits instead of Western digits'],
        [/^٪\s*صيغة %\s*غلط:\s*"([^"]*)"\s*—.*$/, '٪ Wrong "%" format: "$1" — the % sign should directly follow the number with no space, e.g. 90%'],
        [/^📏\s*مسافة بين حرف جر\/واو والرقم$/, '📏 Space between a preposition/"و" and a number'],
        [/^📏\s*مسافة بين "ال" والرقم$/, '📏 Space between "ال" (the) and a number'],
        [/^📏\s*مسافة بين "ال" وكلمة إنجليزية$/, '📏 Space between "ال" (the) and an English word'],
        [/^📐\s*"كيلوغرام" بعد رقم لازم تختصر لـ كغ$/, '📐 "kilogram" after a number must be abbreviated to "kg"'],
        [/^📐\s*"متر" بعد رقم لازم تختصر لـ م$/, '📐 "meter" after a number must be abbreviated to "m"'],
        [/^📐\s*"لتر" بعد رقم لازم تختصر لـ ل$/, '📐 "liter" after a number must be abbreviated to "L"'],
        [/^📐\s*"درجة مئوية" بعد رقم لازم تختصر لـ °م$/, '📐 "degree Celsius" after a number must be abbreviated to "°C"'],
        [/^📐\s*"فولت" بعد رقم لازم تختصر لـ ف$/, '📐 "volt" after a number must be abbreviated to "V"'],
        [/^🔤\s*"([^"]*)"\s*كلمة إنجليزية مكتوبة عربي — المفروض:\s*(.*)$/, '🔤 "$1" is an English word transliterated in Arabic — should be: $2'],
        [/^✏️\s*"([^"]*)"\s*ناقصة همزة — المفروض:\s*(.*)$/, '✏️ "$1" is missing a hamza — should be: $2'],

        // filler/hashtag
        [/^#️⃣\s*عدد علامات # فردي \(مش متزاوج\) — فيه هاشتاج ناقص فتح أو قفل$/, '#️⃣ Odd number of "#" marks — an unmatched hashtag open/close'],
        [/^#️⃣\s*مسافة زايدة جوه الهاشتاج، المفروض تبقى لازقة:\s*(.*)$/, '#️⃣ Extra space inside hashtag, should be tight: $1'],
        [/^#️⃣\s*مسافة مزدوجة جوه الهاشتاج:\s*(.*)$/, '#️⃣ Double space inside hashtag: $1'],
        [/^#️⃣\s*محتوى الهاشتاج مش فيلر وردز صحيحة:\s*(.*)$/, '#️⃣ Hashtag content is not a valid filler word: $1'],
        [/^#️⃣\s*كلمة فيلر\s*"([^"]*)"\s*من غير هاشتاج حواليها خالص$/, '#️⃣ Filler word "$1" is not wrapped in a hashtag at all'],
        [/^#️⃣\s*مجموعتين هاشتاج متجاورتين لازم يتدمجوا في واحد:\s*(.*)$/, '#️⃣ Two adjacent hashtag groups must be merged into one: $1'],

        // today's stats
        [/^✅\s*عدد التاسكات اللي خلّصتها النهاردة:\s*(\d+)$/, '✅ Tasks finished today: $1'],
        [/^✏️\s*إجمالي السيجمنتات المُفرّغة النهاردة:\s*(\d+)$/, '✏️ Total segments transcribed today: $1'],
        [/^🗣️\s*زمن الكلام اللي فرّغته النهاردة:\s*([\d.]+)\s*ثانية\s*\((\d+)\s*دقيقة و\s*([\d.]+)\s*ثانية\)$/, '🗣️ Speech time transcribed today: $1s ($2 min $3 sec)'],
        [/^⏱️\s*زمن التاجات اللي عملتها النهاردة:\s*([\d.]+)\s*ثانية\s*\((\d+)\s*دقيقة و\s*([\d.]+)\s*ثانية\)$/, '⏱️ Tag time logged today: $1s ($2 min $3 sec)'],
        [/^⏳\s*وقت الشغل الفعلي النهاردة \(من التايمر\):\s*(\d+)\s*دقيقة و\s*(\d+)\s*ثانية$/, '⏳ Actual worked time today (from the timer): $1 min $2 sec'],
        [/^ℹ️.*$/, 'ℹ️ These numbers update only when you click "Finish Task" at the end of each task, so they stay accurate.'],
        [/^لسه مفيش أي تاسكات اتسجّلت النهاردة$/, 'No tasks logged yet today']
    ];

    function translateForReport(text) {
        if (text === null || text === undefined) return '';
        const str = String(text).trim();
        for (const [regex, replacement] of REPORT_TRANSLATIONS) {
            if (regex.test(str)) return str.replace(regex, replacement);
        }
        // no matching template - at minimum translate the word "segment" as a fallback, and leave the rest as-is
        return str.replace(/سيجمنت/g, 'Segment');
    }

    function buildQualityReportHtml() {
        const cached = loadCachedReview();
        const stats = loadDailyStats();
        const now = new Date();
        const timestamp = now.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';

        let reviewHtml = '';
        if (cached && cached.tabs) {
            cached.tabs.forEach(tab => {
                if (tab.excludeFromTotal && tab.sections.every(s => s.items.length === 0)) return;
                reviewHtml += '<h2>' + escapeHtml(translateForReport(tab.label)) + '</h2>';
                if (tab.sections.length === 0 || tab.sections.every(s => s.items.length === 0)) {
                    reviewHtml += '<p class="ok-box">✅ ' + escapeHtml(translateForReport(tab.emptyMessage || 'No issues')) + '</p>';
                } else {
                    tab.sections.forEach(sec => {
                        if (sec.heading) reviewHtml += '<h3>' + escapeHtml(translateForReport(sec.heading)) + '</h3>';
                        if (sec.items.length > 0) {
                            reviewHtml += '<ul>';
                            sec.items.forEach(item => {
                                const t = typeof item === 'string' ? item : item.text;
                                reviewHtml += '<li>' + escapeHtml(translateForReport(t)) + '</li>';
                            });
                            reviewHtml += '</ul>';
                        }
                    });
                }
            });
        } else {
            reviewHtml = '<p>No saved "Full Review" result yet — run "🚀 Full Review" before exporting so it gets included in the report.</p>';
        }

        const speechMin = Math.floor(stats.speechSeconds / 60);
        const speechRem = Math.round(stats.speechSeconds % 60);
        const tagMin = Math.floor(stats.tagSeconds / 60);
        const tagRem = Math.round(stats.tagSeconds % 60);
        const workedMin = Math.floor(stats.workedSeconds / 60);
        const workedRem = Math.round(stats.workedSeconds % 60);
        const reviewAgeNote = cached ? ('Included Full Review snapshot from: ' + new Date(cached.timestamp).toISOString().replace('T', ' ').slice(0, 19) + ' UTC') : '';

        return '<!DOCTYPE html>\n' +
            '<html lang="en" dir="ltr"><head><meta charset="UTF-8">\n' +
            '<title>Transcription Quality Report - ' + escapeHtml(stats.date) + '</title>\n' +
            '<style>\n' +
            'body{font-family:"Segoe UI",Tahoma,Arial,sans-serif;background:#0f0f14;color:#e5e7eb;padding:36px;direction:ltr;line-height:1.7;}\n' +
            'h1{color:#a78bfa;border-bottom:2px solid #7c3aed;padding-bottom:12px;margin-bottom:4px;}\n' +
            'h2{color:#38bdf8;margin-top:30px;border-bottom:1px solid rgba(56,189,248,0.25);padding-bottom:6px;}\n' +
            'h3{color:#fbbf24;margin-top:18px;font-size:15px;}\n' +
            'ul{background:rgba(255,255,255,0.04);border-radius:10px;padding:14px 30px;margin:8px 0;}\n' +
            'li{margin-bottom:6px;}\n' +
            '.ok-box{color:#34d399;background:rgba(16,185,129,0.08);padding:12px 16px;border-radius:10px;border:1px solid rgba(16,185,129,0.2);}\n' +
            '.meta{color:#94a3b8;font-size:13px;margin-bottom:22px;}\n' +
            '.stats-box{display:flex;gap:16px;margin:20px 0;flex-wrap:wrap;}\n' +
            '.stat-card{background:rgba(124,58,237,0.14);border:1px solid rgba(167,139,250,0.35);border-radius:14px;padding:16px 22px;min-width:190px;}\n' +
            '.stat-card b{display:block;font-size:22px;color:#c4b5fd;margin-top:6px;}\n' +
            '@media print{body{background:#fff;color:#111;}ul{background:#f4f4f6;}.stat-card{background:#f0ebff;color:#111;border-color:#c4b5fd;}.stat-card b{color:#5b21b6;}.ok-box{background:#ecfdf5;border-color:#a7f3d0;}}\n' +
            '</style></head><body>\n' +
            '<h1>📋 Transcription Quality Report</h1>\n' +
            '<div class="meta">Report generated: ' + escapeHtml(timestamp) + (reviewAgeNote ? ' — ' + escapeHtml(reviewAgeNote) : '') + '</div>\n' +
            '<div class="stats-box">\n' +
            '<div class="stat-card">Tasks finished today<b>' + stats.tasksFinished + '</b></div>\n' +
            '<div class="stat-card">Segments transcribed today<b>' + stats.segmentsEdited + '</b></div>\n' +
            '<div class="stat-card">Speech time transcribed today<b>' + speechMin + ' min ' + speechRem + ' sec</b></div>\n' +
            '<div class="stat-card">Tag time logged today<b>' + tagMin + ' min ' + tagRem + ' sec</b></div>\n' +
            '<div class="stat-card">Actual worked time today<b>' + workedMin + ' min ' + workedRem + ' sec</b></div>\n' +
            '</div>\n' +
            reviewHtml +
            '</body></html>';
    }

    function exportQualityReport() {
        const html = buildQualityReportHtml();
        const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'quality-report-' + getTodayKey() + '.html';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        showToast('اتحمّل تقرير الجودة بالإنجليزي ✅ - افتحه وبعدين Ctrl+P → Save as PDF لو محتاجه PDF');
    }

    function addExportReportButton() {
        const btn = document.createElement('button');
        btn.textContent = '🧾 تصدير المراجعة';
        btn.style.cssText = 'position:fixed;bottom:165px;left:560px;z-index:99999;background:#0f766e;color:#fff;border:none;padding:10px 16px;font-size:14px;font-weight:bold;cursor:pointer;';
        btn.onclick = () => exportQualityReport();
        document.body.appendChild(btn);
    }

    // ==================== Unified modern styling for all buttons (v10.0) ====================
    function injectModernButtonStyle() {
        if (document.getElementById('tx-tool-style')) return;
        const style = document.createElement('style');
        style.id = 'tx-tool-style';
        style.textContent = `
            .tx-tool-btn {
                border-radius: 12px !important;
                padding: 8px 12px !important;
                font-size: 11.5px !important;
                font-weight: 700 !important;
                letter-spacing: 0.2px;
                border: 1px solid rgba(255,255,255,0.16) !important;
                box-shadow: 0 3px 10px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.2) !important;
                backdrop-filter: blur(8px) saturate(160%) !important;
                -webkit-backdrop-filter: blur(8px) saturate(160%) !important;
                transition: box-shadow 0.18s ease, filter 0.18s ease, border-color 0.18s ease !important;
                font-family: 'Cairo', 'Segoe UI', Tahoma, sans-serif !important;
            }
            .tx-tool-btn:hover {
                filter: brightness(1.18) saturate(1.15);
                border-color: rgba(255,255,255,0.4) !important;
                box-shadow: 0 4px 14px rgba(0,0,0,0.4), 0 0 0 3px rgba(255,255,255,0.07), inset 0 1px 0 rgba(255,255,255,0.3) !important;
                opacity: 1 !important;
            }
            .tx-tool-btn:active { filter: brightness(0.9); }
            .tx-tool-btn:disabled { opacity: 0.4 !important; cursor: not-allowed !important; filter: none !important; }
        `;
        document.head.appendChild(style);
    }

    function softenAllButtons() {
        injectModernButtonStyle();
        const softPalette = [
            'rgba(63,107,82,0.6)', 'rgba(74,90,120,0.6)', 'rgba(122,90,63,0.6)', 'rgba(90,74,120,0.6)',
            'rgba(63,107,107,0.6)', 'rgba(122,74,74,0.6)', 'rgba(74,107,74,0.6)', 'rgba(107,74,107,0.6)',
            'rgba(146,64,14,0.6)', 'rgba(6,95,70,0.6)', 'rgba(124,58,237,0.6)', 'rgba(21,128,61,0.6)'
        ];
        let colorIndex = 0;

        document.querySelectorAll('button').forEach(btn => {
            const txt = btn.textContent.trim();
            const isOurButton = /^[📋🔍⚠️🈯📐🚀↩️↪️🩹📊📂🧾✅🧪📤🔁]/.test(txt);
            if (!isOurButton) return;

            btn.classList.add('tx-tool-btn');
            btn.style.opacity = '1';
            btn.style.background = softPalette[colorIndex % softPalette.length];
            colorIndex++;
        });
    }

    // ==================== Smart floating menu - Dynamic Island style (v10.0) ====================
    function ensureMascotStyles() {
        if (document.getElementById('tx-mascot-style')) return;
        const style = document.createElement('style');
        style.id = 'tx-mascot-style';
        style.textContent = `
            .tx-mascot-btn {
                display: flex; align-items: center; gap: 9px;
                background: rgba(14,14,18,0.84);
                backdrop-filter: blur(20px) saturate(180%);
                -webkit-backdrop-filter: blur(20px) saturate(180%);
                color: #e5e7eb; border: none; border-radius: 50px;
                padding: 9px 18px 9px 14px; cursor: pointer;
                box-shadow: 0 10px 28px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.06);
                transition: all 0.25s cubic-bezier(0.2,0.8,0.2,1);
                font-family: 'Cairo', 'Segoe UI', Tahoma, sans-serif; font-weight: 700; font-size: 13px;
                pointer-events: auto;
            }
            .tx-mascot-btn:hover {
                background: rgba(20,20,26,0.92);
                box-shadow: 0 14px 32px rgba(0,0,0,0.55), 0 0 0 4px rgba(124,58,237,0.12), inset 0 1px 0 rgba(255,255,255,0.1);
            }
            .tx-mascot-btn.open {
                background: rgba(32,14,14,0.88);
                box-shadow: 0 10px 28px rgba(220,38,38,0.32), inset 0 1px 0 rgba(255,255,255,0.08);
            }

            .tx-mascot-face, .tx-mascot-eye, .tx-mascot-pupil {
                forced-color-adjust: none !important;
                color-scheme: light !important;
            }

            .tx-mascot-face {
                display: flex; gap: 6px;
                background: radial-gradient(circle at 35% 30%, #26262f, #0a0a0d) !important;
                border-radius: 12px; padding: 6px 8px;
                box-shadow: inset 0 1px 6px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.12);
            }
            .tx-mascot-eye {
                width: 18px; height: 18px;
                background: #ffffff !important;
                border-radius: 50%;
                position: relative;
                box-shadow: 0 0 0 2px rgba(255,255,255,0.5), inset 0 0 3px rgba(0,0,0,0.35);
                transition: transform 0.12s ease;
            }
            .tx-mascot-eye.blink { transform: scaleY(0.1); }
            .tx-mascot-pupil {
                width: 8px; height: 8px;
                background: radial-gradient(circle at 35% 35%, #5b21b6, #0f0a1f) !important;
                border-radius: 50%;
                position: absolute; top: 50%; left: 50%;
                transform: translate(-50%, -50%);
                transition: transform 0.15s ease;
                box-shadow: 0 0 2px rgba(0,0,0,0.6);
            }
            .tx-mascot-pupil::after {
                content: '';
                position: absolute; top: 18%; left: 20%;
                width: 32%; height: 32%;
                background: rgba(255,255,255,0.9);
                border-radius: 50%;
            }
            .tx-mascot-label { white-space: nowrap; color: #e5e7eb; }

            #tx-buttons-wrapper {
                position: relative;
                scrollbar-width: thin;
                scrollbar-color: rgba(167,139,250,0.4) transparent;
            }
            #tx-buttons-wrapper::-webkit-scrollbar { width: 5px; }
            #tx-buttons-wrapper::-webkit-scrollbar-track { background: transparent; }
            #tx-buttons-wrapper::-webkit-scrollbar-thumb { background: rgba(167,139,250,0.35); border-radius: 10px; }
            #tx-buttons-wrapper::-webkit-scrollbar-thumb:hover { background: rgba(167,139,250,0.55); }
            #tx-buttons-wrapper:focus, #tx-buttons-wrapper:focus-visible { outline: none !important; box-shadow: none !important; }
            #tx-buttons-wrapper::before {
                content: '';
                position: absolute; top: 0; left: 12%; right: 12%; height: 1px;
                background: linear-gradient(90deg, transparent, rgba(255,255,255,0.5), transparent);
                pointer-events: none;
            }

            .tx-sparkle {
                position: absolute;
                pointer-events: none;
                font-size: 11px;
                color: rgba(255,255,255,0.95);
                text-shadow: 0 0 6px rgba(196,181,253,0.95), 0 0 12px rgba(124,58,237,0.6);
                transform: translate(-50%, -50%) scale(0.3);
                animation: tx-sparkle-pop 0.75s ease-out forwards;
                z-index: 5;
            }
            @keyframes tx-sparkle-pop {
                0% { opacity: 0; transform: translate(-50%, -50%) scale(0.2) rotate(0deg); }
                25% { opacity: 1; transform: translate(-50%, -50%) scale(1) rotate(40deg); }
                100% { opacity: 0; transform: translate(-50%, -50%) scale(0.4) translateY(-16px) rotate(90deg); }
            }
        `;
        document.head.appendChild(style);
    }

    function attachSparkleTrail(container) {
        let lastSpawn = 0;
        const stars = ['✦', '✧', '✨'];
        container.addEventListener('mousemove', (e) => {
            const now = Date.now();
            if (now - lastSpawn < 90) return;
            lastSpawn = now;

            const rect = container.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top + container.scrollTop;

            const star = document.createElement('span');
            star.className = 'tx-sparkle';
            star.textContent = stars[Math.floor(Math.random() * stars.length)];
            star.style.left = x + 'px';
            star.style.top = y + 'px';
            container.appendChild(star);
            setTimeout(() => star.remove(), 800);
        });
    }

    function initMascotEyes(mainBtn) {
        const maxOffset = 4;
        let isHovering = false;

        mainBtn.addEventListener('mouseenter', () => {
            isHovering = true;
            const pupils = mainBtn.querySelectorAll('.tx-mascot-pupil');
            pupils.forEach(pupil => {
                pupil.style.transform = 'translate(calc(-50% + 2px), -50%)';
            });
        });
        mainBtn.addEventListener('mouseleave', () => {
            isHovering = false;
        });

        document.addEventListener('mousemove', (e) => {
            if (isHovering) return;
            const pupils = mainBtn.querySelectorAll('.tx-mascot-pupil');
            pupils.forEach(pupil => {
                const eye = pupil.parentElement;
                const rect = eye.getBoundingClientRect();
                const cx = rect.left + rect.width / 2;
                const cy = rect.top + rect.height / 2;
                const dx = e.clientX - cx;
                const dy = e.clientY - cy;
                const dist = Math.min(maxOffset, Math.hypot(dx, dy) / 10);
                const angle = Math.atan2(dy, dx);
                const ox = (Math.cos(angle) * dist).toFixed(1);
                const oy = (Math.sin(angle) * dist).toFixed(1);
                pupil.style.transform = 'translate(calc(-50% + ' + ox + 'px), calc(-50% + ' + oy + 'px))';
            });
        });
    }

    function scheduleAutoBlink(mainBtn) {
        function blinkOnce() {
            const eyes = mainBtn.querySelectorAll('.tx-mascot-eye');
            eyes.forEach(eye => eye.classList.add('blink'));
            setTimeout(() => eyes.forEach(eye => eye.classList.remove('blink')), 140);

            if (Math.random() < 0.25) {
                setTimeout(() => {
                    eyes.forEach(eye => eye.classList.add('blink'));
                    setTimeout(() => eyes.forEach(eye => eye.classList.remove('blink')), 140);
                }, 220);
            }

            const nextDelay = 2200 + Math.random() * 3500;
            setTimeout(blinkOnce, nextDelay);
        }
        setTimeout(blinkOnce, 1500 + Math.random() * 1500);
    }

    function setupFloatingMenu() {
        ensureMascotStyles();

        const menuContainer = document.createElement('div');
        menuContainer.id = 'tx-floating-menu';
        menuContainer.style.cssText = `
            position: fixed;
            bottom: 25px;
            right: 25px;
            z-index: 100000;
            display: flex;
            flex-direction: column;
            align-items: flex-end;
            gap: 12px;
            pointer-events: none;
        `;

        const buttonsWrapper = document.createElement('div');
        buttonsWrapper.id = 'tx-buttons-wrapper';
        buttonsWrapper.style.cssText = `
            display: flex;
            flex-direction: column;
            gap: 8px;
            opacity: 0;
            transform: translateY(20px) scale(0.95);
            transition: opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1), transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            pointer-events: none;
            background: linear-gradient(165deg, rgba(40,40,58,0.55), rgba(12,12,20,0.74));
            padding: 14px;
            border-radius: 18px;
            backdrop-filter: blur(26px) saturate(200%);
            -webkit-backdrop-filter: blur(26px) saturate(200%);
            border: 1px solid rgba(255,255,255,0.2);
            box-shadow:
                0 20px 50px rgba(0,0,0,0.55),
                0 0 45px rgba(124,58,237,0.32),
                0 0 20px rgba(56,189,248,0.14),
                inset 0 1px 0 rgba(255,255,255,0.28);
        `;
        attachSparkleTrail(buttonsWrapper);

        const mainBtn = document.createElement('button');
        mainBtn.className = 'tx-mascot-btn';
        mainBtn.innerHTML = `
            <span class="tx-mascot-face">
                <span class="tx-mascot-eye"><span class="tx-mascot-pupil"></span></span>
                <span class="tx-mascot-eye"><span class="tx-mascot-pupil"></span></span>
            </span>
            <span class="tx-mascot-label">Transcription Tools</span>
        `;

        initMascotEyes(mainBtn);
        scheduleAutoBlink(mainBtn);

        const allToolButtons = document.querySelectorAll('.tx-tool-btn');
        allToolButtons.forEach(btn => {
            btn.style.position = 'static';
            btn.style.width = '100%';
            btn.style.textAlign = 'right';
            buttonsWrapper.appendChild(btn);
        });

        let isOpen = false;
        mainBtn.onclick = () => {
            isOpen = !isOpen;

            const eyes = mainBtn.querySelectorAll('.tx-mascot-eye');
            eyes.forEach(eye => eye.classList.add('blink'));
            setTimeout(() => eyes.forEach(eye => eye.classList.remove('blink')), 180);

            const label = mainBtn.querySelector('.tx-mascot-label');
            if (isOpen) {
                buttonsWrapper.style.opacity = '1';
                buttonsWrapper.style.transform = 'translateY(0) scale(1)';
                buttonsWrapper.style.pointerEvents = 'auto';
                mainBtn.classList.add('open');
                label.textContent = 'Close Menu ✕';
            } else {
                buttonsWrapper.style.opacity = '0';
                buttonsWrapper.style.transform = 'translateY(20px) scale(0.95)';
                buttonsWrapper.style.pointerEvents = 'none';
                mainBtn.classList.remove('open');
                label.textContent = 'Transcription Tools';
            }
        };

        menuContainer.appendChild(buttonsWrapper);
        menuContainer.appendChild(mainBtn);
        document.body.appendChild(menuContainer);
    }

    function initButtons() {
        addWhitespaceButton();
        addEnglishTashkeelButton();
        addWritingRulesButton();
        addTagCheckButton();
        addFullReviewButton();
        addUndoButton();
        addRedoButton();
        addRestoreBackupButton();
        addDailyStatsButton();
        addCachedReviewButton();
        addExportReportButton();
        addQAReportButton();
        addExportQAReportButton();
        addFinishTaskButton();
        addErrorNavWidget();
        addHelpButton();
        addTaskTimerWidget();
        hookSiteSaveButton();

        // Runs immediately (no setTimeout) so the buttons aren't scattered for even a single frame before they group
        // inside the floating menu - any delay here used to cause a visible "flash" of the buttons on page load.
        softenAllButtons();
        setupFloatingMenu();
    }

    // Note: initButtons() is now called at the end of the file (after all definitions) to avoid an ordering
    // conflict - it used to call addTaskTimerWidget() before taskTimerStart was even defined, which
    // used to stop initButtons() halfway through and leave the rest of the buttons ungrouped in the menu.

    // ==================== Part 10: live check ====================
    function evaluateRowLive(row) {
        const serialCell = row.querySelector('.number');
        const contentCell = row.querySelector('.textContent .mark-content-textarea');
        const attrCell = row.querySelector('.attr');
        if (!serialCell || !contentCell) return;

        getOrCreateSaveDot(row);

        const rawUntrimmed = contentCell.value !== undefined ? contentCell.value : contentCell.textContent;
        const raw = (rawUntrimmed || '').trim();

        const attrPills = attrCell ? Array.from(attrCell.querySelectorAll('.p1')) : [];
        const hasAttrTag = attrPills.length > 0;
        const attrTagTexts = attrPills.map(el => (el.getAttribute('title') || el.textContent || '').trim());
        const isTagShaped = /^<[A-Za-z]+>$/.test(raw);
        const liveSerial = getSerialFromRow(row);

        // We collect real messages for each issue (not just a count) so the marker (!) can show you the exact
        // issue on click, even if this segment hasn't shown up in "🚀 full review" at all yet.
        const liveMessages = [];

        if (rawUntrimmed && /^\s|\s$/.test(rawUntrimmed)) liveMessages.push('📏 فيه مسافة زايدة في أول أو آخر السيجمنت');
        if (rawUntrimmed && /[^\s،؛:؟!.]\s{2,}[^\s،؛:؟!.]/.test(rawUntrimmed)) liveMessages.push('📏 فيه مسافة مزدوجة بين كلمتين');

        if (raw) {
            const englishWords = countPureEnglishWords(raw);
            if (englishWords.length >= 3) liveMessages.push('🔤 فيه 3 كلمات إنجليزي أو أكتر جوه السيجمنت');
            if (/[\u064B-\u0652]/.test(raw)) liveMessages.push('🔤 فيه تشكيل عربي جوه السيجمنت');
            liveMessages.push(...checkWritingRules(raw, hasAttrTag));
        }

        if (isTagShaped && !hasAttrTag) {
            liveMessages.push('🏷️ النص شكله تاج (زي <NOISE>) بس مفيش تاج Attribute متحط فعلياً');
            if (liveSerial !== null) mergeQATagProblem('missingAttr', liveSerial);
        }
        if (hasAttrTag && attrTagTexts.length > 1) liveMessages.push('🏷️ فيه أكتر من تاج Attribute على نفس السيجمنت');
        if (hasAttrTag && raw && !isTagShaped) liveMessages.push('🏷️ فيه تاج Attribute وكمان نص عادي مع بعض في نفس السيجمنت');
        if (hasAttrTag && attrTagTexts.includes('<NOISE>')) {
            const duration = getRegionDuration(row.id);
            if (duration !== null && duration < 0.5) {
                liveMessages.push('⏱️ تاج <NOISE> على مدة أقل من نص ثانية');
                if (liveSerial !== null) mergeQATagProblem('shortDuration', liveSerial, duration);
            }
        }

        const issues = liveMessages.length;
        const hadIssueBefore = row.dataset.hadIssue === 'true';

        if (issues > 0) {
            setRowStatus(row, 'error');
            row.dataset.hadIssue = 'true';
        } else if (hadIssueBefore) {
            setRowStatus(row, 'ok');
            row.dataset.hadIssue = 'false';
            setTimeout(() => {
                if (row.dataset.hadIssue === 'false') setRowStatus(row, null);
            }, 4000);
        }

        // Syncs the small marker (the transparent dot) with the live check result in real time: if there's an issue, the marker
        // gets added (or its messages get updated) immediately - it doesn't need "🚀 full review" to have already run. And if
        // the segment becomes clean, the marker disappears on its own immediately.
        if (liveSerial !== null) {
            if (issues === 0) {
                if (lastReviewProblemSerialsSet.has(liveSerial)) clearSerialFromReviewProblems(liveSerial);
                removeRowErrorMarker(row);
            } else {
                addSerialToReviewProblems(liveSerial, liveMessages);
                getOrCreateRowErrorMarker(row);
            }
        }
    }

    function initLiveChecker() {
        const table = document.querySelector('#changyuliu_table');
        if (!table) return false;
        if (table.dataset.liveBound) return true;

        table.addEventListener('input', (e) => {
            const row = e.target.closest('tr');
            if (row) evaluateRowLive(row);
        }, true);

        const observer = new MutationObserver((mutations) => {
            const rowsToCheck = new Set();
            mutations.forEach(m => {
                const node = m.target.nodeType === 1 ? m.target : m.target.parentElement;
                const row = node ? node.closest('tr') : null;
                if (row) rowsToCheck.add(row);
            });
            rowsToCheck.forEach(row => evaluateRowLive(row));
            if (rowsToCheck.size > 0) updateRowErrorMarkers();
        });
        observer.observe(table, { childList: true, subtree: true, characterData: true });

        table.dataset.liveBound = 'true';
        console.log('[Live] تم تفعيل الفحص الحي ✅');
        return true;
    }

    // Same as above: we leave it running the whole time so it auto-reattaches on any new task that opens
    // without a refresh - this used to be the cause of the live red glow and error marker disappearing after a while.
    setInterval(() => { initLiveChecker(); }, 800);

    // "Dumb brute-force" periodic sync on all visible rows - not tied to MutationObserver at all.
    // Reason: fixes a case like "add an attribute to a tag and the error still shows" - because some edits
    // (especially attributes/tags) make the site fully replace the <tr> element instead of just editing inside it,
    // and MutationObserver doesn't always catch the right row then (since the old element vanished before we caught it).
    // The safer fix: every second or so we re-evaluate all visible rows from scratch, so no matter how the edit happened
    // (typing, attribute, tag, even paste) the marker and red glow sync up on their own without you needing
    // to run "full review" again.
    setInterval(() => {
        const rows = document.querySelectorAll('#changyuliu_table > tr');
        if (!rows.length) return;
        rows.forEach(row => evaluateRowLive(row));
        updateRowErrorMarkers();
    }, 1100);

    // ==================== Help Center - keyboard shortcuts + full tool guide (tabbed) ====================
    // F2 = full review | F4 = finish task | T = tag check
    // Ctrl+Z / Cmd+Z = step-by-step undo (one manual edit, or a whole batch like an auto-fix run)
    // Ctrl+Y or Ctrl+Shift+Z = redo | Ctrl+Shift+V = multi-clipboard ring
    // Alt+↓ / Alt+↑ = jump to the next/previous error from the last "full review" + show a hint of the problem
    function ensureShortcutSheetStyles() {
        if (document.getElementById('tx-kbd-style')) return;
        const style = document.createElement('style');
        style.id = 'tx-kbd-style';
        style.textContent = `
            .tx-kbd-row {
                display: flex; align-items: center; justify-content: space-between; gap: 10px;
                background: rgba(20,30,29,0.62);
                backdrop-filter: blur(8px) saturate(160%);
                -webkit-backdrop-filter: blur(8px) saturate(160%);
                border: 1px solid rgba(45,212,191,0.18);
                border-radius: 10px; padding: 9px 12px; margin-bottom: 6px;
                transition: background 0.15s ease, border-color 0.15s ease;
            }
            .tx-kbd-row:hover { background: rgba(45,212,191,0.14); border-color: rgba(45,212,191,0.4); }
            .tx-kbd-desc { color: #f1f5f9; font-size: 12.5px; font-weight: 600; }
            /* dir=ltr + unicode-bidi:isolate بيمنعوا خوارزمية الـ BiDi إنها تقلب ترتيب المفتاح الإنجليزي
               (زي F2 أو Ctrl+Shift+Z) جوه سطر عربي RTL */
            .tx-kbd-key {
                direction: ltr; unicode-bidi: isolate; display: inline-block;
                font-family: 'Consolas', 'Courier New', monospace; font-size: 11.5px; font-weight: 700;
                color: #ccfbf1; background: rgba(45,212,191,0.16);
                border: 1px solid rgba(45,212,191,0.4); border-radius: 7px;
                padding: 3px 9px; text-shadow: 0 0 6px rgba(45,212,191,0.5);
                white-space: nowrap;
            }
            .tx-help-tabs { display: flex; gap: 6px; padding: 0 16px 10px; }
            .tx-help-tab-btn {
                flex: 1; text-align: center; padding: 8px 10px; border-radius: 10px;
                background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08);
                color: #94a3b8; font-size: 12.5px; font-weight: 700; cursor: pointer;
                font-family: 'Cairo', 'Segoe UI', Tahoma, sans-serif;
                transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
            }
            .tx-help-tab-btn:hover { color: #e2e8f0; background: rgba(255,255,255,0.07); }
            .tx-help-tab-btn.active {
                background: linear-gradient(135deg, rgba(13,148,136,0.6), rgba(45,212,191,0.35));
                border-color: rgba(45,212,191,0.6); color: #fff;
            }
            .tx-guide-item {
                background: rgba(20,30,29,0.62);
                backdrop-filter: blur(8px) saturate(160%);
                -webkit-backdrop-filter: blur(8px) saturate(160%);
                border-right: 3px solid rgba(45,212,191,0.55);
                border-radius: 10px; padding: 10px 12px; margin-bottom: 8px; cursor: pointer;
                transition: background 0.15s ease, border-right-color 0.15s ease;
            }
            .tx-guide-item:hover { background: rgba(45,212,191,0.14); border-right-color: #2dd4bf; }
            .tx-guide-title { color: #99f6e4; font-size: 13px; font-weight: 800; margin-bottom: 3px; text-shadow: 0 0 8px rgba(45,212,191,0.3); }
            .tx-guide-short { color: #e2e8f0; font-size: 12px; line-height: 1.6; }
            .tx-guide-full {
                color: #e2e8f0; font-size: 12px; line-height: 1.75; margin-top: 8px;
                padding-top: 8px; border-top: 1px dashed rgba(45,212,191,0.2);
                display: none;
            }
            .tx-guide-item.tx-open .tx-guide-full { display: block; }
            .tx-guide-readmore {
                color: #5eead4; font-size: 11.5px; font-weight: 700; margin-top: 6px; display: inline-block;
            }
        `;
        document.head.appendChild(style);
    }

    // Tool guide data - each entry: title, a short description that's always visible, and a full
    // explanation shown only after clicking "read more".
    const TOOL_GUIDE_ENTRIES = [
        { title: '🔍 فحص المسافات', short: 'بيدوّر على مسافات زيادة في أول/آخر السيجمنت، أو مسافة مزدوجة بين كلمتين.', full: 'بيمرّ على كل السيجمنتات (كل الصفحات) وبيجيب أي سيجمنت فيه مسافة فاضلة في البداية أو النهاية، أو مسافتين ورا بعض جوه الجملة. بيقدر يصلحهم تلقائي بضغطة واحدة من داخل نتيجة الفحص.' },
        { title: '🈯 إنجليزي/تشكيل', short: 'بيلقط السيجمنتات اللي فيها 3 كلمات إنجليزي أو أكتر، أو فيها تشكيل عربي.', full: 'التشكيل (الفتحة، الضمة، الكسرة...) مفيش مكان له في التفريغ، والسيجمنتات اللي فيها كلام إنجليزي كتير محتاجة مراجعة. الأداة بتلقط الاتنين وتقدر تشيل التشكيل تلقائي من زرار التصليح.' },
        { title: '📐 فحص القواعد', short: 'بيفحص كل سيجمنت على قواعد كتابة وإملاء محددة (فواصل، علامات، همزات، تاء مربوطة، كلمات حشو، لهجة...) ويقترح تصليح تلقائي.', full: 'ده الفحص اللي بيدقق في تفاصيل الكتابة والإملاء نفسها (زي المسافة بعد علامات الترقيم، الهمزات، التاء المربوطة، تكرار كلمات الحشو، وقواعد خاصة باللهجة اللي تختارها) - مختلف عن "🚀 مراجعة شاملة" اللي بتجمع كل أنواع الفحص مع بعض في تاب واحد.' },
        { title: '⚠️ فحص التاجات', short: 'بيدقق في تناسق التاجات: تاج بدون Attribute، تاجات متتالية من نفس النوع، تاج فيه كلام، إلخ.', full: 'بيجمع كل التاجات في التاسك (كل الصفحات) ويقارن بينها: تاجات متجاورة من نفس النوع ممكن تتدمج، سيجمنت شكله تاج بس من غير Attribute متحدد، أكتر من Attribute على سيجمنت واحد، وتاجات NOISE قصيرة جداً (أقل من نص ثانية).' },
        { title: '↩️ / ↪️ تراجع وإعادة', short: 'Ctrl+Z يرجعك خطوة، Ctrl+Y أو Ctrl+Shift+Z يعيدها. بتحسب أي تصليح تلقائي جماعي كخطوة واحدة.', full: 'كل تعديل - سواء كتابة يدوية في سيجمنت، أو تصليح تلقائي جماعي - بيتسجل كخطوة. Ctrl+Z بيرجع آخر خطوة كاملة دفعة واحدة (لو كانت تصليح 20 سيجمنت، هترجع كل الـ20 مرة واحدة مش سيجمنت سيجمنت).' },
        { title: '🩹 استرجاع نسخة', short: 'بيرجّعلك نسخة قديمة محفوظة من التاسك لو حصل خطأ كبير أو ضاع تعديلك.', full: 'الأداة بتاخد نسخ احتياطية دورية من حالة السيجمنتات وهي شغالة. الزرار ده بيوريك النسخ المتاحة وتقدر ترجع لأي واحدة منها لو حسيت إن حاجة راحت غلط.' },
        { title: '📊 إحصائية اليوم', short: 'عدد التاسكات، السيجمنتات، وزمن الكلام/التاجات اللي خلّصتهم النهاردة.', full: 'الأرقام دي بتتحدث بس لما تدوس "✅ إنهاء التاسك" في آخر كل تاسك - عشان تبقى دقيقة ومحسوبة مرة واحدة لكل تاسك، مهما عدّلت في السيجمنت نفسه عدة مرات. تقدر تصفّرها من نفس اللوحة.' },
        { title: '🚀 مراجعة شاملة', short: 'بتجمع كل أنواع الفحص (مسافات، إنجليزي/تشكيل، قواعد كتابة، تاجات) في لوحة واحدة بتابات، وبتحسب زمن الكلام والتاجات.', full: 'ده الفحص الرئيسي قبل التسليم - بيمشي على كل صفحات التاسك ويجمع كل المشاكل في مكان واحد، وبيسجّل نتيجته عشان الماركر الأحمر الصغير جوه رقم السيجمنت (⚠️) يفضل شغال لايف لحد ما تصلح كل مشكلة.' },
        { title: '📂 مراجعة مخزّنة', short: 'بيوريك آخر نتيجة "مراجعة شاملة" اتحفظت، من غير ما تحتاج تعيد الفحص من الصفر.', full: 'مفيد لو خرجت من الصفحة أو عملت Refresh وعايز ترجع تشوف نتيجة آخر فحص شامل عملته من غير ما تنتظر وقت الفحص تاني.' },
        { title: '🧾 تصدير المراجعة', short: 'بيصدّر نتيجة "🚀 مراجعة شاملة" في ملف تقرير منظم تقدر تحفظه أو تبعته.', full: 'دوسه بعد ما تعمل "🚀 مراجعة شاملة" عشان تاخد كل الملاحظات في ملف واحد منظم بدل ما تقعد تلقطها واحدة واحدة من اللوحة. الملف بيتحمّل على جهازك مباشرة وتقدر تفتحه أو ترفقه لأي حد.' },
        { title: '🧪 فحص QA', short: 'بيقارن كل سيجمنت عدّلته بالنص الأصلي بتاعه، ويطلعلك تقرير مبوّب بكل الفروقات (تاجات/مسافات/قواعد ← إملاء ← تعديلات تانية).', full: 'دوسه في أي وقت وانت شغال على التاسك، وهيوريك تقرير مبوّب بكل سيجمنت عدّلته: النص قبل التعديل، والنص بعده، ونوع كل فرق. مفيد جداً وانت بتراجع شغل مفرغ، عشان يوضّحلك بالظبط إيه اللي اتغيّر في كل سيجمنت.' },
        { title: '📤 تصدير QA', short: 'بيصدّر نتيجة آخر "🧪 فحص QA" في ملف تقرير منفصل، فيه كمان رسالة جاهزة تقدر تبعتها للمفرغ.', full: 'دوسه بعد ما تعمل "🧪 فحص QA" عشان تاخد نتيجته في ملف تقرير منفصل. الملف بيحتوي على أشهر الأخطاء المتكررة، وتفاصيل كل سيجمنت اتعدل، ورسالة جاهزة معمولة تلقائي تقدر تعدّل فيها وتنسخها وتبعتها للمفرغ.' },
        { title: '✅ إنهاء التاسك', short: 'بيقفل التاسك الحالي رسمياً: بيحسب عدد السيجمنتات وزمن الكلام والتاجات، ويضيفهم لإحصائية اليوم، ويصفّر التايمر.', full: 'دايماً دوسه (أو F4) في آخر كل تاسك بعد ما تخلّص التصليح - لو نسيت، هيفضل يفكّرك (توست + تأكيد قبل ما تسيب الصفحة) لأن من غيره إحصائية اليوم مش هتتسجل صح.' },
        { title: '⏱️ مؤقت التاسك (يمين تحت الشاشة)', short: 'بيعدّ الوقت من ساعة ما فتحت التاسك، وبيصفّر لوحده لما تخلّص "✅ إنهاء التاسك".', full: 'دوس عليه يفتح ويقفل. زرار ⏸ الصغير بيوقفه مؤقت (لو أخدت بريك من غير ما تحسبه وقت شغل)، وزرار 🔄 بيصفّره يدوي وتبدأ من الأول لو احتجت كده.' },
        { title: '⚠️ عداد الأخطاء (Alt+↓ / Alt+↑)', short: 'بينقّلك بين السيجمنتات اللي فيها مشاكل من آخر فحص شامل، سيجمنت بسيجمنت.', full: 'بعد أي "🚀 مراجعة شاملة"، الودجت ده بيوريك عدد المشاكل المتبقية، وبيخليك تتنقل بينها بسهولة بالكيبورد من غير ما تدور في الجدول يدوي - وكل ما تصلح مشكلة، بتختفي من العداد لايف.' },
        { title: '📋 حافظة النصوص المتعددة (Clipboard Ring)', short: 'الأداة بتفتكر آخر 10 حاجات نسختها في الصفحة، وتقدر تلزقها بسهولة بـ Ctrl+Shift+V أو Alt+V.', full: 'وأنت جوه أي مربع كتابة، دوس Ctrl+Shift+V أو Alt+V يظهرلك منيو صغير تحت الماوس فيه آخر 10 حاجات نسختها (أسامي متحدثين، تاجات، جمل متكررة...) - تختار بالسهم لفوق/تحت وتدوس Enter، أو تدوس عليها بالماوس، وتتلزق فوراً في مكان الكتابة.' },
        { title: '💾 الحفظ التلقائي (Auto-Save)', short: 'الأداة بتدوس هي نفسها على زرار Save الأصلي كل 60 ثانية - متقلقش، شغلك محفوظ ليك.', full: 'عشان ميضيع عليك شغل لو النور قطع أو حصلت مشكلة، الأداة بتحفظ التاسك تلقائياً كل دقيقة من غير ما تحتاج تدوس Save بنفسك كل شوية. لسه محتاج تدوس Save أو Submit بنفسك وانت فعلاً خلصت التاسك عشان تسلّمه رسمياً.' },
        { title: '😌 منبه الراحة', short: 'بعد كل ساعتين شغل متواصل، هتلاقي تنبيه هادي يفكّرك ترّيح عينك أو تعمل Stretch لمدة 10 دقايق.', full: 'التركيز في التشكيل والتاجات لساعات طويلة بيتعب العين والدماغ - الأداة بتحسب لك الوقت وتظهرلك تنبيه بسيط وهادي (بالعامية) كل ساعتين شغل تقريبي، وبعدها بتصفّر العداد وتبدأ تحسب لساعتين جداد.' }
    ];

    function buildShortcutsTabContent() {
        const rows = [
            { desc: '🚀 مراجعة شاملة', key: 'F2' },
            { desc: '✅ إنهاء التاسك', key: 'F4' },
            { desc: '⚠️ فحص التاجات', key: 'T' },
            { desc: '↩️ تراجع خطوة', key: 'Ctrl+Z' },
            { desc: '↪️ إعادة', key: 'Ctrl+Y / Ctrl+Shift+Z' },
            { desc: '📋 حافظة النصوص المتعددة', key: 'Ctrl+Shift+V / Alt+V' },
            { desc: 'التنقل بين الأخطاء', key: 'Alt+↓ / Alt+↑' }
        ];
        const wrap = document.createElement('div');
        rows.forEach(r => {
            const row = document.createElement('div');
            row.className = 'tx-kbd-row';
            const desc = document.createElement('span');
            desc.className = 'tx-kbd-desc';
            desc.textContent = r.desc;
            const key = document.createElement('span');
            key.className = 'tx-kbd-key';
            key.dir = 'ltr';
            key.textContent = r.key;
            row.appendChild(desc);
            row.appendChild(key);
            wrap.appendChild(row);
        });
        return wrap;
    }

    function buildGuideTabContent() {
        const wrap = document.createElement('div');
        TOOL_GUIDE_ENTRIES.forEach(entry => {
            const item = document.createElement('div');
            item.className = 'tx-guide-item';

            const title = document.createElement('div');
            title.className = 'tx-guide-title';
            title.textContent = entry.title;

            const short = document.createElement('div');
            short.className = 'tx-guide-short';
            short.textContent = entry.short;

            const readmore = document.createElement('span');
            readmore.className = 'tx-guide-readmore';
            readmore.textContent = '⌄ قراءة المزيد';

            const full = document.createElement('div');
            full.className = 'tx-guide-full';
            full.textContent = entry.full;

            item.appendChild(title);
            item.appendChild(short);
            item.appendChild(readmore);
            item.appendChild(full);

            item.addEventListener('click', () => {
                const isOpen = item.classList.toggle('tx-open');
                readmore.textContent = isOpen ? '⌃ إخفاء' : '⌄ قراءة المزيد';
            });

            wrap.appendChild(item);
        });
        return wrap;
    }

    function showHelpCenter() {
        ensurePanelStyles();
        ensureShortcutSheetStyles();

        const overlay = document.createElement('div');
        overlay.className = 'tx-panel-overlay';
        overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

        const box = document.createElement('div');
        box.className = 'tx-panel-box';

        const header = document.createElement('div');
        header.className = 'tx-panel-header';
        header.innerHTML = '<div class="tx-panel-title">❔ مساعدة الأداة</div>';
        const closeBtn = document.createElement('button');
        closeBtn.className = 'tx-panel-btn close-icon';
        closeBtn.textContent = '✕';
        closeBtn.onclick = () => overlay.remove();
        header.appendChild(closeBtn);

        const tabsRow = document.createElement('div');
        tabsRow.className = 'tx-help-tabs';
        const shortcutsTabBtn = document.createElement('div');
        shortcutsTabBtn.className = 'tx-help-tab-btn active';
        shortcutsTabBtn.textContent = '⌨️ اختصارات الكيبورد';
        const guideTabBtn = document.createElement('div');
        guideTabBtn.className = 'tx-help-tab-btn';
        guideTabBtn.textContent = '📖 شرح الأداة بالكامل';
        tabsRow.appendChild(shortcutsTabBtn);
        tabsRow.appendChild(guideTabBtn);

        const body = document.createElement('div');
        body.className = 'tx-panel-body';

        const shortcutsContent = buildShortcutsTabContent();
        const guideContent = buildGuideTabContent();
        guideContent.style.display = 'none';
        body.appendChild(shortcutsContent);
        body.appendChild(guideContent);

        shortcutsTabBtn.onclick = () => {
            shortcutsTabBtn.classList.add('active');
            guideTabBtn.classList.remove('active');
            shortcutsContent.style.display = '';
            guideContent.style.display = 'none';
        };
        guideTabBtn.onclick = () => {
            guideTabBtn.classList.add('active');
            shortcutsTabBtn.classList.remove('active');
            guideContent.style.display = '';
            shortcutsContent.style.display = 'none';
        };

        box.appendChild(header);
        box.appendChild(tabsRow);
        box.appendChild(body);
        overlay.appendChild(box);
        document.body.appendChild(overlay);

        function escHandler(e) { if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', escHandler); } }
        document.addEventListener('keydown', escHandler);
    }

    // ==================== Floating help button - glowing glass, always visible (v20.0) ====================
    // Used to start "collapsed", almost hidden against the screen edge (opacity 0.55 + pulled off-screen with translateX) and needed
    // two clicks to open - that made it easy to miss. Now it looks just like the timer widget: fully visible
    // all the time with the same glow and glass level, and one click opens the help center right away.
    function ensureHelpButtonStyles() {
        if (document.getElementById('tx-help-btn-style')) return;
        const style = document.createElement('style');
        style.id = 'tx-help-btn-style';
        style.textContent = `
            .tx-help-btn {
                position: fixed; top: 560px; left: 6px; z-index: 99996;
                display: flex; align-items: center; gap: 7px;
                background: rgba(14,20,20,0.55);
                border: 1px solid rgba(45,212,191,0.4);
                border-radius: 22px;
                padding: 6px 12px 6px 8px;
                backdrop-filter: blur(10px) saturate(160%);
                -webkit-backdrop-filter: blur(10px) saturate(160%);
                color: #99f6e4; font-weight: 800; font-size: 12.5px;
                font-family: 'Cairo', 'Segoe UI', Tahoma, sans-serif;
                cursor: pointer; user-select: none;
                text-shadow: 0 0 8px rgba(0,255,204,0.4);
                box-shadow: 0 3px 10px rgba(0,0,0,0.3), 0 0 10px rgba(0,255,204,0.22);
                transform: translateX(-14px);
                transition: transform 0.32s cubic-bezier(0.4,0,0.2,1), box-shadow 0.25s ease, border-color 0.25s ease;
            }
            .tx-help-btn:hover {
                transform: translateX(0);
                box-shadow: 0 4px 14px rgba(0,0,0,0.35), 0 0 18px rgba(0,255,204,0.45);
                border-color: rgba(45,212,191,0.7);
            }
            .tx-help-btn .tx-help-btn-icon {
                display: flex; align-items: center; justify-content: center;
                width: 18px; height: 18px; border-radius: 50%; flex-shrink: 0;
                background: rgba(45,212,191,0.16); border: 1px solid rgba(45,212,191,0.5);
                font-size: 12px; font-weight: 900;
            }
        `;
        document.head.appendChild(style);
    }

    function addHelpButton() {
        ensureHelpButtonStyles();
        const btn = document.createElement('div');
        btn.className = 'tx-help-btn';
        btn.title = 'مساعدة الأداة (اختصارات + شرح كامل)';

        const icon = document.createElement('span');
        icon.className = 'tx-help-btn-icon';
        icon.textContent = '؟';

        const label = document.createElement('span');
        label.textContent = 'مساعدة';

        btn.appendChild(icon);
        btn.appendChild(label);
        btn.onclick = () => showHelpCenter();
        document.body.appendChild(btn);
    }

    // ==================== Live task timer - very transparent + collapsible + pausable (v18.0) ====================
    // Starts counting on its own from the moment you open the task page (and keeps running even if you refresh the same page),
    // and resets automatically once you successfully finish "✅ finish task". You can pause it (the small ⏸ button inside) without
    // it resetting - handy if you're taking a break - and you can collapse the whole widget into a small circle by clicking it, and expand it back the same way.
    const TASK_TIMER_KEY = 'tx_task_timer_v1';

    function readTaskTimerState() {
        try {
            const raw = localStorage.getItem(TASK_TIMER_KEY);
            if (raw) {
                const data = JSON.parse(raw);
                if (data && data.url === location.href && typeof data.start === 'number') {
                    return {
                        start: data.start,
                        pausedAccumMs: typeof data.pausedAccumMs === 'number' ? data.pausedAccumMs : 0,
                        paused: !!data.paused,
                        pausedAt: typeof data.pausedAt === 'number' ? data.pausedAt : null
                    };
                }
            }
        } catch (e) { /* تجاهل */ }
        return null;
    }

    function writeTaskTimerState() {
        try {
            localStorage.setItem(TASK_TIMER_KEY, JSON.stringify({
                url: location.href, start: taskTimerStart,
                pausedAccumMs: taskTimerPausedAccumMs, paused: taskTimerPaused, pausedAt: taskTimerPausedAt
            }));
        } catch (e) { /* تجاهل */ }
    }

    const _existingTimerState = readTaskTimerState();
    let taskTimerStart = _existingTimerState ? _existingTimerState.start : Date.now();
    let taskTimerPausedAccumMs = _existingTimerState ? _existingTimerState.pausedAccumMs : 0;
    let taskTimerPaused = _existingTimerState ? _existingTimerState.paused : false;
    let taskTimerPausedAt = _existingTimerState ? _existingTimerState.pausedAt : null;
    if (!_existingTimerState) writeTaskTimerState();

    // Called once "finish task" completes successfully - resets the counter and starts over for the next task
    function resetTaskTimer() {
        taskTimerStart = Date.now();
        taskTimerPausedAccumMs = 0;
        taskTimerPaused = false;
        taskTimerPausedAt = null;
        writeTaskTimerState();
        flashTaskTimerWidget();
        updateTaskTimerPausedUI();
        updateTaskTimerDisplay();
    }

    function toggleTaskTimerPause() {
        const now = Date.now();
        if (!taskTimerPaused) {
            taskTimerPaused = true;
            taskTimerPausedAt = now;
        } else {
            taskTimerPaused = false;
            taskTimerPausedAccumMs += (now - taskTimerPausedAt);
            taskTimerPausedAt = null;
        }
        writeTaskTimerState();
        updateTaskTimerPausedUI();
        updateTaskTimerDisplay();
    }

    function updateTaskTimerPausedUI() {
        const widget = document.getElementById('tx-timer-widget');
        const pauseBtn = document.getElementById('tx-timer-pause-btn');
        if (widget) widget.classList.toggle('tx-timer-paused', taskTimerPaused);
        if (pauseBtn) pauseBtn.textContent = taskTimerPaused ? '▶' : '⏸';
    }

    function formatTaskTimerElapsed(ms) {
        const totalSec = Math.max(0, Math.floor(ms / 1000));
        const h = Math.floor(totalSec / 3600);
        const m = Math.floor((totalSec % 3600) / 60);
        const s = totalSec % 60;
        const pad = (n) => String(n).padStart(2, '0');
        return (h > 0 ? pad(h) + ':' : '') + pad(m) + ':' + pad(s);
    }

    function updateTaskTimerDisplay() {
        const valueEl = document.getElementById('tx-timer-value');
        if (!valueEl) return;
        const now = taskTimerPaused ? taskTimerPausedAt : Date.now();
        valueEl.textContent = formatTaskTimerElapsed(now - taskTimerStart - taskTimerPausedAccumMs);
    }

    function flashTaskTimerWidget() {
        const widget = document.getElementById('tx-timer-widget');
        if (!widget) return;
        widget.classList.add('tx-timer-flash');
        setTimeout(() => widget.classList.remove('tx-timer-flash'), 900);
    }

    function ensureTaskTimerStyles() {
        if (document.getElementById('tx-timer-style')) return;
        const style = document.createElement('style');
        style.id = 'tx-timer-style';
        style.textContent = `
            /* نفس فكرة زرار المساعدة (؟) بالظبط: شريحة صغيرة قاعدة بأمان جوه حافة الشاشة (مش طايرة برّاها)،
               وبتفرد أفقياً لجوه الشاشة عند الهوفر/الضغط - مفيش تقليم للعرض (max-width) يخلي الشكل يبان مقطوع. */
            .tx-timer-widget {
                position: fixed; top: 604px; left: 6px; z-index: 99995;
                display: flex; align-items: center; gap: 7px;
                background: rgba(14,20,20,0.55);
                backdrop-filter: blur(10px) saturate(160%);
                -webkit-backdrop-filter: blur(10px) saturate(160%);
                border: 1px solid rgba(45,212,191,0.28);
                border-radius: 22px;
                padding: 6px 12px 6px 8px;
                box-shadow: 0 3px 10px rgba(0,0,0,0.3), 0 0 8px rgba(0,255,204,0.14);
                font-family: 'Cairo', 'Segoe UI', Tahoma, sans-serif;
                cursor: pointer; user-select: none;
                transform: translateX(-58px);
                transition: transform 0.32s cubic-bezier(0.4,0,0.2,1), box-shadow 0.3s ease, border-color 0.3s ease;
            }
            .tx-timer-widget.tx-expanded, .tx-timer-widget:hover { transform: translateX(0); }
            .tx-timer-widget:hover {
                box-shadow: 0 4px 14px rgba(0,0,0,0.35), 0 0 16px rgba(0,255,204,0.3);
                border-color: rgba(45,212,191,0.5);
            }
            .tx-timer-dot {
                width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
                background: #2dd4bf;
                box-shadow: 0 0 8px rgba(45,212,191,0.95), 0 0 16px rgba(45,212,191,0.5);
                animation: tx-timer-pulse 1.7s ease-in-out infinite;
            }
            .tx-timer-widget.tx-timer-paused .tx-timer-dot { background: #94a3b8; box-shadow: none; animation: none; }
            .tx-timer-text { display: flex; flex-direction: column; line-height: 1.15; white-space: nowrap; }
            .tx-timer-label {
                font-size: 8px; letter-spacing: 1.4px; font-weight: 800; text-transform: uppercase;
                color: rgba(94,234,212,0.7);
            }
            .tx-timer-value {
                font-family: 'Consolas', 'Courier New', monospace; font-size: 14px; font-weight: 700;
                color: #ccfbf1; letter-spacing: 0.6px;
                text-shadow: 0 0 8px rgba(45,212,191,0.65), 0 0 18px rgba(45,212,191,0.3);
                font-variant-numeric: tabular-nums;
            }
            .tx-timer-widget.tx-timer-paused .tx-timer-value { opacity: 0.55; text-shadow: none; }
            .tx-timer-pause-btn, .tx-timer-reset-btn {
                background: rgba(45,212,191,0.1); border: 1px solid rgba(45,212,191,0.25);
                border-radius: 50%; width: 19px; height: 19px; flex-shrink: 0;
                display: flex; align-items: center; justify-content: center;
                color: #99f6e4; font-size: 9px; cursor: pointer; transition: background 0.15s ease, transform 0.15s ease;
            }
            .tx-timer-pause-btn:hover, .tx-timer-reset-btn:hover { background: rgba(45,212,191,0.28); }
            .tx-timer-reset-btn:active { transform: rotate(-90deg); }
            @keyframes tx-timer-pulse {
                0%, 100% { opacity: 1; transform: scale(1); }
                50% { opacity: 0.4; transform: scale(0.7); }
            }
            .tx-timer-widget.tx-timer-flash {
                animation: tx-timer-flash-anim 0.9s ease;
            }
            @keyframes tx-timer-flash-anim {
                0% { box-shadow: 0 0 0 0 rgba(45,212,191,0.9); border-color: rgba(45,212,191,1); }
                60% { box-shadow: 0 0 30px 6px rgba(45,212,191,0.55); }
                100% { box-shadow: 0 3px 10px rgba(0,0,0,0.3), 0 0 8px rgba(0,255,204,0.14); border-color: rgba(45,212,191,0.28); }
            }
        `;
        document.head.appendChild(style);
    }

    function addTaskTimerWidget() {
        ensureTaskTimerStyles();
        const widget = document.createElement('div');
        widget.id = 'tx-timer-widget';
        widget.className = 'tx-timer-widget';
        widget.title = 'وقت التاسك - دوس 🔄 تصفّر، دوس ⏸ توقف مؤقت';

        const dot = document.createElement('span');
        dot.className = 'tx-timer-dot';

        const text = document.createElement('div');
        text.className = 'tx-timer-text';

        const label = document.createElement('span');
        label.className = 'tx-timer-label';
        label.textContent = 'TASK TIMER';

        const value = document.createElement('span');
        value.id = 'tx-timer-value';
        value.className = 'tx-timer-value';
        value.textContent = '00:00';

        text.appendChild(label);
        text.appendChild(value);

        const pauseBtn = document.createElement('span');
        pauseBtn.id = 'tx-timer-pause-btn';
        pauseBtn.className = 'tx-timer-pause-btn';
        pauseBtn.textContent = taskTimerPaused ? '▶' : '⏸';
        pauseBtn.title = 'إيقاف/استكمال العداد مؤقتاً';
        pauseBtn.onclick = (e) => { e.stopPropagation(); toggleTaskTimerPause(); };

        // Clear, always-visible reset button - the "reset the timer and start over" feature is requested and available in one click
        const resetBtn = document.createElement('span');
        resetBtn.className = 'tx-timer-reset-btn';
        resetBtn.textContent = '🔄';
        resetBtn.title = 'صفّر عداد التاسك وابدأ من الأول';
        resetBtn.onclick = async (e) => {
            e.stopPropagation();
            const ok = await showGlassConfirm('عايز تصفّر عداد التاسك وتبدأ من الأول؟ (من غير ما يتحسب حاجة في إحصائية اليوم)');
            if (ok) resetTaskTimer();
        };

        widget.appendChild(dot);
        widget.appendChild(text);
        widget.appendChild(pauseBtn);
        widget.appendChild(resetBtn);
        document.body.appendChild(widget);

        // Clicking the widget itself (not ⏸ or 🔄) expands/collapses it, for when you're not hovering with a mouse (touchscreens, for example)
        widget.addEventListener('click', (e) => {
            if (e.target === pauseBtn || e.target === resetBtn) return;
            widget.classList.toggle('tx-expanded');
        });

        updateTaskTimerPausedUI();
        updateTaskTimerDisplay();
        setInterval(updateTaskTimerDisplay, 1000);
    }

    // ==================== Break/stretch reminder ====================
    // About every two hours of continuous work, shows a gentle, friendly (colloquial) reminder to rest your eyes or stretch
    // for 10 minutes. The time is saved in localStorage so it keeps working even if you refresh the page.
    // Important: the counter only counts time the tab is actually open and visible in front of you (not sitting closed in a background tab),
    // "two hours of work" so it means two real hours, not two hours even with the tab closed next to you.
    const BREAK_ACTIVE_MS_KEY = 'tx_break_active_ms_v1';
    const BREAK_INTERVAL_MS = 2 * 60 * 60 * 1000; // ساعتين

    function getAccumulatedActiveMs() {
        try {
            const v = localStorage.getItem(BREAK_ACTIVE_MS_KEY);
            if (v !== null) {
                const n = parseInt(v, 10);
                if (!isNaN(n)) return n;
            }
        } catch (e) { /* تجاهل */ }
        return 0;
    }

    let accumulatedActiveMs = getAccumulatedActiveMs();

    function saveAccumulatedActiveMs() {
        try { localStorage.setItem(BREAK_ACTIVE_MS_KEY, String(accumulatedActiveMs)); } catch (e) { /* تجاهل */ }
    }

    function resetBreakTimer() {
        accumulatedActiveMs = 0;
        saveAccumulatedActiveMs();
    }

    function ensureBreakReminderStyles() {
        if (document.getElementById('tx-break-style')) return;
        const style = document.createElement('style');
        style.id = 'tx-break-style';
        style.textContent = `
            .tx-break-banner {
                position: fixed; top: 22px; left: 50%; transform: translateX(-50%) translateY(-16px);
                z-index: 999998; opacity: 0;
                display: flex; align-items: center; gap: 12px;
                background: linear-gradient(150deg, rgba(30,41,59,0.92), rgba(15,23,42,0.96));
                backdrop-filter: blur(20px) saturate(180%);
                -webkit-backdrop-filter: blur(20px) saturate(180%);
                border: 1px solid rgba(56,189,248,0.35);
                border-radius: 18px; padding: 14px 18px;
                box-shadow: 0 16px 40px rgba(0,0,0,0.5), 0 0 30px rgba(56,189,248,0.2);
                font-family: 'Cairo', 'Segoe UI', Tahoma, sans-serif; direction: rtl;
                transition: opacity 0.35s ease, transform 0.35s ease;
                max-width: 480px;
            }
            .tx-break-banner.tx-break-show { opacity: 1; transform: translateX(-50%) translateY(0); }
            .tx-break-emoji { font-size: 26px; flex-shrink: 0; }
            .tx-break-text { color: #e2e8f0; font-size: 13px; line-height: 1.6; }
            .tx-break-close {
                background: rgba(56,189,248,0.15); border: 1px solid rgba(56,189,248,0.35);
                border-radius: 9px; color: #bae6fd; font-size: 11.5px; font-weight: 700;
                padding: 6px 12px; cursor: pointer; flex-shrink: 0; transition: background 0.15s ease;
            }
            .tx-break-close:hover { background: rgba(56,189,248,0.3); }
        `;
        document.head.appendChild(style);
    }

    const BREAK_PHRASES = [
        'يلا بينا نرّيح عينك شوية يا نجم 👀 - 10 دقايق Stretch وترجع أقوى!',
        'ساعتين ونص تركيز! خد نفس، اتمطى، ورجع تكسّر تاني بعد 10 دقايق 💪',
        'وقفة صغيرة كده حلوة - قوم اتمشى شوية وارجع بتركيز جامد 🧘',
        'عينك تستاهل راحة دلوقتي - كوباية مية وشوية Stretch، وترجع أنشط 🥤'
    ];
    const breakPhraseState = { last: -1 };

    function showBreakReminderBanner() {
        ensureBreakReminderStyles();
        document.querySelectorAll('.tx-break-banner').forEach(b => b.remove());

        const banner = document.createElement('div');
        banner.className = 'tx-break-banner';

        const emoji = document.createElement('div');
        emoji.className = 'tx-break-emoji';
        emoji.textContent = '☕';

        const text = document.createElement('div');
        text.className = 'tx-break-text';
        text.textContent = pickRandomNoRepeat(BREAK_PHRASES, breakPhraseState);

        const closeBtn = document.createElement('div');
        closeBtn.className = 'tx-break-close';
        closeBtn.textContent = 'تمام 👌';
        closeBtn.onclick = () => {
            banner.classList.remove('tx-break-show');
            setTimeout(() => banner.remove(), 350);
        };

        banner.appendChild(emoji);
        banner.appendChild(text);
        banner.appendChild(closeBtn);
        document.body.appendChild(banner);

        requestAnimationFrame(() => banner.classList.add('tx-break-show'));
        setTimeout(() => {
            banner.classList.remove('tx-break-show');
            setTimeout(() => banner.remove(), 350);
        }, 15000);
    }

    function checkBreakReminder() {
        // We only add this minute to the counter if the tab is actually visible to the user right now
        if (!document.hidden) {
            accumulatedActiveMs += 60000;
            saveAccumulatedActiveMs();
        }
        if (accumulatedActiveMs >= BREAK_INTERVAL_MS) {
            showBreakReminderBanner();
            resetBreakTimer();
        }
    }
    setInterval(checkBreakReminder, 60000);

    // ==================== Celebration system - varied phrases + multiple random themes (v18.0) ====================
    function ensureCelebrationStyles() {
        if (document.getElementById('tx-celebrate-style')) return;
        const style = document.createElement('style');
        style.id = 'tx-celebrate-style';
        style.textContent = `
            .tx-confetti-layer { position: fixed; inset: 0; z-index: 999999; pointer-events: none; overflow: hidden; }
            .tx-confetti-piece {
                position: absolute; top: -20px;
                animation-name: tx-confetti-fall; animation-timing-function: linear; animation-fill-mode: forwards;
            }
            @keyframes tx-confetti-fall {
                0% { transform: translateY(0) rotate(0deg); opacity: 1; }
                100% { transform: translateY(110vh) rotate(560deg); opacity: 0.85; }
            }
            .tx-celebrate-banner {
                position: fixed; top: 38%; left: 50%; z-index: 1000000; pointer-events: none;
                background: linear-gradient(160deg, rgba(32,32,42,0.85), rgba(14,14,19,0.93));
                backdrop-filter: blur(24px) saturate(180%);
                -webkit-backdrop-filter: blur(24px) saturate(180%);
                border: 1px solid rgba(255,255,255,0.16);
                border-radius: 22px; padding: 22px 36px;
                color: #fff; font-family: 'Cairo', 'Segoe UI', Tahoma, sans-serif; text-align: center;
                box-shadow: 0 20px 60px rgba(0,0,0,0.6), 0 0 60px rgba(124,58,237,0.35);
                direction: rtl; white-space: nowrap;
                animation-name: tx-celebrate-pop; animation-timing-function: cubic-bezier(0.34,1.56,0.64,1); animation-fill-mode: forwards;
            }
            .tx-celebrate-banner.tx-celebrate-gold {
                border-color: rgba(251,191,36,0.35);
                box-shadow: 0 20px 60px rgba(0,0,0,0.6), 0 0 70px rgba(251,191,36,0.4);
            }
            .tx-celebrate-banner .tx-cb-title { font-size: 21px; font-weight: 800; margin-bottom: 6px; }
            .tx-celebrate-banner .tx-cb-sub { font-size: 12.5px; color: #cbd5e1; }
            @keyframes tx-celebrate-pop {
                0% { opacity: 0; transform: translate(-50%, -50%) scale(0.6); }
                8% { opacity: 1; transform: translate(-50%, -50%) scale(1.06); }
                14% { transform: translate(-50%, -50%) scale(1); }
                88% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
                100% { opacity: 0; transform: translate(-50%, -50%) scale(0.92); }
            }
            .tx-firework-particle {
                position: absolute; width: 7px; height: 7px; border-radius: 50%;
                box-shadow: 0 0 8px 1px currentColor;
                animation: tx-firework-burst 0.95s ease-out forwards;
            }
            @keyframes tx-firework-burst {
                0% { transform: translate(0, 0) scale(1); opacity: 1; }
                100% { transform: translate(var(--dx), var(--dy)) scale(0.25); opacity: 0; }
            }
            .tx-balloon-piece {
                position: absolute; bottom: -80px; border-radius: 50% 50% 48% 48% / 58% 58% 42% 42%;
                animation-name: tx-balloon-rise; animation-timing-function: ease-in; animation-fill-mode: forwards;
            }
            .tx-balloon-piece::after {
                content: ''; position: absolute; bottom: -16px; left: 50%; width: 1px; height: 16px;
                background: rgba(255,255,255,0.35);
            }
            @keyframes tx-balloon-rise {
                0% { transform: translateY(0) translateX(0) rotate(-4deg); opacity: 1; }
                50% { transform: translateY(-58vh) translateX(18px) rotate(4deg); }
                100% { transform: translateY(-125vh) translateX(-14px) rotate(-3deg); opacity: 0.9; }
            }
            .tx-emoji-piece {
                position: absolute; top: -40px; line-height: 1;
                animation-name: tx-emoji-fall; animation-timing-function: ease-in; animation-fill-mode: forwards;
            }
            @keyframes tx-emoji-fall {
                0% { transform: translateY(0) rotate(0deg); opacity: 1; }
                100% { transform: translateY(112vh) rotate(220deg); opacity: 0.9; }
            }
        `;
        document.head.appendChild(style);
    }

    const CONFETTI_COLORS = ['#f87171', '#fbbf24', '#34d399', '#38bdf8', '#a78bfa', '#f472b6', '#2dd4bf'];
    const BALLOON_COLORS = ['#f87171', '#fbbf24', '#34d399', '#38bdf8', '#a78bfa', '#f472b6', '#fb923c'];
    const EMOJI_SET = ['🐒', '🚀', '🐱', '⭐', '👑', '🎉', '🔥', '🥳', '🦄', '🍕', '💃', '🎈'];

    // Picks a random item from an array without repeating the same item that came up last time
    function pickRandomNoRepeat(pool, state) {
        if (pool.length <= 1) return pool[0];
        let idx;
        do { idx = Math.floor(Math.random() * pool.length); } while (idx === state.last);
        state.last = idx;
        return pool[idx];
    }

    // Big array of encouraging phrases in Egyptian colloquial - said after every "finish task"
    const HYPE_PHRASES = [
        'يا وحش! 🔥 خلصت تاسك كمان',
        'تحفة! 🎯 استمر كده',
        'ماشي زي الزيت 🧈 كمّل بقى',
        'روقان! 😎 تاسك وراه تاسك',
        'إنتاجية النهاردة جامدة أوي 💪',
        'شغل نضيف كده يا كبير 🧼',
        'برافو عليك! 👏 خطوة كمان لقدام',
        'ولا يهمك، إنت ماشي صح 🚦',
        'تاسك تاني في الجيب 🎒',
        'الله ينور، شغل متقن 💡',
        'مفيش حد زيك في السرعة دي ⚡',
        'كده بالظبط! استمر 🌟',
        'خلصان! يلا نكمل 🏁',
        'عاش يا نجم ⭐ تاسك تاني اتحل',
        'دقة وسرعة مع بعض 🎯⚡',
        'إنت في فورمة النهاردة 🔥',
        'حلو أوي كده، ريّح دماغك شوية 🧘',
        'كده يبقى تاسك ناجح 100% ✅',
        'شغلانة زي الفل 🌸',
        'واحدة واحدة وهتخلص الكوتة 📈',
        'جامد يا وحش، عدّاد التاسكات بيزيد 📊',
        'الصبر مفتاح الفرج، وإنت فاتحه 🔑',
        'تمام التمام! خلي همتك عالية 🚀',
        'يلا بينا كمّل الطريق ده 🛤️',
        'أداء يستاهل تصفيق 👏👏',
        'ماشي على السكة الصح 🛤️',
        'إنجاز جديد يتسجل باسمك 🏆',
        'خفيف ولذيذ زي الشغل ده 🍬',
        'مبروك عليك الإنجاز الجديد 🎊',
        'تاسك خلص، وواحد جاي كمان يستناك 👋'
    ];
    const hypeState = { last: -1 };

    // Special phrases for the moment of submitting the task (Submit) - a bit bigger/nicer than the regular finish-task phrases
    const SUBMIT_HYPE_PHRASES = [
        '🏆 عاش! التاسك اتسلّم بنجاح',
        '🚀 تسليم جامد! يلا على التاسك التاني',
        '👑 إنت ملك الشغل النهاردة',
        '🥇 تسليم يستاهل ميدالية',
        '🎊 تم التسليم! خد نفس وكمّل',
        '💎 شغل ألماظ، اتسلّم بنجاح',
        '🔥 حرقت التاسك ده وسلمته زي الفل',
        '🌟 نجم اليوم! تسليم ممتاز',
        '🎯 في الميعاد وبجودة عالية - تسليم تحفة',
        '🏁 خط النهاية اتعدى! يلا للي بعده',
        '🙌 برافو! تسليم يفتح النفس',
        '⚡ سرعة وجودة مع بعض في التسليم ده',
        '🎉 اتسلمت! فرصة تاخد نفس وتبدأ التاني'
    ];
    const submitHypeState = { last: -1 };

    function launchConfetti(durationMs) {
        const duration = durationMs || 4800;
        ensureCelebrationStyles();
        const layer = document.createElement('div');
        layer.className = 'tx-confetti-layer';
        document.body.appendChild(layer);

        const pieceCount = Math.min(160, Math.round(90 * (duration / 4800)));
        for (let i = 0; i < pieceCount; i++) {
            const piece = document.createElement('div');
            piece.className = 'tx-confetti-piece';
            const size = 6 + Math.random() * 7;
            const isCircle = Math.random() < 0.4;
            piece.style.width = size + 'px';
            piece.style.height = (isCircle ? size : size * 1.6) + 'px';
            piece.style.borderRadius = isCircle ? '50%' : '2px';
            piece.style.background = CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)];
            piece.style.left = Math.random() * 100 + 'vw';
            piece.style.animationDuration = (2.4 + Math.random() * (duration / 2400)) + 's';
            piece.style.animationDelay = (Math.random() * (duration / 8000)) + 's';
            layer.appendChild(piece);
        }
        setTimeout(() => layer.remove(), duration);
    }

    // Consecutive firework sparks popping randomly across the screen
    function launchFireworks(durationMs) {
        const duration = durationMs || 3600;
        const bursts = Math.max(2, Math.round(duration / 900));
        ensureCelebrationStyles();
        const layer = document.createElement('div');
        layer.className = 'tx-confetti-layer';
        document.body.appendChild(layer);

        for (let b = 0; b < bursts; b++) {
            const cx = 15 + Math.random() * 70;
            const cy = 15 + Math.random() * 45;
            setTimeout(() => {
                const color = CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)];
                for (let i = 0; i < 26; i++) {
                    const angle = (Math.PI * 2 * i) / 26 + Math.random() * 0.3;
                    const dist = 55 + Math.random() * 65;
                    const p = document.createElement('div');
                    p.className = 'tx-firework-particle';
                    p.style.left = cx + 'vw';
                    p.style.top = cy + 'vh';
                    p.style.color = color;
                    p.style.background = color;
                    p.style.setProperty('--dx', (Math.cos(angle) * dist) + 'px');
                    p.style.setProperty('--dy', (Math.sin(angle) * dist) + 'px');
                    layer.appendChild(p);
                }
            }, b * 320);
        }
        setTimeout(() => layer.remove(), bursts * 320 + 1600);
    }

    // Balloons theme: colorful balloons floating up with a gentle sway
    function launchBalloons(durationMs) {
        const duration = durationMs || 5200;
        ensureCelebrationStyles();
        const layer = document.createElement('div');
        layer.className = 'tx-confetti-layer';
        document.body.appendChild(layer);

        const count = Math.min(26, Math.round(14 * (duration / 5200)));
        for (let i = 0; i < count; i++) {
            const balloon = document.createElement('div');
            balloon.className = 'tx-balloon-piece';
            const w = 30 + Math.random() * 14;
            balloon.style.width = w + 'px';
            balloon.style.height = (w * 1.25) + 'px';
            balloon.style.background = BALLOON_COLORS[Math.floor(Math.random() * BALLOON_COLORS.length)];
            balloon.style.left = Math.random() * 100 + 'vw';
            balloon.style.animationDuration = (3.5 + Math.random() * (duration / 2600)) + 's';
            balloon.style.animationDelay = (Math.random() * (duration / 6000)) + 's';
            layer.appendChild(balloon);
        }
        setTimeout(() => layer.remove(), duration);
    }

    // Emoji-rain theme: cute, funny emojis falling from the top
    function launchEmojiRain(durationMs) {
        const duration = durationMs || 4600;
        ensureCelebrationStyles();
        const layer = document.createElement('div');
        layer.className = 'tx-confetti-layer';
        document.body.appendChild(layer);

        const count = Math.min(70, Math.round(40 * (duration / 4600)));
        for (let i = 0; i < count; i++) {
            const piece = document.createElement('div');
            piece.className = 'tx-emoji-piece';
            piece.textContent = EMOJI_SET[Math.floor(Math.random() * EMOJI_SET.length)];
            piece.style.fontSize = (16 + Math.random() * 16) + 'px';
            piece.style.left = Math.random() * 100 + 'vw';
            piece.style.animationDuration = (2.6 + Math.random() * (duration / 2300)) + 's';
            piece.style.animationDelay = (Math.random() * (duration / 7000)) + 's';
            layer.appendChild(piece);
        }
        setTimeout(() => layer.remove(), duration);
    }

    // Each theme takes the celebration duration in milliseconds and runs itself - the random pick between them happens on every celebration
    const CELEBRATION_THEMES = [
        (d) => launchConfetti(d),
        (d) => launchFireworks(d),
        (d) => launchBalloons(d),
        (d) => launchEmojiRain(d)
    ];
    const themeState = { last: -1 };

    function showCelebrationBannerCustom(title, subtitle, holdMs, goldStyle) {
        ensureCelebrationStyles();
        const banner = document.createElement('div');
        banner.className = 'tx-celebrate-banner' + (goldStyle ? ' tx-celebrate-gold' : '');
        banner.style.animationDuration = (holdMs / 1000) + 's';
        banner.innerHTML = '<div class="tx-cb-title">' + escapeHtml(title) + '</div>' +
            '<div class="tx-cb-sub">' + escapeHtml(subtitle) + '</div>';
        document.body.appendChild(banner);
        setTimeout(() => banner.remove(), holdMs);
    }

    function showCelebrationBanner(reminderNeeded) {
        showCelebrationBannerCustom(
            '🎉 تم الحفظ! 🎉',
            reminderNeeded
                ? 'متنساش تدوس ✅ إنهاء التاسك (أو F4) عشان الإحصائية تتسجل صح 📊'
                : 'مجهود جامد 👏 - جاهز للتاسك اللي بعده',
            3300
        );
    }

    // ==================== Runs a celebration once "✅ finish task" is actually confirmed (not before confirming) - random theme + random phrase, ====================
    // and it lasts a bit longer (~8 seconds) so it doesn't disappear too fast
    function celebrateFinishTask(tasksFinishedToday) {
        const duration = 9500;
        const theme = pickRandomNoRepeat(CELEBRATION_THEMES, themeState);
        theme(duration);
        const phrase = pickRandomNoRepeat(HYPE_PHRASES, hypeState);
        showCelebrationBannerCustom(phrase, 'تاسك رقم ' + tasksFinishedToday + ' النهاردة 🚀', 8300);
    }

    // A bigger, nicer celebration that runs when you press the site's own original "Submit" button - two themes together + a special phrase
    function celebrateSubmitTask() {
        const duration = 10500;
        let theme1 = pickRandomNoRepeat(CELEBRATION_THEMES, themeState);
        theme1(duration);
        let theme2;
        do { theme2 = CELEBRATION_THEMES[Math.floor(Math.random() * CELEBRATION_THEMES.length)]; } while (theme2 === theme1);
        setTimeout(() => theme2(duration * 0.7), 250);
        const phrase = pickRandomNoRepeat(SUBMIT_HYPE_PHRASES, submitHypeState);
        showCelebrationBannerCustom(phrase, 'يلا بينا على التاسك اللي بعده 💪', 9800, true);
    }

    // Called every time you press the site's own original "Save" button - runs a short celebration, and reminds you if you haven't done "finish task" yet
    function celebrateTaskSave() {
        launchConfetti();
        const reminderNeeded = currentTaskTouchedSerials.size > 0;
        showCelebrationBanner(reminderNeeded);
        if (reminderNeeded) {
            setTimeout(() => showToast('لا تنسى: دوس ✅ إنهاء التاسك أو F4 قبل ما تنتقل لتاسك تاني عشان الإحصائية تتسجل صح ⏱️', true, 7000), 1000);
        }
    }

    // Watches the site's own original "Save" and "Submit" buttons (without changing their behavior) and runs the matching celebration.
    // isAutoSaveTriggeredClick is set to true the moment auto-save itself clicks the Save button, so
    // it doesn't trigger a celebration/confetti every 60 seconds - the celebration should stay exclusive to a real user click.
    let isAutoSaveTriggeredClick = false;
    // Set to true whenever any edit happens in the table that hasn't been saved yet; set back to false once a Save happens
    // (whether you clicked it or auto-save did) - so auto-save stops clicking Save every minute if there's no
    // new edit at all since the last save.
    let hasUnsavedChangesSinceLastSave = false;
    function hookSiteSaveButton() {
        document.addEventListener('click', (e) => {
            const target = e.target.closest('button, div, span, a');
            if (!target) return;
            if (target.classList.contains('tx-tool-btn') || target.closest('#tx-floating-menu, .tx-panel-overlay')) return;
            const txt = (target.textContent || '').trim();
            if (txt === 'Save') {
                hasUnsavedChangesSinceLastSave = false;
                if (isAutoSaveTriggeredClick) return;
                celebrateTaskSave();
            } else if (txt === 'Submit') celebrateSubmitTask();
        }, true);
    }

    // ==================== Auto-save every 60 seconds ====================
    // Clicks the site's own original "Save" button itself every minute, so your work stays saved on its own
    // without you needing to remember to click it - if the power goes out or anything happens, the most you could lose is one minute of work.
    function findSiteSaveButton() {
        const candidates = Array.from(document.querySelectorAll('button, div, span, a')).filter(el => {
            if (el.classList.contains('tx-tool-btn')) return false;
            if (el.closest('#tx-floating-menu, .tx-panel-overlay, #tx-timer-widget, .tx-help-btn')) return false;
            const txt = (el.textContent || '').trim();
            if (txt !== 'Save') return false;
            return el.offsetParent !== null || el.getClientRects().length > 0;
        });
        if (candidates.length === 0) return null;
        // "Save" itself, so it mimics a real user click accurately
        candidates.sort((a, b) => a.querySelectorAll('*').length - b.querySelectorAll('*').length);
        return candidates[0];
    }

    function performAutoSave() {
        if (!hasUnsavedChangesSinceLastSave) return;
        if (!document.querySelector('#changyuliu_table')) return;
        const saveBtn = findSiteSaveButton();
        if (!saveBtn) return;
        isAutoSaveTriggeredClick = true;
        try {
            saveBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        } catch (e) { /* تجاهل */ }
        setTimeout(() => { isAutoSaveTriggeredClick = false; }, 500);
    }

    setInterval(performAutoSave, 60000);

    // Extra reminder: if you try to leave the page with edits not yet logged in "finish task", the browser will ask you to confirm
    window.addEventListener('beforeunload', (e) => {
        if (currentTaskTouchedSerials.size > 0) {
            e.preventDefault();
            e.returnValue = '';
        }
    });

    document.addEventListener('keydown', (e) => {
        // Important note: e.key returns the "translated" character based on your keyboard language - if your keyboard is Arabic,
        // pressing V gives you an Arabic letter, not "v", so any condition relying only on e.key will silently fail. The fix: e.code returns
        // the physical key location itself (like 'KeyV') regardless of keyboard language, so we rely on it here (with e.key
        // as a second line of defense for the rare old browsers that might not support e.code).
        const isKey = (code, key) => e.code === code || e.key.toLowerCase() === key;

        if ((e.ctrlKey || e.metaKey) && !e.shiftKey && isKey('KeyZ', 'z')) {
            e.preventDefault();
            undoLastEdit();
            return;
        }
        if ((e.ctrlKey || e.metaKey) && (isKey('KeyY', 'y') || (e.shiftKey && isKey('KeyZ', 'z')))) {
            e.preventDefault();
            redoLastEdit();
            return;
        }
        // Multi-clipboard feature - needs to work while you're inside the text field itself, so it's checked before the isEditing condition.
        // Ctrl+Shift+V is the primary shortcut, Alt+V is an easy alternate with no known browser conflict
        // (F6 was a bad choice since it takes you to Chrome's address bar, so we dropped it).
        if (((e.ctrlKey || e.metaKey) && e.shiftKey && isKey('KeyV', 'v')) || (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && isKey('KeyV', 'v'))) {
            const target = document.activeElement;
            if (target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT')) {
                e.preventDefault();
                showClipboardRingMenu(target);
                return;
            }
        }

        const active = document.activeElement;
        const isEditing = active && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT' || active.isContentEditable);
        if (isEditing) return;

        if (e.key === 'F2') {
            e.preventDefault();
            if (fullReviewBtnRef) runFullReview(fullReviewBtnRef);
        } else if (e.key === 'F4') {
            e.preventDefault();
            if (finishTaskBtnRef) finishCurrentTask(finishTaskBtnRef);
        } else if (isKey('KeyT', 't') && !e.ctrlKey && !e.metaKey && !e.altKey) {
            e.preventDefault();
            if (tagCheckBtnRef) checkTagConsistency(tagCheckBtnRef);
        } else if (e.key === 'ArrowDown' && e.altKey) {
            e.preventDefault();
            goToErrorRelative(1);
        } else if (e.key === 'ArrowUp' && e.altKey) {
            e.preventDefault();
            goToErrorRelative(-1);
        }
    });

    // Called here (last thing in the file) to make sure all the let/const any button needs (like taskTimerStart) are already defined
    initButtons();
})();

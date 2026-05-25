// ==UserScript==
// @name         크랙 미등록 백업/복원
// @namespace    https://crack.wrtn.ai
// @version      1.1.0
// @author       me
// @description  미등록 스토리를 확장프로그램 내부에 저장하고 복원. 무한 임시저장!
// @match        https://crack.wrtn.ai/*
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// ==/UserScript==

(function () {
    'use strict';

    const API_BASE = 'https://crack-api.wrtn.ai/crack-api';
    const LOG = '[백업/복원]';
    const STORAGE_KEY = 'crack_story_backups';

    // ─────────── 내부 저장소 ───────────

    function loadBackups() {
        try {
            const raw = GM_getValue(STORAGE_KEY, '[]');
            return JSON.parse(raw);
        } catch (_) { return []; }
    }

    function saveBackups(list) {
        GM_setValue(STORAGE_KEY, JSON.stringify(list));
    }

    function addBackup(entry) {
        const list = loadBackups();
        list.unshift(entry); // 최신이 위로
        saveBackups(list);
    }

    function removeBackup(backupId) {
        const list = loadBackups().filter(b => b.backupId !== backupId);
        saveBackups(list);
    }

    // ─────────── 스타일 ───────────

    GM_addStyle(`
        .dbm-toast {
            position: fixed; top: 24px; left: 50%;
            transform: translateX(-50%) translateY(-120%);
            background: #1a1a1a; color: #fff;
            padding: 14px 28px; border-radius: 12px;
            font-size: 14px; font-weight: 600;
            line-height: 1.5; text-align: center; white-space: pre-line;
            z-index: 100001; box-shadow: 0 8px 32px rgba(0,0,0,0.4);
            transition: transform 0.35s cubic-bezier(0.16, 1, 0.3, 1);
            pointer-events: none;
        }
        .dbm-toast.show { transform: translateX(-50%) translateY(0); }

        .dbm-btn {
            font-size: 14px; font-weight: 500;
            color: hsl(var(--popover-foreground));
            padding: 8px 14px; cursor: pointer;
            user-select: none; transition: background 0.2s;
        }
        .dbm-btn:hover { background: hsl(var(--accent)); }
        .dbm-divider { height: 1px; background: hsl(var(--border)); margin: 4px 0; }
        .dbm-label {
            font-size: 12px; font-weight: 600;
            color: hsl(var(--muted-foreground));
            padding: 6px 14px 2px; user-select: none;
        }

        .dbm-fab {
            position: fixed; bottom: 24px; right: 24px;
            background: #1a1a1a; color: #fff; border: none;
            padding: 12px 20px; border-radius: 12px;
            font-size: 14px; font-weight: 600; cursor: pointer;
            z-index: 9999; box-shadow: 0 4px 16px rgba(0,0,0,0.3);
            transition: transform 0.2s, background 0.2s;
        }
        .dbm-fab:hover { background: #333; transform: translateY(-2px); }

        .dbm-overlay {
            position: fixed; inset: 0; background: rgba(0,0,0,0.5);
            z-index: 100000; display: flex; align-items: center; justify-content: center;
        }
        .dbm-panel {
            background: hsl(var(--popover, 0 0% 100%));
            color: hsl(var(--popover-foreground, 0 0% 0%));
            border-radius: 16px; padding: 24px;
            min-width: 360px; max-width: 500px; max-height: 70vh;
            box-shadow: 0 16px 48px rgba(0,0,0,0.3);
            display: flex; flex-direction: column; gap: 12px;
        }
        .dbm-panel-title {
            font-size: 18px; font-weight: 700; margin: 0;
        }
        .dbm-panel-subtitle {
            font-size: 13px; color: hsl(var(--muted-foreground, 0 0% 45%));
            margin: -4px 0 4px;
        }
        .dbm-panel-list {
            overflow-y: auto; max-height: 50vh;
            display: flex; flex-direction: column; gap: 8px;
        }
        .dbm-panel-empty {
            text-align: center; padding: 32px 0;
            color: hsl(var(--muted-foreground, 0 0% 45%));
            font-size: 14px;
        }
        .dbm-card {
            display: flex; align-items: center; justify-content: space-between;
            padding: 12px 14px; border-radius: 10px;
            border: 1px solid hsl(var(--border, 0 0% 90%));
            transition: background 0.15s;
        }
        .dbm-card:hover { background: hsl(var(--accent, 0 0% 96%)); }
        .dbm-card-info { flex: 1; min-width: 0; }
        .dbm-card-name {
            font-size: 14px; font-weight: 600;
            overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .dbm-card-date {
            font-size: 12px; color: hsl(var(--muted-foreground, 0 0% 45%));
            margin-top: 2px;
        }
        .dbm-card-btns { display: flex; gap: 6px; margin-left: 8px; }
        .dbm-card-btn {
            padding: 6px 12px; border-radius: 8px; border: none;
            font-size: 13px; font-weight: 600; cursor: pointer;
            transition: opacity 0.15s;
        }
        .dbm-card-btn:hover { opacity: 0.8; }
        .dbm-card-btn.restore { background: #2563eb; color: #fff; }
        .dbm-card-btn.delete { background: #ef4444; color: #fff; }
        .dbm-panel-close {
            padding: 10px 0; text-align: center;
            font-size: 14px; font-weight: 600; cursor: pointer;
            border-radius: 8px; transition: background 0.15s;
        }
        .dbm-panel-close:hover { background: hsl(var(--accent, 0 0% 96%)); }
    `);

    // ─────────── 유틸 ───────────

    function toast(msg, duration = 3600) {
        document.querySelectorAll('.dbm-toast').forEach(el => el.remove());
        const el = document.createElement('div');
        el.className = 'dbm-toast';
        el.textContent = msg;
        document.body.appendChild(el);
        requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('show')));
        setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 400); }, duration);
    }

    function getToken() {
        const m = document.cookie.match(/(?:^|; )access_token=([^;]*)/);
        return m ? decodeURIComponent(m[1]) : null;
    }

    async function apiFetch(method, url, body, label = '') {
        const token = getToken();
        if (!token) throw new Error('로그인 상태를 확인해주세요.');
        const opts = { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } };
        if (body !== undefined) opts.body = JSON.stringify(body);
        const res = await fetch(url, opts);
        const text = await res.text();
        let json = null;
        try { json = text ? JSON.parse(text) : null; } catch (_) { json = { rawText: text }; }
        if (!res.ok) {
            console.error(`${LOG} API 에러 ${label}`, { status: res.status, url, response: json });
            const err = new Error(json?.message || `HTTP ${res.status}`);
            err.status = res.status; err.response = json;
            throw err;
        }
        return json;
    }

    function getFirst(...values) {
        for (const v of values) { if (v !== undefined && v !== null && v !== '') return v; }
        return undefined;
    }

    function normalizeSimpleValue(v) {
        if (!v) return undefined;
        if (typeof v === 'string') return v;
        return v._id || v.id || v.type || v.name;
    }

    // ─────────── 백업 ───────────

    async function backupStory(storyId, andDelete = false) {
        toast('스토리 데이터 가져오는 중...');
        try {
            const detail = await apiFetch('GET', `${API_BASE}/stories/me/${storyId}`, undefined, '백업 조회');
            const raw = detail?.data;
            if (!raw) throw new Error('스토리 데이터를 못 가져왔어요.');

            const entry = {
                backupId: `bk_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                name: raw.name || '스토리',
                date: new Date().toISOString(),
                originalStoryId: storyId,
                storyData: raw
            };

            addBackup(entry);
            console.log(`${LOG} 백업 저장 완료`, { backupId: entry.backupId, name: entry.name });

            if (andDelete) {
                toast('백업 완료! 크랙에서 삭제 중...');
                await new Promise(r => setTimeout(r, 500));
                try {
                    await apiFetch('DELETE', `${API_BASE}/stories/${storyId}`, undefined, '삭제');
                    toast(`✓ 백업 + 삭제 완료!\n"${entry.name}" 저장됨, 슬롯 확보!`, 4000);
                    setTimeout(() => location.reload(), 1500);
                } catch (e) {
                    toast(`백업은 됐지만 삭제 실패 ㅠ\n수동으로 삭제해주세요.`, 5000);
                }
            } else {
                toast(`✓ 백업 완료!\n"${entry.name}" → 확장프로그램에 저장됨`, 3500);
            }
        } catch (err) {
            console.error(`${LOG} 백업 실패`, err);
            toast('백업 실패 ㅠㅠ\n' + String(err?.message || err).slice(0, 200), 5000);
        }
    }

    // ─────────── 복원 ───────────

    function buildRestorePayload(raw) {
        const startingSets = (Array.isArray(raw?.startingSets) ? raw.startingSets : []).map(set => {
            const out = {
                name: set?.name || '기본 설정',
                initialMessages: Array.isArray(set?.initialMessages) ? set.initialMessages : [],
                situationPrompt: set?.situationPrompt || '',
                replySuggestions: Array.isArray(set?.replySuggestions) ? set.replySuggestions : [],
                situationImages: Array.isArray(set?.situationImages) ? set.situationImages : [],
                keywordBook: Array.isArray(set?.keywordBook) ? set.keywordBook : [],
                parameters: Array.isArray(set?.parameters) ? set.parameters : [],
                imageMatrix: set?.imageMatrix || {}
            };
            if (set?.baseSetId) out.baseSetId = set.baseSetId;
            if (typeof set?.playGuide === 'string' && set.playGuide.trim()) out.playGuide = set.playGuide;
            return out;
        });

        const payload = {
            name: raw?.name || '복원된 스토리',
            description: raw?.description || '',
            simpleDescription: raw?.simpleDescription || '',
            storyDetails: raw?.storyDetails || '',
            chatExamples: Array.isArray(raw?.chatExamples) ? raw.chatExamples : [],
            tags: Array.isArray(raw?.tags) ? raw.tags : [],
            visibility: 'private',
            target: normalizeSimpleValue(raw?.target) || raw?.target,
            promptTemplate: raw?.promptTemplate || 'custom',
            isCommentBlocked: !!raw?.isCommentBlocked,
            startingSets,
            shortcutCommands: Array.isArray(raw?.shortcutCommands) ? raw.shortcutCommands : [],
            defaultCrackerModel: raw?.defaultCrackerModel || 'superchat_2_0',
            chatType: normalizeSimpleValue(raw?.chatType) || 'rolePlaying',
            detailDescription: raw?.detailDescription || '',
            chatModelId: raw?.chatModelId,
            situationImageVersion: raw?.situationImageVersion || 'v2',
            customPrompt: raw?.customPrompt || '',
            creatorRecommendedMaxOutput: raw?.creatorRecommendedMaxOutput
        };

        const m = raw?.model;
        if (m) payload.model = (String(m) === m.toUpperCase()) ? m.toLowerCase() : m;

        const genreId = getFirst(raw?.genreId, raw?.genre?._id, raw?.genre?.id);
        if (genreId) payload.genreId = genreId;

        const portrait = getFirst(raw?.portraitImageUrl, raw?.portraitImage?.origin, raw?.profileImage?.origin);
        if (portrait) payload.portraitImageUrl = portrait;

        if (raw?.isMovingPortraitImage || raw?.profileImage?.gif) payload.isMovingPortraitImage = true;

        return payload;
    }

    async function restoreFromBackup(backup) {
        const raw = backup.storyData;
        const name = backup.name;
        toast(`"${name}" 복원 중...\n1/2 스토리 생성`, 5000);

        try {
            // 1. 생성
            let createRes = null;
            for (const url of [`${API_BASE}/stories`, `${API_BASE}/stories/v2`]) {
                try {
                    createRes = await apiFetch('POST', url, {
                        name: raw?.name || '복원',
                        description: raw?.description || '백업 복원',
                        chatType: normalizeSimpleValue(raw?.chatType) || 'rolePlaying'
                    }, `생성 ${url}`);
                    if (createRes?.data?._id || createRes?.data?.id) break;
                } catch (err) {
                    if (err?.status !== 404 && err?.status !== 405) throw err;
                }
            }

            const newId = createRes?.data?._id || createRes?.data?.id;
            if (!newId) throw new Error('스토리 생성 실패. 미등록 5개 제한일 수 있어요.');

            // 2. PATCH
            toast(`"${name}" 복원 중...\n2/2 데이터 채우기`, 5000);
            const patchPayload = buildRestorePayload(raw);

            try {
                const newDetail = await apiFetch('GET', `${API_BASE}/stories/me/${newId}`, undefined, '새 스토리 조회');
                const nr = newDetail?.data;
                if (nr?.snapshotId) patchPayload.expectedBaseSnapshotId = nr.snapshotId;
                if (nr?.startingSets?.length && patchPayload.startingSets?.length) {
                    patchPayload.startingSets.forEach((set, i) => {
                        if (nr.startingSets[i]) {
                            set.baseSetId = nr.startingSets[i].baseSetId || nr.startingSets[i]._id;
                        }
                    });
                }
            } catch (_) {}

            let patched = false;
            for (const url of [`${API_BASE}/stories/${newId}/v2`, `${API_BASE}/stories/${newId}`]) {
                try {
                    await apiFetch('PATCH', url, patchPayload, `PATCH ${url}`);
                    patched = true; break;
                } catch (err) {
                    if (err?.status === 404 || err?.status === 405 || err?.status === 400) continue;
                    throw err;
                }
            }

            if (patched) {
                toast(`✓ 복원 완료!\n"${name}"`, 4000);
                setTimeout(() => location.reload(), 1500);
            } else {
                toast(`스토리 생성됨, 데이터 채우기 실패.\n수동 편집 필요.`, 5000);
            }
        } catch (err) {
            console.error(`${LOG} 복원 실패`, err);
            toast('복원 실패 ㅠㅠ\n' + String(err?.message || err).slice(0, 200), 6000);
        }
    }

    // ─────────── 백업 목록 패널 ───────────

    function formatDate(iso) {
        try {
            const d = new Date(iso);
            const pad = n => String(n).padStart(2, '0');
            return `${d.getFullYear()}.${pad(d.getMonth()+1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
        } catch (_) { return iso; }
    }

    function openBackupPanel() {
        // 기존 패널 닫기
        document.querySelectorAll('.dbm-overlay').forEach(el => el.remove());

        const backups = loadBackups();

        const overlay = document.createElement('div');
        overlay.className = 'dbm-overlay';
        overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

        const panel = document.createElement('div');
        panel.className = 'dbm-panel';

        const title = document.createElement('h2');
        title.className = 'dbm-panel-title';
        title.textContent = '📦 저장된 백업';
        panel.appendChild(title);

        const subtitle = document.createElement('div');
        subtitle.className = 'dbm-panel-subtitle';
        subtitle.textContent = `${backups.length}개 저장됨 · 확장프로그램 내부 저장`;
        panel.appendChild(subtitle);

        const list = document.createElement('div');
        list.className = 'dbm-panel-list';

        if (backups.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'dbm-panel-empty';
            empty.textContent = '저장된 백업이 없어요.\n스토리 메뉴에서 📦 백업을 눌러보세요!';
            list.appendChild(empty);
        } else {
            for (const backup of backups) {
                const card = document.createElement('div');
                card.className = 'dbm-card';

                const info = document.createElement('div');
                info.className = 'dbm-card-info';

                const nameEl = document.createElement('div');
                nameEl.className = 'dbm-card-name';
                nameEl.textContent = backup.name;
                info.appendChild(nameEl);

                const dateEl = document.createElement('div');
                dateEl.className = 'dbm-card-date';
                dateEl.textContent = formatDate(backup.date);
                info.appendChild(dateEl);

                card.appendChild(info);

                const btns = document.createElement('div');
                btns.className = 'dbm-card-btns';

                const restoreBtn = document.createElement('button');
                restoreBtn.className = 'dbm-card-btn restore';
                restoreBtn.textContent = '복원';
                restoreBtn.addEventListener('click', () => {
                    overlay.remove();
                    restoreFromBackup(backup);
                });
                btns.appendChild(restoreBtn);

                const deleteBtn = document.createElement('button');
                deleteBtn.className = 'dbm-card-btn delete';
                deleteBtn.textContent = '삭제';
                deleteBtn.addEventListener('click', () => {
                    if (confirm(`"${backup.name}" 백업을 삭제할까요?`)) {
                        removeBackup(backup.backupId);
                        overlay.remove();
                        openBackupPanel(); // 새로고침
                        toast(`"${backup.name}" 백업 삭제됨`, 2500);
                    }
                });
                btns.appendChild(deleteBtn);

                card.appendChild(btns);
                list.appendChild(card);
            }
        }

        panel.appendChild(list);

        const closeBtn = document.createElement('div');
        closeBtn.className = 'dbm-panel-close';
        closeBtn.textContent = '닫기';
        closeBtn.addEventListener('click', () => overlay.remove());
        panel.appendChild(closeBtn);

        overlay.appendChild(panel);
        document.body.appendChild(overlay);
    }

    // ─────────── 메뉴 삽입 ───────────

    function getStoryInfoFromMenu() {
        const popper = document.querySelector('div[data-radix-popper-content-wrapper]');
        if (!popper || !popper.childNodes[0]) return null;
        try {
            const el = popper.childNodes[0];
            const pk = Object.keys(el).find(k => k.startsWith('__reactProps'));
            if (!pk) return null;
            const children = [].concat(el[pk]?.children || []);
            for (const ch of children) {
                if (ch?.props?.content?.sourceId) {
                    return { id: ch.props.content.sourceId, type: ch.props.content.type || 'story' };
                }
            }
        } catch (_) {}
        return null;
    }

    function createMenuBtn(label, onClick) {
        const btn = document.createElement('div');
        btn.className = 'dbm-btn';
        btn.textContent = label;
        btn.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); onClick(); });
        return btn;
    }

    const MARKER = 'dbm-injected';

    function injectMenu() {
        if (!/^\/my(\/.*)?$/.test(location.pathname)) return;
        const popper = document.querySelector('div[data-radix-popper-content-wrapper]');
        if (!popper) return;
        const container = popper.querySelector('[role="menu"], [data-radix-menu-content]') || popper.childNodes[0]?.childNodes[0];
        if (!container || container.hasAttribute(MARKER)) return;
        container.setAttribute(MARKER, 'true');
        const info = getStoryInfoFromMenu();
        if (!info) return;

        container.appendChild(Object.assign(document.createElement('div'), { className: 'dbm-divider' }));
        container.appendChild(Object.assign(document.createElement('div'), { className: 'dbm-label', textContent: '백업 / 복원' }));
        container.appendChild(createMenuBtn('📦 백업 (내부 저장)', () => backupStory(info.id, false)));
        container.appendChild(createMenuBtn('📦 백업 후 삭제 (슬롯 확보)', () => backupStory(info.id, true)));
    }

    function injectFab() {
        if (!/^\/my(\/.*)?$/.test(location.pathname)) {
            document.getElementById('dbm-fab')?.remove();
            return;
        }
        if (document.getElementById('dbm-fab')) return;
        const btn = document.createElement('button');
        btn.id = 'dbm-fab';
        btn.className = 'dbm-fab';
        const count = loadBackups().length;
        btn.textContent = `📦 저장된 백업${count ? ` (${count})` : ''}`;
        btn.addEventListener('click', openBackupPanel);
        document.body.appendChild(btn);
    }

    function init() {
        new MutationObserver(() => { injectMenu(); injectFab(); })
            .observe(document.body, { childList: true, subtree: true });
        injectFab();
        console.log(`${LOG} 로드 완료 v1.1.0`);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();

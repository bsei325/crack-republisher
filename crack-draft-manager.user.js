// ==UserScript==
// @name         크랙 임시등록 (무제한)
// @namespace    https://crack.wrtn.ai
// @version      2.1.0
// @author       me
// @description  스토리 에디터에서 임시등록(로컬 무제한) + 불러오기. 미등록 슬롯 안 씀!
// @match        https://crack.wrtn.ai/*
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// ==/UserScript==

(function () {
    'use strict';

    const API_BASE = 'https://crack-api.wrtn.ai/crack-api';
    const LOG = '[임시등록]';
    const STORAGE_KEY = 'crack_local_drafts';

    // ─────── 저장소 ───────
    function loadDrafts() {
        try { return JSON.parse(GM_getValue(STORAGE_KEY, '[]')); }
        catch (_) { return []; }
    }
    function saveDrafts(list) { GM_setValue(STORAGE_KEY, JSON.stringify(list)); }
    function addDraft(entry) { const l = loadDrafts(); l.unshift(entry); saveDrafts(l); }
    function removeDraft(id) { saveDrafts(loadDrafts().filter(d => d.id !== id)); }

    // ─────── 스타일 ───────
    GM_addStyle(`
        .ld-toast {
            position:fixed;top:24px;left:50%;transform:translateX(-50%) translateY(-120%);
            background:#1a1a1a;color:#fff;padding:14px 28px;border-radius:12px;
            font-size:14px;font-weight:600;line-height:1.5;text-align:center;white-space:pre-line;
            z-index:100001;box-shadow:0 8px 32px rgba(0,0,0,0.4);
            transition:transform .35s cubic-bezier(.16,1,.3,1);pointer-events:none;
        }
        .ld-toast.show{transform:translateX(-50%) translateY(0)}

        .ld-editor-btns{display:flex;gap:8px;align-items:center}
        .ld-ebtn{
            padding:8px 16px;border-radius:8px;font-size:13px;font-weight:600;
            cursor:pointer;border:none;transition:opacity .15s;
        }
        .ld-ebtn:hover{opacity:.85}
        .ld-ebtn.save{background:#2563eb;color:#fff}
        .ld-ebtn.load{background:#7c3aed;color:#fff}

        .ld-overlay{
            position:fixed;inset:0;background:rgba(0,0,0,.5);
            z-index:100000;display:flex;align-items:center;justify-content:center;
        }
        .ld-panel{
            background:#fff;border-radius:16px;padding:24px;
            min-width:380px;max-width:500px;max-height:70vh;
            box-shadow:0 16px 48px rgba(0,0,0,.3);
            display:flex;flex-direction:column;gap:12px;color:#111;
        }
        @media(prefers-color-scheme:dark){
            .ld-panel{background:#1a1a1a;color:#eee}
            .ld-card{border-color:#333}
            .ld-card:hover{background:#222}
        }
        .ld-panel-title{font-size:18px;font-weight:700;margin:0}
        .ld-panel-sub{font-size:13px;color:#888;margin:-4px 0 4px}
        .ld-panel-list{overflow-y:auto;max-height:50vh;display:flex;flex-direction:column;gap:8px}
        .ld-panel-empty{text-align:center;padding:32px 0;color:#888;font-size:14px}
        .ld-card{
            display:flex;align-items:center;justify-content:space-between;
            padding:12px 14px;border-radius:10px;border:1px solid #ddd;transition:background .15s;
        }
        .ld-card:hover{background:#f5f5f5}
        .ld-card-info{flex:1;min-width:0}
        .ld-card-name{font-size:14px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .ld-card-date{font-size:12px;color:#888;margin-top:2px}
        .ld-card-btns{display:flex;gap:6px;margin-left:8px}
        .ld-card-btn{
            padding:6px 12px;border-radius:8px;border:none;
            font-size:13px;font-weight:600;cursor:pointer;transition:opacity .15s;
        }
        .ld-card-btn:hover{opacity:.8}
        .ld-card-btn.restore{background:#2563eb;color:#fff}
        .ld-card-btn.del{background:#ef4444;color:#fff}
        .ld-panel-close{
            padding:10px 0;text-align:center;font-size:14px;font-weight:600;
            cursor:pointer;border-radius:8px;transition:background .15s;
        }
        .ld-panel-close:hover{background:#f0f0f0}
        @media(prefers-color-scheme:dark){.ld-panel-close:hover{background:#333}}
    `);

    // ─────── 유틸 ───────
    function toast(msg, duration = 3600) {
        document.querySelectorAll('.ld-toast').forEach(el => el.remove());
        const el = document.createElement('div');
        el.className = 'ld-toast'; el.textContent = msg;
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
        if (!token) throw new Error('로그인 필요');
        const opts = { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } };
        if (body !== undefined) opts.body = JSON.stringify(body);
        const res = await fetch(url, opts);
        const text = await res.text();
        let json; try { json = text ? JSON.parse(text) : null; } catch (_) { json = { rawText: text }; }
        if (!res.ok) { const err = new Error(json?.message || `HTTP ${res.status}`); err.status = res.status; throw err; }
        return json;
    }

    // ─────── React 내부에서 폼 데이터 추출 ───────

    // fetch 가로채기 (3차 대안용)
    let interceptMode = false;
    let interceptResolve = null;

    const _origFetch = window.fetch;
    window.fetch = async function (url, opts = {}) {
        if (interceptMode && typeof url === 'string' &&
            url.includes('/stories') &&
            (opts.method === 'POST' || opts.method === 'PATCH' || opts.method === 'PUT')) {
            let body = null;
            try { body = typeof opts.body === 'string' ? JSON.parse(opts.body) : opts.body; } catch (_) {}
            if (body && (body.name || body.customPrompt || body.startingSets)) {
                interceptMode = false;
                if (interceptResolve) interceptResolve(body);
                return new Response(JSON.stringify({
                    result: 'SUCCESS', data: { _id: 'local_temp' }
                }), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }
        }
        return _origFetch.apply(this, arguments);
    };

    function hasStoryKeys(obj) {
        if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
        const keys = Object.keys(obj);
        const storyKeys = ['name', 'customPrompt', 'storyDetails', 'startingSets',
            'situationImageVersion', 'chatType', 'description', 'promptTemplate',
            'chatExamples', 'tags', 'simpleDescription', 'detailDescription'];
        return storyKeys.filter(k => keys.includes(k)).length >= 3;
    }

    function extractFromReactFiber() {
        // React 루트 찾기
        const roots = [
            document.getElementById('__next'),
            document.getElementById('root'),
            document.querySelector('[data-reactroot]'),
            document.body
        ].filter(Boolean);

        for (const root of roots) {
            const fiberKey = Object.keys(root).find(k =>
                k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance'));
            if (!fiberKey) continue;

            let found = null;

            function walk(fiber, depth) {
                if (!fiber || found || depth > 80) return;

                // hooks 체인 탐색 (함수 컴포넌트)
                let hook = fiber.memoizedState;
                let hookIdx = 0;
                while (hook && hookIdx < 50) {
                    const val = hook.memoizedState;
                    if (val && typeof val === 'object') {
                        if (hasStoryKeys(val)) { found = val; return; }
                        if (Array.isArray(val) && val[0] && hasStoryKeys(val[0])) { found = val[0]; return; }
                    }
                    if (hook.queue?.lastRenderedState && hasStoryKeys(hook.queue.lastRenderedState)) {
                        found = hook.queue.lastRenderedState; return;
                    }
                    hook = hook.next;
                    hookIdx++;
                }

                // 클래스 컴포넌트 state
                if (fiber.stateNode?.state && hasStoryKeys(fiber.stateNode.state)) {
                    found = fiber.stateNode.state; return;
                }

                // props 확인
                if (fiber.memoizedProps && hasStoryKeys(fiber.memoizedProps)) {
                    found = fiber.memoizedProps; return;
                }
                // props 안의 중첩 객체
                if (fiber.memoizedProps) {
                    for (const v of Object.values(fiber.memoizedProps)) {
                        if (v && typeof v === 'object' && hasStoryKeys(v)) {
                            found = v; return;
                        }
                    }
                }

                walk(fiber.child, depth + 1);
                if (!found) walk(fiber.sibling, depth + 1);
            }

            walk(root[fiberKey], 0);
            if (found) {
                console.log(`${LOG} React fiber에서 데이터 발견!`, Object.keys(found));
                return found;
            }
        }

        return null;
    }

    function readFormFromDOM() {
        const data = {};
        const inputs = document.querySelectorAll('input[type="text"], input:not([type])');
        const textareas = document.querySelectorAll('textarea');

        // 첫 번째 input은 보통 이름
        if (inputs[0]?.value) data.name = inputs[0].value;

        // textarea 내용 수집
        textareas.forEach((ta, i) => {
            if (!ta.value) return;
            if (i === 0 && !data.storyDetails) data.storyDetails = ta.value;
            else if (i === 1 && !data.customPrompt) data.customPrompt = ta.value;
        });

        // select 값들
        document.querySelectorAll('select').forEach(sel => {
            if (sel.value) {
                const label = sel.closest('label, [class*="field"]')?.textContent || '';
                if (label.includes('템플릿') || label.includes('프롬프트')) data.promptTemplate = sel.value;
            }
        });

        return Object.keys(data).length >= 1 ? data : null;
    }

    // ─────── 임시등록 (저장) ───────

    function findSaveButton() {
        const buttons = document.querySelectorAll('button, [role="button"]');
        for (const btn of buttons) {
            const text = btn.textContent?.trim();
            if (text === '임시저장' || text === '임시 저장') return btn;
        }
        const headerBtns = document.querySelectorAll('header button, nav button, [class*="header"] button');
        for (const btn of headerBtns) {
            if (btn.textContent?.includes('임시')) return btn;
        }
        return null;
    }

    async function doLocalSave() {
        toast('데이터 읽는 중...', 3000);

        // 1차: React 내부에서 직접 읽기
        let capturedData = extractFromReactFiber();

        // 2차: DOM에서 읽기
        if (!capturedData) {
            console.warn(`${LOG} React fiber 실패, DOM에서 읽기 시도`);
            capturedData = readFormFromDOM();
        }

        // 3차: fetch 가로채기 (임시저장 버튼 클릭)
        if (!capturedData) {
            console.warn(`${LOG} DOM 읽기도 실패, fetch 가로채기 시도`);
            const saveBtn = findSaveButton();
            if (saveBtn) {
                capturedData = await new Promise((resolve) => {
                    interceptResolve = resolve;
                    interceptMode = true;
                    setTimeout(() => { if (interceptMode) { interceptMode = false; resolve(null); } }, 5000);
                    saveBtn.click();
                });
            }
        }

        if (!capturedData) {
            toast('데이터를 못 읽었어요 ㅠ\n폼에 내용을 채운 후 다시 시도해주세요.', 4000);
            return;
        }

        // 깊은 복사 (React 프록시 객체 대응)
        let cleanData;
        try {
            cleanData = JSON.parse(JSON.stringify(capturedData));
        } catch (_) {
            cleanData = { ...capturedData };
        }

        const entry = {
            id: `draft_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            name: cleanData.name || '이름 없는 스토리',
            date: new Date().toISOString(),
            data: cleanData
        };

        addDraft(entry);
        console.log(`${LOG} 임시등록 완료`, { id: entry.id, name: entry.name, keys: Object.keys(cleanData) });
        toast(`✓ 임시등록 완료!\n"${entry.name}" 저장됨 (${loadDrafts().length}개)`, 3500);
    }

    // ─────── 불러오기 (복원) ───────

    function formatDate(iso) {
        try {
            const d = new Date(iso);
            const pad = n => String(n).padStart(2, '0');
            return `${d.getFullYear()}.${pad(d.getMonth()+1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
        } catch (_) { return iso; }
    }

    function fillFormField(el, value) {
        if (!el || value === undefined || value === null) return;
        const val = String(value);
        const setter = el.tagName === 'TEXTAREA'
            ? Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set
            : Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
        if (setter) {
            setter.call(el, val);
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
        }
    }

    function tryFillForm(data) {
        let filled = 0;

        // 이름 필드 (보통 첫 번째 input)
        const inputs = document.querySelectorAll('input[type="text"], input:not([type])');
        const textareas = document.querySelectorAll('textarea');

        // 이름
        if (data.name && inputs.length > 0) {
            fillFormField(inputs[0], data.name);
            filled++;
        }

        // 간단한 설명
        if (data.simpleDescription && inputs.length > 1) {
            fillFormField(inputs[1], data.simpleDescription);
            filled++;
        }

        // 스토리 설정 및 정보 / 상세 설명 (textarea)
        if (textareas.length > 0) {
            const storyDetail = data.storyDetails || data.description || '';
            if (storyDetail) {
                fillFormField(textareas[0], storyDetail);
                filled++;
            }
        }

        console.log(`${LOG} 폼 채우기: ${filled}개 필드`);
        return filled;
    }

    async function loadFromDraft(draft) {
        toast(`"${draft.name}" 불러오는 중...`, 3000);

        const data = draft.data;

        // 1차: 현재 폼에 직접 채우기 시도
        const filled = tryFillForm(data);

        if (filled > 0) {
            toast(`✓ "${draft.name}" 불러옴!\n기본 필드 ${filled}개 채움\n\n💡 나머지는 탭별로 확인해주세요.`, 5000);
            return;
        }

        // 2차: API로 스토리 생성 + PATCH (미등록 슬롯 1개 사용)
        if (!confirm(`폼 직접 채우기가 안 돼서\n서버에 새 스토리로 만들어야 해요.\n(미등록 슬롯 1개 사용)\n\n계속할까요?`)) {
            toast('취소됨', 2000);
            return;
        }

        try {
            toast('새 스토리 생성 중...', 5000);

            let createRes;
            for (const url of [`${API_BASE}/stories`, `${API_BASE}/stories/v2`]) {
                try {
                    createRes = await apiFetch('POST', url, {
                        name: data.name || '복원된 스토리',
                        description: data.description || '',
                        chatType: data.chatType || 'rolePlaying'
                    }, `생성`);
                    if (createRes?.data?._id) break;
                } catch (err) {
                    if (err?.status !== 404 && err?.status !== 405) throw err;
                }
            }

            const newId = createRes?.data?._id || createRes?.data?.id;
            if (!newId) throw new Error('스토리 생성 실패. 미등록 슬롯이 꽉 찼을 수 있어요.');

            // PATCH
            toast('데이터 채우는 중...', 5000);

            try {
                const newDetail = await apiFetch('GET', `${API_BASE}/stories/me/${newId}`, undefined, '조회');
                const nr = newDetail?.data;
                if (nr?.snapshotId) data.expectedBaseSnapshotId = nr.snapshotId;
                if (nr?.startingSets?.length && data.startingSets?.length) {
                    data.startingSets.forEach((set, i) => {
                        if (nr.startingSets[i]) {
                            set.baseSetId = nr.startingSets[i].baseSetId || nr.startingSets[i]._id;
                        }
                    });
                }
            } catch (_) {}

            data.visibility = 'private';

            for (const url of [`${API_BASE}/stories/${newId}/v2`, `${API_BASE}/stories/${newId}`]) {
                try {
                    await apiFetch('PATCH', url, data, 'PATCH');
                    toast(`✓ "${draft.name}" 복원 완료!\n에디터로 이동합니다...`, 3000);
                    setTimeout(() => { location.href = `/my`; }, 1500);
                    return;
                } catch (err) {
                    if (err?.status === 404 || err?.status === 405 || err?.status === 400) continue;
                    throw err;
                }
            }

            toast('스토리 생성됨! /my에서 확인해주세요.', 4000);
            setTimeout(() => { location.href = '/my'; }, 1500);

        } catch (err) {
            console.error(`${LOG} 복원 실패`, err);
            toast('복원 실패 ㅠㅠ\n' + String(err?.message || err).slice(0, 200), 5000);
        }
    }

    // ─────── 목록 패널 ───────

    function openDraftPanel() {
        document.querySelectorAll('.ld-overlay').forEach(el => el.remove());
        const drafts = loadDrafts();

        const overlay = document.createElement('div');
        overlay.className = 'ld-overlay';
        overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

        const panel = document.createElement('div');
        panel.className = 'ld-panel';

        const title = document.createElement('h2');
        title.className = 'ld-panel-title';
        title.textContent = '📂 임시등록 목록';
        panel.appendChild(title);

        const sub = document.createElement('div');
        sub.className = 'ld-panel-sub';
        sub.textContent = `${drafts.length}개 저장됨`;
        panel.appendChild(sub);

        const list = document.createElement('div');
        list.className = 'ld-panel-list';

        if (!drafts.length) {
            const empty = document.createElement('div');
            empty.className = 'ld-panel-empty';
            empty.textContent = '저장된 임시등록이 없어요.\n에디터에서 💾 임시등록을 눌러보세요!';
            list.appendChild(empty);
        } else {
            for (const draft of drafts) {
                const card = document.createElement('div');
                card.className = 'ld-card';

                const info = document.createElement('div');
                info.className = 'ld-card-info';
                const nameEl = document.createElement('div');
                nameEl.className = 'ld-card-name';
                nameEl.textContent = draft.name;
                info.appendChild(nameEl);
                const dateEl = document.createElement('div');
                dateEl.className = 'ld-card-date';
                dateEl.textContent = formatDate(draft.date);
                info.appendChild(dateEl);
                card.appendChild(info);

                const btns = document.createElement('div');
                btns.className = 'ld-card-btns';

                const restBtn = document.createElement('button');
                restBtn.className = 'ld-card-btn restore';
                restBtn.textContent = '불러오기';
                restBtn.addEventListener('click', () => { overlay.remove(); loadFromDraft(draft); });
                btns.appendChild(restBtn);

                const delBtn = document.createElement('button');
                delBtn.className = 'ld-card-btn del';
                delBtn.textContent = '삭제';
                delBtn.addEventListener('click', () => {
                    if (confirm(`"${draft.name}" 삭제할까요?`)) {
                        removeDraft(draft.id);
                        overlay.remove();
                        openDraftPanel();
                        toast(`"${draft.name}" 삭제됨`, 2500);
                    }
                });
                btns.appendChild(delBtn);

                card.appendChild(btns);
                list.appendChild(card);
            }
        }

        panel.appendChild(list);

        const closeBtn = document.createElement('div');
        closeBtn.className = 'ld-panel-close';
        closeBtn.textContent = '닫기';
        closeBtn.addEventListener('click', () => overlay.remove());
        panel.appendChild(closeBtn);

        overlay.appendChild(panel);
        document.body.appendChild(overlay);
    }

    // ─────── 에디터 버튼 삽입 ───────

    const EDITOR_MARKER = 'ld-editor-injected';

    function injectEditorButtons() {
        // 임시저장 버튼이 있는 페이지 = 에디터
        const saveBtn = findSaveButton();
        if (!saveBtn) return;

        // 이미 삽입됐으면 스킵
        if (document.querySelector(`.${EDITOR_MARKER}`)) return;

        // 임시저장 버튼 옆에 우리 버튼 추가
        const parent = saveBtn.parentElement;
        if (!parent) return;

        const container = document.createElement('div');
        container.className = `ld-editor-btns ${EDITOR_MARKER}`;

        const localSaveBtn = document.createElement('button');
        localSaveBtn.className = 'ld-ebtn save';
        localSaveBtn.textContent = '💾 임시등록';
        localSaveBtn.title = '미등록 슬롯 안 씀! 확장프로그램 내부에 저장';
        localSaveBtn.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); doLocalSave(); });

        const loadBtn = document.createElement('button');
        loadBtn.className = 'ld-ebtn load';
        const count = loadDrafts().length;
        loadBtn.textContent = `📂 불러오기${count ? ` (${count})` : ''}`;
        loadBtn.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); openDraftPanel(); });

        container.appendChild(localSaveBtn);
        container.appendChild(loadBtn);

        // 임시저장 버튼 앞에 삽입
        parent.insertBefore(container, saveBtn);
    }

    // ─────── 초기화 ───────

    function init() {
        new MutationObserver(() => injectEditorButtons())
            .observe(document.body, { childList: true, subtree: true });
        console.log(`${LOG} 로드 완료 v2.1.0`);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();

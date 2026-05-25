// ==UserScript==
// @name         크랙 임시등록 (무제한)
// @namespace    https://crack.wrtn.ai
// @version      2.5.0
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
        if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return 0;
        const keys = Object.keys(obj);
        const storyKeys = ['name', 'customPrompt', 'storyDetails', 'startingSets',
            'situationImageVersion', 'chatType', 'description', 'promptTemplate',
            'chatExamples', 'tags', 'simpleDescription', 'detailDescription',
            'model', 'visibility', 'shortcutCommands', 'defaultCrackerModel',
            'chatModelId', 'genreId', 'portraitImageUrl', 'isCommentBlocked'];
        return storyKeys.filter(k => keys.includes(k)).length;
    }

    function extractFromReactFiber() {
        const roots = [
            document.getElementById('__next'),
            document.getElementById('root'),
            document.querySelector('[data-reactroot]'),
            document.body
        ].filter(Boolean);

        let bestMatch = null;
        let bestScore = 0;

        for (const root of roots) {
            const fiberKey = Object.keys(root).find(k =>
                k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance'));
            if (!fiberKey) continue;

            function checkCandidate(obj) {
                if (!obj || typeof obj !== 'object') return;
                const score = hasStoryKeys(obj);
                if (score > bestScore) {
                    bestScore = score;
                    bestMatch = obj;
                }
            }

            function walk(fiber, depth) {
                if (!fiber || depth > 100) return;

                // hooks 체인
                let hook = fiber.memoizedState;
                let hi = 0;
                while (hook && hi < 60) {
                    const val = hook.memoizedState;
                    if (val && typeof val === 'object') {
                        checkCandidate(val);
                        if (Array.isArray(val) && val[0]) checkCandidate(val[0]);
                        // 중첩 객체도 체크
                        if (!Array.isArray(val)) {
                            for (const v of Object.values(val)) {
                                if (v && typeof v === 'object' && !Array.isArray(v)) checkCandidate(v);
                            }
                        }
                    }
                    if (hook.queue?.lastRenderedState) checkCandidate(hook.queue.lastRenderedState);
                    hook = hook.next;
                    hi++;
                }

                // 클래스 컴포넌트
                if (fiber.stateNode?.state) checkCandidate(fiber.stateNode.state);

                // props
                if (fiber.memoizedProps) {
                    checkCandidate(fiber.memoizedProps);
                    for (const v of Object.values(fiber.memoizedProps)) {
                        if (v && typeof v === 'object' && !Array.isArray(v)) checkCandidate(v);
                    }
                }

                // Context
                if (fiber.memoizedProps?.value) checkCandidate(fiber.memoizedProps.value);
                if (fiber.pendingProps?.value) checkCandidate(fiber.pendingProps.value);

                walk(fiber.child, depth + 1);
                walk(fiber.sibling, depth + 1);
            }

            walk(root[fiberKey], 0);
        }

        if (bestMatch && bestScore >= 5) {
            console.log(`${LOG} React fiber 최적 매칭 (${bestScore}개 키)`, Object.keys(bestMatch));
            return bestMatch;
        }

        console.warn(`${LOG} React fiber 매칭 실패 (최고 ${bestScore}개 키)`);
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
        const keyCount = Object.keys(cleanData).length;
        toast(`✓ 임시등록 완료!\n"${entry.name}" 저장됨 (필드 ${keyCount}개 캡처)`, 3500);
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

    function sanitizeForPatch(raw) {
        // 서버가 까다롭게 체크하는 필드들을 정리
        const str = (v, maxLen) => {
            if (v === null || v === undefined) return '';
            const s = typeof v === 'string' ? v : String(v);
            return maxLen ? s.slice(0, maxLen) : s;
        };

        const VALID_MODELS = ['gpt4', 'gpt4o', 'gpt4o-mini', 'claude', 'superchat', 'superchat_2_0'];
        let model = str(raw?.model).toLowerCase();
        if (!VALID_MODELS.some(m => model.includes(m))) model = 'superchat_2_0';

        const VALID_CHAT_TYPES = ['rolePlaying', 'chatBot', 'storyGame'];
        let chatType = raw?.chatType;
        if (typeof chatType === 'object') chatType = chatType?._id || chatType?.id || chatType?.name;
        if (!VALID_CHAT_TYPES.includes(chatType)) chatType = 'rolePlaying';

        const payload = {
            name: str(raw?.name, 30) || '복원된 스토리',
            description: str(raw?.description, 500) || '복원된 스토리',
            simpleDescription: str(raw?.simpleDescription, 30) || '',
            detailDescription: str(raw?.detailDescription, 1000) || '',
            storyDetails: str(raw?.storyDetails) || '',
            customPrompt: str(raw?.customPrompt) || '',
            model,
            chatType,
            visibility: 'private',
            promptTemplate: str(raw?.promptTemplate) || 'custom',
            isCommentBlocked: !!raw?.isCommentBlocked,
            defaultCrackerModel: str(raw?.defaultCrackerModel) || 'superchat_2_0',
            tags: Array.isArray(raw?.tags) ? raw.tags : [],
            chatExamples: Array.isArray(raw?.chatExamples) ? raw.chatExamples : [],
            shortcutCommands: Array.isArray(raw?.shortcutCommands) ? raw.shortcutCommands : [],
            situationImageVersion: raw?.situationImageVersion || 'v2'
        };

        // startingSets 정리
        if (Array.isArray(raw?.startingSets) && raw.startingSets.length) {
            payload.startingSets = raw.startingSets.map(set => ({
                name: str(set?.name, 30) || '기본 설정',
                initialMessages: Array.isArray(set?.initialMessages) ? set.initialMessages : [],
                situationPrompt: str(set?.situationPrompt) || '',
                replySuggestions: Array.isArray(set?.replySuggestions) ? set.replySuggestions : [],
                situationImages: Array.isArray(set?.situationImages) ? set.situationImages : [],
                keywordBook: Array.isArray(set?.keywordBook) ? set.keywordBook : [],
                parameters: Array.isArray(set?.parameters) ? set.parameters : [],
                imageMatrix: set?.imageMatrix || {},
                ...(set?.baseSetId ? { baseSetId: set.baseSetId } : {}),
                ...(set?.playGuide ? { playGuide: str(set.playGuide) } : {})
            }));
        }

        // 선택 필드들 (있으면 넣고, 없으면 안 넣음)
        const genreId = raw?.genreId || raw?.genre?._id || raw?.genre?.id;
        if (genreId && typeof genreId === 'string') payload.genreId = genreId;

        const portrait = raw?.portraitImageUrl || raw?.portraitImage?.origin || raw?.profileImage?.origin;
        if (portrait && typeof portrait === 'string' && portrait.startsWith('http')) {
            payload.portraitImageUrl = portrait;
        }

        if (raw?.creatorRecommendedMaxOutput) {
            payload.creatorRecommendedMaxOutput = raw.creatorRecommendedMaxOutput;
        }

        return payload;
    }

    async function loadFromDraft(draft) {
        const data = draft.data;
        const name = draft.name;

        if (!confirm(`"${name}" 복원하면\n미등록 슬롯 1개를 사용해요.\n\n계속할까요?`)) {
            toast('취소됨', 2000);
            return;
        }

        try {
            const payload = sanitizeForPatch(data);
            console.log(`${LOG} 복원 데이터`, { keys: Object.keys(payload), name: payload.name });

            // POST로 스토리 생성 (sanitized 데이터 전체 전송)
            toast(`"${name}" 복원 중...`, 5000);

            let newId = null;
            const postUrls = [
                `${API_BASE}/stories`,
                `${API_BASE}/stories/v2`
            ];

            for (const url of postUrls) {
                try {
                    const res = await apiFetch('POST', url, payload, `POST ${url}`);
                    newId = res?.data?._id || res?.data?.id || res?._id;
                    if (newId) {
                        console.log(`${LOG} POST 생성 성공`, { url, newId });
                        break;
                    }
                } catch (err) {
                    console.warn(`${LOG} POST 시도 ${url}:`, err?.status, err?.message?.slice(0, 100));
                    // 404/405 = 이 URL 아님 → 다음
                    if (err?.status === 404 || err?.status === 405) continue;
                    // 400 = 필드 문제 → 최소 필드로 재시도
                    if (err?.status === 400) continue;
                    throw err;
                }
            }

            // POST 실패 시 최소 필드로 재시도 + PATCH
            if (!newId) {
                console.log(`${LOG} 전체 데이터 POST 실패, 최소 필드로 재시도`);
                for (const url of postUrls) {
                    try {
                        const res = await apiFetch('POST', url, {
                            name: payload.name,
                            chatType: 'rolePlaying'
                        }, `POST 최소 ${url}`);
                        newId = res?.data?._id || res?.data?.id;
                        if (newId) break;
                    } catch (err) {
                        if (err?.status === 404 || err?.status === 405) continue;
                        if (err?.status === 400) continue;
                        throw err;
                    }
                }
            }

            if (!newId) throw new Error('스토리 생성 실패. 미등록 슬롯이 꽉 찼을 수 있어요.');

            // PATCH로 데이터 채우기
            toast('데이터 채우는 중...', 5000);

            // 새 스토리의 snapshotId, baseSetId 가져오기
            try {
                const newDetail = await apiFetch('GET', `${API_BASE}/stories/me/${newId}`, undefined, '조회');
                const nr = newDetail?.data;
                if (nr?.snapshotId) payload.expectedBaseSnapshotId = nr.snapshotId;
                if (nr?.startingSets?.length && payload.startingSets?.length) {
                    payload.startingSets.forEach((set, i) => {
                        if (nr.startingSets[i]) {
                            set.baseSetId = nr.startingSets[i].baseSetId || nr.startingSets[i]._id;
                        }
                    });
                }
            } catch (_) {}

            let patched = false;
            for (const url of [`${API_BASE}/stories/${newId}/v2`, `${API_BASE}/stories/${newId}`]) {
                try {
                    await apiFetch('PATCH', url, payload, `PATCH ${url}`);
                    patched = true;
                    break;
                } catch (err) {
                    console.warn(`${LOG} PATCH 시도 ${url}:`, err?.status, err?.message?.slice(0, 100));
                    if (err?.status === 404 || err?.status === 405) continue;
                    if (err?.status === 400) continue;
                }
            }

            toast(`✓ "${name}" 복원 완료!\n/my에서 확인해주세요.${patched ? '' : '\n(기본 데이터만 저장됨)'}`, 4000);
            setTimeout(() => { location.href = '/my'; }, 1500);

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
        console.log(`${LOG} 로드 완료 v2.5.0`);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();

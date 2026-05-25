// ==UserScript==
// @name         크랙 임시등록 (무제한)
// @namespace    https://crack.wrtn.ai
// @version      3.0.2
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

    // ─────── 임시등록 팝업 (수동 입력) ───────

    function openSavePopup() {
        document.querySelectorAll('.ld-overlay').forEach(el => el.remove());

        const overlay = document.createElement('div');
        overlay.className = 'ld-overlay';
        overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

        const panel = document.createElement('div');
        panel.className = 'ld-panel';
        panel.style.maxWidth = '550px';

        panel.innerHTML = `
            <h2 class="ld-panel-title">💾 임시등록</h2>
            <div class="ld-panel-sub">에디터에서 복사 → 여기 붙여넣기! (미등록 슬롯 안 씀)</div>
            <div style="display:flex;flex-direction:column;gap:10px;max-height:55vh;overflow-y:auto;padding:2px">
                <label style="font-size:13px;font-weight:600">스토리 이름 *</label>
                <input id="ld-name" style="padding:8px 12px;border:1px solid #ccc;border-radius:8px;font-size:14px" placeholder="에디터에서 이름 복사">

                <label style="font-size:13px;font-weight:600">한줄 소개</label>
                <input id="ld-simple" style="padding:8px 12px;border:1px solid #ccc;border-radius:8px;font-size:14px" placeholder="짧은 소개 (30자 이하)">

                <label style="font-size:13px;font-weight:600">스토리 설정 및 정보</label>
                <textarea id="ld-details" rows="4" style="padding:8px 12px;border:1px solid #ccc;border-radius:8px;font-size:13px;resize:vertical" placeholder="세계관, 설정, 등장인물 등"></textarea>

                <label style="font-size:13px;font-weight:600">커스텀 프롬프트</label>
                <textarea id="ld-prompt" rows="6" style="padding:8px 12px;border:1px solid #ccc;border-radius:8px;font-size:13px;resize:vertical" placeholder="프롬프트 내용"></textarea>

                <label style="font-size:13px;font-weight:600">첫 메시지 (시작 설정)</label>
                <textarea id="ld-init" rows="3" style="padding:8px 12px;border:1px solid #ccc;border-radius:8px;font-size:13px;resize:vertical" placeholder="첫 번째 메시지"></textarea>

                <label style="font-size:13px;font-weight:600">메모 (자유 메모)</label>
                <textarea id="ld-memo" rows="2" style="padding:8px 12px;border:1px solid #ccc;border-radius:8px;font-size:13px;resize:vertical" placeholder="나중에 기억할 것들"></textarea>
            </div>
            <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px">
                <button id="ld-cancel" class="ld-card-btn del" style="padding:10px 20px">취소</button>
                <button id="ld-save" class="ld-card-btn restore" style="padding:10px 20px">💾 저장</button>
            </div>
        `;

        overlay.appendChild(panel);
        document.body.appendChild(overlay);

        panel.querySelector('#ld-cancel').addEventListener('click', () => overlay.remove());
        panel.querySelector('#ld-save').addEventListener('click', () => {
            const name = panel.querySelector('#ld-name').value.trim();
            if (!name) { toast('이름을 입력해주세요!', 2500); return; }

            const entry = {
                id: `draft_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                name,
                date: new Date().toISOString(),
                data: {
                    name,
                    simpleDescription: panel.querySelector('#ld-simple').value.trim(),
                    storyDetails: panel.querySelector('#ld-details').value.trim(),
                    customPrompt: panel.querySelector('#ld-prompt').value.trim(),
                    initialMessage: panel.querySelector('#ld-init').value.trim(),
                    memo: panel.querySelector('#ld-memo').value.trim()
                }
            };

            addDraft(entry);
            overlay.remove();
            toast(`✓ 임시등록 완료!\n"${name}" 저장됨 (${loadDrafts().length}개)`, 3500);
            updateFabCount();
        });
    }

    // ─────── 불러오기 (복원) ───────

    function formatDate(iso) {
        try {
            const d = new Date(iso);
            const pad = n => String(n).padStart(2, '0');
            return `${d.getFullYear()}.${pad(d.getMonth()+1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
        } catch (_) { return iso; }
    }

    function updateFabCount() {
        const fab = document.getElementById('dbm-fab');
        if (fab) {
            const count = loadDrafts().length;
            fab.textContent = `📂 임시등록 목록${count ? ` (${count})` : ''}`;
        }
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
        } else if (raw?.initialMessage) {
            // 팝업에서 입력한 첫 메시지 → startingSets로 변환
            payload.startingSets = [{
                name: '기본 설정',
                initialMessages: [{ role: 'assistant', content: str(raw.initialMessage) }],
                situationPrompt: '',
                replySuggestions: [],
                situationImages: [],
                keywordBook: [],
                parameters: [],
                imageMatrix: {}
            }];
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

    // ─────── 에디터 감지 ───────

    function findSaveButton() {
        // 모든 버튼/클릭 요소에서 "임시" 포함된 것 찾기
        const allBtns = document.querySelectorAll('button, [role="button"], a');
        for (const btn of allBtns) {
            const text = (btn.textContent || '').trim();
            if (text.includes('임시저장') || text.includes('임시 저장')) return btn;
        }
        // aria-label로도 찾기
        const ariaBtn = document.querySelector('[aria-label*="임시"]');
        if (ariaBtn) return ariaBtn;
        return null;
    }

    function findEditorHeader() {
        // 임시저장 버튼이 없어도 에디터 헤더 영역 찾기
        // "스토리 만들기" 또는 "등록하기" 텍스트가 있는 영역
        const allBtns = document.querySelectorAll('button, [role="button"]');
        for (const btn of allBtns) {
            const text = (btn.textContent || '').trim();
            if (text === '등록하기' || text === '등록') return btn.parentElement;
        }
        // 시계 아이콘 (임시저장 옆에 있는)
        const clockBtn = document.querySelector('button svg[class*="clock"], button [class*="clock"]');
        if (clockBtn) return clockBtn.closest('button')?.parentElement;
        return null;
    }

    // ─────── 에디터 버튼 삽입 ───────

    const EDITOR_MARKER = 'ld-editor-injected';

    function injectEditorButtons() {
        // 이미 삽입됐으면 스킵
        if (document.querySelector(`.${EDITOR_MARKER}`)) return;

        // 임시저장 버튼 또는 에디터 헤더 찾기
        const saveBtn = findSaveButton();
        const headerArea = saveBtn?.parentElement || findEditorHeader();

        if (!headerArea) return;

        const container = document.createElement('div');
        container.className = `ld-editor-btns ${EDITOR_MARKER}`;

        const localSaveBtn = document.createElement('button');
        localSaveBtn.className = 'ld-ebtn save';
        localSaveBtn.textContent = '💾 임시등록';
        localSaveBtn.title = '미등록 슬롯 안 씀! 확장프로그램 내부에 저장';
        localSaveBtn.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); openSavePopup(); });

        const loadBtn = document.createElement('button');
        loadBtn.className = 'ld-ebtn load';
        const count = loadDrafts().length;
        loadBtn.textContent = `📂 불러오기${count ? ` (${count})` : ''}`;
        loadBtn.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); openDraftPanel(); });

        container.appendChild(localSaveBtn);
        container.appendChild(loadBtn);

        // 삽입 위치: 임시저장 앞 또는 헤더 끝
        if (saveBtn) {
            headerArea.insertBefore(container, saveBtn);
        } else {
            headerArea.appendChild(container);
        }

        console.log(`${LOG} 에디터 버튼 삽입 완료`);
    }

    // ─────── 초기화 ───────

    function init() {
        new MutationObserver(() => injectEditorButtons())
            .observe(document.body, { childList: true, subtree: true });
        console.log(`${LOG} 로드 완료 v3.0.2`);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();

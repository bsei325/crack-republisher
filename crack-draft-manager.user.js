// ==UserScript==
// @name         크랙 미등록 백업/복원
// @namespace    https://crack.wrtn.ai
// @version      1.0.0
// @author       me
// @description  미등록 스토리를 JSON으로 백업하고, 나중에 복원. 사실상 무한 임시저장!
// @match        https://crack.wrtn.ai/*
// @grant        GM_addStyle
// ==/UserScript==

(function () {
    'use strict';

    const API_BASE = 'https://crack-api.wrtn.ai/crack-api';
    const LOG = '[백업/복원]';

    GM_addStyle(`
        .dbm-toast {
            position: fixed;
            top: 24px;
            left: 50%;
            transform: translateX(-50%) translateY(-120%);
            background: #1a1a1a;
            color: #fff;
            padding: 14px 28px;
            border-radius: 12px;
            font-size: 14px;
            font-weight: 600;
            line-height: 1.5;
            text-align: center;
            white-space: pre-line;
            z-index: 99999;
            box-shadow: 0 8px 32px rgba(0,0,0,0.4);
            transition: transform 0.35s cubic-bezier(0.16, 1, 0.3, 1);
            pointer-events: none;
        }
        .dbm-toast.show {
            transform: translateX(-50%) translateY(0);
        }
        .dbm-btn {
            font-size: 14px;
            font-weight: 500;
            color: hsl(var(--popover-foreground));
            padding: 8px 14px;
            cursor: pointer;
            user-select: none;
            transition: background 0.2s;
        }
        .dbm-btn:hover {
            background: hsl(var(--accent));
        }
        .dbm-divider {
            height: 1px;
            background: hsl(var(--border));
            margin: 4px 0;
        }
        .dbm-label {
            font-size: 12px;
            font-weight: 600;
            color: hsl(var(--muted-foreground));
            padding: 6px 14px 2px;
            user-select: none;
        }
        .dbm-restore-btn {
            position: fixed;
            bottom: 24px;
            right: 24px;
            background: #1a1a1a;
            color: #fff;
            border: none;
            padding: 12px 20px;
            border-radius: 12px;
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
            z-index: 9999;
            box-shadow: 0 4px 16px rgba(0,0,0,0.3);
            transition: transform 0.2s, background 0.2s;
        }
        .dbm-restore-btn:hover {
            background: #333;
            transform: translateY(-2px);
        }
    `);

    function toast(msg, duration = 3600) {
        document.querySelectorAll('.dbm-toast').forEach(el => el.remove());
        const el = document.createElement('div');
        el.className = 'dbm-toast';
        el.textContent = msg;
        document.body.appendChild(el);
        requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('show')));
        setTimeout(() => {
            el.classList.remove('show');
            setTimeout(() => el.remove(), 400);
        }, duration);
    }

    function getToken() {
        const m = document.cookie.match(/(?:^|; )access_token=([^;]*)/);
        return m ? decodeURIComponent(m[1]) : null;
    }

    async function apiFetch(method, url, body, label = '') {
        const token = getToken();
        if (!token) throw new Error('로그인 상태를 확인해주세요.');

        const opts = {
            method,
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        };
        if (body !== undefined) opts.body = JSON.stringify(body);

        const res = await fetch(url, opts);
        const text = await res.text();

        let json = null;
        try { json = text ? JSON.parse(text) : null; }
        catch (_) { json = { rawText: text }; }

        if (!res.ok) {
            console.error(`${LOG} API 에러 ${label}`, { status: res.status, url, response: json });
            const msg = json?.message || json?.rawText || `HTTP ${res.status}`;
            const err = new Error(msg);
            err.status = res.status;
            err.response = json;
            throw err;
        }
        return json;
    }

    // ─────────── 백업 ───────────

    function downloadJSON(data, filename) {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
            URL.revokeObjectURL(url);
            a.remove();
        }, 100);
    }

    async function backupStory(storyId, andDelete = false) {
        toast('스토리 데이터 가져오는 중...');
        try {
            const detail = await apiFetch('GET', `${API_BASE}/stories/me/${storyId}`, undefined, '백업 조회');
            const raw = detail?.data;
            if (!raw) throw new Error('스토리 데이터를 못 가져왔어요.');

            const storyName = (raw.name || '스토리').replace(/[\\/:*?"<>|]/g, '_').slice(0, 30);
            const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
            const filename = `crack-backup-${storyName}-${dateStr}.json`;

            // 백업 데이터에 메타 정보 추가
            const backupData = {
                _backupMeta: {
                    version: '1.0.0',
                    backupDate: new Date().toISOString(),
                    originalStoryId: storyId,
                    storyName: raw.name || '스토리'
                },
                storyData: raw
            };

            downloadJSON(backupData, filename);
            console.log(`${LOG} 백업 완료`, { storyId, filename, storyName });

            if (andDelete) {
                toast('백업 완료! 크랙에서 삭제 중...');
                await new Promise(r => setTimeout(r, 500));

                try {
                    await apiFetch('DELETE', `${API_BASE}/stories/${storyId}`, undefined, '백업 후 삭제');
                    toast(`✓ 백업 + 삭제 완료!\n"${storyName}" → ${filename}\n미등록 슬롯 1개 확보!`, 5000);
                    // 페이지 새로고침해서 목록 반영
                    setTimeout(() => location.reload(), 2000);
                } catch (delErr) {
                    console.error(`${LOG} 삭제 실패`, delErr);
                    toast(`백업은 됐지만 삭제 실패 ㅠ\n${delErr?.message}\n수동으로 삭제해주세요.`, 6000);
                }
            } else {
                toast(`✓ 백업 완료!\n"${storyName}" → ${filename}`, 4000);
            }
        } catch (err) {
            console.error(`${LOG} 백업 실패`, err);
            toast('백업 실패 ㅠㅠ\n' + String(err?.message || err).slice(0, 200), 6000);
        }
    }

    // ─────────── 복원 ───────────

    function pickFile() {
        return new Promise((resolve) => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.json';
            input.onchange = (e) => {
                const file = e.target.files?.[0];
                resolve(file || null);
            };
            // 취소 시
            input.addEventListener('cancel', () => resolve(null));
            input.click();
        });
    }

    function getFirst(...values) {
        for (const v of values) {
            if (v !== undefined && v !== null && v !== '') return v;
        }
        return undefined;
    }

    function normalizeSimpleValue(value) {
        if (!value) return undefined;
        if (typeof value === 'string') return value;
        return value._id || value.id || value.type || value.name;
    }

    function getPortraitUrl(raw) {
        return getFirst(
            raw?.portraitImageUrl,
            raw?.portraitImage?.origin,
            raw?.profileImage?.origin
        );
    }

    function normalizeModelForPatch(model) {
        if (!model) return undefined;
        const s = String(model);
        return s === s.toUpperCase() ? s.toLowerCase() : s;
    }

    function normalizeTemplateForPatch(pt) {
        if (!pt) return 'custom';
        if (typeof pt === 'string') return pt;
        return pt.template || pt.name || 'custom';
    }

    function buildRestorePayload(raw) {
        // 스토리 생성 후 PATCH에 쓸 페이로드
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
            model: normalizeModelForPatch(raw?.model),
            storyDetails: raw?.storyDetails || '',
            chatExamples: Array.isArray(raw?.chatExamples) ? raw.chatExamples : [],
            tags: Array.isArray(raw?.tags) ? raw.tags : [],
            visibility: 'private',
            target: normalizeSimpleValue(raw?.target) || raw?.target,
            promptTemplate: normalizeTemplateForPatch(raw?.promptTemplate),
            isCommentBlocked: !!raw?.isCommentBlocked,
            startingSets,
            shortcutCommands: Array.isArray(raw?.shortcutCommands) ? raw.shortcutCommands : [],
            defaultCrackerModel: raw?.defaultCrackerModel || 'superchat_2_0',
            chatType: normalizeSimpleValue(raw?.chatType) || raw?.chatType || 'rolePlaying',
            detailDescription: raw?.detailDescription || '',
            chatModelId: raw?.chatModelId,
            situationImageVersion: raw?.situationImageVersion || 'v2',
            customPrompt: raw?.customPrompt || '',
            creatorRecommendedMaxOutput: raw?.creatorRecommendedMaxOutput
        };

        // genreId
        const genreId = getFirst(raw?.genreId, raw?.genre?._id, raw?.genre?.id);
        if (genreId) payload.genreId = genreId;

        // 초상화
        const portrait = getPortraitUrl(raw);
        if (portrait) payload.portraitImageUrl = portrait;

        if (raw?.isMovingPortraitImage || raw?.profileImage?.gif) {
            payload.isMovingPortraitImage = true;
        }

        return payload;
    }

    async function restoreStory() {
        toast('백업 파일을 선택해주세요...', 5000);

        const file = await pickFile();
        if (!file) {
            toast('취소됨', 2000);
            return;
        }

        try {
            toast('백업 파일 읽는 중...');
            const text = await file.text();
            let parsed;
            try {
                parsed = JSON.parse(text);
            } catch (_) {
                throw new Error('유효한 JSON 파일이 아니에요.');
            }

            // 백업 형식 확인
            const raw = parsed?.storyData || parsed?.data || parsed;
            const meta = parsed?._backupMeta;
            const storyName = meta?.storyName || raw?.name || '복원된 스토리';

            if (!raw?.name && !raw?.customPrompt && !raw?.startingSets) {
                throw new Error('크랙 스토리 백업 파일이 아닌 것 같아요.');
            }

            console.log(`${LOG} 복원 시작`, {
                storyName,
                backupDate: meta?.backupDate,
                originalId: meta?.originalStoryId,
                hasSets: !!raw?.startingSets?.length
            });

            // 1단계: 빈 스토리 생성
            toast(`"${storyName}" 복원 중...\n1/2 스토리 생성`, 5000);

            const createPayload = {
                name: raw?.name || '복원된 스토리',
                description: raw?.description || '백업에서 복원된 스토리',
                chatType: normalizeSimpleValue(raw?.chatType) || 'rolePlaying'
            };

            let createRes;
            // 생성 엔드포인트 시도
            const createEndpoints = [
                `${API_BASE}/stories`,
                `${API_BASE}/stories/v2`
            ];

            for (const url of createEndpoints) {
                try {
                    createRes = await apiFetch('POST', url, createPayload, `스토리 생성 ${url}`);
                    if (createRes?.data?._id || createRes?.data?.id || createRes?._id) {
                        console.log(`${LOG} 생성 성공`, { url, res: createRes });
                        break;
                    }
                } catch (err) {
                    console.log(`${LOG} 생성 시도 ${url}`, err?.status, err?.message);
                    if (err?.status !== 404 && err?.status !== 405) {
                        throw err; // 404/405가 아니면 실제 에러
                    }
                }
            }

            const newStoryId = createRes?.data?._id || createRes?.data?.id || createRes?._id;
            if (!newStoryId) {
                console.error(`${LOG} 생성 응답`, createRes);
                throw new Error('스토리 생성에 실패했어요. 미등록 5개 제한일 수 있어요.');
            }

            console.log(`${LOG} 새 스토리 ID: ${newStoryId}`);

            // 2단계: 백업 데이터로 PATCH
            toast(`"${storyName}" 복원 중...\n2/2 데이터 채우기`, 5000);

            const patchPayload = buildRestorePayload(raw);

            // 새 스토리의 snapshotId 필요할 수 있음
            try {
                const newDetail = await apiFetch('GET', `${API_BASE}/stories/me/${newStoryId}`, undefined, '새 스토리 조회');
                const newRaw = newDetail?.data;
                if (newRaw?.snapshotId) {
                    patchPayload.expectedBaseSnapshotId = newRaw.snapshotId;
                }
                // 새 스토리의 startingSets에 baseSetId가 있으면 사용
                if (newRaw?.startingSets?.length && patchPayload.startingSets?.length) {
                    patchPayload.startingSets.forEach((set, i) => {
                        if (newRaw.startingSets[i]) {
                            set.baseSetId = newRaw.startingSets[i].baseSetId ||
                                            newRaw.startingSets[i]._id ||
                                            newRaw.startingSets[i].id;
                        }
                    });
                }
            } catch (e) {
                console.warn(`${LOG} 새 스토리 조회 실패, 그냥 PATCH 시도`, e);
            }

            console.log(`${LOG} PATCH payload`, {
                newStoryId,
                name: patchPayload.name,
                setsCount: patchPayload.startingSets?.length,
                payloadSizeKB: Math.round(JSON.stringify(patchPayload).length / 1024)
            });

            // PATCH 시도 (v2 먼저, 실패하면 일반)
            let patched = false;
            for (const patchUrl of [
                `${API_BASE}/stories/${newStoryId}/v2`,
                `${API_BASE}/stories/${newStoryId}`
            ]) {
                try {
                    await apiFetch('PATCH', patchUrl, patchPayload, `복원 PATCH ${patchUrl}`);
                    patched = true;
                    console.log(`${LOG} PATCH 성공`, { url: patchUrl });
                    break;
                } catch (err) {
                    console.warn(`${LOG} PATCH 시도 ${patchUrl}`, err?.status, err?.message);
                    if (err?.status === 404 || err?.status === 405) continue;
                    // 400이면 페이로드 문제일 수 있으니 다음 URL 시도
                    if (err?.status === 400) continue;
                    throw err;
                }
            }

            if (patched) {
                toast(`✓ 복원 완료!\n"${storyName}"을(를) 미등록에 복원했어요.`, 5000);
                setTimeout(() => location.reload(), 2000);
            } else {
                toast(`스토리는 생성됐지만 데이터 채우기에 실패했어요.\n수동으로 편집해주세요.`, 6000);
            }

        } catch (err) {
            console.error(`${LOG} 복원 실패`, err);
            const msg = String(err?.message || err).slice(0, 200);
            const hint = msg.includes('5') || msg.includes('제한') || msg.includes('limit')
                ? '\n\n💡 미등록 슬롯을 먼저 비워주세요!' : '';
            toast('복원 실패 ㅠㅠ\n' + msg + hint, 8000);
        }
    }

    // ─────────── UI / 메뉴 삽입 ───────────

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
                    return {
                        id: ch.props.content.sourceId,
                        type: ch.props.content.type || 'story',
                        name: ch.props.content.name || ''
                    };
                }
            }
        } catch (e) {
            console.warn(`${LOG} story id 추출 실패`, e);
        }
        return null;
    }

    function createButton(label, onClick) {
        const btn = document.createElement('div');
        btn.className = 'dbm-btn';
        btn.textContent = label;
        btn.addEventListener('click', e => {
            e.preventDefault();
            e.stopPropagation();
            onClick();
        });
        return btn;
    }

    const MARKER = 'dbm-injected';

    function injectMenu() {
        if (!/^\/my(\/.*)?$/.test(location.pathname)) return;

        const popper = document.querySelector('div[data-radix-popper-content-wrapper]');
        if (!popper) return;

        const container = popper.querySelector('[role="menu"], [data-radix-menu-content]')
            || popper.childNodes[0]?.childNodes[0];

        if (!container || container.hasAttribute(MARKER)) return;
        container.setAttribute(MARKER, 'true');

        const info = getStoryInfoFromMenu();
        if (!info) return;

        const divider = document.createElement('div');
        divider.className = 'dbm-divider';
        container.appendChild(divider);

        const label = document.createElement('div');
        label.className = 'dbm-label';
        label.textContent = '백업 / 복원';
        container.appendChild(label);

        container.appendChild(createButton('📦 백업 (JSON 다운로드)', () => backupStory(info.id, false)));
        container.appendChild(createButton('📦 백업 후 삭제 (슬롯 확보)', () => backupStory(info.id, true)));
    }

    // ─────────── 복원 버튼 (플로팅) ───────────

    const RESTORE_BTN_ID = 'dbm-restore-floating';

    function injectRestoreButton() {
        if (!/^\/my(\/.*)?$/.test(location.pathname)) {
            const existing = document.getElementById(RESTORE_BTN_ID);
            if (existing) existing.remove();
            return;
        }

        if (document.getElementById(RESTORE_BTN_ID)) return;

        const btn = document.createElement('button');
        btn.id = RESTORE_BTN_ID;
        btn.className = 'dbm-restore-btn';
        btn.textContent = '📦 백업에서 복원';
        btn.addEventListener('click', () => restoreStory());
        document.body.appendChild(btn);
    }

    // ─────────── 초기화 ───────────

    function init() {
        new MutationObserver(() => {
            injectMenu();
            injectRestoreButton();
        }).observe(document.body, {
            childList: true,
            subtree: true
        });
        injectRestoreButton();
        console.log(`${LOG} 로드 완료 v1.0.0`);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();

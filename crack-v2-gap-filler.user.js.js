// ==UserScript==
// @name         크랙 v2 빈칸 투명 채우기
// @namespace    https://crack.wrtn.ai
// @version      1.0.0
// @author       me
// @description  재게시 없이 기존 v2 이미지 배치표의 빈 조합을 얇은 투명 이미지로 채움
// @match        https://crack.wrtn.ai/*
// @grant        GM_addStyle
// @updateURL    https://raw.githubusercontent.com/bsei325/crack-republisher/main/crack-v2-gap-filler.user.js
// @downloadURL  https://raw.githubusercontent.com/bsei325/crack-republisher/main/crack-v2-gap-filler.user.js
// ==/UserScript==

(function () {
    'use strict';

    const API_BASE = 'https://crack-api.wrtn.ai/crack-api';
    const LOG = '[v2 빈칸 채우기]';

    // 1x1은 화면에서 큰 정사각형 빈칸처럼 보일 수 있어서, 아주 얇고 긴 투명 PNG를 사용한다.
    // 이 파일을 GitHub 저장소 루트에 같이 올려야 한다.
    const TRANSPARENT_STRIP_IMAGE_URL =
        'https://raw.githubusercontent.com/bsei325/crack-republisher/main/transparent-strip-2000x4.png';

    GM_addStyle(`
        .vgf-toast {
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
        .vgf-toast.show {
            transform: translateX(-50%) translateY(0);
        }
        .vgf-btn {
            font-size: 14px;
            font-weight: 500;
            color: hsl(var(--popover-foreground));
            padding: 8px 14px;
            cursor: pointer;
            user-select: none;
            transition: background 0.2s;
        }
        .vgf-btn:hover {
            background: hsl(var(--accent));
        }
        .vgf-divider {
            height: 1px;
            background: hsl(var(--border));
            margin: 4px 0;
        }
        .vgf-label {
            font-size: 12px;
            font-weight: 600;
            color: hsl(var(--muted-foreground));
            padding: 6px 14px 2px;
            user-select: none;
        }
    `);

    function toast(msg, duration = 3600) {
        document.querySelectorAll('.vgf-toast').forEach(el => el.remove());
        const el = document.createElement('div');
        el.className = 'vgf-toast';
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
        if (!token) throw new Error('access_token을 못 찾았어요. 로그인 상태를 확인해줘.');

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
            console.error(`${LOG} API 에러 ${label}`, {
                status: res.status,
                url,
                response: json,
                requestPayload: body
            });
            const msg = json?.message || json?.rawText || `HTTP ${res.status}`;
            const err = new Error(msg);
            err.status = res.status;
            err.response = json;
            err.payload = body;
            throw err;
        }
        return json;
    }

    function compactObject(obj) {
        const out = {};
        for (const [k, v] of Object.entries(obj || {})) {
            if (v === undefined) continue;
            out[k] = v;
        }
        return out;
    }

    function getFirst(...values) {
        for (const v of values) {
            if (v !== undefined && v !== null && v !== '') return v;
        }
        return undefined;
    }

    function isBadObjectString(s) {
        return !s || s === '[object Object]' || s === 'object Object';
    }

    function primitiveString(v) {
        if (v === undefined || v === null) return '';
        if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
            const s = String(v).trim();
            return isBadObjectString(s) ? '' : s;
        }
        return '';
    }

    function extractDeepPrimitive(value, preferredKeys = [], depth = 0) {
        if (depth > 4 || value === undefined || value === null) return '';

        const direct = primitiveString(value);
        if (direct) return direct;

        if (Array.isArray(value)) {
            for (const item of value) {
                const got = extractDeepPrimitive(item, preferredKeys, depth + 1);
                if (got) return got;
            }
            return '';
        }

        if (typeof value === 'object') {
            const keys = [
                ...preferredKeys,
                'name',
                'keyword',
                'title',
                'label',
                'value',
                'text',
                'displayName',
                'displayText',
                'situation',
                'category',
                'situationName',
                'categoryName',
                'situationKeyword',
                'categoryKeyword',
                'imageKeyword',
                'key'
            ];

            for (const key of keys) {
                if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
                const got = extractDeepPrimitive(value[key], preferredKeys, depth + 1);
                if (got) return got;
            }

            for (const v of Object.values(value)) {
                const got = extractDeepPrimitive(v, preferredKeys, depth + 1);
                if (got) return got;
            }
        }

        return '';
    }

    function extractV2Label(value, fallback = '기본', preferredKeys = []) {
        const got = extractDeepPrimitive(value, preferredKeys, 0);
        return got || fallback;
    }

    function trimUniqueLabel(label, fallback, used) {
        let s = extractV2Label(label, fallback).trim();
        if (isBadObjectString(s)) s = fallback || '기본';

        let base = s.slice(0, 10);
        if (!base) base = (fallback || '기본').slice(0, 10);

        if (!used.has(base)) {
            used.add(base);
            return base;
        }

        for (let n = 2; n < 1000; n++) {
            const suffix = String(n);
            const candidate = `${base.slice(0, Math.max(1, 10 - suffix.length))}${suffix}`;
            if (!used.has(candidate)) {
                used.add(candidate);
                return candidate;
            }
        }
        return base;
    }

    function trimKeyword(value, fallback = '') {
        const s = extractV2Label(value, fallback, ['keyword', 'name']).trim();
        if (!s || isBadObjectString(s)) return fallback ? String(fallback).slice(0, 10) : '';
        return s.slice(0, 10);
    }

    function normalizeV2SetLabels(set) {
        const imgs = Array.isArray(set?.situationImages) ? set.situationImages : [];
        const matrix = set?.imageMatrix || {};

        const rawCategories = Array.isArray(matrix.categories) && matrix.categories.length
            ? matrix.categories.map((v, i) => extractV2Label(v, `분류${i + 1}`, ['name', 'category', 'label', 'keyword']))
            : imgs.map((img, i) => extractV2Label(img?.category, `분류${i + 1}`, ['name', 'category', 'label', 'keyword']));

        const rawSituations = Array.isArray(matrix.situations) && matrix.situations.length
            ? matrix.situations.map((v, i) => extractV2Label(v, `상황${i + 1}`, ['keyword', 'name', 'situation', 'label']))
            : imgs.map((img, i) => extractV2Label(img?.situation, `상황${i + 1}`, ['keyword', 'name', 'situation', 'label']));

        const catUsed = new Set();
        const sitUsed = new Set();
        const catMap = new Map();
        const sitMap = new Map();

        function getCat(raw, idx) {
            const key = extractV2Label(raw, `분류${idx + 1}`, ['name', 'category', 'label', 'keyword']);
            if (!catMap.has(key)) catMap.set(key, trimUniqueLabel(key, `분류${catMap.size + 1}`, catUsed));
            return catMap.get(key);
        }

        function getSit(raw, idx) {
            const key = extractV2Label(raw, `상황${idx + 1}`, ['keyword', 'name', 'situation', 'label']);
            if (!sitMap.has(key)) sitMap.set(key, trimUniqueLabel(key, `상황${sitMap.size + 1}`, sitUsed));
            return sitMap.get(key);
        }

        rawCategories.forEach((c, i) => getCat(c, i));
        rawSituations.forEach((s, i) => getSit(s, i));

        if (catMap.size === 0) catMap.set('기본', trimUniqueLabel('기본', '기본', catUsed));
        if (sitMap.size === 0) sitMap.set('기본', trimUniqueLabel('기본', '기본', sitUsed));

        const defaultCategory = Array.from(catMap.values())[0] || '기본';
        const defaultSituation = Array.from(sitMap.values())[0] || '기본';

        const situationImages = imgs
            .filter(img => img?.imageUrl)
            .map((img, idx) => {
                const rawCat = extractV2Label(img?.category, '', ['name', 'category', 'label', 'keyword']);
                const rawSit = extractV2Label(img?.situation, '', ['keyword', 'name', 'situation', 'label']);

                return compactObject({
                    situation: rawSit ? getSit(rawSit, idx) : defaultSituation,
                    keyword: trimKeyword(img?.keyword, ''),
                    imageUrl: img.imageUrl,
                    category: rawCat ? getCat(rawCat, idx) : defaultCategory
                });
            });

        const categories = Array.from(catMap.values()).filter(Boolean).map(v => String(v).slice(0, 10));
        const situations = Array.from(sitMap.values()).filter(Boolean).map(v => String(v).slice(0, 10));

        return {
            imageMatrix: {
                categories: categories.length ? categories : ['기본'],
                situations: situations.length ? situations : ['기본']
            },
            situationImages
        };
    }

    function fillMissingCellsWithTransparent(set) {
        const normalized = normalizeV2SetLabels(set);

        const categories = normalized.imageMatrix.categories;
        const situations = normalized.imageMatrix.situations;
        const images = [...normalized.situationImages];

        const existing = new Set();
        for (const img of images) {
            const cat = img?.category ? String(img.category).slice(0, 10) : '';
            const sit = img?.situation ? String(img.situation).slice(0, 10) : '';
            if (cat && sit) existing.add(`${cat}|||${sit}`);
        }

        let added = 0;
        for (const category of categories) {
            for (const situation of situations) {
                const key = `${category}|||${situation}`;
                if (existing.has(key)) continue;

                images.push({
                    situation,
                    keyword: '',
                    imageUrl: TRANSPARENT_STRIP_IMAGE_URL,
                    category
                });
                existing.add(key);
                added++;
            }
        }

        return {
            imageMatrix: normalized.imageMatrix,
            situationImages: images,
            added
        };
    }

    function buildKeywordBook(kb) {
        if (!Array.isArray(kb)) return [];
        return kb.map(item => ({
            name: item?.name || '',
            keywords: Array.isArray(item?.keywords) ? item.keywords : [],
            prompt: item?.prompt || ''
        }));
    }

    function buildParam(p) {
        const r = {
            name: p?.name,
            colorHexCode: p?.colorHexCode,
            iconUrl: p?.iconUrl,
            initialValue: p?.initialValue,
            min: p?.min,
            max: p?.max,
            prompt: p?.prompt,
            unit: p?.unit
        };
        if (Array.isArray(p?.levels) && p.levels.length) {
            r.levels = p.levels.map(l => ({
                name: l?.name,
                levelMinValue: l?.levelMinValue,
                levelMaxValue: l?.levelMaxValue,
                levelPrompt: l?.levelPrompt
            }));
        }
        return compactObject(r);
    }

    function normalizeModelForPatch(model) {
        if (!model) return undefined;
        const s = String(model);
        if (s === s.toUpperCase()) return s.toLowerCase();
        return s;
    }

    function normalizeTemplateForPatch(promptTemplate) {
        if (!promptTemplate) return 'custom';
        if (typeof promptTemplate === 'string') return promptTemplate;
        return promptTemplate.template || promptTemplate.name || 'custom';
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
            raw?.profileImage?.origin,
            'about:blank'
        );
    }

    function getBaseSetId(set) {
        return getFirst(set?.baseSetId, set?.setId, set?._id, set?.id);
    }

    function buildPatchStartingSet(set) {
        const filled = fillMissingCellsWithTransparent(set);

        const out = compactObject({
            baseSetId: getBaseSetId(set),
            name: set?.name || '기본 설정',
            initialMessages: Array.isArray(set?.initialMessages) ? set.initialMessages : [],
            situationPrompt: set?.situationPrompt || '',
            replySuggestions: Array.isArray(set?.replySuggestions) ? set.replySuggestions : [],
            situationImages: filled.situationImages,
            keywordBook: buildKeywordBook(set?.keywordBook),
            parameters: Array.isArray(set?.parameters) ? set.parameters.map(buildParam) : [],
            imageMatrix: filled.imageMatrix
        });

        // playGuide는 빈 문자열이면 PATCH에서 에러를 낼 수 있어서, 내용이 있을 때만 넣는다.
        if (typeof set?.playGuide === 'string' && set.playGuide.trim()) {
            out.playGuide = set.playGuide;
        }

        return { set: out, added: filled.added };
    }

    function buildPatchPayload(raw) {
        const setResults = (Array.isArray(raw?.startingSets) ? raw.startingSets : []).map(buildPatchStartingSet);
        const startingSets = setResults.map(r => r.set);
        const added = setResults.reduce((sum, r) => sum + r.added, 0);

        const payload = compactObject({
            name: raw?.name || '스토리',
            description: raw?.description || '설명',
            simpleDescription: raw?.simpleDescription || '간략한 설명',
            model: normalizeModelForPatch(raw?.model),
            storyDetails: raw?.storyDetails || '',
            chatExamples: Array.isArray(raw?.chatExamples) ? raw.chatExamples : [],
            tags: Array.isArray(raw?.tags) ? raw.tags : [],
            visibility: normalizeSimpleValue(raw?.visibility) || raw?.visibility || 'private',
            target: normalizeSimpleValue(raw?.target) || raw?.target,
            promptTemplate: normalizeTemplateForPatch(raw?.promptTemplate),
            isCommentBlocked: !!raw?.isCommentBlocked,
            startingSets,
            shortcutCommands: Array.isArray(raw?.shortcutCommands) ? raw.shortcutCommands : [],
            defaultCrackerModel: raw?.defaultCrackerModel || 'superchat_2_0',
            chatType: normalizeSimpleValue(raw?.chatType) || raw?.chatType || 'rolePlaying',
            genreId: getFirst(raw?.genreId, raw?.genre?._id, raw?.genre?.id),
            detailDescription: raw?.detailDescription || '',
            chatModelId: raw?.chatModelId,
            portraitImageUrl: getPortraitUrl(raw),
            situationImageVersion: 'v2',
            creatorRecommendedMaxOutput: raw?.creatorRecommendedMaxOutput,
            customPrompt: raw?.customPrompt || '',
            isMovingPortraitImage: !!(raw?.isMovingPortraitImage || raw?.profileImage?.gif),
            expectedBaseSnapshotId: raw?.snapshotId
        });

        return { payload, added };
    }

    async function fillStoryGaps(storyId) {
        toast('v2 이미지 배치표 확인 중...');
        try {
            const detail = await apiFetch('GET', `${API_BASE}/stories/me/${storyId}`, undefined, '스토리 조회');
            const raw = detail?.data;

            if (!raw) throw new Error('스토리 데이터를 못 가져왔어요.');
            if (raw.situationImageVersion !== 'v2') {
                toast('이 스토리는 v2 이미지 배치표가 아니에요.', 3600);
                return;
            }

            const { payload, added } = buildPatchPayload(raw);

            console.log(`${LOG} PATCH payload`, {
                storyId,
                added,
                placeholder: TRANSPARENT_STRIP_IMAGE_URL,
                payload
            });

            if (added <= 0) {
                toast('채울 빈칸이 없어요.\n이미 모든 조합에 이미지가 있어요.', 4200);
                return;
            }

            const ok = confirm(
                `v2 배치표 빈칸 ${added}개를 얇은 투명 이미지로 채울까요?\n\n` +
                `다른 캐릭터/표정으로 복제하지 않고,\n` +
                `없는 조합에만 투명 strip 이미지를 넣습니다.`
            );
            if (!ok) {
                toast('취소했어요.');
                return;
            }

            toast(`빈칸 ${added}개를 투명 strip으로 채우는 중...`, 5000);
            await apiFetch('PATCH', `${API_BASE}/stories/${storyId}/v2`, payload, '투명 빈칸 PATCH');

            toast(`✓ 완료!\n빈 조합 ${added}개를 얇은 투명 이미지로 채웠어요.`, 5200);
        } catch (err) {
            console.error(`${LOG} 실패`, err);
            toast('실패 ㅠㅠ\n' + String(err?.message || err).slice(0, 220), 7000);
        }
    }

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
                        type: ch.props.content.type || 'story'
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
        btn.className = 'vgf-btn';
        btn.textContent = label;
        btn.addEventListener('click', e => {
            e.preventDefault();
            e.stopPropagation();
            onClick();
        });
        return btn;
    }

    const MARKER = 'vgf-injected';

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
        divider.className = 'vgf-divider';
        container.appendChild(divider);

        const label = document.createElement('div');
        label.className = 'vgf-label';
        label.textContent = 'v2 이미지 빈칸 보정';
        container.appendChild(label);

        if (info.type && info.type !== 'story') {
            container.appendChild(createButton('⚠ 스토리만 가능', () => toast('스토리 타입만 가능해요.')));
            return;
        }

        container.appendChild(createButton('🧩 투명 strip으로 빈칸 채우기', () => fillStoryGaps(info.id)));
    }

    function init() {
        new MutationObserver(() => injectMenu()).observe(document.body, {
            childList: true,
            subtree: true
        });
        console.log(`${LOG} 로드 완료 v1.0.0`);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();

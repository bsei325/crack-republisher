// ==UserScript==
// @name         크랙 재게시 도우미
// @namespace    https://crack.wrtn.ai
// @version      2.6.0
// @author       me
// @description  크랙 스토리 재게시 + v2 이름/키워드 10자 정규화 + 세이프티/언세이프티 선택
// @match        https://crack.wrtn.ai/*
// @grant        GM_addStyle
// ==/UserScript==

(function () {
    'use strict';

    const API_BASE = 'https://crack-api.wrtn.ai/crack-api';
    const LOG = '[재게시 도우미]';
    // 크랙의 메인 커스텀 프롬프트는 7000자까지 허용되는 경우가 있어서 5000자로 자르면 안 됨.
    // 다만 서버가 특정 필드에 대해 "5000자 이하"라고 거절하는 경우가 있어,
    // customPrompt는 7000 기준, 그 외 긴 텍스트는 5000 기준으로만 자동 정리한다.
    const DEFAULT_TEXT_LIMIT = 5000;
    const DEFAULT_SAFE_TEXT_LIMIT = 4990;
    const CUSTOM_PROMPT_LIMIT = 7000;
    const CUSTOM_PROMPT_SAFE_LIMIT = 6990;
    const MAX_POST_SITUATION_IMAGES = 50;

    // ╔═══════════════════════════════════════════════════════╗
    // ║  1. 스타일                                            ║
    // ╚═══════════════════════════════════════════════════════╝

    GM_addStyle(`
        .rp-toast {
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
        .rp-toast.show {
            transform: translateX(-50%) translateY(0);
        }
        .rp-btn {
            font-size: 14px;
            font-weight: 500;
            color: hsl(var(--popover-foreground));
            padding: 8px 14px;
            cursor: pointer;
            user-select: none;
            transition: background 0.2s;
        }
        .rp-btn:hover {
            background: hsl(var(--accent));
        }
        .rp-divider {
            height: 1px;
            background: hsl(var(--border));
            margin: 4px 0;
        }
        .rp-label {
            font-size: 12px;
            font-weight: 600;
            color: hsl(var(--muted-foreground));
            padding: 6px 14px 2px;
            user-select: none;
        }
    `);


    // ╔═══════════════════════════════════════════════════════╗
    // ║  2. 공통 유틸                                         ║
    // ╚═══════════════════════════════════════════════════════╝

    function toast(msg, duration = 3200) {
        document.querySelectorAll('.rp-toast').forEach(el => el.remove());
        const el = document.createElement('div');
        el.className = 'rp-toast';
        el.textContent = msg;
        document.body.appendChild(el);
        requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('show')));
        setTimeout(() => {
            el.classList.remove('show');
            setTimeout(() => el.remove(), 400);
        }, duration);
    }

    function hasValue(v) {
        return v !== undefined && v !== null;
    }

    function compactObject(obj) {
        const out = {};
        for (const [k, v] of Object.entries(obj)) {
            if (v !== undefined) out[k] = v;
        }
        return out;
    }

    function unique(arr) {
        const seen = new Set();
        const out = [];
        for (const item of arr || []) {
            if (!hasValue(item)) continue;
            const s = String(item);
            if (!s || seen.has(s)) continue;
            seen.add(s);
            out.push(s);
        }
        return out;
    }

    function getFirst(...values) {
        for (const v of values) {
            if (v !== undefined && v !== null && v !== '') return v;
        }
        return undefined;
    }

    // v1 이미지 이름 전용. v2 배치표의 situation/category에는 절대 쓰면 안 됨.
    function sanitize(str, fallback = '이미지') {
        if (!str || typeof str !== 'string') return fallback;
        let c = str.replace(/[^가-힣a-zA-Z0-9\s]/g, '').trim();
        if (!c) c = fallback;
        if (c.length > 10) c = c.slice(0, 10);
        return c;
    }

    function makeUniqueName(base, used) {
        let name = sanitize(base, '이미지');
        if (!used.has(name)) {
            used.add(name);
            return name;
        }
        for (let n = 2; n <= 999; n++) {
            const suffix = String(n);
            const candidate = `${name.slice(0, Math.max(1, 10 - suffix.length))}${suffix}`;
            if (!used.has(candidate)) {
                used.add(candidate);
                return candidate;
            }
        }
        return name;
    }


    // 서버가 글자 수 제한으로 거절할 때, customPrompt 7000자는 보존하고 나머지 긴 텍스트만 안전하게 줄인다.
    function lastNamedSegment(path) {
        const parts = String(path).split(/[.\[\]]/).filter(Boolean);
        for (let i = parts.length - 1; i >= 0; i--) {
            if (!/^\d+$/.test(parts[i])) return parts[i];
        }
        return '';
    }

    function shouldSkipTextLimit(path) {
        const key = lastNamedSegment(path).toLowerCase();
        return key.includes('url')
            || key.endsWith('id')
            || key.includes('hexcode')
            || key === 'model'
            || key === 'visibility'
            || key === 'target'
            || key === 'chattype'
            || key === 'prompttemplate'
            || key === 'situationimageversion'
            || key === 'defaultcrackermodel'
            || key === 'rarity'
            || key === 'type'
            || key === 'comparisonoperator'
            || key === 'valueType';
    }

    function getTextLimitForPath(path) {
        const key = lastNamedSegment(path).toLowerCase();

        // 메인 커스텀 프롬프트는 크랙 UI에서 7000자까지 쓰는 경우가 있으므로 7000 기준.
        if (key === 'customprompt') return {
            limit: CUSTOM_PROMPT_LIMIT,
            safeLimit: CUSTOM_PROMPT_SAFE_LIMIT,
            reason: 'customPrompt 7000자 기준'
        };

        // 그 외 필드는 서버가 5000자 제한으로 거절하는 경우가 있어서 5000 기준.
        return {
            limit: DEFAULT_TEXT_LIMIT,
            safeLimit: DEFAULT_SAFE_TEXT_LIMIT,
            reason: '서버 5000자 제한 대응'
        };
    }

    function limitLongStrings(value, path, report) {
        if (typeof value === 'string') {
            if (shouldSkipTextLimit(path)) return value;

            const limitInfo = getTextLimitForPath(path);
            if (value.length > limitInfo.limit) {
                report.push({
                    path,
                    length: value.length,
                    limit: limitInfo.limit,
                    trimmedTo: limitInfo.safeLimit,
                    reason: limitInfo.reason
                });
                return value.slice(0, limitInfo.safeLimit);
            }
            return value;
        }
        if (Array.isArray(value)) {
            return value.map((item, idx) => limitLongStrings(item, `${path}[${idx}]`, report));
        }
        if (value && typeof value === 'object') {
            const out = {};
            for (const [k, v] of Object.entries(value)) {
                out[k] = limitLongStrings(v, `${path}.${k}`, report);
            }
            return out;
        }
        return value;
    }

    function makeTextLimitedPayload(payload) {
        const report = [];
        const limitedPayload = limitLongStrings(payload, 'payload', report);
        return { payload: limitedPayload, report };
    }


    function situationImageOverflowReport(payload) {
        const report = [];
        const sets = Array.isArray(payload?.startingSets) ? payload.startingSets : [];
        sets.forEach((set, idx) => {
            const imgs = Array.isArray(set?.situationImages) ? set.situationImages : [];
            if (imgs.length > MAX_POST_SITUATION_IMAGES) {
                report.push({
                    path: `payload.startingSets[${idx}].situationImages`,
                    length: imgs.length,
                    limit: MAX_POST_SITUATION_IMAGES,
                    trimmedTo: MAX_POST_SITUATION_IMAGES,
                    reason: 'POST 생성 situationImages 50개 제한 우회: 생성 후 PATCH로 v2 원본 복원 시도'
                });
            }
        });
        return report;
    }

    function hasAnySituationImagesOverMax(payload) {
        return situationImageOverflowReport(payload).length > 0;
    }

    function limitSituationImagesForPostCreate(payload, report) {
        const out = JSON.parse(JSON.stringify(payload));
        const sets = Array.isArray(out?.startingSets) ? out.startingSets : [];
        sets.forEach((set, idx) => {
            if (!Array.isArray(set?.situationImages)) return;
            if (set.situationImages.length > MAX_POST_SITUATION_IMAGES) {
                report.push({
                    path: `payload.startingSets[${idx}].situationImages`,
                    length: set.situationImages.length,
                    limit: MAX_POST_SITUATION_IMAGES,
                    trimmedTo: MAX_POST_SITUATION_IMAGES,
                    reason: 'POST 생성 situationImages 50개 제한 우회: 생성 후 PATCH로 v2 원본 복원 시도'
                });
                set.situationImages = set.situationImages.slice(0, MAX_POST_SITUATION_IMAGES);
            }
        });
        return out;
    }

    function isSituationImagesLimitError(err) {
        const s = [
            err?.message,
            typeof err?.response === 'string' ? err.response : JSON.stringify(err?.response || '')
        ].filter(Boolean).join(' ');
        return /situationImages?.*no more than 50|no more than 50.*situationImages?|50\s*elements?/i.test(s);
    }

    // POST 생성 API만 5000자 제한을 더 빡빡하게 거는 경우가 있어서,
    // 최후 재시도에서는 customPrompt도 임시로 4990자까지 줄여 생성한 뒤 PATCH로 원본 복원을 시도한다.
    function limitLongStringsForPostCreate(value, path, report) {
        if (typeof value === 'string') {
            if (shouldSkipTextLimit(path)) return value;
            if (value.length > DEFAULT_TEXT_LIMIT) {
                report.push({
                    path,
                    length: value.length,
                    limit: DEFAULT_TEXT_LIMIT,
                    trimmedTo: DEFAULT_SAFE_TEXT_LIMIT,
                    reason: lastNamedSegment(path).toLowerCase() === 'customprompt'
                        ? 'POST 생성 5000자 제한 우회: 생성 후 PATCH로 원본 복원 시도'
                        : 'POST 생성 5000자 제한 대응'
                });
                return value.slice(0, DEFAULT_SAFE_TEXT_LIMIT);
            }
            return value;
        }
        if (Array.isArray(value)) {
            return value.map((item, idx) => limitLongStringsForPostCreate(item, `${path}[${idx}]`, report));
        }
        if (value && typeof value === 'object') {
            const out = {};
            for (const [k, v] of Object.entries(value)) {
                out[k] = limitLongStringsForPostCreate(v, `${path}.${k}`, report);
            }
            return out;
        }
        return value;
    }

    function makeShortMatrixLabel(value, fallback, used) {
        let base = String(value || fallback || '').trim();
        if (!base) base = fallback || '항목';
        // POST 생성 API는 v2 imageMatrix 라벨에 10자 제한을 빡빡하게 건다.
        // 원본은 생성 직후 PATCH에서 다시 복원하므로, POST용 임시 라벨만 짧게 만든다.
        base = base.slice(0, 10);
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

    function limitV2MatrixAndPlayGuideForPostCreate(payload, report) {
        const out = JSON.parse(JSON.stringify(payload));
        if (out?.situationImageVersion !== 'v2') return out;

        const sets = Array.isArray(out.startingSets) ? out.startingSets : [];
        sets.forEach((set, idx) => {
            // POST 생성 API는 v2 startingSet마다 playGuide를 "필수 + 1글자 이상"으로 검사하는 경우가 있다.
            // 크랙 빌더 PATCH는 playGuide가 없어도 저장되지만, POST만 빡빡하므로 생성 때만 더미값을 넣는다.
            const originalPlayGuide = Object.prototype.hasOwnProperty.call(set, 'playGuide') ? set.playGuide : undefined;
            if (typeof originalPlayGuide !== 'string' || originalPlayGuide.trim().length === 0) {
                set.playGuide = '안내';
                report.push({
                    path: `payload.startingSets[${idx}].playGuide`,
                    reason: 'POST 생성 필수값 우회: 빈/누락 playGuide를 임시 1글자 이상 값으로 채움. 생성 후 PATCH에서 원본 구조 복원'
                });
            }

            const imgs = Array.isArray(set.situationImages) ? set.situationImages : [];
            const matrix = set.imageMatrix || {};
            let rawCategories = Array.isArray(matrix.categories) && matrix.categories.length
                ? unique(matrix.categories)
                : unique(imgs.map(img => img?.category));
            let rawSituations = Array.isArray(matrix.situations) && matrix.situations.length
                ? unique(matrix.situations)
                : unique(imgs.map(img => img?.situation));

            // POST 생성 API는 v2 imageMatrix.categories / situations 둘 다 최소 1개를 요구한다.
            // 원본에 배치표가 없거나 한쪽만 비어 있어도 생성용으로만 더미 축을 만든다.
            let addedDummyAxis = false;
            if (rawCategories.length === 0) {
                rawCategories = ['기본'];
                addedDummyAxis = true;
            }
            if (rawSituations.length === 0) {
                rawSituations = ['기본'];
                addedDummyAxis = true;
            }

            const catUsed = new Set();
            const sitUsed = new Set();
            const catMap = new Map();
            const sitMap = new Map();

            rawCategories.forEach((c, i) => catMap.set(String(c), makeShortMatrixLabel(c, `분류${i + 1}`, catUsed)));
            rawSituations.forEach((s, i) => sitMap.set(String(s), makeShortMatrixLabel(s, `상황${i + 1}`, sitUsed)));

            const defaultCategory = Array.from(catMap.values())[0] || '기본';
            const defaultSituation = Array.from(sitMap.values())[0] || '기본';

            imgs.forEach((img, i) => {
                const rawCat = img.category != null && String(img.category).trim() !== '' ? String(img.category) : null;
                const rawSit = img.situation != null && String(img.situation).trim() !== '' ? String(img.situation) : null;

                if (rawCat) {
                    if (!catMap.has(rawCat)) catMap.set(rawCat, makeShortMatrixLabel(rawCat, `분류${i + 1}`, catUsed));
                    img.category = catMap.get(rawCat);
                } else {
                    img.category = defaultCategory;
                }

                if (rawSit) {
                    if (!sitMap.has(rawSit)) sitMap.set(rawSit, makeShortMatrixLabel(rawSit, `상황${i + 1}`, sitUsed));
                    img.situation = sitMap.get(rawSit);
                } else {
                    img.situation = defaultSituation;
                }
            });

            const newCategories = unique(Array.from(catMap.values()));
            const newSituations = unique(Array.from(sitMap.values()));
            set.imageMatrix = { categories: newCategories, situations: newSituations };

            const changed = addedDummyAxis
                || rawCategories.some(c => String(c).length > 10 || catMap.get(String(c)) !== String(c))
                || rawSituations.some(s => String(s).length > 10 || sitMap.get(String(s)) !== String(s));
            if (changed) {
                report.push({
                    path: `payload.startingSets[${idx}].imageMatrix`,
                    reason: 'POST 생성 imageMatrix 필수/10자 제한 우회: 임시 배치표로 생성 후 PATCH에서 원본 v2 배치표 복원 시도',
                    categoryCount: newCategories.length,
                    situationCount: newSituations.length
                });
            }
        });
        return out;
    }

    function makePostCreateLimitedPayload(payload) {
        const report = [];
        let limitedPayload = limitLongStringsForPostCreate(payload, 'payload', report);
        limitedPayload = limitSituationImagesForPostCreate(limitedPayload, report);
        limitedPayload = limitV2MatrixAndPlayGuideForPostCreate(limitedPayload, report);
        return { payload: limitedPayload, report };
    }

    function isTextLimitError(err) {
        const s = [
            err?.message,
            typeof err?.response === 'string' ? err.response : JSON.stringify(err?.response || '')
        ].filter(Boolean).join(' ');
        return /5000|5,000|글자\s*이하|이하로\s*입력|characters?/i.test(s);
    }

    function isImageMatrixLimitError(err) {
        const s = [
            err?.message,
            typeof err?.response === 'string' ? err.response : JSON.stringify(err?.response || '')
        ].filter(Boolean).join(' ');
        return /imageMatrix|10글자|10\s*characters?/i.test(s);
    }

    function isPlayGuideError(err) {
        const s = [
            err?.message,
            typeof err?.response === 'string' ? err.response : JSON.stringify(err?.response || '')
        ].filter(Boolean).join(' ');
        return /playGuide|longer or equal to 1/i.test(s);
    }


    // ╔═══════════════════════════════════════════════════════╗
    // ║  3. 인증 & API                                        ║
    // ╚═══════════════════════════════════════════════════════╝

    function getToken() {
        const m = document.cookie.match(/(?:^|; )access_token=([^;]*)/);
        return m ? decodeURIComponent(m[1]) : null;
    }

    async function apiFetch(method, url, body, label = '') {
        const token = getToken();
        if (!token) throw new Error('로그인 토큰을 못 찾았어요. 크랙에 다시 로그인해줘!');

        const opts = {
            method,
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        };
        if (body !== undefined) opts.body = typeof body === 'string' ? body : JSON.stringify(body);

        const res = await fetch(url, opts);
        const text = await res.text();
        let json = null;
        try { json = text ? JSON.parse(text) : null; } catch (_) {}

        if (!res.ok) {
            const msg = json?.message || json?.error || text || `HTTP ${res.status}`;
            console.error(`${LOG} API 에러 ${label}`, {
                status: res.status,
                statusText: res.statusText,
                response: json || text,
                requestBody: body
            });
            const err = new Error(String(msg));
            err.status = res.status;
            err.response = json || text;
            throw err;
        }
        return json;
    }


    // ╔═══════════════════════════════════════════════════════╗
    // ║  4. 페이로드 빌더                                      ║
    // ╚═══════════════════════════════════════════════════════╝

    function buildLevel(l) {
        return compactObject({
            name: l?.name || '',
            levelMinValue: l?.levelMinValue,
            levelMaxValue: l?.levelMaxValue,
            levelPrompt: l?.levelPrompt || ''
        });
    }

    function buildParam(p) {
        const r = compactObject({
            name: p?.name || '',
            colorHexCode: p?.colorHexCode,
            iconUrl: p?.iconUrl,
            initialValue: p?.initialValue,
            min: p?.min,
            max: p?.max,
            prompt: p?.prompt || '',
            unit: p?.unit || ''
        });
        if (Array.isArray(p?.levels) && p.levels.length > 0) {
            r.levels = p.levels.map(buildLevel);
        }
        return r;
    }

    function buildRule(r) {
        if (!r) return {};
        if (r.type === 'GROUP') {
            return compactObject({
                type: 'GROUP',
                ruleOperator: r.ruleOperator,
                rules: Array.isArray(r.rules) ? r.rules.map(buildRule) : []
            });
        }
        return compactObject({
            type: r.type,
            comparisonOperator: r.comparisonOperator,
            statName: r.statName,
            value: r.value,
            valueType: r.valueType
        });
    }

    function buildEnding(e) {
        const condition = { turnCount: e?.condition?.turnCount ?? 0 };
        if (e?.condition?.groupOperator) condition.groupOperator = e.condition.groupOperator;
        if (Array.isArray(e?.condition?.rules) && e.condition.rules.length > 0) {
            condition.rules = e.condition.rules.map(buildRule);
        }

        return compactObject({
            baseEndingId: e?.baseEndingId,
            name: e?.name || '',
            blurredImageUrl: e?.blurredImageUrl,
            imageUrl: e?.imageUrl,
            condition,
            conditionPrompt: e?.conditionPrompt || '',
            rarity: e?.rarity || 'N',
            epilogueExample: e?.epilogueExample,
            hint: e?.hint
        });
    }

    function buildKeywordBook(kb) {
        if (!Array.isArray(kb)) return [];
        return kb.map(item => ({
            name: item?.name || '',
            keywords: Array.isArray(item?.keywords) ? item.keywords : [],
            prompt: item?.prompt || ''
        }));
    }

    function buildV1Matrix(m) {
        if (!m) return undefined;
        const categories = Array.isArray(m.categories)
            ? unique(m.categories.map(c => sanitize(String(c), '카테고리')))
            : undefined;
        const situations = Array.isArray(m.situations)
            ? unique(m.situations.map(s => sanitize(String(s), '상황')))
            : undefined;

        if (!categories && !situations) return undefined;
        return compactObject({ categories, situations });
    }

    function buildV2Matrix(set) {
        const m = set?.imageMatrix || {};
        const imgs = Array.isArray(set?.situationImages) ? set.situationImages : [];

        const categories = Array.isArray(m.categories)
            ? unique(m.categories)
            : unique(imgs.map(img => img?.category));
        const situations = Array.isArray(m.situations)
            ? unique(m.situations)
            : unique(imgs.map(img => img?.situation));

        if (categories.length === 0 && situations.length === 0) return undefined;
        return { categories, situations };
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

            // 위 키 이름이 아닌 구조로 들어와도 [object Object] 대신 내부 primitive를 하나라도 건진다.
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

    function trimV2Label(label, fallback, used) {
        let s = extractV2Label(label, fallback).trim();
        if (isBadObjectString(s)) s = fallback || '기본';

        // 크랙 v2 PATCH도 imageMatrix 라벨 10자 제한을 검사한다.
        // 이름/키워드 각각 10자 제한에 맞춰 실제로 들어가는 문자열을 10자 이내로 맞춘다.
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

    function trimV2Keyword(value, fallback = '') {
        // v2 이미지 keyword도 서버/UI에서 10자 제한을 받는 케이스가 있어 안전하게 10자 이내로 맞춘다.
        const s = extractV2Label(value, fallback, ['keyword', 'name']).trim();
        if (!s || isBadObjectString(s)) return fallback ? String(fallback).slice(0, 10) : '';
        return s.slice(0, 10);
    }

    function normalizeV2SetForServer(set) {
        const imgs = Array.isArray(set?.situationImages) ? set.situationImages : [];
        const m = set?.imageMatrix || {};

        // categories는 보통 캐릭터/분류 이름, situations는 상황 키워드에 해당한다.
        // 객체로 내려와도 name/keyword 안쪽 값을 꺼내고, 최종 문자열은 10자 이내로 맞춘다.
        const rawCategories = Array.isArray(m.categories) && m.categories.length
            ? m.categories.map((v, i) => extractV2Label(v, `분류${i + 1}`, ['name', 'category', 'label', 'keyword']))
            : imgs.map((img, i) => extractV2Label(img?.category, `분류${i + 1}`, ['name', 'category', 'label', 'keyword']));

        const rawSituations = Array.isArray(m.situations) && m.situations.length
            ? m.situations.map((v, i) => extractV2Label(v, `상황${i + 1}`, ['keyword', 'name', 'situation', 'label']))
            : imgs.map((img, i) => extractV2Label(img?.situation, `상황${i + 1}`, ['keyword', 'name', 'situation', 'label']));

        const catUsed = new Set();
        const sitUsed = new Set();
        const catMap = new Map();
        const sitMap = new Map();

        function getCat(raw, idx) {
            const key = extractV2Label(raw, `분류${idx + 1}`, ['name', 'category', 'label', 'keyword']);
            if (!catMap.has(key)) catMap.set(key, trimV2Label(key, `분류${catMap.size + 1}`, catUsed));
            return catMap.get(key);
        }

        function getSit(raw, idx) {
            const key = extractV2Label(raw, `상황${idx + 1}`, ['keyword', 'name', 'situation', 'label']);
            if (!sitMap.has(key)) sitMap.set(key, trimV2Label(key, `상황${sitMap.size + 1}`, sitUsed));
            return sitMap.get(key);
        }

        rawCategories.forEach((c, i) => getCat(c, i));
        rawSituations.forEach((s, i) => getSit(s, i));

        if (catMap.size === 0) catMap.set('기본', trimV2Label('기본', '기본', catUsed));
        if (sitMap.size === 0) sitMap.set('기본', trimV2Label('기본', '기본', sitUsed));

        const defaultCategory = Array.from(catMap.values())[0] || '기본';
        const defaultSituation = Array.from(sitMap.values())[0] || '기본';

        const situationImages = imgs.map((img, idx) => {
            const rawCat = extractV2Label(img?.category, '', ['name', 'category', 'label', 'keyword']);
            const rawSit = extractV2Label(img?.situation, '', ['keyword', 'name', 'situation', 'label']);

            return compactObject({
                situation: rawSit ? getSit(rawSit, idx) : defaultSituation,
                keyword: trimV2Keyword(img?.keyword, ''),
                imageUrl: img?.imageUrl,
                category: rawCat ? getCat(rawCat, idx) : defaultCategory
            });
        });

        const result = {
            imageMatrix: {
                categories: Array.from(catMap.values()).filter(v => !isBadObjectString(v)).map(v => String(v).slice(0, 10)),
                situations: Array.from(sitMap.values()).filter(v => !isBadObjectString(v)).map(v => String(v).slice(0, 10))
            },
            situationImages: situationImages.map(img => compactObject({
                ...img,
                category: img.category ? String(img.category).slice(0, 10) : defaultCategory,
                situation: img.situation ? String(img.situation).slice(0, 10) : defaultSituation,
                keyword: trimV2Keyword(img.keyword, '')
            }))
        };

        if (result.imageMatrix.categories.length === 0) result.imageMatrix.categories = ['기본'];
        if (result.imageMatrix.situations.length === 0) result.imageMatrix.situations = ['기본'];

        return result;
    }


    function getSetId(s) {
        return getFirst(
            s?.setId,
            s?.baseSetId,
            s?.id,
            s?._id,
            s?.sourceId
        );
    }

    function buildSet(s, isV2) {
        const r = compactObject({
            // POST 생성용 필드명은 setId. GET/PATCH 원본의 baseSetId가 있으면 setId로 바꿔 넣는다.
            setId: getSetId(s),
            name: s?.name || '기본 설정',
            initialMessages: Array.isArray(s?.initialMessages) ? s.initialMessages : [],
            situationPrompt: s?.situationPrompt || '',
            replySuggestions: Array.isArray(s?.replySuggestions) ? s.replySuggestions : [],
            keywordBook: buildKeywordBook(s?.keywordBook),
            parameters: Array.isArray(s?.parameters) ? s.parameters.map(buildParam) : []
        });

        if (isV2) {
            // v2 배치표는 서버가 imageMatrix 라벨 10자 제한을 검사한다.
            // API 원본에 category/situation이 객체로 내려오는 경우 [object Object]가 섞이면 400이 나므로 문자열로 정규화한다.
            if (typeof s?.playGuide === 'string' && s.playGuide.trim().length > 0) {
                r.playGuide = s.playGuide;
            }
            const normalizedV2 = normalizeV2SetForServer(s);
            r.imageMatrix = normalizedV2.imageMatrix;
            r.situationImages = normalizedV2.situationImages;
        } else {
            const usedNames = new Set();
            r.situationImages = (Array.isArray(s?.situationImages) ? s.situationImages : []).map((img, idx) => {
                const base = getFirst(img?.keyword, img?.situation, `이미지${idx + 1}`);
                return compactObject({
                    situation: sanitize(img?.situation, '상황'),
                    keyword: makeUniqueName(base, usedNames),
                    imageUrl: img?.imageUrl,
                    category: img?.category != null ? sanitize(String(img.category), '카테고리') : undefined
                });
            });
            const matrix = buildV1Matrix(s?.imageMatrix);
            if (matrix) r.imageMatrix = matrix;
        }

        if (s?.ending && Array.isArray(s.ending.endings) && s.ending.endings.length > 0) {
            r.ending = { endings: s.ending.endings.map(buildEnding) };
        }

        return r;
    }

    function buildRecommendedOutput(ro) {
        if (!ro) return { type: 'TOTAL', totalMultiplier: 'default' };
        const r = compactObject({
            type: ro.type || 'TOTAL',
            totalMultiplier: ro.totalMultiplier
        });
        if (Array.isArray(ro.modelMultipliers) && ro.modelMultipliers.length > 0) {
            r.modelMultipliers = ro.modelMultipliers.map(m => compactObject({
                chatModelId: m?.chatModelId,
                maxOutputMultiplier: m?.maxOutputMultiplier
            }));
        }
        return r;
    }

    function pickPortraitUrl(raw) {
        return getFirst(
            raw?.portraitImageUrl,
            raw?.portraitImage?.origin,
            raw?.portraitImage?.url,
            raw?.profileImage?.origin,
            raw?.profileImage?.url,
            raw?.profileImage?.gif,
            'about:blank'
        );
    }

    function pickMovingFlag(raw) {
        if (typeof raw?.isMovingPortraitImage === 'boolean') return raw.isMovingPortraitImage;
        return !!(raw?.portraitImage?.gif || raw?.profileImage?.gif);
    }

    function buildPayload(raw, visibility, options = {}) {
        const isV2 = raw?.situationImageVersion === 'v2';
        const adultOverride = typeof options.adultOverride === 'boolean' ? options.adultOverride : undefined;

        const payload = compactObject({
            chatExamples: Array.isArray(raw?.chatExamples) ? raw.chatExamples : [],
            chatModelId: raw?.chatModelId,
            chatType: raw?.chatType || 'rolePlaying',
            customPrompt: raw?.customPrompt || '',
            defaultCrackerModel: raw?.defaultCrackerModel || 'superchat_2_0',
            description: raw?.description || '설명',
            detailDescription: raw?.detailDescription || '',
            genreId: raw?.genreId,
            isCommentBlocked: !!raw?.isCommentBlocked,
            isMovingPortraitImage: pickMovingFlag(raw),
            model: raw?.model,
            name: raw?.name || '재게시 스토리',
            portraitImageUrl: pickPortraitUrl(raw),
            promptTemplate: raw?.promptTemplate?.template || raw?.promptTemplate || 'custom',
            simpleDescription: raw?.simpleDescription || '간략한 설명',
            startingSets: (Array.isArray(raw?.startingSets) ? raw.startingSets : []).map(s => buildSet(s, isV2)),
            storyDetails: raw?.storyDetails || '',
            tags: Array.isArray(raw?.tags) ? raw.tags : [],
            target: raw?.target || 'all',
            visibility,
            isAdult: adultOverride ?? !!raw?.isAdult,
            creatorRecommendedMaxOutput: buildRecommendedOutput(raw?.creatorRecommendedMaxOutput),
            situationImageVersion: raw?.situationImageVersion || 'v1'
        });

        if (isV2 || Array.isArray(raw?.shortcutCommands)) {
            payload.shortcutCommands = Array.isArray(raw?.shortcutCommands) ? raw.shortcutCommands : [];
        }

        // v2 POST가 snapshot을 요구하는 경우를 대비한 선택 옵션.
        if (options.withSnapshot) {
            const snapshotId = getFirst(raw?.expectedBaseSnapshotId, raw?.baseSnapshotId, raw?.snapshotId, raw?.currentBaseSnapshotId);
            if (snapshotId) payload.expectedBaseSnapshotId = snapshotId;
        }

        return payload;
    }

    function buildV1FallbackPayload(raw, visibility) {
        const clone = JSON.parse(JSON.stringify(raw));
        clone.situationImageVersion = 'v1';
        clone.shortcutCommands = undefined;
        clone.expectedBaseSnapshotId = undefined;

        for (const set of clone.startingSets || []) {
            delete set.playGuide;
            delete set.imageMatrix;
            const used = new Set();
            set.situationImages = (set.situationImages || []).map((img, idx) => {
                const base = [img.category, img.situation].filter(Boolean).join(' ') || img.keyword || `이미지${idx + 1}`;
                return {
                    situation: sanitize(img.situation || base, '상황'),
                    keyword: makeUniqueName(base, used),
                    imageUrl: img.imageUrl
                };
            });
        }

        const payload = buildPayload(clone, visibility, {});
        delete payload.shortcutCommands;
        return payload;
    }

    function logPayloadSummary(raw, payload) {
        const sets = payload.startingSets || [];
        const imageCount = sets.reduce((sum, s) => sum + (s.situationImages?.length || 0), 0);
        console.log(`${LOG} 원본 데이터:`, raw);
        console.log(`${LOG} 변환된 페이로드:`, payload);
        console.log(`${LOG} 요약`, {
            version: payload.situationImageVersion,
            visibility: payload.visibility,
            setCount: sets.length,
            imageCount,
            size: JSON.stringify(payload).length + ' bytes'
        });
    }


    // ╔═══════════════════════════════════════════════════════╗
    // ║  5. 재게시 로직                                       ║
    // ╚═══════════════════════════════════════════════════════╝

    async function postStory(payload, label) {
        return apiFetch('POST', `${API_BASE}/stories/v2`, payload, label);
    }

    async function postStoryWithAutoTextLimit(payload, label) {
        const originalCustomPrompt = typeof payload?.customPrompt === 'string' ? payload.customPrompt : '';
        const imageOverflow = hasAnySituationImagesOverMax(payload);
        const isV2Payload = payload?.situationImageVersion === 'v2';

        // POST /stories/v2 생성 API는 customPrompt 5000자 제한,
        // startingSets[].situationImages 50개 제한, v2 imageMatrix 라벨 10자 제한을 더 빡빡하게 건다.
        // 그래서 POST는 임시 단축/축소본으로 만들고, 생성 직후 builder식 PATCH로 v2 원본을 복원한다.
        if (originalCustomPrompt.length > DEFAULT_TEXT_LIMIT || imageOverflow || isV2Payload) {
            const postLimited = makePostCreateLimitedPayload(payload);
            console.warn(`${LOG} POST 생성 제한 우회 후 PATCH 전체 복원 예정`, postLimited.report);
            const imageReport = postLimited.report.filter(r => String(r.path).includes('situationImages'));
            const textReport = postLimited.report.filter(r => !String(r.path).includes('situationImages'));
            toast(`POST 생성 제한 우회 중...
긴 글/가이드/배치 ${textReport.length}개 / 이미지 임시값 ${imageReport.length}개
생성 후 v2 원본으로 복원할게`, 5600);
            const result = await postStory(postLimited.payload, `${label} / POST 임시 축소`);
            return {
                result,
                textLimited: textReport.length > 0,
                imageLimited: imageReport.length > 0,
                report: postLimited.report,
                restoreAfterCreate: true,
                restorePayload: payload
            };
        }

        try {
            const result = await postStory(payload, label);
            return { result, textLimited: false, imageLimited: false, report: [], restoreAfterCreate: false, restorePayload: null };
        } catch (err) {
            if (!isTextLimitError(err) && !isSituationImagesLimitError(err) && !isImageMatrixLimitError(err) && !isPlayGuideError(err)) throw err;

            const limited = makePostCreateLimitedPayload(payload);
            if (limited.report.length) {
                console.warn(`${LOG} 서버 제한 항목 자동 정리 후 PATCH 복원 예정`, limited.report);
                toast(`서버 제한 항목 ${limited.report.length}개 발견
먼저 축소 생성하고 v2 원본 복원 중...`, 5000);
                const result = await postStory(limited.payload, `${label} / POST 제한 자동 축소`);
                return {
                    result,
                    textLimited: limited.report.some(r => !String(r.path).includes('situationImages')),
                    imageLimited: limited.report.some(r => String(r.path).includes('situationImages')),
                    report: limited.report,
                    restoreAfterCreate: true,
                    restorePayload: payload
                };
            }

            throw err;
        }
    }

    function isLikelyId(v) {
        return typeof v === 'string' && /^[a-zA-Z0-9_-]{10,80}$/.test(v);
    }

    function getCreatedStoryId(res) {
        const direct = [
            res?.data?.id,
            res?.data?._id,
            res?.data?.storyId,
            res?.data?.sourceId,
            res?.story?.id,
            res?.story?._id,
            res?.story?.storyId,
            res?.result?.id,
            res?.result?._id,
            res?.result?.storyId,
            res?.id,
            res?._id,
            res?.storyId
        ];
        for (const v of direct) if (isLikelyId(v)) return v;

        const seen = new Set();
        function walk(o) {
            if (!o || typeof o !== 'object' || seen.has(o)) return null;
            seen.add(o);

            const looksLikeStory = 'startingSets' in o || 'customPrompt' in o || 'portraitImageUrl' in o || 'storyDetails' in o;
            if (looksLikeStory) {
                for (const k of ['id', '_id', 'storyId', 'sourceId']) {
                    if (isLikelyId(o[k])) return o[k];
                }
            }

            for (const [k, v] of Object.entries(o)) {
                const key = String(k).toLowerCase();
                if ((key === 'storyid' || key === 'story_id' || (key.includes('story') && key.includes('id'))) && isLikelyId(v)) {
                    return v;
                }
            }
            for (const v of Object.values(o)) {
                const found = walk(v);
                if (found) return found;
            }
            return null;
        }
        return walk(res);
    }

    function getOriginalCustomPrompt(payload) {
        return typeof payload?.customPrompt === 'string' ? payload.customPrompt : '';
    }

    function getCreatedStoryData(res) {
        return res?.data || res?.story || res?.result?.data || res?.result || res || {};
    }

    function getCreatedSnapshotId(res) {
        const data = getCreatedStoryData(res);
        return getFirst(
            data?.snapshotId,
            data?.expectedBaseSnapshotId,
            data?.baseSnapshotId,
            data?.currentBaseSnapshotId,
            res?.snapshotId,
            res?.expectedBaseSnapshotId,
            res?.baseSnapshotId
        );
    }

    function patchModelValue(model) {
        // 크랙 빌더 PATCH payload는 "sonnet"처럼 소문자로 보내는 케이스가 확인됨.
        return typeof model === 'string' ? model.toLowerCase() : model;
    }

    function buildPatchStartingSet(postSet, createdSet) {
        const out = {};
        for (const [k, v] of Object.entries(postSet || {})) {
            if (k === 'setId') continue;
            if (v !== undefined) out[k] = v;
        }

        // POST 생성용은 setId, PATCH 수정용은 baseSetId.
        // 생성 응답의 baseSetId가 있으면 그것을 최우선으로 사용한다.
        const baseSetId = getFirst(
            createdSet?.baseSetId,
            createdSet?.setId,
            postSet?.baseSetId,
            postSet?.setId,
            postSet?._id
        );
        if (baseSetId) out.baseSetId = baseSetId;
        return out;
    }

    function buildBuilderLikePatchPayload(originalPayload, createResult) {
        const data = getCreatedStoryData(createResult);
        const createdSets = Array.isArray(data?.startingSets) ? data.startingSets : [];
        const snapshotId = getCreatedSnapshotId(createResult);

        // 실제 크랙 빌더 저장 PATCH에서 확인한 필드 순서/구조를 최대한 맞춘다.
        const patch = compactObject({
            name: originalPayload?.name || '재게시 스토리',
            description: originalPayload?.description || '설명',
            simpleDescription: originalPayload?.simpleDescription || '간략한 설명',
            model: patchModelValue(originalPayload?.model),
            storyDetails: originalPayload?.storyDetails || '',
            chatExamples: Array.isArray(originalPayload?.chatExamples) ? originalPayload.chatExamples : [],
            tags: Array.isArray(originalPayload?.tags) ? originalPayload.tags : [],
            visibility: originalPayload?.visibility,
            target: originalPayload?.target,
            promptTemplate: originalPayload?.promptTemplate || 'custom',
            isCommentBlocked: !!originalPayload?.isCommentBlocked,
            startingSets: (Array.isArray(originalPayload?.startingSets) ? originalPayload.startingSets : [])
                .map((set, idx) => buildPatchStartingSet(set, createdSets[idx])),
            shortcutCommands: Array.isArray(originalPayload?.shortcutCommands) ? originalPayload.shortcutCommands : [],
            defaultCrackerModel: originalPayload?.defaultCrackerModel || 'superchat_2_0',
            chatType: originalPayload?.chatType || 'rolePlaying',
            genreId: originalPayload?.genreId,
            detailDescription: originalPayload?.detailDescription || '',
            chatModelId: originalPayload?.chatModelId,
            portraitImageUrl: originalPayload?.portraitImageUrl,
            situationImageVersion: originalPayload?.situationImageVersion || 'v1',
            creatorRecommendedMaxOutput: originalPayload?.creatorRecommendedMaxOutput,
            customPrompt: originalPayload?.customPrompt || '',
            isMovingPortraitImage: !!originalPayload?.isMovingPortraitImage,
            expectedBaseSnapshotId: snapshotId
        });

        // 최종 안전장치: v2 PATCH payload 어디에도 [object Object]나 10자 초과 matrix 라벨이 남지 않게 한 번 더 정리한다.
        if (patch.situationImageVersion === 'v2' && Array.isArray(patch.startingSets)) {
            patch.startingSets = patch.startingSets.map(set => {
                const normalized = normalizeV2SetForServer(set);
                return {
                    ...set,
                    imageMatrix: normalized.imageMatrix,
                    situationImages: normalized.situationImages
                };
            });
        }

        return patch;
    }


    function makeTempObjectId(seed = 0) {
        const chars = '0123456789abcdef';
        let out = '';
        const base = `${Date.now()}${Math.random()}${seed}`;
        for (let i = 0; i < 24; i++) {
            const code = base.charCodeAt(i % base.length) + Math.floor(Math.random() * 16) + i + seed;
            out += chars[code % 16];
        }
        return out;
    }

    function getAnyImageUrlForTemp(raw, originalPayload, set) {
        // v2 POST가 situationImages 0개를 싫어하는 것으로 보여서 임시 이미지 1개를 넣는다.
        // 원본 복원 PATCH 때 전체 이미지/배치표로 덮어쓴다.
        const fromSet = Array.isArray(set?.situationImages)
            ? set.situationImages.find(img => typeof img?.imageUrl === 'string' && img.imageUrl.startsWith('http'))?.imageUrl
            : undefined;

        return getFirst(
            fromSet,
            originalPayload?.portraitImageUrl,
            raw?.portraitImage?.origin,
            raw?.profileImage?.origin
        );
    }

    function buildV1ShellCreatePayloadForV2Restore(raw, visibility, options = {}) {
        const original = buildPayload(raw, visibility, options);
        const rawSets = Array.isArray(raw?.startingSets) && raw.startingSets.length > 0
            ? raw.startingSets
            : [{ name: '기본 설정' }];

        const fallbackImageUrl = getAnyImageUrlForTemp(raw, original, rawSets[0]);

        const shellSets = rawSets.map((set, idx) => {
            const tempImageUrl = getAnyImageUrlForTemp(raw, original, set) || fallbackImageUrl;

            return compactObject({
                // POST /stories/v2는 situationImageVersion:v2 자체를 계속 400으로 튕기는 케이스가 있어
                // 생성 단계는 검증이 느슨한 v1 껍데기로만 통과시킨다.
                // 최종 결과는 바로 아래 PATCH에서 v2 원본으로 덮어쓴다.
                setId: makeTempObjectId(idx),
                name: (set?.name || `기본 설정 ${idx + 1}`).slice(0, 20),
                initialMessages: ['임시 시작 메시지입니다.'],
                situationPrompt: '임시 상황 프롬프트입니다.',
                replySuggestions: [],
                situationImages: tempImageUrl ? [{
                    situation: '기본',
                    keyword: '기본',
                    imageUrl: tempImageUrl
                }] : [],
                keywordBook: [],
                parameters: []
            });
        });

        return compactObject({
            chatExamples: [],
            chatModelId: original.chatModelId,
            chatType: original.chatType || 'rolePlaying',
            customPrompt: '임시 프롬프트입니다. 생성 후 원본으로 복원됩니다.',
            defaultCrackerModel: original.defaultCrackerModel || 'superchat_2_0',
            description: original.description || '설명',
            detailDescription: original.detailDescription || '',
            genreId: original.genreId,
            isCommentBlocked: !!original.isCommentBlocked,
            isMovingPortraitImage: !!original.isMovingPortraitImage,
            model: original.model,
            name: original.name || '재게시 스토리',
            portraitImageUrl: original.portraitImageUrl,
            promptTemplate: original.promptTemplate || 'custom',
            simpleDescription: original.simpleDescription || '간략한 설명',
            startingSets: shellSets,
            storyDetails: '',
            tags: [],
            target: original.target || 'female',
            visibility,
            isAdult: !!original.isAdult,
            creatorRecommendedMaxOutput: original.creatorRecommendedMaxOutput || { type: 'TOTAL', totalMultiplier: 'default' },
            situationImageVersion: 'v1'
        });
    }

    function hasCreatedStartingSets(res) {
        const data = getCreatedStoryData(res);
        return Array.isArray(data?.startingSets) && data.startingSets.length > 0;
    }

    async function getFreshCreatedStoryData(storyId, postResult, label) {
        // POST 응답에 snapshotId와 새 startingSets가 둘 다 있으면 그대로 쓴다.
        if (getCreatedSnapshotId(postResult) && hasCreatedStartingSets(postResult)) {
            return postResult;
        }

        // 없으면 새로 만든 story를 다시 조회해서 snapshotId/baseSetId를 확보한다.
        try {
            const fresh = await apiFetch('GET', `${API_BASE}/stories/me/${storyId}`, undefined, `${label} / 새 스토리 재조회`);
            if (fresh?.data) return fresh;
            return fresh || postResult;
        } catch (err) {
            console.warn(`${LOG} 새 스토리 재조회 실패. POST 응답만으로 PATCH를 시도합니다.`, err);
            return postResult;
        }
    }

    async function createV2ByMinimalPostThenPatchFull(raw, visibility, options = {}) {
        const originalPayload = buildPayload(raw, visibility, options);
        const shellPayload = buildV1ShellCreatePayloadForV2Restore(raw, visibility, options);

        console.log(`${LOG} v2 원본 payload`, {
            setCount: originalPayload.startingSets?.length || 0,
            imageCount: (originalPayload.startingSets || []).reduce((n, s) => n + (s.situationImages?.length || 0), 0),
            customPromptLength: (originalPayload.customPrompt || '').length,
            payload: originalPayload
        });
        console.log(`${LOG} v1 임시껍데기 POST payload`, shellPayload);

        toast(`1/3 v1 임시껍데기 생성 중...
최종은 바로 v2 원본으로 복원할게`, 4600);

        const postResult = await postStory(shellPayload, 'v1 임시껍데기 생성');
        const storyId = getCreatedStoryId(postResult);
        if (!storyId) {
            console.error(`${LOG} POST는 성공했지만 새 storyId를 못 찾음`, postResult);
            throw new Error('새 스토리 ID를 못 찾았어요');
        }

        toast(`2/3 임시 스토리 생성 완료
v2 원본 배치표/이미지/프롬프트 복원 중...`, 5000);

        const freshResult = await getFreshCreatedStoryData(storyId, postResult, 'v1 임시껍데기 생성');
        const patchPayload = buildBuilderLikePatchPayload(originalPayload, freshResult);

        if (!patchPayload.expectedBaseSnapshotId) {
            patchPayload.expectedBaseSnapshotId = getCreatedSnapshotId(postResult);
        }

        if (!patchPayload.expectedBaseSnapshotId) {
            console.warn(`${LOG} expectedBaseSnapshotId가 비어 있음. 서버가 거절할 수 있습니다.`, {
                postResult,
                freshResult,
                patchPayload
            });
        }

        console.log(`${LOG} v2 원본 전체 PATCH payload`, {
            storyId,
            expectedBaseSnapshotId: patchPayload.expectedBaseSnapshotId,
            setCount: patchPayload.startingSets?.length || 0,
            imageCount: (patchPayload.startingSets || []).reduce((n, s) => n + (s.situationImages?.length || 0), 0),
            customPromptLength: (patchPayload.customPrompt || '').length,
            payload: patchPayload
        });

        const patchResult = await apiFetch('PATCH', `${API_BASE}/stories/${storyId}/v2`, patchPayload, 'v2 원본 전체 복원');

        toast(`3/3 원본 복원 완료!
최종본은 v2 배치표/전체 이미지 유지됨`, 5600);

        return {
            result: patchResult,
            label: 'v1 임시 생성 후 v2 원본 전체 복원',
            fallback: false,
            textLimited: false,
            imageLimited: false,
            textLimitReport: [],
            restoreAfterCreate: true,
            restoreResult: {
                attempted: true,
                ok: true,
                mode: 'v1-shell-post-v2-full-patch',
                storyId,
                snapshotId: patchPayload.expectedBaseSnapshotId
            }
        };
    }


    async function patchRestoreCustomPrompt(createResult, originalPayload, label) {
        const originalCustomPrompt = getOriginalCustomPrompt(originalPayload);
        const needsTextRestore = !!originalCustomPrompt && originalCustomPrompt.length > DEFAULT_TEXT_LIMIT;
        const needsImageRestore = hasAnySituationImagesOverMax(originalPayload);
        if (!needsTextRestore && !needsImageRestore) {
            return { attempted: false, ok: true, reason: '복원할 POST 제한 초과 항목 없음' };
        }

        const storyId = getCreatedStoryId(createResult);
        if (!storyId) {
            console.warn(`${LOG} 생성은 됐지만 새 스토리 ID를 못 찾아서 customPrompt 복원을 못 했어요. 생성 응답:`, createResult);
            return { attempted: true, ok: false, reason: '새 스토리 ID를 못 찾음' };
        }

        let restoreSource = createResult;
        if (!getCreatedSnapshotId(restoreSource)) {
            try {
                console.warn(`${LOG} 생성 응답에서 snapshotId를 못 찾아 새 스토리를 다시 조회합니다.`, createResult);
                restoreSource = await apiFetch('GET', `${API_BASE}/stories/me/${storyId}`, undefined, `${label} / 생성 스토리 재조회`);
            } catch (getErr) {
                console.warn(`${LOG} 생성 스토리 재조회 실패. snapshotId 없이 PATCH를 시도합니다.`, getErr);
            }
        }

        const fullPatch = buildBuilderLikePatchPayload(originalPayload, restoreSource);
        console.log(`${LOG} v2 원본 전체 복원 PATCH 페이로드`, {
            storyId,
            customPromptLength: originalCustomPrompt.length,
            over50ImageSetCount: situationImageOverflowReport(originalPayload).length,
            expectedBaseSnapshotId: fullPatch.expectedBaseSnapshotId,
            startingSetCount: fullPatch.startingSets?.length || 0,
            payload: fullPatch
        });

        try {
            const patched = await apiFetch('PATCH', `${API_BASE}/stories/${storyId}/v2`, fullPatch, `${label} / builder식 원본 전체 복원`);
            console.log(`${LOG} v2 원본 전체 복원 성공`, { storyId, length: originalCustomPrompt.length, response: patched });
            return {
                attempted: true,
                ok: true,
                mode: 'builder-full',
                storyId,
                snapshotId: fullPatch.expectedBaseSnapshotId
            };
        } catch (fullErr) {
            console.warn(`${LOG} builder식 전체 복원 실패 → POST 안전형 v2 전체 복원 시도`, fullErr);
        }

        try {
            const safeReport = [];
            const safeV2Patch = limitV2MatrixAndPlayGuideForPostCreate(fullPatch, safeReport);
            if (safeReport.length > 0) {
                console.warn(`${LOG} v2 배치표 라벨/가이드 안전화 후 전체 복원 PATCH 시도`, safeReport);
                const patched = await apiFetch('PATCH', `${API_BASE}/stories/${storyId}/v2`, safeV2Patch, `${label} / v2 안전형 전체 복원`);
                console.log(`${LOG} v2 안전형 전체 복원 성공`, { storyId, response: patched });
                return {
                    attempted: true,
                    ok: true,
                    mode: 'builder-safe-v2',
                    storyId,
                    snapshotId: safeV2Patch.expectedBaseSnapshotId,
                    warning: 'imageMatrix 라벨은 서버 제한 때문에 10자 임시명으로 정리됨'
                };
            }
        } catch (safeErr) {
            console.warn(`${LOG} v2 안전형 전체 복원도 실패 → expectedBaseSnapshotId 포함 부분 복원 시도`, safeErr);
        }

        try {
            const snapshotId = fullPatch.expectedBaseSnapshotId;
            const partialPatch = compactObject({
                customPrompt: originalCustomPrompt,
                expectedBaseSnapshotId: snapshotId
            });
            const patched = await apiFetch('PATCH', `${API_BASE}/stories/${storyId}/v2`, partialPatch, `${label} / customPrompt 부분 복원`);
            console.log(`${LOG} customPrompt 부분 복원 성공`, { storyId, length: originalCustomPrompt.length, response: patched });
            return {
                attempted: true,
                ok: true,
                mode: 'partial-with-snapshot',
                storyId,
                snapshotId
            };
        } catch (partialErr) {
            console.error(`${LOG} v2 원본 전체 복원 최종 실패`, partialErr);
            return {
                attempted: true,
                ok: false,
                reason: partialErr?.message || 'PATCH 복원 실패',
                storyId,
                snapshotId: fullPatch.expectedBaseSnapshotId
            };
        }
    }

    async function createStory(raw, visibility, options = {}) {
        const isV2 = raw?.situationImageVersion === 'v2';

        // v2는 POST 생성 검증이 너무 빡빡해서 원본을 조금씩 줄여 넣지 않는다.
        // 무조건 최소 껍데기만 POST로 만든 뒤, 크랙 빌더가 쓰는 PATCH 구조로 원본 전체를 복원한다.
        if (isV2) {
            return createV2ByMinimalPostThenPatchFull(raw, visibility, options);
        }

        const tries = [{
            label: 'v1 기본 페이로드',
            payload: buildPayload(raw, visibility, options)
        }];

        let lastErr = null;
        for (const t of tries) {
            try {
                logPayloadSummary(raw, t.payload);
                const posted = await postStoryWithAutoTextLimit(t.payload, t.label);
                let restoreResult = null;
                if (posted.restoreAfterCreate) {
                    restoreResult = await patchRestoreCustomPrompt(posted.result, posted.restorePayload || t.payload, t.label);
                }
                return {
                    result: posted.result,
                    label: t.label,
                    fallback: false,
                    textLimited: posted.textLimited,
                    imageLimited: posted.imageLimited,
                    textLimitReport: posted.report || [],
                    restoreAfterCreate: !!posted.restoreAfterCreate,
                    restoreResult
                };
            } catch (err) {
                lastErr = err;
                if ([401, 403, 404, 429].includes(err.status)) break;
                console.warn(`${LOG} ${t.label} 실패`, err);
            }
        }
        throw lastErr || new Error('재게시 실패');
    }

    async function republish(storyId, visibility, adultOverride) {
        const adultLabel = adultOverride === true ? '언세이프티' : adultOverride === false ? '세이프티' : '원본 등급';
        toast(`${adultLabel}로 재게시 준비 중...`);
        try {
            const detail = await apiFetch('GET', `${API_BASE}/stories/me/${storyId}`, undefined, '스토리 조회');
            const raw = detail?.data || detail;
            const created = await createStory(raw, visibility, { adultOverride });

            const trimmedCount = created.textLimitReport?.length || 0;
            const restored = created.restoreResult?.attempted ? created.restoreResult.ok : null;
            if (created.restoreAfterCreate && restored === true) {
                const warn = created.restoreResult?.warning ? `
※ ${created.restoreResult.warning}` : '';
                toast(`✓ ${adultLabel} 재게시 완료!
v1 임시껍데기 생성 후
v2 원본 배치표/이미지/프롬프트 복원 완료했어요.${warn}`, 8200);
            } else if (created.restoreAfterCreate && restored === false) {
                toast(`△ ${adultLabel} 재게시는 됐는데
v2 원본 전체 복원은 실패했어요.
콘솔 로그를 확인해줘 ㅠㅠ`, 7600);
            } else if (created.textLimited || created.imageLimited) {
                toast(`✓ ${adultLabel} 재게시 완료!
서버 제한 항목 ${trimmedCount}개를 처리했어요.`, 5600);
            } else {
                toast(`✓ ${adultLabel} 재게시 완료!`);
            }

            // /my 목록 새로고침 유도
            window.history.pushState(null, '', window.location.href);
            window.dispatchEvent(new Event('popstate'));
        } catch (err) {
            console.error(`${LOG} 최종 에러:`, err);
            const msg = (err?.message || '알 수 없는 오류').slice(0, 220);
            toast('재게시 실패 ㅠㅠ\n' + msg, 5200);
        }
    }


    // ╔═══════════════════════════════════════════════════════╗
    // ║  6. 스토리 ID 추출                                    ║
    // ╚═══════════════════════════════════════════════════════╝

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
            console.warn(`${LOG} 메뉴에서 ID 추출 실패`, e);
        }
        return null;
    }


    // ╔═══════════════════════════════════════════════════════╗
    // ║  7. 메뉴 UI                                           ║
    // ╚═══════════════════════════════════════════════════════╝

    const MARKER = 'rp-injected';

    function createButton(label, onClick) {
        const btn = document.createElement('div');
        btn.className = 'rp-btn';
        btn.textContent = label;
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            onClick();
        });
        return btn;
    }

    function injectMenu() {
        if (!/^\/my(\/.*)?$/.test(location.pathname)) return;

        const popper = document.querySelector('div[data-radix-popper-content-wrapper]');
        if (!popper) return;

        const container = popper.querySelector('[role="menu"], [data-radix-menu-content]')
                          || popper.childNodes[0]?.childNodes[0];
        if (!container || container.hasAttribute(MARKER)) return;

        const info = getStoryInfoFromMenu();
        if (!info) return;

        container.setAttribute(MARKER, 'true');

        if (info.type && info.type !== 'story') {
            const d = document.createElement('div');
            d.className = 'rp-divider';
            container.appendChild(d);
            container.appendChild(createButton('⚠ 스토리만 재게시 가능', () => {
                toast('현재 스토리 타입만 지원해요!');
            }));
            return;
        }

        const divider = document.createElement('div');
        divider.className = 'rp-divider';
        container.appendChild(divider);

        const labelSafe = document.createElement('div');
        labelSafe.className = 'rp-label';
        labelSafe.textContent = '세이프티로 재게시';
        container.appendChild(labelSafe);

        container.appendChild(createButton('🟢 공개 / 세이프티', () => republish(info.id, 'public', false)));
        container.appendChild(createButton('🟢 비공개 / 세이프티', () => republish(info.id, 'private', false)));
        container.appendChild(createButton('🟢 링크 공개 / 세이프티', () => republish(info.id, 'linkonly', false)));

        const divider2 = document.createElement('div');
        divider2.className = 'rp-divider';
        container.appendChild(divider2);

        const labelUnsafe = document.createElement('div');
        labelUnsafe.className = 'rp-label';
        labelUnsafe.textContent = '언세이프티로 재게시';
        container.appendChild(labelUnsafe);

        container.appendChild(createButton('🔞 공개 / 언세이프티', () => republish(info.id, 'public', true)));
        container.appendChild(createButton('🔞 비공개 / 언세이프티', () => republish(info.id, 'private', true)));
        container.appendChild(createButton('🔞 링크 공개 / 언세이프티', () => republish(info.id, 'linkonly', true)));
    }


    // ╔═══════════════════════════════════════════════════════╗
    // ║  8. 초기화                                            ║
    // ╚═══════════════════════════════════════════════════════╝

    function init() {
        new MutationObserver(() => injectMenu()).observe(document.body, {
            childList: true,
            subtree: true
        });
        console.log(`${LOG} 로드 완료 v2.6.0`);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();

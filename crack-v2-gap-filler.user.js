// ==UserScript==
// @name         크랙 v2 빈칸 투명 채우기
// @namespace    https://crack.wrtn.ai
// @version      1.8.2
// @author       me
// @description  v2 이미지 배치표 빈 조합에 투명 이미지를 개별 업로드 (각 빈칸별 정확한 category/situation)
// @match        https://crack.wrtn.ai/*
// @grant        GM_addStyle
// @updateURL    https://raw.githubusercontent.com/bsei325/crack-republisher/main/crack-v2-gap-filler.user.js
// @downloadURL  https://raw.githubusercontent.com/bsei325/crack-republisher/main/crack-v2-gap-filler.user.js
// ==/UserScript==

(function () {
    'use strict';

    const API_BASE = 'https://crack-api.wrtn.ai/crack-api';
    const LOG = '[v2 빈칸 채우기]';

    const GITHUB_TRANSPARENT_STRIP_URL = 'https://raw.githubusercontent.com/bsei325/crack-republisher/main/transparent-strip-2000x4.png';
    const BUILTIN_TRANSPARENT_STRIP_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAB9AAAAAECAYAAADWMKTOAAAAQUlEQVR42u3ZQQEAIACEMLR/5zOIWwS+nG0BAAAAAAAAwO+uBAAAAAAAAABgoAMAAAAAAABAZaADAAAAAAAAQFUPFhYDBYINOjAAAAAASUVORK5CYII=';

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
                'name', 'keyword', 'title', 'label', 'value', 'text',
                'displayName', 'displayText', 'situation', 'category',
                'situationName', 'categoryName', 'situationKeyword',
                'categoryKeyword', 'imageKeyword', 'key'
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
        if (!used.has(base)) { used.add(base); return base; }
        for (let n = 2; n < 1000; n++) {
            const suffix = String(n);
            const candidate = `${base.slice(0, Math.max(1, 10 - suffix.length))}${suffix}`;
            if (!used.has(candidate)) { used.add(candidate); return candidate; }
        }
        return base;
    }

    function trimKeyword(value, fallback = '') {
        const s = extractV2Label(value, fallback, ['keyword', 'name']).trim();
        if (!s || isBadObjectString(s)) return fallback ? String(fallback).slice(0, 10) : '';
        return s.slice(0, 10);
    }

    function extractImageUrlFromValue(value) {
        if (!value) return '';
        if (typeof value === 'string') {
            const s = value.trim();
            return /^https?:\/\//i.test(s) ? s : '';
        }
        if (Array.isArray(value)) {
            for (const item of value) {
                const got = extractImageUrlFromValue(item);
                if (got) return got;
            }
            return '';
        }
        if (typeof value === 'object') {
            const keys = ['imageUrl', 'url', 'origin', 'original', 'src', 'path', 'fileUrl', 'downloadUrl', 'thumbnailUrl'];
            for (const key of keys) {
                if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
                const got = extractImageUrlFromValue(value[key]);
                if (got) return got;
            }
        }
        return '';
    }

    function extractSituationImageUrl(img) {
        return extractImageUrlFromValue(
            img?.imageUrl || img?.image || img?.imageFile || img?.file ||
            img?.uploadedImage || img?.resource || img?.url
        );
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
            .map((img, idx) => {
                const imageUrl = extractSituationImageUrl(img);
                if (!imageUrl) return null;
                const rawCat = extractV2Label(img?.category, '', ['name', 'category', 'label', 'keyword']);
                const rawSit = extractV2Label(img?.situation, '', ['keyword', 'name', 'situation', 'label']);
                return compactObject({
                    situation: rawSit ? getSit(rawSit, idx) : defaultSituation,
                    keyword: trimKeyword(img?.keyword, ''),
                    imageUrl,
                    category: rawCat ? getCat(rawCat, idx) : defaultCategory
                });
            })
            .filter(Boolean);

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

    // ─────────── 빈 조합 찾기 ───────────

    function getBaseSetId(set) {
        return getFirst(set?.baseSetId, set?.setId, set?._id, set?.id);
    }

    function findGapsPerSet(raw) {
        const result = [];
        const sets = Array.isArray(raw?.startingSets) ? raw.startingSets : [];

        for (const set of sets) {
            const baseSetId = getBaseSetId(set);
            if (!baseSetId) continue;

            const normalized = normalizeV2SetLabels(set);
            const categories = normalized.imageMatrix.categories;
            const situations = normalized.imageMatrix.situations;

            const existing = new Set();
            for (const img of normalized.situationImages) {
                const cat = img?.category ? String(img.category).slice(0, 10) : '';
                const sit = img?.situation ? String(img.situation).slice(0, 10) : '';
                if (cat && sit) existing.add(`${cat}|||${sit}`);
            }

            const gaps = [];
            for (const category of categories) {
                for (const situation of situations) {
                    if (!existing.has(`${category}|||${situation}`)) {
                        gaps.push({ category, situation });
                    }
                }
            }

            if (gaps.length > 0) {
                result.push({ baseSetId, setName: set?.name || '기본', gaps });
            }
        }

        return result;
    }

    // ─────────── 투명 이미지 준비 ───────────

    function base64ToBlob(base64, mimeType = 'image/png') {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return new Blob([bytes], { type: mimeType });
    }

    async function getTransparentStripBlob() {
        try {
            const res = await fetch(`${GITHUB_TRANSPARENT_STRIP_URL}?t=${Date.now()}`, {
                method: 'GET', cache: 'no-store', mode: 'cors'
            });
            if (res.ok) {
                const blob = await res.blob();
                if (blob && blob.size > 0) {
                    console.log(`${LOG} GitHub 투명 이미지 사용`, { size: blob.size });
                    return blob.type ? blob : new Blob([blob], { type: 'image/png' });
                }
            }
        } catch (e) {
            console.warn(`${LOG} GitHub fetch 실패, 내장 이미지 사용`, e);
        }
        const fallback = base64ToBlob(BUILTIN_TRANSPARENT_STRIP_PNG_BASE64, 'image/png');
        console.log(`${LOG} 내장 투명 이미지 사용`, { size: fallback.size });
        return fallback;
    }

    // ─────────── S3 업로드 ───────────

    async function putToS3(presignedUrl, blob) {
        // 시도 1: Content-Type 포함
        try {
            const res = await fetch(presignedUrl, {
                method: 'PUT', mode: 'cors', body: blob,
                headers: { 'Content-Type': 'image/png' }
            });
            if (res.ok) return true;
        } catch (_) {}

        // 시도 2: Content-Type 없이
        try {
            const res = await fetch(presignedUrl, {
                method: 'PUT', mode: 'cors', body: blob
            });
            if (res.ok) return true;
        } catch (_) {}

        return false;
    }

    // ─────────── 진행 상황 폴링 ───────────

    async function pollBulkProgress(bulkId, maxWaitSec = 30) {
        const pollUrl = `${API_BASE}/situation-images/presigned-urls/bulk/${bulkId}`;
        const start = Date.now();

        for (let i = 0; i < 15; i++) {
            const elapsed = (Date.now() - start) / 1000;
            if (elapsed > maxWaitSec) break;

            await new Promise(r => setTimeout(r, 2000));

            try {
                const res = await apiFetch('GET', pollUrl, undefined, `진행 폴링 ${i + 1}`);
                const sets = res?.data?.startingSets || [];
                let allDone = true;

                for (const set of sets) {
                    const p = set?.progress;
                    if (p) {
                        console.log(`${LOG} 진행: ${set.baseSetId} → 성공 ${p.successCount}/${p.totalCount}, 에러 ${p.errorCount}`);
                        if (p.successCount + p.errorCount < p.totalCount) allDone = false;
                    }
                }

                if (allDone && sets.length > 0) {
                    console.log(`${LOG} ✓ 모든 업로드 처리 완료`);
                    return true;
                }
            } catch (err) {
                console.log(`${LOG} 진행 폴링 ${err?.status || '에러'}`, err?.message);
                // 404면 이 엔드포인트 없음 → 폴링 포기
                if (err?.status === 404) {
                    console.warn(`${LOG} 진행 폴링 엔드포인트 없음, 시간 대기로 전환`);
                    await new Promise(r => setTimeout(r, 8000));
                    return false;
                }
            }
        }

        console.warn(`${LOG} 폴링 타임아웃 (${maxWaitSec}초)`);
        return false;
    }

    // ─────────── 핵심: 빈칸별 개별 업로드 ───────────

    function getStorySourceId(raw, storyId) {
        return raw?._id || raw?.id || raw?.sourceId || storyId;
    }

    async function uploadGapsWithTransparent(raw, storyId, gapsPerSet, blob) {
        const sourceId = getStorySourceId(raw, storyId);
        if (!sourceId) throw new Error('sourceId를 못 찾았어요.');

        // 모든 세트의 빈칸을 하나의 bulk 요청에 넣기
        // uploads = 유니크한 category/situation 조합들
        const uniqueGaps = new Map();
        for (const { gaps } of gapsPerSet) {
            for (const g of gaps) {
                const key = `${g.category}|||${g.situation}`;
                if (!uniqueGaps.has(key)) {
                    uniqueGaps.set(key, { fileType: 'png', category: g.category, situation: g.situation });
                }
            }
        }

        const uploads = Array.from(uniqueGaps.values());
        const startingSets = gapsPerSet.map(g => ({ baseSetId: g.baseSetId }));

        console.log(`${LOG} 개별 빈칸 업로드 요청`, {
            sourceId,
            uploadsCount: uploads.length,
            setsCount: startingSets.length,
            uploads: uploads.slice(0, 10) // 처음 10개만 로그
        });

        const bulkPayload = { sourceId, uploads, startingSets };

        const bulkRes = await apiFetch(
            'POST',
            `${API_BASE}/situation-images/presigned-urls/bulk`,
            bulkPayload,
            '빈칸별 presigned bulk'
        );

        console.log(`${LOG} presigned bulk 응답`, {
            result: bulkRes?.result,
            bulkId: bulkRes?.data?.bulkId,
            setsCount: bulkRes?.data?.startingSets?.length
        });

        const bulkId = bulkRes?.data?.bulkId;
        const responseSets = bulkRes?.data?.startingSets || [];

        // 모든 presigned URL에 투명 이미지 PUT + final URL 수집
        let putCount = 0;
        let putFail = 0;

        // ★ baseSetId별로 {category|||situation → finalUrl} 수집
        const uploadedUrlMap = new Map(); // baseSetId → Map<"cat|||sit", url>

        for (const setResult of responseSets) {
            const baseSetId = setResult?.baseSetId || '';
            const uploadsArr = setResult?.uploads || [];
            const rejected = setResult?.rejected || [];

            if (rejected.length) {
                console.warn(`${LOG} 거부된 업로드`, { baseSetId, rejected });
            }

            if (!uploadedUrlMap.has(baseSetId)) {
                uploadedUrlMap.set(baseSetId, new Map());
            }
            const setUrlMap = uploadedUrlMap.get(baseSetId);

            for (const upload of uploadsArr) {
                const presignedUrl = upload?.url;
                if (!presignedUrl) continue;

                const ok = await putToS3(presignedUrl, blob);
                if (ok) {
                    putCount++;
                    const finalUrl = String(presignedUrl).split('?')[0];
                    const cat = upload?.category || '';
                    const sit = upload?.situation || '';
                    if (cat && sit) {
                        setUrlMap.set(`${cat}|||${sit}`, finalUrl);
                    }
                    console.log(`${LOG} S3 PUT 성공`, { baseSetId, cat, sit, finalUrl: finalUrl.slice(-40) });
                } else {
                    putFail++;
                    console.error(`${LOG} S3 PUT 실패`, {
                        category: upload?.category,
                        situation: upload?.situation
                    });
                }
            }
        }

        console.log(`${LOG} S3 PUT 결과: 성공 ${putCount}, 실패 ${putFail}`);

        if (putCount === 0) {
            throw new Error('S3 업로드가 전부 실패했어요.');
        }

        // 서버 처리 대기 + 폴링
        if (bulkId) {
            toast(`S3 업로드 ${putCount}개 완료, 서버 처리 대기 중...`, 8000);
            await pollBulkProgress(bulkId, 30);
        } else {
            toast('서버 처리 대기 중...', 5000);
            await new Promise(r => setTimeout(r, 8000));
        }

        return { putCount, putFail, bulkId, uploadedUrlMap };
    }

    // ─────────── PATCH용 빌더 (이전과 동일) ───────────

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
            name: p?.name, colorHexCode: p?.colorHexCode, iconUrl: p?.iconUrl,
            initialValue: p?.initialValue, min: p?.min, max: p?.max,
            prompt: p?.prompt, unit: p?.unit
        };
        if (Array.isArray(p?.levels) && p.levels.length) {
            r.levels = p.levels.map(l => ({
                name: l?.name, levelMinValue: l?.levelMinValue,
                levelMaxValue: l?.levelMaxValue, levelPrompt: l?.levelPrompt
            }));
        }
        return compactObject(r);
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

    function buildPatchPayload(raw, uploadedUrlMap) {
        const startingSets = (Array.isArray(raw?.startingSets) ? raw.startingSets : [])
            .map(set => {
                const baseSetId = getBaseSetId(set);
                const normalized = normalizeV2SetLabels(set);
                const categories = normalized.imageMatrix.categories;
                const situations = normalized.imageMatrix.situations;
                const images = [...normalized.situationImages];

                // ★ 빈칸에 업로드된 URL 채워넣기
                const existing = new Set();
                for (const img of images) {
                    const cat = img?.category ? String(img.category).slice(0, 10) : '';
                    const sit = img?.situation ? String(img.situation).slice(0, 10) : '';
                    if (cat && sit) existing.add(`${cat}|||${sit}`);
                }

                const setUrlMap = uploadedUrlMap?.get(baseSetId);
                let added = 0;

                for (const category of categories) {
                    for (const situation of situations) {
                        const key = `${category}|||${situation}`;
                        if (existing.has(key)) continue;

                        // 이 빈칸에 맞는 업로드된 URL 찾기
                        const url = setUrlMap?.get(key);
                        if (url) {
                            images.push({
                                situation,
                                keyword: '',
                                imageUrl: url,
                                category
                            });
                            existing.add(key);
                            added++;
                        }
                    }
                }

                console.log(`${LOG} 세트 ${set?.name || baseSetId}: 기존 ${normalized.situationImages.length}개 + 추가 ${added}개 = ${images.length}개`);

                return compactObject({
                    baseSetId,
                    name: set?.name || '기본 설정',
                    initialMessages: Array.isArray(set?.initialMessages) ? set.initialMessages : [],
                    situationPrompt: set?.situationPrompt || '',
                    replySuggestions: Array.isArray(set?.replySuggestions) ? set.replySuggestions : [],
                    situationImages: images,
                    keywordBook: buildKeywordBook(set?.keywordBook),
                    parameters: Array.isArray(set?.parameters) ? set.parameters.map(buildParam) : [],
                    imageMatrix: normalized.imageMatrix,
                    ...(typeof set?.playGuide === 'string' && set.playGuide.trim() ? { playGuide: set.playGuide } : {})
                });
            });

        const totalAdded = startingSets.reduce((sum, s) => {
            const orig = (Array.isArray(raw?.startingSets) ? raw.startingSets : [])
                .find(os => getBaseSetId(os) === s.baseSetId);
            const origCount = Array.isArray(orig?.situationImages) ? orig.situationImages.length : 0;
            return sum + (s.situationImages.length - origCount);
        }, 0);

        return {
            payload: compactObject({
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
            }),
            totalAdded
        };
    }

    // ─────────── 메인 실행 ───────────

    async function fillStoryGaps(storyId) {
        toast('v2 이미지 배치표 확인 중...');
        try {
            // 1. 스토리 조회
            const detail = await apiFetch('GET', `${API_BASE}/stories/me/${storyId}`, undefined, '스토리 조회');
            const raw = detail?.data;
            if (!raw) throw new Error('스토리 데이터를 못 가져왔어요.');
            if (raw.situationImageVersion !== 'v2') {
                toast('이 스토리는 v2 이미지 배치표가 아니에요.', 3600);
                return;
            }

            // 2. 빈 조합 찾기
            const gapsPerSet = findGapsPerSet(raw);
            const totalGaps = gapsPerSet.reduce((sum, g) => sum + g.gaps.length, 0);

            console.log(`${LOG} 빈 조합 분석`, {
                sets: gapsPerSet.map(g => ({
                    baseSetId: g.baseSetId,
                    setName: g.setName,
                    gapsCount: g.gaps.length,
                    gaps: g.gaps.slice(0, 5) // 처음 5개만
                })),
                totalGaps
            });

            if (totalGaps === 0) {
                toast('채울 빈칸이 없어요.\n이미 모든 조합에 이미지가 있어요.', 4200);
                return;
            }

            // 3. 투명 이미지 준비
            toast(`빈 조합 ${totalGaps}개 발견! 투명 이미지 준비 중...`, 4000);
            const blob = await getTransparentStripBlob();

            // 4. ★ 각 빈칸의 정확한 category/situation으로 개별 업로드
            toast(`투명 이미지를 빈칸 ${totalGaps}개에 업로드 중...`, 10000);
            const uploadResult = await uploadGapsWithTransparent(raw, storyId, gapsPerSet, blob);

            // 5. 업로드 후 스토리 재조회
            toast('서버 반영 확인 중...', 3000);
            await new Promise(r => setTimeout(r, 2000));
            const freshDetail = await apiFetch('GET', `${API_BASE}/stories/me/${storyId}`, undefined, '스토리 재조회');
            const freshRaw = freshDetail?.data || raw;

            // 6. ★ 업로드된 URL을 빈칸에 채워서 PATCH 페이로드 만들기
            const { payload, totalAdded } = buildPatchPayload(freshRaw, uploadResult.uploadedUrlMap);

            console.log(`${LOG} PATCH payload 요약`, {
                storyId,
                totalAdded,
                startingSetsCount: payload?.startingSets?.length,
                situationImagesCount: payload?.startingSets?.map(s => s?.situationImages?.length)
            });

            if (totalAdded <= 0) {
                toast('채울 빈칸이 없거나 업로드 URL 매칭에 실패했어요.', 4200);
                return;
            }

            // 7. ★ 무조건 PATCH
            toast(`빈칸 ${totalAdded}개를 채워서 저장 중...`, 5000);

            // PATCH 재시도
            let patchSuccess = false;
            for (let attempt = 1; attempt <= 5; attempt++) {
                try {
                    await apiFetch('PATCH', `${API_BASE}/stories/${storyId}/v2`, payload, `PATCH ${attempt}`);
                    patchSuccess = true;
                    break;
                } catch (err) {
                    const msg = String(err?.message || '');
                    console.warn(`${LOG} PATCH 재시도 ${attempt}`, msg);
                    if (attempt < 5 && (msg.includes('업로드') || msg.includes('완료') || err?.status === 400)) {
                        toast(`서버 처리 대기 중... (${attempt}/5)`, 3000);
                        await new Promise(r => setTimeout(r, 3000 * attempt));
                    } else {
                        throw err;
                    }
                }
            }

            if (patchSuccess) {
                toast(`✓ 완료!\n빈 조합 ${totalAdded}개를 투명 이미지로 채우고 저장했어요.`, 5600);
            }
        } catch (err) {
            console.error(`${LOG} 실패`, err);
            const errMsg = String(err?.message || err).slice(0, 240);
            toast('실패 ㅠㅠ\n' + errMsg, 8000);
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
                    return { id: ch.props.content.sourceId, type: ch.props.content.type || 'story' };
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

        container.appendChild(createButton('🧩 빈칸 투명 이미지 자동 채우기', () => fillStoryGaps(info.id)));
    }

    function init() {
        new MutationObserver(() => injectMenu()).observe(document.body, {
            childList: true,
            subtree: true
        });
        console.log(`${LOG} 로드 완료 v1.8.2`);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();

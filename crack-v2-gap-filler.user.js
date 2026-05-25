// ==UserScript==
// @name         크랙 v2 빈칸 투명 채우기
// @namespace    https://crack.wrtn.ai
// @version      1.6.0
// @author       me
// @description  GitHub 투명 이미지를 크랙에 자동 업로드한 뒤 v2 이미지 배치표 빈칸을 자동 채움
// @match        https://crack.wrtn.ai/*
// @grant        GM_addStyle
// @updateURL    https://raw.githubusercontent.com/bsei325/crack-republisher/main/crack-v2-gap-filler.user.js
// @downloadURL  https://raw.githubusercontent.com/bsei325/crack-republisher/main/crack-v2-gap-filler.user.js
// ==/UserScript==

(function () {
    'use strict';

    const API_BASE = 'https://crack-api.wrtn.ai/crack-api';
    const LOG = '[v2 빈칸 채우기]';

    // GitHub에 올려둔 투명 strip 이미지. 실패하면 내장된 투명 strip PNG로 대체한다.
    const GITHUB_TRANSPARENT_STRIP_URL = 'https://raw.githubusercontent.com/bsei325/crack-republisher/main/transparent-strip-2000x4.png';
    const TRANSPARENT_UPLOAD_CATEGORY = '투명';
    const TRANSPARENT_UPLOAD_SITUATION = '빈칸';
    const BUILTIN_TRANSPARENT_STRIP_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAB9AAAAAECAYAAADWMKTOAAAAQUlEQVR42u3ZQQEAIACEMLR/5zOIWwS+nG0BAAAAAAAAwO+uBAAAAAAAAABgoAMAAAAAAABAZaADAAAAAAAAQFUPFhYDBYINOjAAAAAASUVORK5CYII=';

    // 외부 이미지 URL은 크랙 서버가 막을 수 있어서 사용하지 않는다.
    // 스토리 안에 이미 업로드되어 있는 투명/공백/strip 이미지를 자동 감지해서 그 URL을 재사용한다.

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

    function extractImageUrlFromValue(value) {
        if (!value) return '';

        if (typeof value === 'string') {
            const s = value.trim();
            // 크랙 PATCH는 blob/data/raw가 아니라 업로드 완료된 http(s) URL만 안정적으로 받는다.
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
            const keys = [
                'imageUrl',
                'url',
                'origin',
                'original',
                'src',
                'path',
                'fileUrl',
                'downloadUrl',
                'thumbnailUrl'
            ];

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
            img?.imageUrl ||
            img?.image ||
            img?.imageFile ||
            img?.file ||
            img?.uploadedImage ||
            img?.resource ||
            img?.url
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

    function fillMissingCellsWithTransparent(set, placeholderUrl) {
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
                    imageUrl: placeholderUrl,
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

    function buildPatchStartingSet(set, placeholderUrl) {
        const filled = fillMissingCellsWithTransparent(set, placeholderUrl);

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

        if (typeof set?.playGuide === 'string' && set.playGuide.trim()) {
            out.playGuide = set.playGuide;
        }

        return { set: out, added: filled.added };
    }

    function buildPatchPayload(raw, placeholderUrlByBaseSetId) {
        const fallbackUrl = placeholderUrlByBaseSetId instanceof Map
            ? (placeholderUrlByBaseSetId.get('__default') || Array.from(placeholderUrlByBaseSetId.values())[0])
            : placeholderUrlByBaseSetId;

        const setResults = (Array.isArray(raw?.startingSets) ? raw.startingSets : [])
            .map(set => {
                const baseSetId = getBaseSetId(set);
                const url = placeholderUrlByBaseSetId instanceof Map
                    ? (placeholderUrlByBaseSetId.get(baseSetId) || fallbackUrl)
                    : fallbackUrl;
                return buildPatchStartingSet(set, url);
            });
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

    
    function labelLooksTransparent(choice) {
        return /투명|빈칸|공백|blank|transparent|strip|spacer|empty|틈/i.test(
            `${choice.combo} ${choice.keyword} ${choice.setName}`
        );
    }

    function collectExistingImageChoices(raw) {
        const choices = [];
        const seen = new Set();
        const sets = Array.isArray(raw?.startingSets) ? raw.startingSets : [];

        sets.forEach((set, setIndex) => {
            const normalized = normalizeV2SetLabels(set);
            (normalized.situationImages || []).forEach((img, imageIndex) => {
                const imageUrl = extractSituationImageUrl(img);
                if (!imageUrl) return;

                const category = img.category ? String(img.category).slice(0, 10) : '';
                const situation = img.situation ? String(img.situation).slice(0, 10) : '';
                const keyword = img.keyword ? String(img.keyword).slice(0, 10) : '';
                const combo = `${category}_${situation}`;
                const dedupe = `${combo}|||${imageUrl}`;

                if (seen.has(dedupe)) return;
                seen.add(dedupe);

                choices.push({
                    setName: set?.name || `세트${setIndex + 1}`,
                    category,
                    situation,
                    keyword,
                    combo,
                    imageUrl,
                    setIndex,
                    imageIndex
                });
            });
        });

        return choices;
    }

    function getImageSize(url, timeoutMs = 4500) {
        return new Promise(resolve => {
            const img = new Image();
            let done = false;

            const finish = result => {
                if (done) return;
                done = true;
                resolve(result);
            };

            const timer = setTimeout(() => finish(null), timeoutMs);

            img.onload = () => {
                clearTimeout(timer);
                finish({
                    width: img.naturalWidth || img.width || 0,
                    height: img.naturalHeight || img.height || 0
                });
            };
            img.onerror = () => {
                clearTimeout(timer);
                finish(null);
            };
            img.src = url;
        });
    }

    async function pickPlaceholderChoiceAuto(raw) {
        const choices = collectExistingImageChoices(raw);
        if (!choices.length) return null;

        const labeled = choices.find(labelLooksTransparent);
        if (labeled) {
            labeled.detectReason = 'label';
            return labeled;
        }

        const inspected = [];
        for (const choice of choices.slice(0, 120)) {
            const size = await getImageSize(choice.imageUrl);
            if (!size || !size.width || !size.height) continue;

            const longSide = Math.max(size.width, size.height);
            const shortSide = Math.max(1, Math.min(size.width, size.height));
            const ratio = longSide / shortSide;

            inspected.push({
                ...choice,
                width: size.width,
                height: size.height,
                ratio
            });
        }

        inspected.sort((a, b) => b.ratio - a.ratio);

        const strip = inspected.find(item => {
            const longSide = Math.max(item.width, item.height);
            const shortSide = Math.min(item.width, item.height);
            return longSide >= 80 && shortSide <= 30 && item.ratio >= 8;
        });

        if (strip) {
            strip.detectReason = 'size';
            return strip;
        }

        console.warn(`${LOG} 투명 이미지 자동 감지 실패`, { choices, inspected });
        return null;
    }


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
                method: 'GET',
                cache: 'no-store',
                mode: 'cors'
            });
            if (res.ok) {
                const blob = await res.blob();
                if (blob && blob.size > 0) {
                    console.log(`${LOG} GitHub 투명 이미지 사용`, { size: blob.size, type: blob.type });
                    return blob.type ? blob : new Blob([blob], { type: 'image/png' });
                }
            }
            console.warn(`${LOG} GitHub 투명 이미지 fetch 실패`, res.status);
        } catch (e) {
            console.warn(`${LOG} GitHub 투명 이미지 fetch 에러, 내장 이미지 사용`, e);
        }

        const fallback = base64ToBlob(BUILTIN_TRANSPARENT_STRIP_PNG_BASE64, 'image/png');
        console.log(`${LOG} 내장 투명 이미지 사용`, { size: fallback.size, type: fallback.type });
        return fallback;
    }

    function getStorySourceId(raw, storyId) {
        return raw?._id || raw?.id || raw?.sourceId || storyId;
    }

    function getPatchableStartingSetIds(raw) {
        const ids = [];
        const seen = new Set();
        for (const set of (Array.isArray(raw?.startingSets) ? raw.startingSets : [])) {
            const baseSetId = getBaseSetId(set);
            if (!baseSetId || seen.has(baseSetId)) continue;
            seen.add(baseSetId);
            ids.push(baseSetId);
        }
        return ids;
    }

    function parsePresignedUploads(bulkResponse) {
        const map = new Map();
        const startingSets = Array.isArray(bulkResponse?.data?.startingSets)
            ? bulkResponse.data.startingSets
            : [];

        for (const setResult of startingSets) {
            const baseSetId = setResult?.baseSetId;
            const upload = Array.isArray(setResult?.uploads) ? setResult.uploads[0] : null;
            const presignedUrl = upload?.url;

            if (!baseSetId || !presignedUrl) continue;

            map.set(baseSetId, {
                baseSetId,
                uploadId: upload?._id,
                presignedUrl,
                finalUrl: String(presignedUrl).split('?')[0],
                category: upload?.category || TRANSPARENT_UPLOAD_CATEGORY,
                situation: upload?.situation || TRANSPARENT_UPLOAD_SITUATION
            });
        }

        return map;
    }

    async function putToS3PresignedUrl(presignedUrl, blob) {
        async function attempt(withContentType) {
            const opts = {
                method: 'PUT',
                mode: 'cors',
                body: blob
            };
            if (withContentType) {
                opts.headers = { 'Content-Type': 'image/png' };
            }

            const res = await fetch(presignedUrl, opts);
            if (!res.ok) {
                let body = '';
                try { body = await res.text(); } catch (_) {}
                throw new Error(`S3 PUT 실패 ${res.status} ${body.slice(0, 180)}`);
            }
            return res;
        }

        try {
            return await attempt(true);
        } catch (firstErr) {
            console.warn(`${LOG} Content-Type 포함 PUT 실패, 무헤더로 재시도`, firstErr);
            return await attempt(false);
        }
    }

    async function uploadTransparentToCrack(raw, storyId) {
        const sourceId = getStorySourceId(raw, storyId);
        const baseSetIds = getPatchableStartingSetIds(raw);

        if (!sourceId) throw new Error('sourceId를 못 찾았어요.');
        if (!baseSetIds.length) throw new Error('startingSet baseSetId를 못 찾았어요.');

        const bulkPayload = {
            sourceId,
            uploads: [{
                fileType: 'png',
                category: TRANSPARENT_UPLOAD_CATEGORY,
                situation: TRANSPARENT_UPLOAD_SITUATION
            }],
            startingSets: baseSetIds.map(baseSetId => ({ baseSetId }))
        };

        console.log(`${LOG} presigned bulk 요청`, bulkPayload);

        const bulkResponse = await apiFetch(
            'POST',
            `${API_BASE}/situation-images/presigned-urls/bulk`,
            bulkPayload,
            '투명 이미지 presigned bulk'
        );

        const uploadMap = parsePresignedUploads(bulkResponse);
        if (!uploadMap.size) {
            console.error(`${LOG} presigned bulk 응답 파싱 실패`, bulkResponse);
            throw new Error('투명 이미지 업로드 URL을 못 받았어요.');
        }

        const blob = await getTransparentStripBlob();
        const finalUrlByBaseSetId = new Map();

        for (const [baseSetId, info] of uploadMap.entries()) {
            console.log(`${LOG} S3 PUT 시작`, {
                baseSetId,
                uploadId: info.uploadId,
                finalUrl: info.finalUrl
            });

            await putToS3PresignedUrl(info.presignedUrl, blob);
            finalUrlByBaseSetId.set(baseSetId, info.finalUrl);
        }

        if (!finalUrlByBaseSetId.size) {
            throw new Error('투명 이미지 업로드에 실패했어요.');
        }

        finalUrlByBaseSetId.set('__default', Array.from(finalUrlByBaseSetId.values())[0]);
        return finalUrlByBaseSetId;
    }

    async function patchWithRetry(storyId, payload, maxTries = 5) {
        let lastErr = null;

        for (let attempt = 1; attempt <= maxTries; attempt++) {
            try {
                return await apiFetch('PATCH', `${API_BASE}/stories/${storyId}/v2`, payload, `투명 빈칸 PATCH ${attempt}`);
            } catch (err) {
                lastErr = err;
                const msg = String(err?.message || '');
                const retryable =
                    msg.includes('업로드') ||
                    msg.includes('완료') ||
                    msg.includes('상황 이미지') ||
                    err?.status === 400;

                if (!retryable || attempt === maxTries) throw err;

                console.warn(`${LOG} PATCH 재시도 대기`, { attempt, message: msg });
                toast(`업로드 반영 대기 중... (${attempt}/${maxTries})`, 2600);
                await new Promise(resolve => setTimeout(resolve, 1200 * attempt));
            }
        }

        throw lastErr || new Error('PATCH 실패');
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

            toast('투명 이미지를 크랙에 자동 업로드 중...', 5000);
            const placeholderUrlByBaseSetId = await uploadTransparentToCrack(raw, storyId);

            const { payload, added } = buildPatchPayload(raw, placeholderUrlByBaseSetId);

            console.log(`${LOG} PATCH payload`, {
                storyId,
                added,
                placeholderUrlByBaseSetId: Object.fromEntries(placeholderUrlByBaseSetId),
                payload
            });

            if (added <= 0) {
                toast('채울 빈칸이 없어요.\n이미 모든 조합에 이미지가 있어요.', 4200);
                return;
            }

            toast(`빈칸 ${added}개를 투명 이미지로 채우는 중...`, 5000);
            await patchWithRetry(storyId, payload, 5);

            toast(`✓ 완료!\nGitHub 투명 이미지 업로드 후 빈 조합 ${added}개를 자동으로 채웠어요.`, 5600);
        } catch (err) {
            console.error(`${LOG} 실패`, err);
            toast('실패 ㅠㅠ\n' + String(err?.message || err).slice(0, 240), 8000);
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

        container.appendChild(createButton('🧩 GitHub 투명 이미지로 자동 채우기', () => fillStoryGaps(info.id)));
    }

    function init() {
        new MutationObserver(() => injectMenu()).observe(document.body, {
            childList: true,
            subtree: true
        });
        console.log(`${LOG} 로드 완료 v1.6.0`);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();

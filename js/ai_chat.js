/**
 * ai_chat.js — Gemini AI 통합 모듈 (설계자문 / NG분석 / 단면최적화)
 * Models: auto / gemini-2.5-pro / gemini-2.5-flash / gemini-3.1-pro
 */

(function () {
    const MODEL_NAMES = {
        auto: 'Auto (권장)',
        'gemini-2.5-pro': 'Gemini 2.5 Pro',
        'gemini-2.5-flash': 'Gemini 2.5 Flash',
        'gemini-3.1-pro': 'Gemini 3.1 Pro'
    };

    function getSelectedModel() {
        const sel = document.getElementById('geminiModelSelect');
        return sel ? sel.value : 'auto';
    }

    function getModelDisplayName(model) {
        return MODEL_NAMES[model] || model;
    }

    function updateSelectedModelBadge() {
        const badgeText = document.getElementById('aiModelBadgeText');
        if (badgeText) badgeText.textContent = getModelDisplayName(getSelectedModel());
        if (chatModelStatus) {
            chatModelStatus.textContent = `선택 모델: ${getModelDisplayName(getSelectedModel())}`;
            chatModelStatus.style.display = 'block';
            chatModelStatus.style.color = 'var(--text-dim)';
        }
    }

    function resolveTaskModel(task) {
        const selected = getSelectedModel();
        if (selected !== 'auto') return selected;
        return 'gemini-2.5-pro';
    }

    function getGeminiUrl(model) {
        return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    }

    const chatContainer = document.getElementById('aiChatMessages');
    const chatModelStatus = document.getElementById('aiChatModelStatus');
    const btnSend = document.getElementById('btnAIChatSend');
    const inputMessage = document.getElementById('aiChatInput');
    const apiKeyInput = document.getElementById('geminiApiKey');

    let chatHistory = [];
    let contextCache = { key: '', text: '', json: '' };
    let lastChatContextKey = '';

    // ========== 모델 선택 변경 시 배지 업데이트 ==========
    const modelSelect = document.getElementById('geminiModelSelect');
    if (modelSelect) {
        modelSelect.addEventListener('change', updateSelectedModelBadge);
    }
    updateSelectedModelBadge();

    // ========== 서브탭 전환 로직 ==========
    const subTabs = document.querySelectorAll('.ai-sub-tab');
    const subContents = document.querySelectorAll('.ai-sub-content');

    subTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            if (tab.disabled) return;
            const target = tab.dataset.aisub;

            subTabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            subContents.forEach(c => {
                c.style.display = 'none';
                c.classList.remove('active');
            });
            const targetEl = document.getElementById(target);
            if (targetEl) {
                targetEl.style.display = 'flex';
                targetEl.classList.add('active');
            }
        });
    });

    // ========== 공통 API 호출 헬퍼 ==========
    function getApiKey() {
        const key = apiKeyInput ? apiKeyInput.value.trim() : '';
        if (!key) alert('헤더의 Gemini API Key를 먼저 입력해주세요.');
        return key;
    }

    async function callGemini(apiKey, contents, model) {
        const response = await fetch(`${getGeminiUrl(model)}?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents })
        });
        if (!response.ok) throw new Error(`API 오류: ${response.status}`);
        const data = await response.json();
        return data.candidates[0].content.parts[0].text;
    }

    async function callGeminiForTask(apiKey, contents, task, options = {}) {
        const primaryModel = resolveTaskModel(task);
        if (typeof options.onModelAttempt === 'function') {
            options.onModelAttempt(primaryModel, { fallback: false });
        }
        try {
            return {
                text: await callGemini(apiKey, contents, primaryModel),
                model: primaryModel,
                fallbackUsed: false
            };
        } catch (error) {
            const isAuto = getSelectedModel() === 'auto';
            const canFallback = isAuto && primaryModel !== 'gemini-2.5-flash' && /429|RESOURCE_EXHAUSTED/i.test(error.message || '');
            if (!canFallback) throw error;
            if (typeof options.onModelAttempt === 'function') {
                options.onModelAttempt('gemini-2.5-flash', { fallback: true, failedModel: primaryModel });
            }

            return {
                text: await callGemini(apiKey, contents, 'gemini-2.5-flash'),
                model: 'gemini-2.5-flash',
                fallbackUsed: true
            };
        }
    }

    // ========== 1. 설계자문 채팅 ==========
    const systemPrompt = [
        '너는 대한민국 항만·어항 설계기준(KDS 64 00 00) 기반의 항만 구조 설계 자문 AI다.',
        '답변과 최적화 제안은 공학적 자문으로 제시하고 최종 결정은 담당 기술자 검토·승인을 전제로 한다.',
        'NG가 있으면 안정성 확보와 경제성을 함께 고려한 보완안을 수치와 함께 제안한다.',
        '기본 답변은 짧고 실무적으로 작성한다. 사용자가 길게 요청하지 않으면 6~10문장 또는 짧은 bullet 위주로 끝낸다.',
        '현재 결과에서 직접 읽히는 사실, 가장 취약한 항목, 필요한 조치만 우선 말하고 일반론과 반복 문구는 줄인다.',
        '표나 목록이 꼭 필요할 때만 쓰고, 같은 기준값이나 면책성 문구를 반복하지 않는다.',
        '하중조합은 상시 비계류, 상시 계류(견인력 적용 시), 지진시로 구분한다. 견인력 미적용 시 8조합(상시4+지진4), 적용 시 12조합(비계류4+계류4+지진4)이다.',
        '활동, 전도, 직선활동 기준은 상시 1.2 이상, 지진시 1.1 이상이며 다른 기준을 임의 적용하지 않는다.',
        '폭 또는 높이 증대 효과를 설명할 때는 자중 증가, 저항모멘트 증가, 마찰저항 증가, 지지폭 증가처럼 실제 유리 메커니즘으로만 설명한다.',
        '관성력 증가는 일반적으로 지진시 불리한 효과이므로 안정성 보강 효과처럼 서술하지 않는다.',
        '지지력은 종래식 하중분산법 결과인 p1, p1\', qta, qa와 참고 편심(e)으로만 설명하고 FS_br 같은 임의 식은 만들지 않는다.',
        '가상배면 해측 뒤채움사석은 구조물 자중과 지진관성력에 포함된 것으로 해석한다.',
        '원호활동은 별도 지반해석 항목으로 취급하고, 현재 결과에 없으면 값을 추정하지 않는다.',
        '주어진 결과와 문서 범위를 벗어나는 기준값이나 판정식을 추측하지 않는다.'
    ].join(' ');

    const strictSystemPrompt = [
        'You are a Korean harbor-structure design advisory assistant.',
        'Answer in Korean.',
        'Use only the current stability-review context in CTX_TEXT and CTX_JSON.',
        'Treat CTX_JSON as the primary numeric source when both are present.',
        'If CTX_JSON includes a critical ranking, use that ranking instead of recomputing critical cases yourself.',
        'Ignore older answers when they conflict with the current context.',
        'Default style: short, practical, and directly tied to the current results.',
        'Do not use markdown tables unless the user explicitly asks for a table.',
        'Do not produce long reports unless the user explicitly asks for detail.',
        'Copy values exactly from the provided context. Do not invent, swap, or paraphrase numbers loosely.',
        'For bearing checks, explain only with p1, p1\\\', qta, qa, and eccentricity e.',
        'Do not introduce qmax, FS_br, or any other bearing metric that is not in the current context.',
        'Load cases 1-4 are normal and 5-8 are seismic.',
        'Sliding, overturning, and base sliding criteria are 1.2 for normal and 1.1 for seismic.',
        'Bearing passes when p1<=qta and p1\\\'<=qa.',
        'Virtual-backfill seaside rubble is included as structural self-weight and seismic inertia.',
        'Circular slip is a separate geotechnical check. If not in the current results, say it is not available.',
        'Do not suggest section changes unless the user explicitly asks for a design recommendation.',
        'If the user asks how to improve one check while avoiding overdesign in other checks, explain which variables affect the target check most directly, what side effects they have on the other checks, and which options are the most selective and economical first.',
        'Unless the user asks for exact dimensions, keep such optimization advice qualitative and mechanism-based rather than inventing specific sizes.',
        'If a value is missing, say "현재 결과에서 확인 불가".'
    ].join(' ');

    function isTradeoffOptimizationQuestion(userText) {
        const text = userText || '';
        return /(최적화|개선|증가|올리|높이|키우|줄이|낮추|방안|방향|조정)/i.test(text) &&
            /(활동|전도|직선활동|지지력|bearing)/i.test(text) &&
            /(유지|충분|과설계|과도|너무 높|너무 크|동시에|대신|하면서|말고|않게)/i.test(text);
    }

    function buildChatStyleGuide(userText) {
        const wantsTable = /표로|테이블|table/i.test(userText || '');
        const wantsDetail = /상세|자세|길게|보고서|자문서|근거를 자세히|자세히 설명/i.test(userText || '');
        const wantsTradeoffAdvice = isTradeoffOptimizationQuestion(userText);
        const maxUnits = wantsDetail ? 8 : 5;
        const rules = [
            'Start with the answer immediately. No intro or closing filler.',
            wantsTable ? 'If you use a table, keep it very compact.' : 'Do not use markdown tables.',
            `Keep the answer within ${maxUnits} short sentences or lines unless the user explicitly asks for more.`,
            'Do not repeat obvious statements such as "all cases pass" more than once.',
            'When listing critical load cases, include only the requested cases and requested metrics.',
            'If CTX_JSON contains critical ranking data, copy that order directly.',
            'Prefer one-line case summaries such as: C8: 활동 1.13 / 전도 1.47 / 직선활동 1.13 / p1 328.6 <= qta 600 / p1\\\' 138.1 <= qa 600.',
            'Do not add design recommendations unless the user explicitly asks for them.'
        ];
        if (wantsTradeoffAdvice) {
            rules.push('For tradeoff-style design questions, structure the answer as: 1) target check and why it governs, 2) the most selective improvement options first, 3) what to avoid because it mainly increases already-sufficient checks.');
            rules.push('When comparing options, prefer mechanism-based explanations such as increasing base friction, toe resistance, or lower-block resistance first, and explain the likely effect on activity, overturning, and bearing separately.');
            rules.push('Unless the user explicitly asks for dimensions, do not invent exact section sizes or numeric revisions.');
        }
        return rules.map((rule, index) => `${index + 1}. ${rule}`).join('\n');
    }

    function roundNum(value, digits) {
        const num = Number(value);
        if (!Number.isFinite(num)) return 0;
        return Number(num.toFixed(digits));
    }

    function packCaseResult(caseName, result) {
        if (!result) return null;
        const safeSf = value => (value === Infinity ? 'INF' : roundNum(value, 2));
        const safeQ = value => (value >= 99999 ? 'OVR' : roundNum(value, 1));
        return {
            lc: caseName,
            js: [safeSf(result.slidingJoint.sf), result.slidingJoint.pass ? 1 : 0, result.slidingJoint.criticalLevel, result.slidingJoint.criticalWater],
            ot: [safeSf(result.overturning.sf), result.overturning.pass ? 1 : 0, result.overturning.criticalLevel, result.overturning.criticalWater],
            br: [
                safeQ(result.bearing.p1),
                safeQ(result.bearing.p1Prime),
                result.bearing.pass ? 1 : 0,
                roundNum(result.bearing.qta, 1),
                roundNum(result.bearing.qa, 1),
                roundNum(result.bearing.ecc, 3),
                roundNum(result.bearing.b, 3),
                roundNum(result.bearing.L, 3),
                result.bearing.criticalLevel,
                result.bearing.criticalWater
            ],
            bs: [safeSf(result.slidingBase.sf), result.slidingBase.pass ? 1 : 0, result.slidingBase.criticalLevel, result.slidingBase.criticalWater]
        };
    }

    function calcReserveRatio(value, criterion, inverse) {
        const v = Number(value);
        const c = Number(criterion);
        if (!Number.isFinite(v) || !Number.isFinite(c) || c <= 0) return Number.POSITIVE_INFINITY;
        if (inverse) {
            if (v <= 0) return Number.POSITIVE_INFINITY;
            return c / v;
        }
        return v / c;
    }

    function buildCriticalCaseRanking(results) {
        if (!Array.isArray(results)) return [];

        return results.map((result, index) => {
            const caseName = `C${index + 1}`;
            const isSeismic = index >= 4;
            const sfLimit = isSeismic ? 1.1 : 1.2;
            const metrics = [
                { key: 'sliding', reserve: calcReserveRatio(result.slidingJoint.sf, sfLimit, false) },
                { key: 'overturning', reserve: calcReserveRatio(result.overturning.sf, sfLimit, false) },
                { key: 'baseSliding', reserve: calcReserveRatio(result.slidingBase.sf, sfLimit, false) },
                { key: 'bearingP1', reserve: calcReserveRatio(result.bearing.p1, result.bearing.qta, true) },
                { key: 'bearingP1Prime', reserve: calcReserveRatio(result.bearing.p1Prime, result.bearing.qa, true) }
            ].sort((a, b) => a.reserve - b.reserve);

            return {
                lc: caseName,
                type: isSeismic ? 'seismic' : 'normal',
                criticalMetric: metrics[0].key,
                criticalReserve: roundNum(metrics[0].reserve, 4),
                js: roundNum(result.slidingJoint.sf, 2),
                ot: roundNum(result.overturning.sf, 2),
                bs: roundNum(result.slidingBase.sf, 2),
                p1: roundNum(result.bearing.p1, 1),
                p1p: roundNum(result.bearing.p1Prime, 1),
                qta: roundNum(result.bearing.qta, 1),
                qa: roundNum(result.bearing.qa, 1)
            };
        }).sort((a, b) =>
            a.criticalReserve - b.criticalReserve ||
            a.js - b.js ||
            a.bs - b.bs ||
            a.ot - b.ot ||
            a.p1 - b.p1 ||
            a.p1p - b.p1p ||
            a.lc.localeCompare(b.lc)
        );
    }

    function buildContextCacheKey(mode) {
        const s = window.QuayWallState || {};
        const res = window.QuayWallResults || [];
        return JSON.stringify({
            mode,
            cap: [s.cap && s.cap.width, s.cap && s.cap.bottomEL, s.crownEL],
            blk: Array.isArray(s.blocks) ? s.blocks.map(b => [b.width, b.bottomEL]) : [],
            cond: [
                s.ahhw, s.allw, s.residualHead, s.rubbleHeight, s.rubbleWidth,
                s.concUnitWeight, s.soilUnitWeight, s.soilSubUnitWeight, s.soilFrictionAngle,
                s.earthPressureMethod, s.wallFrictionAngle, s.frictionCR, s.frictionCC,
                s.surchargeStructure, s.surchargeHinterland, s.seismicKh, s.seismicKv,
                s.allowableBearingTop, s.allowableBearingTopSeismic, s.allowableBearing, s.allowableBearingSeismic
            ],
            res: Array.isArray(res) ? res.map(r => [
                r.caseName,
                r.slidingJoint.sf, r.slidingJoint.pass ? 1 : 0, r.slidingJoint.criticalLevel, r.slidingJoint.criticalWater,
                r.overturning.sf, r.overturning.pass ? 1 : 0, r.overturning.criticalLevel, r.overturning.criticalWater,
                r.bearing.p1, r.bearing.p1Prime, r.bearing.pass ? 1 : 0, r.bearing.qta, r.bearing.qa, r.bearing.ecc, r.bearing.b, r.bearing.L, r.bearing.criticalLevel, r.bearing.criticalWater,
                r.slidingBase.sf, r.slidingBase.pass ? 1 : 0, r.slidingBase.criticalLevel, r.slidingBase.criticalWater
            ]) : []
        });
    }

    function buildCompactContextJson() {
        const s = window.QuayWallState || {};
        const res = window.QuayWallResults || [];
        const critical = buildCriticalCaseRanking(res).slice(0, 2);
        const ngCases = Array.isArray(res)
            ? res
                .filter((r, idx) => idx !== 0 && idx !== 4 && (!r.slidingJoint.pass || !r.overturning.pass || !r.bearing.pass || !r.slidingBase.pass))
                .map(r => packCaseResult(r.caseName, r))
            : [];

        return JSON.stringify({
            geo: {
                n: s.blockCount || 0,
                crown: roundNum(s.crownEL, 3),
                seabed: roundNum(s.seabedEL, 3),
                cap: [roundNum(s.cap && s.cap.width, 3), roundNum(s.cap && s.cap.bottomEL, 3)],
                blk: Array.isArray(s.blocks) ? s.blocks.map(b => [roundNum(b.width, 3), roundNum(b.bottomEL, 3)]) : [],
                rub: [roundNum(s.rubbleHeight, 3), roundNum(s.rubbleWidth, 3), roundNum(s.concUnitWeight, 3)],
                toe: { en: s.toeEnabled !== false ? 1 : 0, w: s.toeEnabled !== false ? roundNum(s.toeWidth, 2) : 0 }
            },
            cond: {
                water: [roundNum(s.ahhw, 3), roundNum(s.allw, 3), roundNum(s.residualHead, 3)],
                soil: [roundNum(s.soilUnitWeight, 3), roundNum(s.soilSubUnitWeight, 3), roundNum(s.soilFrictionAngle, 3)],
                ep: s.earthPressureMethod === 'rankine' ? ['rankine', 0] : ['coulomb', roundNum(s.wallFrictionAngle, 3)],
                fr: [roundNum(s.frictionCR, 3), roundNum(s.frictionCC, 3)],
                sur: [roundNum(s.surchargeStructure, 3), roundNum(s.surchargeHinterland, 3)],
                seis: [roundNum(s.seismicKh, 4), roundNum(s.seismicKv, 4)],
                bearing: [roundNum(s.allowableBearingTop, 1), roundNum(s.allowableBearingTopSeismic, 1), roundNum(s.allowableBearing, 1), roundNum(s.allowableBearingSeismic, 1)]
            },
            res: {
                cNormal: packCaseResult('C1', res.find(r => r.group === 'normal') || res[0]),
                cSeismic: packCaseResult('CS', res.find(r => r.group === 'seismic') || res[res.length - 1]),
                critical,
                ng: ngCases
            }
        });
    }

    function buildFullContextJson() {
        const s = window.QuayWallState || {};
        const res = window.QuayWallResults || [];
        const critical = buildCriticalCaseRanking(res).slice(0, 2);
        return JSON.stringify({
            geo: {
                n: s.blockCount || 0,
                crown: roundNum(s.crownEL, 3),
                seabed: roundNum(s.seabedEL, 3),
                cap: [roundNum(s.cap && s.cap.width, 3), roundNum(s.cap && s.cap.bottomEL, 3), roundNum((s.cap && s.cap.height) || 0, 3)],
                blk: Array.isArray(s.blocks) ? s.blocks.map(b => [roundNum(b.width, 3), roundNum(b.bottomEL, 3), roundNum(b.height || 0, 3)]) : [],
                rub: [roundNum(s.rubbleHeight, 3), roundNum(s.rubbleWidth, 3), roundNum(s.rubbleUnitWeight, 3), roundNum(s.rubbleSatUnitWeight, 3)],
                toe: { en: s.toeEnabled !== false ? 1 : 0, w: s.toeEnabled !== false ? roundNum(s.toeWidth, 2) : 0, h: s.toeEnabled !== false ? roundNum(s.armorHeight * (s.armorLayerCount || 1), 2) : 0 }
            },
            cond: {
                water: [roundNum(s.ahhw, 3), roundNum(s.allw, 3), roundNum(s.residualHead, 3)],
                soil: [roundNum(s.soilUnitWeight, 3), roundNum(s.soilSubUnitWeight, 3), roundNum(s.soilFrictionAngle, 3)],
                ep: s.earthPressureMethod === 'rankine' ? ['rankine', 0] : ['coulomb', roundNum(s.wallFrictionAngle, 3)],
                fr: [roundNum(s.frictionCR, 3), roundNum(s.frictionCC, 3)],
                sur: [roundNum(s.surchargeStructure, 3), roundNum(s.surchargeHinterland, 3)],
                seis: [roundNum(s.seismicKh, 4), roundNum(s.seismicKv, 4)],
                bearing: [roundNum(s.allowableBearingTop, 1), roundNum(s.allowableBearingTopSeismic, 1), roundNum(s.allowableBearing, 1), roundNum(s.allowableBearingSeismic, 1)]
            },
            critical,
            res: Array.isArray(res) ? res.map((r, idx) => packCaseResult(`C${idx + 1}`, r)) : []
        });
    }

    function getContextBundle(mode) {
        if (!window.buildSharedContext) {
            return { text: '상태 정보를 불러올 수 없습니다.', json: '{}' };
        }

        const key = buildContextCacheKey(mode);
        if (contextCache.key !== key) {
            contextCache = {
                key,
                text: window.buildSharedContext(mode),
                json: mode === 'full' ? buildFullContextJson() : buildCompactContextJson()
            };
        }
        return contextCache;
    }

    function buildChatContextMessage(bundle) {
        const source = bundle || getContextBundle('full');
        return `[CTX_TEXT]\n${source.text}\n[CTX_JSON]\n${source.json}`;
    }

    function setChatModelStatus(model, isFallback, inProgress) {
        if (!chatModelStatus) return;
        const title = inProgress ? '응답 생성 모델' : '최근 응답 모델';
        const suffix = isFallback ? ' (자동 전환)' : '';
        chatModelStatus.textContent = `${title}: ${getModelDisplayName(model)}${suffix}`;
        chatModelStatus.style.display = 'block';
        chatModelStatus.style.color = isFallback ? '#fbbf24' : 'var(--text-dim)';
    }

    function addMessage(text, sender) {
        if (!chatContainer) return;
        const msgDiv = document.createElement('div');
        msgDiv.className = `chat-msg ${sender}-msg`;
        let formattedText = text;
        if (sender === 'ai') {
            formattedText = formattedText.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
            formattedText = formattedText.replace(/\n/g, '<br>');
        }
        msgDiv.innerHTML = `<div class="msg-bubble">${formattedText}</div>`;
        chatContainer.appendChild(msgDiv);
        chatContainer.scrollTop = chatContainer.scrollHeight;
    }

    function updateChatLoading(loadingDiv, model, isFallback) {
        if (!loadingDiv) return;
        const modelName = getModelDisplayName(model);
        const note = isFallback ? `<div style="margin-top:6px; font-size:11px; color:#fbbf24;">기존 모델 한도 도달로 ${modelName}로 재시도 중입니다.</div>` : '';
        loadingDiv.innerHTML = `<div class="msg-bubble">분석 및 응답 작성 중... ⏳<div style="margin-top:6px; font-size:11px; color:#93c5fd;">${modelName}</div>${note}</div>`;
    }

    function addLoading(model, isFallback) {
        if (!chatContainer) return null;
        const msgDiv = document.createElement('div');
        msgDiv.className = `chat-msg ai-msg loading-msg`;
        updateChatLoading(msgDiv, model || resolveTaskModel('chat'), !!isFallback);
        chatContainer.appendChild(msgDiv);
        chatContainer.scrollTop = chatContainer.scrollHeight;
        return msgDiv;
    }

    async function sendToGemini(userText) {
        const apiKey = getApiKey();
        if (!apiKey) return;

        addMessage(userText, 'user');
        inputMessage.value = '';
        const initialModel = resolveTaskModel('chat');
        const loadingDiv = addLoading(initialModel, false);
        setChatModelStatus(initialModel, false, true);

        try {
            const bundle = getContextBundle('full');
            const currentContext = buildChatContextMessage(bundle);
            const chatContextKey = buildContextCacheKey('full');
            if (lastChatContextKey && lastChatContextKey !== chatContextKey) {
                chatHistory = [];
            }
            lastChatContextKey = chatContextKey;

            const styleGuide = buildChatStyleGuide(userText);
            const recentHistory = chatHistory
                .filter(entry => entry.role === 'user')
                .slice(-2);
            const contents = [{
                "role": "user",
                "parts": [{
                    "text": `[SYS]\n${strictSystemPrompt}\n[STYLE]\n${styleGuide}\n[NOTE]\nUse the current context first, stay concise, and do not infer missing values.`
                }]
            }, ...recentHistory, {
                "role": "user",
                "parts": [{"text": `${currentContext}\n[Q]\n${userText}`}]
            }];

            const geminiResult = await callGeminiForTask(apiKey, contents, 'chat', {
                onModelAttempt: (model, meta) => {
                    updateChatLoading(loadingDiv, model, !!(meta && meta.fallback));
                    setChatModelStatus(model, !!(meta && meta.fallback), true);
                }
            });
            const aiResponseText = geminiResult.text;

            chatHistory.push({ "role": "user", "parts": [{"text": `[Q]\n${userText}`}] });

            if (loadingDiv) loadingDiv.remove();
            setChatModelStatus(geminiResult.model, geminiResult.fallbackUsed, false);
            addMessage(aiResponseText, 'ai');

        } catch (error) {
            console.error(error);
            if (loadingDiv) loadingDiv.remove();
            addMessage("❌ 통신 중 오류가 발생했습니다. API Key를 확인하거나 잠시 후 다시 시도해주세요.", 'ai');
        }
    }

    if (btnSend && inputMessage) {
        btnSend.addEventListener('click', () => {
            const text = inputMessage.value.trim();
            if (text) sendToGemini(text);
        });
        inputMessage.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); btnSend.click(); }
        });
    }

    // ========== 2. AI 단면 최적화 (인라인 방식) ==========
    const btnRunOptimize = document.getElementById('btnRunOptimize');
    const optResultArea = document.getElementById('optResultArea');
    const optDetailArea = document.getElementById('optDetailArea');
    const btnSubOptResult = document.getElementById('btnSubOptResult');

    let optimizedData = null;
    let beforeOptState = null;

    function renderOptimizeLoading(activeModel, isFallback) {
        if (!optResultArea) return;
        const modelName = getModelDisplayName(activeModel);
        const note = isFallback ? `<p style="margin-top:6px; color:#fbbf24; font-size:11px;">기존 모델 한도 도달로 ${modelName}로 재시도 중입니다.</p>` : '';
        optResultArea.innerHTML = `<div style="text-align:center; padding:20px 0;"><div style="display:inline-block; width:30px; height:30px; border:3px solid rgba(255,255,255,0.1); border-top-color:#38bdf8; border-radius:50%; animation:spin 1s linear infinite;"></div><p style="margin-top:12px; color:#94a3b8;">${modelName}가 경제성 단면을 재설계하고 있습니다...</p>${note}</div>`;
    }

    function renderNgLoading(activeModel, isFallback) {
        if (!ngAnaResult) return;
        const modelName = getModelDisplayName(activeModel);
        const note = isFallback ? `<p style="margin-top:6px; color:#fbbf24; font-size:11px;">기존 모델 한도 도달로 ${modelName}로 재시도 중입니다.</p>` : '';
        ngAnaResult.innerHTML = `<div style="text-align:center; padding:20px 0;"><div style="display:inline-block; width:30px; height:30px; border:3px solid rgba(255,255,255,0.1); border-top-color:#ef4444; border-radius:50%; animation:spin 1s linear infinite;"></div><p style="margin-top:16px; color:#cbd5e1;">${modelName}가 N.G. 원인과 보완 대책을 분석 중입니다...</p>${note}</div>`;
    }

    // ── 공용 헬퍼 함수 ──

    function captureCurrentState() {
        const capEl = document.getElementById('capWidth');
        const capBotEl = document.getElementById('capBottomEL');
        const crownEl = document.getElementById('crownEL');
        const capHeight = (crownEl && capBotEl) ? parseFloat(crownEl.value) - parseFloat(capBotEl.value) : 1.1;
        const widthInputs = document.querySelectorAll('.block-width-input');
        const bottomInputs = document.querySelectorAll('.block-bottom-input');
        const blocks = [];
        let prevBot = capBotEl ? parseFloat(capBotEl.value) : 0;
        for (let i = 0; i < widthInputs.length; i++) {
            const botEl = parseFloat(bottomInputs[i].value) || 0;
            blocks.push({ width: parseFloat(widthInputs[i].value) || 0, height: parseFloat((prevBot - botEl).toFixed(2)) });
            prevBot = botEl;
        }
        return { capWidth: capEl ? parseFloat(capEl.value) : 0, capHeight: parseFloat(capHeight.toFixed(2)), blocks };
    }

    /** 안전율 셀 HTML — 상시(상단)/지진(하단) 이중 표시 */
    function fmtDualFs(vN, vS, reqN, reqS) {
        const isOkNg = v => (v === 'O.K' || v === 'N.G');
        const okColor = '#34d399';   // 초록 — OK 공통
        const ngColor = '#ef4444';   // 빨강 — NG 공통
        const color = (v, req) => isOkNg(v) ? (v === 'O.K' ? okColor : ngColor) : ((parseFloat(v) || 0) >= req ? okColor : ngColor);
        return `<td style="padding:5px; text-align:center; line-height:1.4;"><div style="font-weight:700; color:${color(vN, reqN)};">${vN || '-'}</div><div style="font-size:10px; color:${color(vS, reqS)}; opacity:0.9;">(${vS || '-'})</div></td>`;
    }

    /** 과설계 판정: 모든 블록의 최소 안전율이 목표 대비 얼마나 여유있는지 반환 */
    function getMinMarginRatio(optObj, targetNormal, targetSeismic) {
        if (optObj && optObj._validation && Number.isFinite(optObj._validation.minMarginRatio)) {
            return optObj._validation.minMarginRatio;
        }
        let minRatio = Infinity;
        optObj.blocks.forEach(b => {
            const fn = b.fsNormal || {};
            const fs = b.fsSeismic || {};
            // 활동, 전도, 직선활동 (숫자형 안전율)
            [fn.sliding, fn.overturning, fn.baseSliding].forEach(v => {
                const num = parseFloat(v);
                if (num && num < Infinity) minRatio = Math.min(minRatio, num / targetNormal);
            });
            [fs.sliding, fs.overturning, fs.baseSliding].forEach(v => {
                const num = parseFloat(v);
                if (num && num < Infinity) minRatio = Math.min(minRatio, num / targetSeismic);
            });
        });
        return minRatio;
    }

    /** 블록 폭을 균일하게 줄이되 역전 방지 및 최소폭 유지 */
    function shrinkWidths(optObj, step) {
        const blocks = optObj.blocks;
        // 하단부터 줄이기 (하단이 가장 넓으므로)
        for (let i = blocks.length - 1; i >= 0; i--) {
            const minW = (i === 0) ? optObj.capWidth : blocks[i - 1].width; // 상위 블록 폭 이상 유지
            const newW = Math.round((blocks[i].width - step) * 10) / 10;
            if (newW >= minW) {
                blocks[i].width = newW;
            }
        }
        // 상치콘크리트 폭도 축소 시도
        const newCapW = Math.round((optObj.capWidth - step) * 10) / 10;
        if (newCapW >= 0.5) { // 상치 최소 폭 0.5m
            // 상치 줄이면 블록도 같이 줄일 수 있으므로 블록 최상단과 비교
            if (newCapW <= blocks[0].width) {
                optObj.capWidth = newCapW;
            }
        }
    }

    function cloneOptConfig(optObj, beforeState) {
        return {
            capWidth: Number(optObj.capWidth),
            blocks: optObj.blocks.map((b, i) => ({
                width: Number(b.width),
                height: Number(b.height || beforeState.blocks[i].height)
            }))
        };
    }

    function getSectionArea(optObj, beforeState) {
        const capHeight = optObj._capHeight || beforeState.capHeight || 0;
        let area = (optObj.capWidth || 0) * capHeight;
        optObj.blocks.forEach((b, i) => {
            area += (b.width || 0) * (b.height || beforeState.blocks[i].height || 0);
        });
        return area;
    }

    function getNgItemCount(validation) {
        if (!validation || !Array.isArray(validation.ngCases)) return 0;
        return validation.ngCases.reduce((sum, c) => sum + ((c && Array.isArray(c.items)) ? c.items.length : 0), 0);
    }

    function applyGrowAction(optObj, action, step, maxBlockHeight) {
        const r1 = v => Math.round(v * 10) / 10;
        if (!action) return;

        if (action.type === 'capWidth') {
            optObj.capWidth = r1(optObj.capWidth + step);
            if (optObj.blocks[0] && optObj.blocks[0].width < optObj.capWidth) {
                optObj.blocks[0].width = optObj.capWidth;
            }
        } else if (action.type === 'blockWidth') {
            const i = action.index;
            optObj.blocks[i].width = r1(optObj.blocks[i].width + step);
            if (i === 0 && optObj.blocks[0].width < optObj.capWidth) {
                optObj.blocks[0].width = optObj.capWidth;
            }
        } else if (action.type === 'blockHeight') {
            const i = action.index;
            const curH = Number(optObj.blocks[i].height || 0);
            if (curH + step <= maxBlockHeight + 1e-9) {
                optObj.blocks[i].height = r1(curH + step);
            }
        }

        for (let i = 0; i < optObj.blocks.length; i++) {
            if (i === 0 && optObj.blocks[i].width < optObj.capWidth) {
                optObj.blocks[i].width = optObj.capWidth;
            }
            if (i > 0 && optObj.blocks[i].width < optObj.blocks[i - 1].width) {
                optObj.blocks[i].width = optObj.blocks[i - 1].width;
            }
        }
    }

    function compareOptCandidates(a, b, beforeState) {
        if (!a) return b;
        if (!b) return a;

        const aPass = !!(a._validation && a._validation.passAll);
        const bPass = !!(b._validation && b._validation.passAll);
        if (aPass !== bPass) return aPass ? a : b;

        const aArea = getSectionArea(a, beforeState);
        const bArea = getSectionArea(b, beforeState);
        const aMargin = (a._validation && Number.isFinite(a._validation.minMarginRatio)) ? a._validation.minMarginRatio : Infinity;
        const bMargin = (b._validation && Number.isFinite(b._validation.minMarginRatio)) ? b._validation.minMarginRatio : Infinity;

        if (!aPass && !bPass) {
            const aNg = getNgItemCount(a._validation);
            const bNg = getNgItemCount(b._validation);
            if (aNg !== bNg) return aNg < bNg ? a : b;
            if (Math.abs(aMargin - bMargin) > 1e-9) return aMargin > bMargin ? a : b;
            if (Math.abs(aArea - bArea) > 1e-9) return aArea < bArea ? a : b;
            return a;
        }

        if (Math.abs(aArea - bArea) > 1e-9) return aArea < bArea ? a : b;
        if (Math.abs(aMargin - bMargin) > 1e-9) return aMargin < bMargin ? a : b;
        return a;
    }

    function autoRepairToPassingSection(seedOptObj, beforeState, maxBlockHeight) {
        const STEP = 0.1;
        const MAX_ITER = 120;
        let current = cloneOptConfig(seedOptObj, beforeState);
        verifyWithEngine(current, beforeState);

        let bestPass = current._validation && current._validation.passAll ? cloneOptConfig(current, beforeState) : null;
        if (bestPass) verifyWithEngine(bestPass, beforeState);

        for (let iter = 0; iter < MAX_ITER; iter++) {
            if (current._validation && current._validation.passAll) {
                current._autoRepairApplied = true;
                return current;
            }

            let bestNext = null;
            const actions = [{ type: 'capWidth' }];
            for (let i = 0; i < current.blocks.length; i++) actions.push({ type: 'blockWidth', index: i });
            for (let i = 0; i < current.blocks.length; i++) {
                const h = Number(current.blocks[i].height || 0);
                if (h + STEP <= maxBlockHeight + 1e-9) actions.push({ type: 'blockHeight', index: i });
            }

            actions.forEach(action => {
                const candidate = cloneOptConfig(current, beforeState);
                applyGrowAction(candidate, action, STEP, maxBlockHeight);
                verifyWithEngine(candidate, beforeState);
                bestNext = compareOptCandidates(bestNext, candidate, beforeState);
                if (candidate._validation && candidate._validation.passAll) {
                    bestPass = compareOptCandidates(bestPass, candidate, beforeState);
                }
            });

            if (!bestNext) break;
            current = bestNext;
        }

        if (bestPass) {
            bestPass._autoRepairApplied = true;
            return bestPass;
        }

        current._autoRepairApplied = true;
        return current;
    }

    /** 제안된 치수로 StabilityAnalysis 실행 → optObj에 실제 안전율 주입 */
    function verifyWithEngine(optObj, beforeState) {
        const st = window.QuayWallState;
        if (!st || !window.StabilityAnalysis) return;

        // 상치콘크리트 하단 결정: HHW 이상 확보 (시공성) + 최소 높이 0.50m (항설)
        let capBotEL = Math.max(st.cap.bottomEL, st.ahhw);
        capBotEL = Math.round(capBotEL * 10) / 10; // DL 소수점 첫째자리
        if (st.crownEL - capBotEL < 0.50) capBotEL = Math.round((st.crownEL - 0.50) * 10) / 10;
        const tempBlocks = [];
        let curTop = capBotEL;
        for (let i = 0; i < optObj.blocks.length; i++) {
            const bh = optObj.blocks[i].height || beforeState.blocks[i].height;
            const botEL = Math.round((curTop - bh) * 10) / 10; // DL 소수점 첫째자리
            tempBlocks.push({ width: optObj.blocks[i].width, height: bh, bottomEL: botEL });
            curTop = botEL;
        }
        const tempP = {
            blocks: tempBlocks,
            cap: { width: optObj.capWidth, height: st.crownEL - capBotEL, bottomEL: capBotEL },
            toe: {
                enabled: st.toeEnabled !== false,
                width: st.toeEnabled !== false ? st.toeWidth : 0,
                armorHeight: st.toeEnabled !== false ? (st.armorHeight * st.armorLayerCount) : 0
            },
            seabedEL: st.seabedEL, rubbleHeight: Math.max(0, tempBlocks[tempBlocks.length - 1].bottomEL - st.seabedEL),
            concUnitWeight: st.concUnitWeight, seawaterUW: st.seawaterUnitWeight,
            ahhw: st.ahhw, allw: st.allw,
            soilUnitWeight: st.soilUnitWeight, soilSubmergedUW: st.soilSubUnitWeight,
            soilPhi: st.soilFrictionAngle, soilSatUnitWeight: st.soilSatUnitWeight,
            wallFrictionAngle: st.wallFrictionAngle, earthPressureMethod: st.earthPressureMethod,
            surchargeStructure: st.surchargeStructure, surchargeHinterland: st.surchargeHinterland,
            residualHead: st.residualHead, bollardForce: st.bollardForce,
            seismicKh: st.seismicKh, seismicKv: st.seismicKv,
            frictionCoeff: st.frictionCR, frictionCC: st.frictionCC,
            allowableBearingTop: st.allowableBearingTop,
            allowableBearingTopSeismic: st.allowableBearingTopSeismic,
            allowableBearing: st.allowableBearing, allowableBearingSeismic: st.allowableBearingSeismic,
            rubbleUnitWeight: st.rubbleUnitWeight, rubbleSatUnitWeight: st.rubbleSatUnitWeight,
        };
        const results = window.StabilityAnalysis.calculateAll(tempP);
        const fmt = v => v === Infinity ? '∞' : v.toFixed(2);
        const ngCases = [];
        let minMarginRatio = Infinity;

        results.forEach(r => {
            const slideRatio = r.slidingJoint.required > 0 ? r.slidingJoint.sf / r.slidingJoint.required : Infinity;
            const overturnRatio = r.overturning.required > 0 ? r.overturning.sf / r.overturning.required : Infinity;
            const baseRatio = r.slidingBase.required > 0 ? r.slidingBase.sf / r.slidingBase.required : Infinity;
            const bearingRatio1 = r.bearing.p1 > 0 ? r.bearing.qta / r.bearing.p1 : Infinity;
            const bearingRatio2 = r.bearing.p1Prime > 0 ? r.bearing.qa / r.bearing.p1Prime : Infinity;
            minMarginRatio = Math.min(minMarginRatio, slideRatio, overturnRatio, baseRatio, bearingRatio1, bearingRatio2);

            const failedItems = [];
            if (!r.slidingJoint.pass) failedItems.push(`활동 ${fmt(r.slidingJoint.sf)}`);
            if (!r.overturning.pass) failedItems.push(`전도 ${fmt(r.overturning.sf)}`);
            if (!r.bearing.pass) {
                failedItems.push(`지지력 p1 ${r.bearing.p1 >= 99999 ? '전도' : r.bearing.p1.toFixed(1)}/${r.bearing.qta.toFixed(1)}`);
                failedItems.push(`지지력 p1' ${r.bearing.p1Prime >= 99999 ? '전도' : r.bearing.p1Prime.toFixed(1)}/${r.bearing.qa.toFixed(1)}`);
            }
            if (!r.slidingBase.pass) failedItems.push(`직선활동 ${fmt(r.slidingBase.sf)}`);

            if (failedItems.length > 0) {
                ngCases.push({
                    caseName: r.caseName,
                    group: r.group,
                    items: failedItems
                });
            }
        });

        // 블록별 worst 안전율 추출
        optObj.blocks.forEach((b, i) => {
            const isBase = (i === optObj.blocks.length - 1);
            const extractByGroup = (group, qtaVal, qaVal) => {
                let w = { sliding: Infinity, overturning: Infinity, p1: 0, p1Prime: 0, bearOk: true, baseSliding: Infinity, maxEcc: 0 };
                results.filter(r => r.group === group).forEach(r => {
                    w.sliding = Math.min(w.sliding, isBase ? r.slidingBase.sf : r.slidingJoint.sf);
                    w.baseSliding = Math.min(w.baseSliding, r.slidingBase.sf);
                    w.overturning = Math.min(w.overturning, r.overturning.sf);
                    w.p1 = Math.max(w.p1, r.bearing.p1);
                    w.p1Prime = Math.max(w.p1Prime, r.bearing.p1Prime);
                    w.maxEcc = Math.max(w.maxEcc, Math.abs(r.bearing.ecc || 0));
                    if (!r.bearing.pass) w.bearOk = false;
                });
                return {
                    sliding: fmt(w.sliding), overturning: fmt(w.overturning),
                    bearingP1: `${w.p1 >= 99999 ? '전도' : w.p1.toFixed(1)}`,
                    bearingP1Prime: `${w.p1Prime >= 99999 ? '전도' : w.p1Prime.toFixed(1)}`,
                    bearingPass: w.bearOk,
                    bearingQta: qtaVal,
                    bearingQa: qaVal,
                    bearingEcc: w.maxEcc ? w.maxEcc.toFixed(3) : '0.000',
                    baseSliding: fmt(w.baseSliding)
                };
            };
            b.fsNormal = extractByGroup('normal', st.allowableBearingTop || 500, st.allowableBearing || 500);
            b.fsSeismic = extractByGroup('seismic', st.allowableBearingTopSeismic || 600, st.allowableBearingSeismic || 600);
        });

        // 보정된 상치 하단 및 높이를 optObj에 저장 (적용 시 사용)
        optObj._capBotEL = capBotEL;
        optObj._capHeight = st.crownEL - capBotEL;
        optObj._engineResults = results;
        optObj._validation = {
            passAll: ngCases.length === 0,
            ngCases,
            minMarginRatio
        };
    }

    /** 비교표 HTML 생성 (인라인 & 상세탭 공용) */
    function buildComparisonTable(optObj, beforeState, normalFs, seismicFs, opts) {
        const pad = opts.compact ? '5px' : '7px';
        const fontSize = opts.compact ? '12px' : '13px';
        const fsLabel = `<span style="color:#60a5fa">≥${normalFs.toFixed(2)}</span><br><span style="font-size:9px; color:#fb923c;">(지진 ≥${seismicFs.toFixed(2)})</span>`;
        const headers = ['부재', '현재 (폭/높이)', '추천 (폭/높이)', '변화', '활동', '전도', '지지력', '직선활동'];
        const thColors = ['#94a3b8', '#f87171', '#34d399', '#fbbf24', '#60a5fa', '#60a5fa', '#60a5fa', '#60a5fa'];

        let html = `<table style="width:100%; text-align:center; border-collapse:collapse; background:rgba(255,255,255,0.03); font-size:${fontSize};">`;
        html += `<thead><tr style="border-bottom:1px solid rgba(255,255,255,0.1);">`;
        headers.forEach((h, i) => { html += `<th style="padding:${pad}; color:${thColors[i]};">${h}</th>`; });
        html += `</tr></thead><tbody>`;

        // 상치콘크리트 행
        const capDiff = optObj.capWidth - beforeState.capWidth;
        const newCapH = optObj._capHeight || beforeState.capHeight;
        const capHDiff = newCapH - beforeState.capHeight;
        const diffColor = v => v > 0 ? '#fbbf24' : v < 0 ? '#38bdf8' : '#94a3b8';
        html += `<tr style="border-bottom:1px solid rgba(255,255,255,0.05);"><td style="padding:${pad};">상치콘크리트</td>`;
        html += `<td style="padding:${pad}; line-height:1.4;">B: ${beforeState.capWidth.toFixed(1)}<br><span style="font-size:10px; opacity:0.8;">H: ${beforeState.capHeight.toFixed(2)}</span></td>`;
        html += `<td style="padding:${pad}; font-weight:600; color:#34d399; line-height:1.4;">B: ${optObj.capWidth}<br><span style="font-size:10px; opacity:0.8; font-weight:400;">H: ${newCapH.toFixed(2)}</span></td>`;
        html += `<td style="padding:${pad}; color:${diffColor(capDiff)};">B: ${capDiff > 0 ? '+' : ''}${capDiff.toFixed(1)}<br><span style="color:${Math.abs(capHDiff) > 0.05 ? '#c084fc' : '#94a3b8'}; font-size:10px;">H: ${capHDiff > 0 ? '+' : ''}${capHDiff.toFixed(2)}</span></td>`;
        html += `<td style="color:#64748b;">-</td><td style="color:#64748b;">-</td><td style="color:#64748b;">-</td><td style="color:#64748b;">-</td></tr>`;

        // 블록 행
        const total = optObj.blocks.length;
        optObj.blocks.forEach((b, i) => {
            const bw = beforeState.blocks[i] ? beforeState.blocks[i].width : 0;
            const diff = b.width - bw;
            const fn = b.fsNormal || {};
            const fs = b.fsSeismic || {};
            const isLast = (i === total - 1);
            const label = isLast ? `블록 ${i + 1} <span style="font-size:10px; color:#fbbf24;">(최하단)</span>` : `블록 ${i + 1}`;
            const bh = b.height || beforeState.blocks[i].height;
            const diffH = bh - beforeState.blocks[i].height;

            html += `<tr style="border-bottom:1px solid rgba(255,255,255,0.05);${isLast ? ' background:rgba(251,191,36,0.05);' : ''}">`;
            html += `<td style="padding:${pad};">${label}</td>`;
            html += `<td style="padding:${pad}; line-height:1.4;">B: ${bw.toFixed(1)}<br><span style="font-size:10px; opacity:0.8;">H: ${beforeState.blocks[i].height.toFixed(2)}</span></td>`;
            html += `<td style="padding:${pad}; font-weight:600; color:#34d399; line-height:1.4;">B: ${b.width}<br><span style="font-size:10px; opacity:0.8; font-weight:400;">H: ${bh.toFixed(2)}</span></td>`;
            html += `<td style="padding:${pad}; font-size:12px;"><span style="color:${diffColor(diff)};">B: ${diff > 0 ? '+' : ''}${diff.toFixed(1)}</span><br><span style="color:${Math.abs(diffH) > 0.05 ? '#c084fc' : '#94a3b8'}; font-size:10px;">H: ${diffH > 0 ? '+' : ''}${diffH.toFixed(2)}</span></td>`;
            html += fmtDualFs(fn.sliding, fs.sliding, normalFs, seismicFs);
            html += fmtDualFs(fn.overturning, fs.overturning, normalFs, seismicFs);
            // 지지력: 종래식 하중분산법 p1/qta, p1'/qa 형식
            const bearColorN = fn.bearingPass ? '#34d399' : '#ef4444';
            const bearColorS = fs.bearingPass ? '#34d399' : '#ef4444';
            html += `<td style="padding:5px; text-align:center; line-height:1.4;">`;
            html += `<div style="font-weight:700; color:${bearColorN};">p1 ${fn.bearingP1 || '-'} / ${fn.bearingQta || '-'}</div>`;
            html += `<div style="font-size:9px; color:${bearColorN}; opacity:0.85;">p1' ${fn.bearingP1Prime || '-'} / ${fn.bearingQa || '-'}</div>`;
            html += `<div style="font-size:8px; color:${bearColorN}; opacity:0.75;">e ${fn.bearingEcc || '-'}</div>`;
            html += `<div style="font-size:10px; color:${bearColorS}; opacity:0.9;">(p1 ${fs.bearingP1 || '-'} / ${fs.bearingQta || '-'})</div>`;
            html += `<div style="font-size:8px; color:${bearColorS}; opacity:0.75;">(p1' ${fs.bearingP1Prime || '-'} / ${fs.bearingQa || '-'})</div></td>`;
            html += fmtDualFs(fn.baseSliding, fs.baseSliding, normalFs, seismicFs);
            html += `</tr>`;
        });

        // 기준 행
        html += `<tr style="border-top:1px solid rgba(255,255,255,0.15);"><td style="padding:4px; color:#94a3b8; font-size:11px;">목표</td><td colspan="3"></td>`;
        html += `<td style="padding:4px; font-size:11px; color:#60a5fa; font-weight:600;">${fsLabel}</td>`;
        html += `<td style="padding:4px; font-size:11px; color:#60a5fa; font-weight:600;">${fsLabel}</td>`;
        html += `<td style="padding:4px; font-size:11px; color:#60a5fa; font-weight:600;"><span style="color:#60a5fa">p1≤qta<br>p1'≤qa</span></td>`;
        html += `<td style="padding:4px; font-size:11px; color:#60a5fa; font-weight:600;">${fsLabel}</td>`;
        html += `</tr></tbody></table>`;
        return html;
    }


    function getTargetFs() {
        return {
            normal: parseFloat((document.getElementById('targetFsNormal') || {}).value) || 1.20,
            seismic: parseFloat((document.getElementById('targetFsSeismic') || {}).value) || 1.10,
        };
    }

    // ── 📊 결과 서브탭 렌더링 ──

    function renderOptDetail(optObj, beforeState) {
        if (!optDetailArea) return;
        const fs = getTargetFs();
        let html = `<div style="background:rgba(15,23,42,0.8); padding:16px; border-radius:8px; border:1px solid rgba(255,255,255,0.1);">`;
        html += `<h4 style="color:#60a5fa; margin:0 0 8px 0; font-size:14px;">📐 제원 비교 및 실제 검증 안전율</h4>`;
        html += buildComparisonTable(optObj, beforeState, fs.normal, fs.seismic, { compact: false });
        html += `<p style="margin-top:10px; font-size:11px; color:#94a3b8;">※ 안전율은 실제 계산 엔진(StabilityAnalysis)으로 검증된 결과입니다. 치수 제안은 AI 권고안입니다.</p>`;
        html += `</div>`;
        optDetailArea.innerHTML = html;
    }

    // ── 최적화 실행 ──

    if (btnRunOptimize) {
        btnRunOptimize.addEventListener('click', async () => {
            const apiKey = getApiKey();
            if (!apiKey) return;

            beforeOptState = captureCurrentState();
            optimizedData = null;

            optResultArea.style.display = 'block';
            renderOptimizeLoading(resolveTaskModel('optimize'), false);
            btnRunOptimize.disabled = true;
            btnRunOptimize.style.opacity = '0.5';

            try {
                const currentContext = getContextBundle('compact').json;
                const fs = getTargetFs();
                const maxH = parseFloat((document.getElementById('maxBlockHeight') || {}).value) || 2.0;
                const st = window.QuayWallState;

                // 상치콘크리트 하단 결정: HHW 이상 확보 (시공성) + 최소 높이 0.50m (항설)
                let enforcedCapBotEL = st ? Math.max(st.cap.bottomEL, st.ahhw) : beforeOptState.capHeight;
                enforcedCapBotEL = Math.round(enforcedCapBotEL * 10) / 10; // DL 소수점 첫째자리
                if (st && st.crownEL - enforcedCapBotEL < 0.50) enforcedCapBotEL = Math.round((st.crownEL - 0.50) * 10) / 10;
                const enforcedCapHeight = st ? st.crownEL - enforcedCapBotEL : beforeOptState.capHeight;

                const optimizePayload = {
                    task: 'economic_section_optimization',
                    role: '대한민국 항만·어항 설계기준 기반 단면 치수 제안',
                    objective: {
                        passAllChecks: true,
                        targetFs: { normal: roundNum(fs.normal, 2), seismic: roundNum(fs.seismic, 2) },
                        idealMinMargin: '100~105%',
                        overdesignLimit: '110%',
                        direction: 'reduce_or_min_change_first'
                    },
                    fixed: {
                        capBottomEL: roundNum(enforcedCapBotEL, 3),
                        capHeight: roundNum(enforcedCapHeight, 2),
                        crownEL: st ? roundNum(st.crownEL, 2) : null
                    },
                    constraints: {
                        blockCount: beforeOptState.blocks.length,
                        maxBlockHeight: roundNum(maxH, 1),
                        widthRule: 'lower_block_width >= upper_block_width',
                        sectionType: 'vertical_or_gradual_trapezoid_only',
                        preferredAdjDiff: 0.5,
                        maxAdjDiff: 1.0,
                        dimensionStep: 0.1,
                        validation: 'system_rechecks_fs_after_response',
                        response: 'json_only'
                    },
                    outputSchema: {
                        capWidth: roundNum(beforeOptState.capWidth, 1),
                        blocks: beforeOptState.blocks.map(b => ({
                            width: roundNum(b.width || 3.0, 1),
                            height: roundNum(b.height || 1.8, 1)
                        }))
                    },
                    context: JSON.parse(currentContext)
                };

                const optPrompt = [
                    '아래 JSON을 기준으로 모든 안정검토 항목을 만족하는 가장 경제적인 단면 치수만 제안해.',
                    '가장 취약한 안전율이 목표의 100~105%면 이상적이고 110%를 넘기면 과설계로 본다.',
                    '가능하면 현재 치수에서 줄이는 방향으로, 꼭 필요할 때만 0.1m 단위 최소 변경을 허용한다.',
                    '응답은 마크다운 없이 순수 JSON 객체 1개만 반환해.'
                ].join(' ');

                const geminiResult = await callGeminiForTask(
                    apiKey,
                    [{ parts: [{ "text": `${optPrompt}\n${JSON.stringify(optimizePayload)}` }] }],
                    'optimize',
                    {
                        onModelAttempt: (model, meta) => renderOptimizeLoading(model, !!(meta && meta.fallback))
                    }
                );
                const textRes = geminiResult.text;

                let cleaned = textRes.trim();
                if (cleaned.startsWith("```json")) cleaned = cleaned.replace(/^```json/, '').replace(/```$/, '').trim();
                else if (cleaned.startsWith("```")) cleaned = cleaned.replace(/^```/, '').replace(/```$/, '').trim();

                const optObj = JSON.parse(cleaned);

                // 치수 강제 라운딩 (0.1m 단위) — 시공 현실성 확보
                const r1 = v => Math.round(v * 10) / 10;
                optObj.capWidth = r1(optObj.capWidth);
                optObj.blocks.forEach(b => { b.width = r1(b.width); if (b.height) b.height = r1(b.height); });

                // 실제 계산 엔진으로 안전율 검증
                verifyWithEngine(optObj, beforeOptState);

                // AI 제안이 N.G.면 엔진 기준으로 통과 단면을 자동 보정 탐색
                if (!optObj._validation || !optObj._validation.passAll) {
                    const repaired = autoRepairToPassingSection(optObj, beforeOptState, maxH);
                    if (repaired) {
                        optObj.capWidth = repaired.capWidth;
                        optObj.blocks = repaired.blocks;
                        verifyWithEngine(optObj, beforeOptState);
                        optObj._autoRepairApplied = true;
                    }
                }

                // ── 과설계 자동 축소 루프 ──
                // 최소 안전율이 목표 대비 10% 이상 초과하면 폭을 0.1m씩 줄여가며 재검증
                const MARGIN_LIMIT = 1.10;  // 목표 대비 10% 이내가 적정
                const MAX_ITER = 30;        // 무한루프 방지
                let iter = 0;
                let marginRatio = getMinMarginRatio(optObj, fs.normal, fs.seismic);

                while (marginRatio > MARGIN_LIMIT && iter < MAX_ITER) {
                    // 현재 치수 백업
                    const backup = { capWidth: optObj.capWidth, blocks: optObj.blocks.map(b => ({ ...b })) };

                    shrinkWidths(optObj, 0.1);

                    // 축소 후 치수가 변하지 않았으면 중단 (더 이상 줄일 수 없음)
                    const unchanged = backup.capWidth === optObj.capWidth &&
                        backup.blocks.every((bb, i) => bb.width === optObj.blocks[i].width);
                    if (unchanged) break;

                    // 역전 방지 재확인
                    let valid = true;
                    for (let i = 1; i < optObj.blocks.length; i++) {
                        if (optObj.blocks[i].width < optObj.blocks[i - 1].width) { valid = false; break; }
                    }
                    if (optObj.blocks[0].width < optObj.capWidth) valid = false;
                    if (!valid) { // 롤백
                        optObj.capWidth = backup.capWidth;
                        optObj.blocks = backup.blocks;
                        break;
                    }

                    verifyWithEngine(optObj, beforeOptState);
                    const newMargin = getMinMarginRatio(optObj, fs.normal, fs.seismic);

                    if (newMargin < 1.0) {
                        // 안전율 미달 → 롤백하고 중단
                        optObj.capWidth = backup.capWidth;
                        optObj.blocks = backup.blocks;
                        verifyWithEngine(optObj, beforeOptState);
                        break;
                    }
                    marginRatio = newMargin;
                    iter++;
                }

                optimizedData = optObj;

                // 인라인 결과 표시
                let resultHtml = `<div style="background:rgba(15,23,42,0.8); padding:12px; border-radius:8px; border:1px solid rgba(255,255,255,0.1);">`;
                resultHtml += `<p style="margin:0 0 8px 0; font-size:11px; color:#60a5fa;">※ 안전율은 실제 계산 엔진(StabilityAnalysis) 검증 결과입니다.</p>`;
                if (optObj._autoRepairApplied && optObj._validation && optObj._validation.passAll) {
                    resultHtml += `<p style="margin:0 0 8px 0; font-size:11px; color:#fbbf24;">AI 최초 제안이 미달되어, 엔진 기준으로 통과 단면을 자동 재탐색한 결과입니다.</p>`;
                }
                resultHtml += buildComparisonTable(optObj, beforeOptState, fs.normal, fs.seismic, { compact: true });
                if (optObj._validation && !optObj._validation.passAll) {
                    const ngLines = optObj._validation.ngCases
                        .map(c => `<div style="margin-top:4px;">- ${c.caseName}: ${c.items.join(', ')}</div>`)
                        .join('');
                    resultHtml += `<div style="margin-top:10px; padding:10px 12px; border-radius:6px; background:rgba(239,68,68,0.12); border:1px solid rgba(239,68,68,0.28); color:#fecaca; font-size:12px; line-height:1.5;">
                        <div style="font-weight:700; color:#fca5a5;">자동 재탐색 후에도 통과 단면을 찾지 못했습니다. 엔진 재검증 결과 아직 N.G.가 남아 있습니다.</div>
                        ${ngLines}
                        <div style="margin-top:6px; color:#cbd5e1;">치수 제안은 참고용으로만 표시하며 적용 버튼은 제공하지 않습니다.</div>
                    </div>`;
                } else {
                    resultHtml += `<div style="text-align:center; margin-top:10px;">
                        <button id="btnApplyOptInline" style="background:#38bdf8; color:#0f172a; border:none; padding:8px 20px; border-radius:6px; font-weight:600; cursor:pointer; font-size:13px;">이 제원으로 적용</button>
                    </div>`;
                }
                resultHtml += `</div>`;

                optResultArea.innerHTML = resultHtml;

                // 적용 버튼 이벤트
                const applyBtn = document.getElementById('btnApplyOptInline');
                if (applyBtn) applyBtn.addEventListener('click', () => {
                    if (!optimizedData) return;
                    const st = window.QuayWallState;

                    // 1. 상치콘크리트 폭 적용
                    const capEl = document.getElementById('capWidth');
                    if (capEl) { capEl.value = optimizedData.capWidth; }
                    if (st) st.cap.width = optimizedData.capWidth;

                    // 2. 상치콘크리트 하단 적용 (HHW 이상 확보)
                    const capBotInput = document.getElementById('capBottomEL');
                    if (capBotInput && optimizedData._capBotEL != null) {
                        capBotInput.value = optimizedData._capBotEL.toFixed(1);
                    }
                    if (st && optimizedData._capBotEL != null) st.cap.bottomEL = optimizedData._capBotEL;

                    // 3. 블록 제원 적용 (state 직접 업데이트)
                    const widthInputs = document.querySelectorAll('.block-width-input');
                    const bottomInputs = document.querySelectorAll('.block-bottom-input');
                    const capBotEl = optimizedData._capBotEL || parseFloat(document.getElementById('capBottomEL').value) || 0;

                    let currentTop = capBotEl;
                    optimizedData.blocks.forEach((b, i) => {
                        const inputW = Array.from(widthInputs).find(el => parseInt(el.dataset.index) === i);
                        const inputBot = Array.from(bottomInputs).find(el => parseInt(el.dataset.index) === i);
                        const newBot = Math.round((currentTop - (b.height || beforeOptState.blocks[i].height)) * 10) / 10;

                        if (inputW) inputW.value = b.width;
                        if (inputBot) inputBot.value = newBot.toFixed(1);

                        // state 직접 업데이트
                        if (st && st.blocks[i]) {
                            st.blocks[i].width = b.width;
                            st.blocks[i].bottomEL = newBot;
                        }
                        currentTop = newBot;
                    });

                    // 4. 강제 재계산 (시각화 + 안정검토 즉시 업데이트)
                    if (window.forceRecalculate) window.forceRecalculate();

                    renderOptDetail(optimizedData, beforeOptState);
                    if (btnSubOptResult) { btnSubOptResult.disabled = false; btnSubOptResult.style.opacity = '1'; btnSubOptResult.click(); }
                });

            } catch (e) {
                console.error(e);
                optResultArea.innerHTML = `<p style="color:#ef4444; font-weight:bold; padding:10px;">오류가 발생했습니다: ${e.message}</p><p style="padding:0 10px; color:#94a3b8;">API 상태를 확인하거나 잠시 후 다시 시도해주세요.</p>`;
            } finally {
                btnRunOptimize.disabled = false;
                btnRunOptimize.style.opacity = '1';
            }
        });
    }

    // ========== 3. NG 원인 분석 ==========
    const btnRunNGAna = document.getElementById('btnRunNGAna');
    const ngAnaResult = document.getElementById('ngAnaResult');

    if (btnRunNGAna) {
        btnRunNGAna.addEventListener('click', async () => {
            const apiKey = getApiKey();
            if (!apiKey) return;

            ngAnaResult.style.display = 'block';
            renderNgLoading(resolveTaskModel('ng'), false);

            try {
                const currentContext = getContextBundle('compact').json;
                const ngPayload = {
                    task: 'ng_cause_and_countermeasure',
                    role: '대한민국 항만·어항 설계기준 기반 NG 원인 분석',
                    output: [
                        '### 🔍 N.G. 발생 원인 분석',
                        '### 💡 추천 보완 대책',
                        '### 📊 예상 효과'
                    ],
                    requirements: [
                        'NG 조건과 항목 설명',
                        '역학적·기하학적 원인 설명',
                        'OK 확보를 위한 설계 보완 방향을 수치 중심으로 제안',
                        '전문가답지만 읽기 쉽게 작성'
                    ],
                    rules: [
                        '하중조합은 상시 비계류, 상시 계류(견인력 시), 지진시로 구분한다',
                        '지지력은 종래식 하중분산법 결과인 p1, p1\', qta, qa와 참고 편심 e로만 설명한다',
                        '원호활동은 지반분야 별도 프로그램 검토 항목으로 설명한다',
                        'FS_br = qa/qmax 같은 임의 식이나 지지력 안전율 2.0 같은 추정 기준을 만들지 않는다',
                        '제공된 결과값과 기준 문구 밖의 내용을 단정하지 않는다'
                    ],
                    context: JSON.parse(currentContext)
                };

                const prompt = [
                    '아래 JSON을 바탕으로 현재 NG 원인과 보완 대책을 분석해.',
                    'NG 조건, 역학적·기하학적 원인, 설계 치수 보완 방향을 명확히 설명해.',
                    '하중조합은 group 필드(normal/seismic)로 상시·지진을 구분한다.',
                    '지지력은 p1≤qta, p1\'≤qa로 설명하고 원호활동은 별도 검토 항목으로 적어.',
                    'FS_br 같은 임의 안전율은 만들지 마.',
                    '출력은 지정된 3개 마크다운 섹션 제목을 그대로 사용해.'
                ].join(' ');

                const geminiResult = await callGeminiForTask(
                    apiKey,
                    [{ parts: [{"text": `${prompt}\n${JSON.stringify(ngPayload)}`}] }],
                    'ng',
                    {
                        onModelAttempt: (model, meta) => renderNgLoading(model, !!(meta && meta.fallback))
                    }
                );
                const textRes = geminiResult.text;

                let formattedHtml = textRes;
                formattedHtml = formattedHtml.replace(/### (.*)/g, '<h3 style="color:#ef4444; margin-top:20px; margin-bottom:10px; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:5px; font-size:16px;">$1</h3>');
                formattedHtml = formattedHtml.replace(/\*\*(.*?)\*\*/g, '<strong style="color:#f8fafc;">$1</strong>');
                formattedHtml = formattedHtml.replace(/\n/g, '<br>');
                formattedHtml = formattedHtml.replace(/\*\s(.*?)<br>/g, '<li style="margin-left:20px; margin-bottom:4px;">$1</li>');

                ngAnaResult.innerHTML = formattedHtml;

            } catch(e) {
                console.error(e);
                ngAnaResult.innerHTML = `<p style="color:#ef4444; font-weight:bold;">오류가 발생했습니다: ${e.message}</p><p>API 상태를 확인하거나 잠시 후 다시 시도해주세요.</p>`;
            }
        });
    }

})();

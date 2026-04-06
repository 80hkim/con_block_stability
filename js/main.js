/**
 * main.js — 콘크리트 블록식 안벽 안정검토 컨트롤러
 * KDS 64 55 20 기준
 */
(function () {
    const viz = window.QuayWallVisualization
        ? new QuayWallVisualization('crossSectionCanvas')
        : null;

    // ── 최적화: debounce 유틸리티 (타이핑 중 불필요한 연산 방지) ──
    function debounce(fn, ms) {
        let timer;
        return function (...args) {
            clearTimeout(timer);
            timer = setTimeout(() => fn.apply(this, args), ms);
        };
    }
    const debouncedUpdate = debounce(() => updateVisualization(), 120);

    // ── 기본 블록 데이터 (3단, 스크린샷 기준) ──
    const defaultBlocks = [
        { width: 1.8, bottomEL: 6.6, height: 1.8 },
        { width: 2.1, bottomEL: 4.8, height: 1.8 },
        { width: 2.9, bottomEL: 3.0, height: 1.8 },
    ];

    // ── State (초기 설정값 스크린샷 기준 세팅) ──
    const state = {
        blockCount: 3,
        blocks: JSON.parse(JSON.stringify(defaultBlocks)),
        cap: { width: 1.5, bottomEL: 8.4, height: 1.1 },
        crownEL: 9.5,
        rubbleHeight: 4.3, // blockBottom(3.0) - seabed(-1.3) = 4.3
        rubbleWidth: 1.7,
        concUnitWeight: 23.0,
        ahhw: 8.964,
        allw: 0.0,
        mtl: 4.482,
        seabedEL: -1.3,
        // 물성치 (KDS 64 55 20 기준)
        seawaterUnitWeight: 10.10,
        soilUnitWeight: 18.0,
        soilSatUnitWeight: 20.0,
        soilSubUnitWeight: 9.9, // 20.0 - 10.10
        rubbleUnitWeight: 18.0,
        rubbleSatUnitWeight: 20.0,
        soilFrictionAngle: 30,
        wallFrictionAngle: 15,
        soilCohesion: 0,
        residualHead: 2.988,
        surchargeStructure: 10.0,
        surchargeHinterland: 10.0,
        bollardForce: 0.0,
        seismicKh: 0.066,
        frictionCC: 0.5,
        frictionCR: 0.6,
        allowableBearingTop: 500,
        allowableBearingTopSeismic: 600,
        allowableBearing: 500,
        allowableBearingSeismic: 600,
        rubbleFrictionAngle: 40,
        earthPressureMethod: 'rankine',  // 'rankine' = δ미적용, 'coulomb' = δ적용
        // Toe 설정 (피복석)
        toeEnabled: true,
        armorLayerCount: 1,
        armorVolume: 0.2,
        armorHeight: 0.60,
        toeWidth: 0.50,
        toeSlopeH: 1.0,
        // 피복석 소요중량 검토 (이스바쉬)
        currentVelocity: 0,
        armorDensity: 2.65,
        isbashCoeff: 0.86,
    };
    window.QuayWallState = state; // AI가 접근할 수 있도록 노출
    window.forceRecalculate = () => { updateVisualization(); }; // AI 최적화 적용 후 즉시 재계산용

    // ── DOM Elements ──
    const $ = id => document.getElementById(id);
    const blockCountSelect = $('blockCount');
    const blockInputsContainer = $('blockInputs');
    const capWidthInput = $('capWidth');
    const capBottomELInput = $('capBottomEL');
    const capHeightInput = $('capHeight');

    document.querySelectorAll('.section-header').forEach(header => {
        header.addEventListener('click', () => {
            const targetId = header.getAttribute('data-toggle');
            const body = document.getElementById(targetId);
            const section = header.closest('.input-section');
            section.classList.toggle('active');
            body.classList.toggle('collapsed');
        });
    });

    function buildBlockInputs() {
        const count = state.blockCount;
        blockInputsContainer.innerHTML = '';
        while (state.blocks.length < count) {
            const lastBlock = state.blocks[state.blocks.length - 1] || { width: 3.0, bottomEL: -2.5, height: 2.0 };
            state.blocks.push({
                width: Math.round((lastBlock.width + 0.5) * 10) / 10,
                bottomEL: lastBlock.bottomEL - 2.0,
                height: 2.0
            });
        }
        state.blocks.length = count;

        for (let i = 0; i < count; i++) {
            const block = state.blocks[i];
            const blockNum = i + 1;
            const isBottom = (i === count - 1);
            const isTop = (i === 0);
            let posLabel = count === 1 ? '' : (isTop ? ' (최상단)' : (isBottom ? ' (최하단)' : ''));
            const badgeClass = `b${Math.min(blockNum, 10)}`;

            const group = document.createElement('div');
            group.className = 'block-input-group';
            group.innerHTML = `
                <div class="block-label">
                    <span class="block-badge ${badgeClass}">${blockNum}</span> 블록 ${blockNum}${posLabel}
                </div>
                <div class="block-dims">
                    <div class="dim-input"><label>폭 B</label><div class="input-with-unit">
                        <input type="number" class="block-width-input" data-index="${i}" value="${block.width}" step="0.1" min="0.5" max="20"><span class="unit">m</span></div>
                    </div>
                    <div class="dim-input"><label>하단 DL</label><div class="input-with-unit">
                        <input type="number" class="block-bottom-input" data-index="${i}" value="${block.bottomEL}" step="0.1"><span class="unit">DL m</span></div>
                    </div>
                </div>`;
            blockInputsContainer.appendChild(group);
        }

        blockInputsContainer.querySelectorAll('.block-width-input').forEach(input => input.addEventListener('input', onBlockDimChange));
        blockInputsContainer.querySelectorAll('.block-bottom-input').forEach(input => input.addEventListener('input', onBlockDimChange));
    }

    function onBlockDimChange(e) {
        const idx = parseInt(e.target.dataset.index);
        let val = parseFloat(e.target.value);
        if (isNaN(val)) val = 0;
        if (e.target.classList.contains('block-width-input')) { state.blocks[idx].width = val; }
        else if (e.target.classList.contains('block-bottom-input')) { state.blocks[idx].bottomEL = val; }
        debouncedUpdate();
    }

    function calculateHeights() {
        state.cap.height = state.crownEL - state.cap.bottomEL;
        if (capHeightInput) capHeightInput.value = state.cap.height.toFixed(2);
        let prevEL = state.cap.bottomEL;
        for (let i = 0; i < state.blocks.length; i++) {
            state.blocks[i].height = prevEL - state.blocks[i].bottomEL;
            const hInput = $('blockHeight_' + i);
            if (hInput) hInput.value = state.blocks[i].height.toFixed(2);
            prevEL = state.blocks[i].bottomEL;
        }
    }

    function dlToLocalY(dlValue) {
        const blockBottomDL = state.seabedEL + state.rubbleHeight;
        return dlValue - blockBottomDL;
    }

    function updateMTL() {
        state.mtl = (state.ahhw + state.allw) / 2;
        const mtlInput = $('mtl');
        if (mtlInput) mtlInput.value = state.mtl.toFixed(2);

        // 잔류수위(RWL Rise) 자동 계산: 조차의 1/3에 해당하는 상승고 산정
        const tidalRange = state.ahhw - state.allw;
        state.residualHead = parseFloat((tidalRange / 3).toFixed(3));
        const rhInput = $('residualHead');
        if (rhInput) rhInput.value = state.residualHead;
    }

    // 피복석 규격(m³/ea) → 높이 자동 산정
    // D_n = V^(1/3), 0.1m 단위 올림
    function calcArmorHeight(volumeM3) {
        const Dn = Math.pow(volumeM3, 1 / 3);
        return Math.ceil(Dn * 10) / 10;
    }

    function updateArmorHeight() {
        state.armorHeight = calcArmorHeight(state.armorVolume);

        // 피복석 층수와 규격을 고려하여 '해측 기초사석 전면폭' 자동 산출
        // 공식: 앞굽(Toe) 폭(0.5m) + 피복석 2개 길이(2 * Dn)
        const autoWidth = 0.5 + (2 * state.armorHeight);

        // 0.1m 단위로 올림하여 여유 확보
        const cleanWidth = Math.ceil(autoWidth * 10) / 10;
        state.rubbleWidth = cleanWidth;

        const rwInput = $('rubbleWidth');
        if (rwInput) {
            rwInput.value = cleanWidth.toFixed(1);
            rwInput.style.background = 'rgba(255,165,0,0.1)';
        }
    }

    function syncToeTerminologyUI() {
        const toePanel = $('armorVolume') ? $('armorVolume').closest('.block-input-group') : null;
        if (!toePanel) return;

        const panelLabel = toePanel.querySelector('.block-label');
        if (panelLabel) {
            const textNode = Array.from(panelLabel.childNodes)
                .find(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
            if (textNode) textNode.textContent = ' 최하단 블록 일체형 Toe';
        }

        const volumeLabel = document.querySelector('label[for="armorVolume"]');
        if (volumeLabel) volumeLabel.textContent = 'Toe 등가체적 (치수환산용)';

        const layerLabel = document.querySelector('label[for="armorLayerCount"]');
        if (layerLabel) layerLabel.textContent = 'Toe 높이 배수 (n)';

        const layerSelect = $('armorLayerCount');
        if (layerSelect) {
            if (layerSelect.options[0]) layerSelect.options[0].text = '1배';
            if (layerSelect.options[1]) layerSelect.options[1].text = '2배';
            layerSelect.title = '최하단 콘크리트 블록의 일체형 Toe 높이 배수';
        }

        const volumeSelect = $('armorVolume');
        if (volumeSelect) {
            volumeSelect.title = '최하단 콘크리트 블록 일체형 Toe의 등가체적 입력';
        }

        const helperText = Array.from(toePanel.querySelectorAll('div'))
            .find(el => el.textContent.includes('Toe') && el.textContent.includes('0.5m'));
        if (helperText) {
            helperText.style.display = 'none';
        }
    }

    function updateVisualization() {
        // 토압조건 수중단위중량 자동 계산 (포화단위중량 - 해수단위중량)
        state.soilSubUnitWeight = state.soilSatUnitWeight - state.seawaterUnitWeight;

        // 기초사석 높이 자동 계산: 최하단 블록 하단 DL - 해저면(원지반) DL
        if (state.blocks && state.blocks.length > 0) {
            const bottomBlockEL = state.blocks[state.blocks.length - 1].bottomEL;

            // 원지반(seabedEL) 자동 조정: 블록이 원지반 아래로 내려가면
            // 기초사석 최소 높이(2.0m)를 유지하도록 원지반을 자동 하향
            const minRubbleHeight = 2.0;
            if (bottomBlockEL - state.seabedEL < minRubbleHeight) {
                state.seabedEL = parseFloat((bottomBlockEL - minRubbleHeight).toFixed(1));
                if (_seabedEl) _seabedEl.value = state.seabedEL.toFixed(1);
            }

            state.rubbleHeight = Math.max(0, bottomBlockEL - state.seabedEL);
        }

        calculateHeights();
        const data = {
            blocks: state.blocks,
            cap: state.cap,
            crownEL: state.crownEL,
            rubbleHeight: state.rubbleHeight,
            rubbleWidth: state.rubbleWidth,
            ahhwY: dlToLocalY(state.ahhw),
            mtlY: dlToLocalY(state.mtl),
            allwY: dlToLocalY(state.allw),
            waterLevelY: dlToLocalY(state.ahhw),
            seabedEL: state.seabedEL,
            loadCase: state.loadCase || 'normal',
            surcharge: state.surcharge || 0,
            waveHeight: parseFloat(($('waveHeight') || {}).value) || 2.0,
            wavePeriod: parseFloat(($('wavePeriod') || {}).value) || 8.0,
            waveAngle: parseFloat(($('waveAngle') || {}).value) || 0,
            // Toe 및 피복석 (toeEnabled=false 시 width/armorHeight를 0으로 설정 → 시각화/계산 모두 자동 미적용)
            armorHeight: state.armorHeight * (state.armorLayerCount || 2),
            toe: {
                enabled: state.toeEnabled !== false,
                width: state.toeEnabled !== false ? state.toeWidth : 0,
                armorHeight: state.toeEnabled !== false ? (state.armorHeight * (state.armorLayerCount || 2)) : 0,
                slopeHeight: state.toeEnabled !== false ? state.toeSlopeH : 0
            },
            // 외력분포도용 파라미터
            surchargeStructure: state.surchargeStructure,
            surchargeHinterland: state.surchargeHinterland,
            residualHead: state.residualHead,
            bollardForce: state.bollardForce,
            seismicKh: state.seismicKh,
            seawaterUnitWeight: state.seawaterUnitWeight,
            soilFrictionAngle: state.soilFrictionAngle,
        };

        if (window.QuayWallVisualization && viz) { viz.draw(data); }
        runStability();
    }

    // ── 결과 테이블 동적 생성 ──
    let _currentCaseCount = 0;

    function buildResultsTable(caseCount, loadCases) {
        if (caseCount === _currentCaseCount) return;
        _currentCaseCount = caseCount;

        const is12 = caseCount === 12;
        const thead = $('resultsTableHead');
        const tbody = $('resultsTableBody');
        const panel = $('results-panel');
        const summary = $('resultsCaseSummary');
        if (summary) summary.textContent = `${caseCount} 하중조합`;
        if (panel) {
            if (is12) panel.classList.add('mode-12col');
            else panel.classList.remove('mode-12col');
        }

        // 그룹 구조: 12조합 → 비계류4 + 계류4 + 지진4, 8조합 → 상시4 + 지진4
        const groups = is12
            ? [{ label: '상시 (비계류)', cls: 'normal-h', count: 4 },
               { label: '상시 (계류)', cls: 'mooring-h', count: 4 },
               { label: '지진시', cls: 'seismic-h', count: 4 }]
            : [{ label: '상 시', cls: 'normal-h', count: 4 },
               { label: '지진시', cls: 'seismic-h', count: 4 }];

        // thead
        let h1 = '<tr><th colspan="2" class="corner-cell">검토항목</th>';
        groups.forEach(g => { h1 += `<th colspan="${g.count}" class="group-header ${g.cls}">${g.label}</th>`; });
        h1 += '</tr>';

        let h2 = '<tr><th colspan="2" class="corner-cell"></th>';
        for (let i = 1; i <= caseCount; i++) {
            h2 += `<th class="lc-header" data-lc="${i}" style="cursor:help; text-decoration:underline dotted rgba(255,255,255,0.4);">하중조합 ${i}</th>`;
        }
        h2 += '</tr>';
        thead.innerHTML = h1 + h2;

        // tbody — 4개 검토항목 × 3행 (검토/기준/판정)
        const items = [
            { key: 'JointSl', label: '활동', hasSF: true },
            { key: 'Overt', label: '전도', hasSF: true },
            { key: 'Bear', label: '지지력', hasSF: false },
            { key: 'BaseSl', label: '직선활동', hasSF: true }
        ];

        let body = '';
        items.forEach(item => {
            // 행1: 검토값
            body += `<tr><td rowspan="3" class="item-label">${item.label}</td>`;
            body += `<td class="sub-label">${item.hasSF ? 'Fs' : '검토'}</td>`;
            for (let i = 1; i <= caseCount; i++) body += `<td id="c${i}${item.key}SF" class="pass-cell has-basic-tooltip">-</td>`;
            body += '</tr>';
            // 행2: 기준
            body += `<tr><td class="sub-label">기준</td>`;
            for (let i = 1; i <= caseCount; i++) {
                if (item.hasSF) {
                    const isSeismic = is12 ? i > 8 : i > 4;
                    body += `<td class="req-cell">${isSeismic ? '≥1.1' : '≥1.2'}</td>`;
                } else {
                    body += `<td id="c${i}${item.key}Req" class="req-cell">-</td>`;
                }
            }
            body += '</tr>';
            // 행3: 판정
            body += `<tr><td class="sub-label">판정</td>`;
            for (let i = 1; i <= caseCount; i++) body += `<td id="c${i}${item.key}St" class="pass-cell-bg">-</td>`;
            body += '</tr>';
        });
        tbody.innerHTML = body;

        // 툴팁 재바인딩
        rebindLcTooltips();
    }

    function runStability() {
        if (!window.StabilityAnalysis) return;
        const p = {
            blocks: state.blocks,
            cap: { ...state.cap, height: state.crownEL - state.cap.bottomEL },
            toe: {
                enabled: state.toeEnabled !== false,
                width: state.toeEnabled !== false ? state.toeWidth : 0,
                armorHeight: state.toeEnabled !== false ? (state.armorHeight * state.armorLayerCount) : 0
            },
            seabedEL: state.seabedEL, rubbleHeight: state.rubbleHeight,
            concUnitWeight: state.concUnitWeight, seawaterUW: state.seawaterUnitWeight,
            ahhw: state.ahhw, allw: state.allw,
            soilUnitWeight: state.soilUnitWeight,
            soilSubmergedUW: state.soilSubUnitWeight, soilPhi: state.soilFrictionAngle,
            soilSatUnitWeight: state.soilSatUnitWeight, wallFrictionAngle: state.wallFrictionAngle,
            earthPressureMethod: state.earthPressureMethod,
            surchargeStructure: state.surchargeStructure, surchargeHinterland: state.surchargeHinterland,
            residualHead: state.residualHead, bollardForce: state.bollardForce,
            seismicKh: state.seismicKh,
            frictionCoeff: state.frictionCR,
            frictionCC: state.frictionCC,
            allowableBearingTop: state.allowableBearingTop,
            allowableBearingTopSeismic: state.allowableBearingTopSeismic,
            allowableBearing: state.allowableBearing,
            allowableBearingSeismic: state.allowableBearingSeismic,
            rubbleUnitWeight: state.rubbleUnitWeight,
            rubbleSatUnitWeight: state.rubbleSatUnitWeight,
        };
        const loadCases = StabilityAnalysis.getLoadCases(p.bollardForce || 0);
        buildResultsTable(loadCases.length, loadCases);
        const results = StabilityAnalysis.calculateAll(p);
        window.QuayWallResults = results;
        updateResultsPanel(results);

        // 피복석 소요중량 검토 (이스바쉬)
        updateArmorCheck();
    }

    function updateArmorCheck() {
        const el = $('armorCheckResult');
        if (!el || !StabilityAnalysis.calcArmorStoneIsbash) return;
        const result = StabilityAnalysis.calcArmorStoneIsbash({
            currentVelocity: state.currentVelocity,
            armorDensity: state.armorDensity,
            isbashCoeff: state.isbashCoeff,
            seawaterUW: state.seawaterUnitWeight,
            armorVolume: state.armorVolume,
        });
        if (!result) {
            el.innerHTML = '<span style="color:var(--text-dim);">조류속 입력 시 자동 검토</span>';
            el.style.borderColor = 'rgba(255,255,255,0.08)';
            return;
        }
        const passColor = result.pass ? '#10b981' : '#ef4444';
        const passText = result.pass ? 'O.K' : 'N.G';
        const reqVol = result.requiredVolume < 0.001 ? '<0.001' : result.requiredVolume.toFixed(3);
        el.innerHTML = `<span style="color:${passColor}; font-weight:700;">${passText}</span>&nbsp; 소요 ${reqVol} m³/ea (${(result.requiredMass * 1000).toFixed(0)} kg) &nbsp;|&nbsp; 현재 ${result.currentVolume} m³/ea`;
        el.style.borderColor = result.pass ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)';
    }

    function updateResultsPanel(results) {
        let hasNG = false;
        results.forEach((r, idx) => {
            const caseNum = idx + 1;

            // 1. 활동 (Joint Sliding)
            const jsEl = $(`c${caseNum}JointSlSF`);
            const jsStEl = $(`c${caseNum}JointSlSt`);
            if (jsEl) {
                jsEl.textContent = (r.slidingJoint.sf === Infinity ? '∞' : r.slidingJoint.sf.toFixed(2));
                jsEl.setAttribute('data-val-tooltip', `임계조건: ${r.slidingJoint.criticalLevel} / ${r.slidingJoint.criticalWater}`);
                jsEl.className = r.slidingJoint.pass ? 'pass-cell has-basic-tooltip' : 'fail-cell has-basic-tooltip';
            }
            if (jsStEl) { jsStEl.textContent = r.slidingJoint.pass ? 'O.K' : 'N.G'; jsStEl.className = r.slidingJoint.pass ? 'pass-cell-bg' : 'fail-cell-bg'; }

            // 2. 전도 (Overturning)
            const otEl = $(`c${caseNum}OvertSF`);
            const otStEl = $(`c${caseNum}OvertSt`);
            if (otEl) {
                otEl.textContent = (r.overturning.sf === Infinity ? '∞' : r.overturning.sf.toFixed(2));
                otEl.setAttribute('data-val-tooltip', `임계조건: ${r.overturning.criticalLevel} / ${r.overturning.criticalWater}`);
                otEl.className = r.overturning.pass ? 'pass-cell has-basic-tooltip' : 'fail-cell has-basic-tooltip';
            }
            if (otStEl) { otStEl.textContent = r.overturning.pass ? 'O.K' : 'N.G'; otStEl.className = r.overturning.pass ? 'pass-cell-bg' : 'fail-cell-bg'; }

            // 3. 지지력 (Bearing) — 지배적 조건 1줄 + SVG 툴팁
            const brEl = $(`c${caseNum}BearSF`);
            const brReqEl = $(`c${caseNum}BearReq`);
            const brStEl = $(`c${caseNum}BearSt`);
            if (brEl) {
                const p1Text = (r.bearing.p1 > 0 && r.bearing.p1 < 99999) ? Number(r.bearing.p1.toFixed(1)).toLocaleString('en-US') : (r.bearing.p1 >= 99999 ? '⚠전도' : 'N/A');
                const p1PrimeText = (r.bearing.p1Prime > 0 && r.bearing.p1Prime < 99999) ? Number(r.bearing.p1Prime.toFixed(1)).toLocaleString('en-US') : (r.bearing.p1Prime >= 99999 ? '⚠전도' : 'N/A');
                const util1 = r.bearing.qta > 0 ? r.bearing.p1 / r.bearing.qta : Infinity;
                const util2 = r.bearing.qa > 0 ? r.bearing.p1Prime / r.bearing.qa : Infinity;
                const gov1 = util1 >= util2;
                const govLabel = gov1 ? 'p1' : "p1'";
                const govVal = gov1 ? p1Text : p1PrimeText;
                const govAllow = gov1 ? Math.floor(r.bearing.qta) : Math.floor(r.bearing.qa);
                brEl.textContent = `${govLabel} = ${govVal}`;
                brEl.removeAttribute('data-val-tooltip');
                brEl.className = r.bearing.pass ? 'pass-cell' : 'fail-cell';
                brEl.style.cursor = 'help';
                // SVG 툴팁 바인딩
                brEl.onmouseenter = () => { imgTooltip.innerHTML = buildBearingTooltip(r); imgTooltip.style.display = 'block'; };
                brEl.onmousemove = (e) => {
                    let left = e.clientX + 15, top = e.clientY + 15;
                    if (left + imgTooltip.offsetWidth > window.innerWidth) left = e.clientX - imgTooltip.offsetWidth - 15;
                    if (top + imgTooltip.offsetHeight > window.innerHeight) top = e.clientY - imgTooltip.offsetHeight - 15;
                    imgTooltip.style.left = left + 'px'; imgTooltip.style.top = top + 'px';
                };
                brEl.onmouseleave = () => { imgTooltip.style.display = 'none'; };
                if (brReqEl) brReqEl.textContent = `≤ ${govAllow}`;
            }
            if (brStEl) { brStEl.textContent = r.bearing.pass ? 'O.K' : 'N.G'; brStEl.className = r.bearing.pass ? 'pass-cell-bg' : 'fail-cell-bg'; }

            // 4. 직선활동 (Base Sliding)
            const bsEl = $(`c${caseNum}BaseSlSF`);
            const bsStEl = $(`c${caseNum}BaseSlSt`);
            if (bsEl) {
                bsEl.textContent = (r.slidingBase.sf === Infinity ? '∞' : r.slidingBase.sf.toFixed(2));
                bsEl.setAttribute('data-val-tooltip', `임계조건: ${r.slidingBase.criticalLevel} / ${r.slidingBase.criticalWater}`);
                bsEl.className = r.slidingBase.pass ? 'pass-cell has-basic-tooltip' : 'fail-cell has-basic-tooltip';
            }
            if (bsStEl) { bsStEl.textContent = r.slidingBase.pass ? 'O.K' : 'N.G'; bsStEl.className = r.slidingBase.pass ? 'pass-cell-bg' : 'fail-cell-bg'; }

            if (!r.slidingJoint.pass || !r.overturning.pass || !r.bearing.pass || !r.slidingBase.pass) hasNG = true;
        });

        // N.G. 발생 시 Gemini AI 서브버튼 활성화/비활성화
        const ngBadge = $('ngBadge');
        const btnSubNG = $('btnSubNG');
        const btnSubOptimize = $('btnSubOptimize');
        const optStatusMsg = $('optStatusMsg');
        if (ngBadge) {
            if (hasNG) {
                ngBadge.style.display = 'inline-block';
                if (btnSubNG) { btnSubNG.disabled = false; }
                if (optStatusMsg) { optStatusMsg.textContent = "최적화 실행이 가능합니다."; optStatusMsg.style.color = "var(--accent)"; }
            } else {
                ngBadge.style.display = 'none';
                if (btnSubNG) { btnSubNG.disabled = true; }
                if (optStatusMsg) { optStatusMsg.textContent = "N.G. 사항이 없어 최적화가 필요하지 않습니다."; optStatusMsg.style.color = "var(--text-dim)"; }
            }
        }
    }


    // ── 최적화: 자주 참조되는 DOM 요소 캐시 ──
    const _concUW = $('concUnitWeight');
    const _rubbleW = $('rubbleWidth');
    const _ahhwEl = $('ahhw');
    const _crownEl = $('crownEL');
    const _seabedEl = $('seabedEL');

    blockCountSelect.addEventListener('change', () => { state.blockCount = parseInt(blockCountSelect.value); buildBlockInputs(); updateVisualization(); });
    capWidthInput.addEventListener('input', () => { state.cap.width = parseFloat(capWidthInput.value) || 2.5; debouncedUpdate(); });
    capBottomELInput.addEventListener('input', () => { state.cap.bottomEL = parseFloat(capBottomELInput.value) || 0; debouncedUpdate(); });
    _concUW.addEventListener('input', () => { state.concUnitWeight = parseFloat(_concUW.value) || 23.0; debouncedUpdate(); });
    _rubbleW.addEventListener('input', () => {
        state.rubbleWidth = parseFloat(_rubbleW.value) || 1.5;
        _rubbleW.style.background = 'var(--bg-input)';
        debouncedUpdate();
    });
    _ahhwEl.addEventListener('input', () => { state.ahhw = parseFloat(_ahhwEl.value) || 0; updateMTL(); debouncedUpdate(); });
    _crownEl.addEventListener('input', () => { state.crownEL = parseFloat(_crownEl.value) || 3.0; debouncedUpdate(); });
    _seabedEl.addEventListener('input', () => { state.seabedEL = parseFloat(_seabedEl.value) || -6.0; debouncedUpdate(); });

    // 피복석 소요중량 검토 입력
    ['currentVelocity', 'armorDensity'].forEach(id => {
        const el = $(id);
        if (el) el.addEventListener('input', () => { state[id] = parseFloat(el.value) || 0; updateArmorCheck(); });
    });
    const isbashSel = $('isbashCoeff');
    if (isbashSel) isbashSel.addEventListener('change', () => { state.isbashCoeff = parseFloat(isbashSel.value) || 0.86; updateArmorCheck(); });

    $('btnZoomIn').addEventListener('click', () => { if (window.QuayWallVisualization && viz) viz.zoomIn(); });
    $('btnZoomOut').addEventListener('click', () => { if (window.QuayWallVisualization && viz) viz.zoomOut(); });
    $('btnFit').addEventListener('click', () => { if (window.QuayWallVisualization && viz) viz.fitView(); });

    // 결과 패널 토글 기능
    const btnToggleResults = $('btnToggleResults');
    const resultsPanel = $('results-panel');
    if (btnToggleResults && resultsPanel) {
        btnToggleResults.addEventListener('click', () => {
            resultsPanel.classList.toggle('collapsed');
            if (resultsPanel.classList.contains('collapsed')) {
                btnToggleResults.textContent = '▲';
            } else {
                btnToggleResults.textContent = '▼';
            }
            // 창 크기 변경 후 캔버스 리사이징을 위해 잠시 후 업데이트 및 화면 맞춤 호출
            setTimeout(() => {
                updateVisualization();
                if (window.QuayWallVisualization && viz) {
                    viz.fitView();
                }
            }, 60);
        });
    }

    $('showDimensions').addEventListener('change', (e) => { if (viz) viz.showDimensions = e.target.checked; updateVisualization(); });
    $('showForces').addEventListener('change', (e) => { if (viz) viz.showForces = e.target.checked; updateVisualization(); });
    $('showLabels').addEventListener('change', (e) => { if (viz) viz.showLabels = e.target.checked; updateVisualization(); });
    $('showWaterLevels').addEventListener('change', (e) => { if (viz) viz.showWaterLevels = e.target.checked; updateVisualization(); });
    $('showCL').addEventListener('change', (e) => { if (viz) viz.showCL = e.target.checked; updateVisualization(); });

    // 하중조합 툴팁 생성 로직 (이미지형 테이블 툴팁)
    let imgTooltip = document.getElementById('imageLikeTooltip');
    if (!imgTooltip) {
        imgTooltip = document.createElement('div');
        imgTooltip.id = 'imageLikeTooltip';
        Object.assign(imgTooltip.style, {
            display: 'none', position: 'fixed', zIndex: '9999', backgroundColor: 'transparent',
            pointerEvents: 'none', whiteSpace: 'nowrap'
        });
        document.body.appendChild(imgTooltip);
    }

    const _ttStyle = `<style>.tt-glass-container{background:rgba(15,23,42,0.65);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border:1px solid rgba(255,255,255,0.2);border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,0.5),inset 0 1px 0 rgba(255,255,255,0.1);padding:4px;overflow:hidden}.tt-table{border-collapse:collapse;text-align:center;width:100%;font-family:'Inter',"Malgun Gothic",sans-serif;letter-spacing:-0.3px;font-size:11px}.tt-table th,.tt-table td{padding:6px 10px;color:#f8fafc;border:1px solid rgba(255,255,255,0.1)}.tt-table thead{background:rgba(255,255,255,0.1);font-weight:600;text-shadow:0 1px 2px rgba(0,0,0,0.5)}.tt-table tbody{background:transparent;font-weight:400}</style>`;

    function buildTooltipCache() {
        const cases = StabilityAnalysis.getLoadCases(state.bollardForce || 0);
        const cache = {};
        cases.forEach((lc, i) => {
            const n = i + 1;
            const isSeismic = lc.group === 'seismic';
            const isMooring = lc.subgroup === 'mooring';
            const gubun = isSeismic ? '지진시' : (isMooring ? '계류' : '상시');
            const d = {
                gubun, caseName: `C-${n}`,
                w: '●', s1: lc.sStr ? '●' : '-', s2: lc.sHint ? '●' : '-',
                p: '●', r: '●',
                i: isSeismic ? '●' : '-', d: isSeismic ? '●' : '-',
                t: lc.bollard ? '●' : '-'
            };
            cache[String(n)] = `${_ttStyle}<div class="tt-glass-container"><table class="tt-table"><thead><tr><th rowspan="2">구분</th><th rowspan="2">Case</th><th rowspan="2">자중</th><th colspan="2" style="border-bottom:1px dotted rgba(255,255,255,0.3);">상재하중</th><th rowspan="2">토압</th><th rowspan="2">잔류수압</th><th rowspan="2">관성력</th><th rowspan="2">동수압</th><th rowspan="2">견인력</th></tr><tr><th style="border-right:1px dotted rgba(255,255,255,0.3);">구조물</th><th>배후부지</th></tr></thead><tbody><tr><td>${d.gubun}</td><td>${d.caseName}</td><td>${d.w}</td><td style="border-right:1px dotted rgba(255,255,255,0.3);">${d.s1}</td><td>${d.s2}</td><td>${d.p}</td><td>${d.r}</td><td>${d.i}</td><td>${d.d}</td><td>${d.t}</td></tr></tbody></table></div>`;
        });
        return cache;
    }
    let _tooltipCache = buildTooltipCache();

    function rebindLcTooltips() {
        _tooltipCache = buildTooltipCache();
        document.querySelectorAll('.lc-header').forEach(header => {
            const lcNum = header.dataset.lc;
            if (!_tooltipCache[lcNum]) return;
            header.onmouseenter = () => { imgTooltip.innerHTML = _tooltipCache[lcNum]; imgTooltip.style.display = 'block'; };
            header.onmousemove = (e) => {
                let left = e.clientX + 15, top = e.clientY + 15;
                if (left + imgTooltip.offsetWidth > window.innerWidth) left = e.clientX - imgTooltip.offsetWidth - 15;
                if (top + imgTooltip.offsetHeight > window.innerHeight) top = e.clientY - imgTooltip.offsetHeight - 15;
                imgTooltip.style.left = left + 'px'; imgTooltip.style.top = top + 'px';
            };
            header.onmouseleave = () => { imgTooltip.style.display = 'none'; };
        });
    }

    // ── 지지력 반력분포 SVG 툴팁 생성 ──
    function buildBearingTooltip(r) {
        const br = r.bearing;
        const W = 400, H = 280;
        const pad = { l: 70, r: 50, t: 50, b: 70 };
        const gW = W - pad.l - pad.r, gH = H - pad.t - pad.b;

        const B = br.currentB || 1;
        const b = br.b || 0;
        const eAbs = Math.abs(br.ecc || 0);
        const p1 = br.p1 || 0;
        const D = br.moundThickness || 0;
        const L = br.L || 0;
        const qta = br.qta || 0;
        const isUniform = eAbs < 0.001 && p1 > 0 && p1 < 99999;
        const isTrap = !isUniform && eAbs <= B / 6 && p1 > 0 && p1 < 99999;
        const isTri = !isUniform && !isTrap && p1 > 0 && p1 < 99999;
        const isOvr = p1 >= 99999;

        // p2 계산 (사다리꼴/등분포 시)
        const V = (br.p1 && br.currentB) ? br.p1 * br.currentB / (1 + 6 * eAbs / B) : 0;
        const p2v = (B > 0 && V > 0) ? Math.max(0, (V / B) * (1 - 6 * eAbs / B)) : 0;

        // 스케일
        const maxP = Math.max(p1, qta * 1.05, 1);
        const xScale = gW / B;
        const pScale = gH / maxP;
        const x = v => pad.l + v * xScale;
        const y = v => pad.t + gH - v * pScale;

        const passColor = br.pass ? '#10b981' : '#ef4444';
        const passText = br.pass ? 'O.K' : 'N.G';

        let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" style="font-family:Inter,'Malgun Gothic',sans-serif;">`;
        svg += `<defs>`;
        svg += `<marker id="aL" markerWidth="6" markerHeight="6" refX="6" refY="3" orient="auto"><path d="M6,0 L0,3 L6,6" fill="#94a3b8"/></marker>`;
        svg += `<marker id="aR" markerWidth="6" markerHeight="6" refX="0" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6" fill="#94a3b8"/></marker>`;
        svg += `</defs>`;
        svg += `<rect width="${W}" height="${H}" rx="10" fill="rgba(15,23,42,0.95)"/>`;

        // 헤더 (상단)
        const distLabel = isUniform ? '등분포' : (br.distType || '반력분포');
        svg += `<text x="${W/2}" y="18" text-anchor="middle" fill="#e2e8f0" font-size="12" font-weight="700">지지력 검토 — ${distLabel}</text>`;
        svg += `<text x="${W/2}" y="34" text-anchor="middle" fill="${passColor}" font-size="11" font-weight="600">${r.caseName} (${br.criticalLevel} / ${br.criticalWater}) ${passText}</text>`;

        // 기초면 기준선
        const baseY = y(0);
        svg += `<line x1="${x(0)}" y1="${baseY}" x2="${x(B)}" y2="${baseY}" stroke="#64748b" stroke-width="2.5"/>`;
        // 기초면 해칭
        for (let hx = 0; hx < B; hx += B / 12) {
            const sx = x(hx);
            svg += `<line x1="${sx}" y1="${baseY}" x2="${sx - 4}" y2="${baseY + 6}" stroke="#475569" stroke-width="0.8"/>`;
        }

        if (isOvr) {
            svg += `<text x="${W/2}" y="${pad.t + gH/2}" text-anchor="middle" fill="#ef4444" font-size="15" font-weight="700">⚠ 전도 임박</text>`;
            svg += `<text x="${W/2}" y="${pad.t + gH/2 + 18}" text-anchor="middle" fill="#f87171" font-size="11">e = ${eAbs.toFixed(3)}m ≥ B/2 = ${(B/2).toFixed(3)}m</text>`;
        } else if (isUniform) {
            // 등분포: e ≈ 0, p1 = p2 = V/B
            svg += `<rect x="${x(0)}" y="${y(p1)}" width="${x(B)-x(0)}" height="${baseY-y(p1)}" fill="rgba(16,185,129,0.2)" stroke="#10b981" stroke-width="1.5"/>`;
            svg += `<text x="${x(0)-6}" y="${y(p1)+4}" text-anchor="end" fill="#34d399" font-size="11" font-weight="600">${p1.toFixed(1)}</text>`;
            svg += `<text x="${x(0)-6}" y="${y(p1)+16}" text-anchor="end" fill="#6ee7b7" font-size="9">kPa</text>`;
        } else if (isTrap) {
            // 사다리꼴
            svg += `<polygon points="${x(0)},${baseY} ${x(0)},${y(p1)} ${x(B)},${y(p2v)} ${x(B)},${baseY}" fill="rgba(59,130,246,0.2)" stroke="#3b82f6" stroke-width="1.5"/>`;
            // p1 (좌측)
            svg += `<text x="${x(0)-6}" y="${y(p1)+4}" text-anchor="end" fill="#60a5fa" font-size="11" font-weight="600">p1=${p1.toFixed(1)}</text>`;
            // p2 (우측)
            svg += `<text x="${x(B)+6}" y="${y(p2v)+4}" text-anchor="start" fill="#60a5fa" font-size="10">${p2v.toFixed(1)}</text>`;
        } else if (isTri) {
            // 삼각형
            svg += `<polygon points="${x(0)},${baseY} ${x(0)},${y(p1)} ${x(b)},${baseY}" fill="rgba(239,68,68,0.15)" stroke="#ef4444" stroke-width="1.5"/>`;
            svg += `<text x="${x(0)-6}" y="${y(p1)+4}" text-anchor="end" fill="#f87171" font-size="11" font-weight="600">p1=${p1.toFixed(1)}</text>`;
            // 비접지 구간 점선
            if (b < B) {
                svg += `<line x1="${x(b)}" y1="${baseY}" x2="${x(B)}" y2="${baseY}" stroke="#ef4444" stroke-width="1" stroke-dasharray="4,3"/>`;
            }
        }

        // qta 기준선 (전도 아닌 경우)
        if (!isOvr && qta > 0 && qta <= maxP) {
            svg += `<line x1="${x(0)-5}" y1="${y(qta)}" x2="${x(B)+5}" y2="${y(qta)}" stroke="#f59e0b" stroke-width="1" stroke-dasharray="5,3"/>`;
            svg += `<text x="${x(B)+8}" y="${y(qta)+4}" text-anchor="start" fill="#fbbf24" font-size="10" font-weight="500">qta=${Math.floor(qta)}</text>`;
        }

        // 하단 치수 (전도 아닌 경우)
        if (!isOvr) {
            const dimY1 = baseY + 14;
            const dimY2 = baseY + 30;
            const dimY3 = baseY + 44;

            if (isTri && b < B) {
                // 삼각형: b 치수 + B 전체
                svg += `<line x1="${x(0)}" y1="${dimY1}" x2="${x(b)}" y2="${dimY1}" stroke="#94a3b8" stroke-width="1" marker-start="url(#aL)" marker-end="url(#aR)"/>`;
                svg += `<text x="${x(b/2)}" y="${dimY2-4}" text-anchor="middle" fill="#e2e8f0" font-size="10">b=${b.toFixed(2)}m</text>`;
                svg += `<line x1="${x(0)}" y1="${dimY2+4}" x2="${x(B)}" y2="${dimY2+4}" stroke="#64748b" stroke-width="0.8" marker-start="url(#aL)" marker-end="url(#aR)"/>`;
                svg += `<text x="${x(B/2)}" y="${dimY3}" text-anchor="middle" fill="#94a3b8" font-size="9">B=${B.toFixed(2)}m</text>`;
            } else {
                // 등분포/사다리꼴: B 치수만
                svg += `<line x1="${x(0)}" y1="${dimY1}" x2="${x(B)}" y2="${dimY1}" stroke="#94a3b8" stroke-width="1" marker-start="url(#aL)" marker-end="url(#aR)"/>`;
                svg += `<text x="${x(B/2)}" y="${dimY2-4}" text-anchor="middle" fill="#e2e8f0" font-size="10">B=${B.toFixed(2)}m</text>`;
            }

            // 편심 정보
            const eColor = isTri ? '#f87171' : '#94a3b8';
            const eNote = isTri ? `> B/6(${(B/6).toFixed(3)})` : `≤ B/6(${(B/6).toFixed(3)})`;
            svg += `<text x="${x(B/2)}" y="${H-10}" text-anchor="middle" fill="${eColor}" font-size="9">e=${eAbs.toFixed(3)}m ${eNote}</text>`;
        }

        // 하단 2단계 정보
        const p1pText = br.p1Prime < 99999 ? br.p1Prime.toFixed(1) : '전도';
        const s1 = br.stage1Pass ? '✓' : '✗';
        const s2 = br.stage2Pass ? '✓' : '✗';
        const s1c = br.stage1Pass ? '#10b981' : '#ef4444';
        const s2c = br.stage2Pass ? '#10b981' : '#ef4444';
        svg += `<text x="${W/2}" y="${H-24}" text-anchor="middle" fill="#cbd5e1" font-size="10">`;
        svg += `<tspan fill="${s1c}">${s1}</tspan> p1=${p1 < 99999 ? p1.toFixed(1) : '전도'} ≤ qta=${Math.floor(qta)}`;
        svg += `   <tspan fill="${s2c}">${s2}</tspan> p1'=${p1pText} ≤ qa=${Math.floor(br.qa)}`;
        svg += `</text>`;

        svg += '</svg>';
        return `<div style="background:transparent;">${svg}</div>`;
    }

    // 글로벌 일반 텍스트 툴팁 추가 로직 (안전율 항목 호버용)
    let basicGlassTooltip = document.getElementById('basicGlassTooltip');
    if (!basicGlassTooltip) {
        basicGlassTooltip = document.createElement('div');
        basicGlassTooltip.id = 'basicGlassTooltip';
        Object.assign(basicGlassTooltip.style, {
            display: 'none', position: 'fixed', zIndex: '9999',
            background: 'rgba(15, 23, 42, 0.75)',
            backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
            border: '1px solid rgba(255, 255, 255, 0.2)',
            borderRadius: '8px',
            boxShadow: '0 10px 30px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.1)',
            padding: '8px 12px', color: '#f8fafc',
            fontFamily: '"Inter", "Malgun Gothic", sans-serif', fontSize: '12px',
            pointerEvents: 'none', whiteSpace: 'nowrap', lineHeight: '1.5'
        });
        document.body.appendChild(basicGlassTooltip);

        document.addEventListener('mouseover', (e) => {
            const tgt = e.target.closest('[data-val-tooltip]');
            if (tgt) {
                tgt.style.cursor = 'help';
                basicGlassTooltip.innerHTML = tgt.getAttribute('data-val-tooltip')
                    .replace(/\n/g, '<br/>')
                    .replace('임계조건: ', '<span style="color:#94a3b8; font-size:11px;">임계조건: </span>')
                    .replace(' / ', '<br/><span style="color:#94a3b8; font-size:11px;">수위조합: </span><span style="color:#38bdf8;">')
                    .replace('분포유형: ', '</span><br/><span style="color:#94a3b8; font-size:11px;">분포유형: </span><span style="color:#fbbf24;">')
                    + '</span>';
                basicGlassTooltip.style.display = 'block';
            }
        });
        document.addEventListener('mousemove', (e) => {
            const tgt = e.target.closest('[data-val-tooltip]');
            if (tgt && basicGlassTooltip.style.display === 'block') {
                let left = e.clientX + 15;
                let top = e.clientY + 15;
                if (left + basicGlassTooltip.offsetWidth > window.innerWidth) left = e.clientX - basicGlassTooltip.offsetWidth - 15;
                if (top + basicGlassTooltip.offsetHeight > window.innerHeight) top = e.clientY - basicGlassTooltip.offsetHeight - 15;
                basicGlassTooltip.style.left = left + 'px';
                basicGlassTooltip.style.top = top + 'px';
            }
        });
        document.addEventListener('mouseout', (e) => {
            const tgt = e.target.closest('[data-val-tooltip]');
            if (tgt) {
                basicGlassTooltip.style.display = 'none';
            }
        });
    }

    // 지진 하중 자동/수동 모드 토글
    const seismicModeRadios = document.getElementsByName('seismicInputMode');
    const seismicAutoPanel = $('seismicAutoPanel');
    const seismicKhInput = $('seismicKh');

    function updateSeismicAutoKh() {
        const mode = Array.from(seismicModeRadios).find(r => r.checked).value;
        const soil = $('seismicSoilClass').value;
        const autoRadio = document.querySelector('input[name="seismicInputMode"][value="auto"]');
        const manualRadio = document.querySelector('input[name="seismicInputMode"][value="manual"]');
        const detailsEl = $('seismicAutoDetails');

        // S6(부지특성평가 요구)는 자동계산 차단 및 수동입력 강제 로직
        if (soil === 'S6') {
            if (mode === 'auto') {
                manualRadio.checked = true;
                seismicAutoPanel.style.display = 'none';
                seismicKhInput.readOnly = false;
                seismicKhInput.style.background = 'var(--bg-input)';
                if (detailsEl) detailsEl.innerHTML = `<span style="color:#ef4444; font-weight:700;">⚠ S6 지반은 부지특성평가가 필요합니다.<br/>k<sub>h</sub> 수동 입력 모드로 자동 전환되었습니다.</span>`;
            } else {
                if (detailsEl) detailsEl.innerHTML = `<span style="color:#ef4444; font-weight:700;">⚠ S6 지반은 부지특성평가가 필요합니다.<br/>k<sub>h</sub> 수동 입력이 요구됩니다.</span>`;
            }
            return;
        }

        if (Array.from(seismicModeRadios).find(r => r.checked).value === 'auto') {
            const soil = $('seismicSoilClass').value;

            // [KDS 기준 교정] S6 지반은 자동 산정 대상에서 제외 (부지 특성 평가 필수)
            if (soil === 'S6') {
                if (detailsEl) {
                    detailsEl.innerHTML = `<span style="color:#ef4444; font-weight:700;">[경고] S6 지반은 부지 특성 평가(Site-specific)가 필수입니다. 자동 산술이 불가하므로 '수동 입력' 모드를 사용해 주십시오.</span>`;
                }
                seismicKhInput.value = "";
                return;
            }

            const z = parseFloat($('seismicZone').value);
            const i = parseFloat($('seismicReturn').value);
            const s = z * i;

            // KDS 17 10 00 단주기 지반증폭계수(Fa) 테이블 (S가 0.1, 0.2, 0.3, 0.4, 0.5일 때)
            const fa_table = {
                'S1': [1.0, 1.0, 1.0, 1.0, 1.0],
                'S2': [1.2, 1.2, 1.1, 1.0, 1.0],
                'S3': [1.6, 1.4, 1.2, 1.1, 1.0],
                'S4': [2.4, 2.0, 1.7, 1.4, 1.3],
                'S5': [3.2, 2.4, 2.0, 1.8, 1.6]
            };

            let fa = 1.0;
            const faArray = fa_table[soil] || fa_table['S1'];

            if (s <= 0.1) fa = faArray[0];
            else if (s >= 0.5) fa = faArray[4];
            else {
                // 선형보간
                const s_keys = [0.1, 0.2, 0.3, 0.4, 0.5];
                for (let j = 0; j < 4; j++) {
                    if (s >= s_keys[j] && s < s_keys[j + 1]) {
                        const ratio = (s - s_keys[j]) / 0.1;
                        fa = faArray[j] + (faArray[j + 1] - faArray[j]) * ratio;
                        break;
                    }
                }
            }

            // kh = 0.5 * (Z * I * Fa) (항만설계기준 등가정적 가속도의 50%)
            const kh = parseFloat((0.5 * s * fa).toFixed(3));
            state.seismicKh = kh;
            seismicKhInput.value = kh;

            if (detailsEl) {
                detailsEl.innerHTML =
                    `<div style="background:rgba(255,255,255,0.02); padding:8px; border-radius:4px; border:1px solid rgba(255,255,255,0.1); margin-top:4px;">` +
                    `<div style="color:var(--text-secondary); font-size:10.5px; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:4px; margin-bottom:4px;">[KDS 17 10 00 및 64 17 00 설계기준 계산 경로]</div>` +
                    `<div style="display:flex; justify-content:space-between; margin-bottom:2px;"><span style="color:var(--text-dim);">지각가속도 (S = Z × I):</span> <span>${z} × ${i} = <strong>${s.toFixed(3)}</strong></span></div>` +
                    `<div style="display:flex; justify-content:space-between; margin-bottom:2px;"><span style="color:var(--text-dim);">지반증폭계수 (Fₐ):</span> <span>${soil} 분류 기준 → <strong>${fa.toFixed(2)}</strong></span></div>` +
                    `<div style="display:flex; justify-content:space-between; margin-top:4px; padding-top:4px; border-top:1px dashed rgba(255,255,255,0.1);"><strong style="color:var(--text-primary);">최종 수평진도 (k<sub>h</sub>):</strong> <strong style="color:var(--accent); font-size:13px;">${kh}</strong></div>` +
                    `<div style="font-size:9.5px; color:var(--text-dim); margin-top:2px;">※ 등가정적 가속도(S×Fₐ)의 50%를 설계수평진도로 적용함</div>` +
                    `</div>`;
            }
            updateVisualization();
        } else {
            if (detailsEl) detailsEl.innerHTML = `※ 수동모드: 사용자가 k<sub>h</sub>를 직접 입력합니다.`;
        }
    }

    seismicModeRadios.forEach(r => {
        r.addEventListener('change', () => {
            let mode = r.value;
            if (mode === 'auto') {
                // 숨겨진 상태에서 S6이 선택되어 있을 때 자동모드를 누르면 발생하는 갇힘 현상 방지
                if ($('seismicSoilClass').value === 'S6') {
                    alert('S6 지반은 KDS 자동 산출이 금지되어 있습니다.\n지반분류를 기본값(S2)으로 초기화하여 자동 계산 모드로 복귀합니다.');
                    $('seismicSoilClass').value = 'S2';
                }
                seismicAutoPanel.style.display = 'block';
                seismicKhInput.readOnly = true;
                seismicKhInput.style.background = 'rgba(0,0,0,0.2)';
                updateSeismicAutoKh();
            } else {
                seismicAutoPanel.style.display = 'none';
                seismicKhInput.readOnly = false;
                seismicKhInput.style.background = 'var(--bg-input)';
                const detailsEl = $('seismicAutoDetails');
                if (detailsEl) detailsEl.innerHTML = `※ 수동모드: 사용자가 k<sub>h</sub>를 직접 입력합니다.`;
            }
        });
    });

    ['seismicZone', 'seismicReturn', 'seismicSoilClass'].forEach(id => {
        $(id).addEventListener('change', updateSeismicAutoKh);
    });


    $('seismicKh').addEventListener('input', () => {
        const isAuto = Array.from(seismicModeRadios).find(r => r.checked).value === 'auto';
        if (!isAuto) {
            state.seismicKh = parseFloat($('seismicKh').value) || 0;
            debouncedUpdate();
        }
    });

    // [최적화: ahhw는 위에서 이미 전용 리스너 등록됨 → 중복 제거]
    // [최적화: concUnitWeight도 위에서 전용 리스너 등록됨 → 중복 제거]
    // [최적화: debounce 적용으로 타이핑 중 불필요한 연산 방지]
    const simpleInputs = [
        { id: 'soilUnitWeight', key: 'soilUnitWeight' }, { id: 'soilSatUnitWeight', key: 'soilSatUnitWeight' },
        { id: 'soilFrictionAngle', key: 'soilFrictionAngle' }, { id: 'soilCohesion', key: 'soilCohesion' },
        { id: 'seawaterUnitWeight', key: 'seawaterUnitWeight' },
        { id: 'surchargeStructure', key: 'surchargeStructure' }, { id: 'surchargeHinterland', key: 'surchargeHinterland' },
        { id: 'bollardForce', key: 'bollardForce' },
        { id: 'frictionCR', key: 'frictionCR' }, { id: 'frictionCC', key: 'frictionCC' },
        { id: 'rubbleFrictionAngle', key: 'rubbleFrictionAngle' }, { id: 'rubbleUnitWeight', key: 'rubbleUnitWeight' },
        { id: 'rubbleSatUnitWeight', key: 'rubbleSatUnitWeight' }, { id: 'wallFrictionAngle', key: 'wallFrictionAngle' },
        { id: 'allw', key: 'allw' },
        { id: 'allowableBearingTop', key: 'allowableBearingTop' },
        { id: 'allowableBearingTopSeismic', key: 'allowableBearingTopSeismic' },
        { id: 'allowableBearing', key: 'allowableBearing' },
        { id: 'allowableBearingSeismic', key: 'allowableBearingSeismic' }
    ];
    const _simpleElCache = {}; // DOM 캐시
    simpleInputs.forEach(({ id, key }) => {
        const el = $(id);
        if (el) {
            _simpleElCache[id] = el;
            el.addEventListener('input', () => {
                state[key] = parseFloat(el.value) || 0;
                if (id === 'allw') updateMTL();
                debouncedUpdate();
            });
        }
    });

    // 토압 이론 선택 이벤트 (Rankine/Coulomb)
    const earthPressureSelect = $('earthPressureMethod');
    const wallFrictionRow = $('wallFrictionRow');
    if (earthPressureSelect) {
        const updateWallFrictionUI = () => {
            if (wallFrictionRow) {
                wallFrictionRow.style.opacity = state.earthPressureMethod === 'rankine' ? '0.35' : '1';
                wallFrictionRow.style.pointerEvents = state.earthPressureMethod === 'rankine' ? 'none' : 'auto';
            }
        };
        earthPressureSelect.addEventListener('change', () => {
            state.earthPressureMethod = earthPressureSelect.value;
            updateWallFrictionUI();
            updateVisualization();
        });
        // 초기 UI 상태 반영
        updateWallFrictionUI();
        updateMTL(); // 초기 잔류수위 계산 동기화
    }


    // Toe 관련 이벤트 (피복석 규격만)
    $('armorVolume').addEventListener('change', () => { state.armorVolume = parseFloat($('armorVolume').value) || 0.1; updateArmorHeight(); updateVisualization(); });

    // Toe 적용/미적용 토글
    const toeEnabledCheckbox = $('toeEnabled');
    if (toeEnabledCheckbox) {
        const toeInputsWrap = $('toeInputsWrap');
        const toeDisabledNote = $('toeDisabledNote');
        const updateToeUI = () => {
            const enabled = toeEnabledCheckbox.checked;
            if (toeInputsWrap) {
                toeInputsWrap.style.opacity = enabled ? '1' : '0.35';
                toeInputsWrap.style.pointerEvents = enabled ? 'auto' : 'none';
            }
            if (toeDisabledNote) toeDisabledNote.style.display = enabled ? 'none' : 'block';
        };
        toeEnabledCheckbox.addEventListener('change', () => {
            state.toeEnabled = toeEnabledCheckbox.checked;
            updateToeUI();
            updateVisualization();
        });
        updateToeUI();
    }

    // 피복석 층수 이벤트
    const armorLayerSelect = $('armorLayerCount');
    if (armorLayerSelect) {
        armorLayerSelect.addEventListener('change', () => {
            state.armorLayerCount = parseInt(armorLayerSelect.value) || 2;
            updateArmorHeight();
            updateVisualization();
        });
    }

    // 견인력 관련 이벤트 (선박/어선 구분 + 각 드롭다운)
    const vesselTonnageSelect = $('vesselTonnage');
    const fishingTonnageSelect = $('fishingTonnage');
    const bollardForceInput = $('bollardForce');
    const shipTonnageGroup = $('shipTonnageGroup');
    const fishingTonnageGroup = $('fishingTonnageGroup');

    function applyBollardValue(val) {
        if (val === 'manual') {
            bollardForceInput.readOnly = false;
            bollardForceInput.style.background = 'var(--bg-input)';
            bollardForceInput.focus();
        } else {
            bollardForceInput.readOnly = true;
            bollardForceInput.style.background = 'rgba(0,0,0,0.1)';
            const numVal = parseFloat(String(val).replace(/[^0-9.]/g, '')) || 0;
            bollardForceInput.value = numVal.toLocaleString('en-US');
            state.bollardForce = numVal;
            _tooltipCache = buildTooltipCache();
            updateVisualization();
        }
    }

    document.querySelectorAll('input[name="vesselType"]').forEach(radio => {
        radio.addEventListener('change', () => {
            if (radio.value === 'ship') {
                shipTonnageGroup.style.display = 'block';
                fishingTonnageGroup.style.display = 'none';
                applyBollardValue(vesselTonnageSelect.value);
            } else {
                shipTonnageGroup.style.display = 'none';
                fishingTonnageGroup.style.display = 'block';
                applyBollardValue(fishingTonnageSelect.value);
            }
        });
    });

    if (vesselTonnageSelect && bollardForceInput) {
        vesselTonnageSelect.addEventListener('change', () => applyBollardValue(vesselTonnageSelect.value));
    }

    if (fishingTonnageSelect && bollardForceInput) {
        fishingTonnageSelect.addEventListener('change', () => applyBollardValue(fishingTonnageSelect.value));
    }

    bollardForceInput.addEventListener('input', (e) => {
        const activeSelect = (shipTonnageGroup && shipTonnageGroup.style.display !== 'none')
            ? vesselTonnageSelect : fishingTonnageSelect;
        if (activeSelect && activeSelect.value === 'manual') {
            let numVal = parseFloat(e.target.value.replace(/[^0-9.]/g, ''));
            if (isNaN(numVal)) numVal = 0;
            state.bollardForce = numVal;
            _tooltipCache = buildTooltipCache();
            updateVisualization();
        }
    });

    bollardForceInput.addEventListener('blur', (e) => {
        const activeSelect = (shipTonnageGroup && shipTonnageGroup.style.display !== 'none')
            ? vesselTonnageSelect : fishingTonnageSelect;
        if (activeSelect && activeSelect.value === 'manual') {
            e.target.value = state.bollardForce.toLocaleString('en-US');
        }
    });

    // ── Results Panel Tab Switching ──
    function syncResultsPanelMode(activeTabId) {
        if (!resultsPanel) return;
        resultsPanel.classList.remove('mode-stability', 'mode-ai');
        if (activeTabId === 'tab-stability') resultsPanel.classList.add('mode-stability');
        else resultsPanel.classList.add('mode-ai');
    }

    document.querySelectorAll('.results-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.results-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.results-tab-content').forEach(c => c.classList.remove('active'));
            tab.classList.add('active');
            const target = document.getElementById(tab.dataset.tab);
            if (target) target.classList.add('active');
            syncResultsPanelMode(tab.dataset.tab);
        });
    });
    syncResultsPanelMode(document.querySelector('.results-tab.active')?.dataset.tab || 'tab-stability');

    // ── Gemini AI Analysis ──
    const btnRunAI = $('btnRunAI');
    if (btnRunAI) {
        btnRunAI.addEventListener('click', runAIAnalysis);
    }

    // ══════════════════════════════════════════════════════════════
    // [최적화] 공용 AI 컨텍스트 생성기 — 토큰 절약형
    // mode: 'compact' (채팅/NG/최적화용) | 'full' (Advisory 분석용)
    // ══════════════════════════════════════════════════════════════
    function buildSharedContext(mode) {
        const res = window.QuayWallResults;
        const s = state;
        let t = '';
        const fmt = v => v === Infinity ? 'INF' : Number(v).toFixed(2);
        const fmtQ = v => v >= 99999 ? 'OVR' : Number(v).toFixed(1);
        const fmtPass = v => v ? 'OK' : 'NG';

        // [1] 구조물 제원 (공통)
        t += `[제원] ${s.blockCount}단블록, 천단 DL${s.crownEL}m, 해저면 DL${s.seabedEL}m\n`;
        t += `상치: B=${s.cap.width}m, DL${s.cap.bottomEL}m\n`;
        s.blocks.forEach((b, i) => { t += `블록${i + 1}: B=${b.width}m, DL${b.bottomEL}m\n`; });
        t += `기초사석: H=${s.rubbleHeight}m, 해측폭=${s.rubbleWidth}m, γc=${s.concUnitWeight}\n`;

        // [2] 조건 (공통)
        t += `[조건] HHW=${s.ahhw}, LLW=${s.allw}, RWL_Rise=${s.residualHead}m\n`;
        t += `γs=${s.soilUnitWeight}, γ'=${s.soilSubUnitWeight}, φ=${s.soilFrictionAngle}°, δ=${s.earthPressureMethod === 'rankine' ? '0(Rankine)' : s.wallFrictionAngle + '(Coulomb)'}\n`;
        t += `μCR=${s.frictionCR}, μCC=${s.frictionCC}, q1=${s.surchargeStructure}, q2=${s.surchargeHinterland}, kh=${s.seismicKh}\n`;
        t += `[판정기준] 활동/전도/직선활동: 상시 1.2 이상, 지진시 1.1 이상 / 지지력: p1≤qta, p1'≤qa / 원호활동: 별도 지반해석\n`;
        t += `[설계가정] Toe 포함 유효폭 적용, 잔류수압 전 하중조합 반영, 지진시 수중 토체는 겉보기 진도 적용, 가상배면 해측 뒤채움사석은 구조물 자중 및 지진관성력에 포함\n`;

        if (!Array.isArray(res) || res.length === 0) return t + '\n(결과 미산출)';

        const lcNames = res.map(r => {
            const sg = r.group === 'seismic' ? '지진' : (r.caseName.includes('계류') || (StabilityAnalysis.getLoadCases(s.bollardForce || 0).find(lc => lc.name === r.caseName) || {}).subgroup === 'mooring' ? '계류' : '상시');
            return r.caseName.replace('하중조합 ', 'C') + sg;
        });

        if (mode === 'full') {
            t += `\n[결과 ${res.length}LC]\n`;
            res.forEach((r, i) => {
                const js = r.slidingJoint, bs = r.slidingBase, ot = r.overturning, br = r.bearing;
                t += `${lcNames[i]}: `;
                t += `활동=${fmt(js.sf)}(${fmtPass(js.pass)})[${js.criticalLevel}/${js.criticalWater}] `;
                t += `전도=${fmt(ot.sf)}(${fmtPass(ot.pass)})[${ot.criticalLevel}/${ot.criticalWater}] `;
                t += `지지력=p1 ${fmtQ(br.p1)}/${fmtQ(br.qta)}, p1' ${fmtQ(br.p1Prime)}/${fmtQ(br.qa)}, e=${Number(br.ecc || 0).toFixed(3)}(${fmtPass(br.pass)})[${br.criticalLevel}/${br.criticalWater}] `;
                t += `직선=${fmt(bs.sf)}(${fmtPass(bs.pass)})[${bs.criticalLevel}/${bs.criticalWater}]\n`;
            });
        } else {
            t += `\n[결과요약]\n`;
            // 첫 번째 상시 비계류 + 첫 번째 지진 케이스
            const cNormal = res.find(r => r.group === 'normal');
            const cSeismic = res.find(r => r.group === 'seismic');
            if (cNormal) t += `${cNormal.caseName}: 활동=${fmt(cNormal.slidingJoint.sf)}(${fmtPass(cNormal.slidingJoint.pass)}), 전도=${fmt(cNormal.overturning.sf)}(${fmtPass(cNormal.overturning.pass)}), 지지력=p1 ${fmtQ(cNormal.bearing.p1)}/${fmtQ(cNormal.bearing.qta)}, p1' ${fmtQ(cNormal.bearing.p1Prime)}/${fmtQ(cNormal.bearing.qa)}(${fmtPass(cNormal.bearing.pass)}), 직선=${fmt(cNormal.slidingBase.sf)}(${fmtPass(cNormal.slidingBase.pass)})\n`;
            if (cSeismic) t += `${cSeismic.caseName}: 활동=${fmt(cSeismic.slidingJoint.sf)}(${fmtPass(cSeismic.slidingJoint.pass)}), 전도=${fmt(cSeismic.overturning.sf)}(${fmtPass(cSeismic.overturning.pass)}), 지지력=p1 ${fmtQ(cSeismic.bearing.p1)}/${fmtQ(cSeismic.bearing.qta)}, p1' ${fmtQ(cSeismic.bearing.p1Prime)}/${fmtQ(cSeismic.bearing.qa)}(${fmtPass(cSeismic.bearing.pass)}), 직선=${fmt(cSeismic.slidingBase.sf)}(${fmtPass(cSeismic.slidingBase.pass)})\n`;

            const ngCases = res.filter(r => r !== cNormal && r !== cSeismic && (!r.slidingJoint.pass || !r.overturning.pass || !r.bearing.pass || !r.slidingBase.pass));
            if (ngCases.length > 0) {
                t += `NG추가: `;
                ngCases.forEach(r => {
                    t += `${r.caseName}(`;
                    if (!r.slidingJoint.pass) t += `활동${r.slidingJoint.sf.toFixed(2)} `;
                    if (!r.overturning.pass) t += `전도${r.overturning.sf.toFixed(2)} `;
                    if (!r.bearing.pass) t += `p1 ${fmtQ(r.bearing.p1)}/${fmtQ(r.bearing.qta)} p1' ${fmtQ(r.bearing.p1Prime)}/${fmtQ(r.bearing.qa)} `;
                    if (!r.slidingBase.pass) t += `직선${r.slidingBase.sf.toFixed(2)} `;
                    t += `) `;
                });
                t += `\n`;
            }
        }
        return t;
    }
    // 글로벌 노출: ai_chat.js에서 접근 가능하도록
    window.buildSharedContext = buildSharedContext;

    // [호환성 유지] 기존 getStabilityDataSummary → buildSharedContext('full') 위임
    function getStabilityDataSummary() {
        return buildSharedContext('full');
    }

    async function runAIAnalysis() {
        const apiKey = $('geminiApiKey').value.trim();
        if (!apiKey) {
            alert('Gemini API Key를 입력해 주세요.');
            return;
        }

        const container = $('aiResultContainer');
        const selectedModel = document.getElementById('geminiModelSelect')?.value || 'auto';
        const actualModel = selectedModel === 'auto' ? 'gemini-2.5-pro' : selectedModel;
        const modelDisplayName = actualModel === 'gemini-3.1-pro' ? 'Gemini 3.1 Pro' : (actualModel === 'gemini-2.5-flash' ? 'Gemini 2.5 Flash' : 'Gemini 2.5 Pro');
        container.innerHTML = `<div class="ai-loading"><span class="spinner"></span> ${modelDisplayName} 분석 중...</div>`;
        btnRunAI.disabled = true;

        const dataSummary = getStabilityDataSummary();

        const prompt = `당신은 항만 구조물 설계 전문가입니다. 아래는 콘크리트 블록식 안벽의 안정검토 결과입니다.
KDS 64 55 20 (항만 및 어항 설계기준)에 따라 분석해 주세요.

${dataSummary}

다음 형식으로 분석 결과를 제시해 주세요:

1. **종합 판정**: 전체적인 안정성 평가 (한 문장)
2. **N.G. 발생 항목 분석**: 기준을 만족하지 못하는 항목에 대해:
   - 어떤 하중조합(C-1~C-8)에서 N.G.가 발생했는지
   - N.G. 발생 원인이 무엇인지 (예: 수평력 과대, 자중 부족 등)
   - 해당 조합의 물리적 의미 설명
3. **보강 방안 제시**: N.G. 항목을 해결하기 위한 구체적 방안:
   - 블록 폭/높이 변경 제안 (구체적 수치)
   - 기초사석 보강 방안
   - 기타 가능한 개선 방안
4. **추가 검토 및 유의사항**: 놓치기 쉬운 항목 및 엔지니어링 판단 필요 사항

*참고: 본 AI 분석은 설계를 돕기 위한 권고 사항(Advisory)이며, 최종 설계 승인은 책임 기술자의 공학적 검토를 거쳐야 합니다.*`;

        try {
            const response = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/${actualModel}:generateContent?key=${apiKey}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: prompt }] }],
                        generationConfig: {
                            temperature: 0.3,
                            maxOutputTokens: 2048,
                        }
                    })
                }
            );

            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.error?.message || `API 오류 (${response.status})`);
            }

            const data = await response.json();
            const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '응답을 받지 못했습니다.';

            // 마크다운 → HTML 간이 변환
            const html = convertMarkdownToHtml(text);
            container.innerHTML = `<div class="ai-result-text">${html}</div>`;

        } catch (err) {
            container.innerHTML = `<div class="ai-result-text" style="color:#ef4444;">
                <strong>⚠️ 오류 발생:</strong> ${err.message}
                <br><br>API Key가 올바른지, 네트워크 연결을 확인해 주세요.
            </div>`;
        } finally {
            btnRunAI.disabled = false;
        }
    }

    function convertMarkdownToHtml(md) {
        let html = md
            // Bold
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            // Headers
            .replace(/^### (.+)$/gm, '<h4 style="color:var(--accent);margin:10px 0 4px;">$1</h4>')
            .replace(/^## (.+)$/gm, '<h3 style="color:var(--text-primary);margin:12px 0 6px;">$1</h3>')
            // Lists
            .replace(/^[-•] (.+)$/gm, '<div style="padding-left:12px;">• $1</div>')
            // Numbered lists
            .replace(/^(\d+)\. (.+)$/gm, '<div style="padding-left:8px;margin:4px 0;"><strong>$1.</strong> $2</div>')
            // Line breaks
            .replace(/\n\n/g, '<br><br>')
            .replace(/\n/g, '<br>');

        // N.G. 하이라이트
        html = html.replace(/N\.G\./g, '<span style="color:#ef4444;font-weight:700;">N.G.</span>');
        html = html.replace(/O\.K\./g, '<span style="color:#10b981;font-weight:700;">O.K.</span>');

        return html;
    }

    function init() {
        buildBlockInputs(); syncToeTerminologyUI(); updateMTL(); updateArmorHeight(); updateSeismicAutoKh(); updateVisualization();
        if (window.QuayWallVisualization && viz) {
            // 레이아웃 안정화 후 fitView (ResizeObserver 콜백 이후 보장)
            setTimeout(() => { updateVisualization(); viz.fitView(); }, 200);
        }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();

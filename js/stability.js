/**
 * ================================================
 * 콘크리트 블록식 안벽 안정검토 계산 모듈
 * stability.js — 8/12 하중조합 (활동, 전도, 지반지지력, 직선활동)
 * 항만 및 어항 설계기준 (KDS 64 55 20) 준용
 * ================================================
 *
 * 안정율 기준 (KDS 64 55 20):
 *   활동(Joint Sliding):  상시 Fs ≥ 1.2, 지진시 Fs ≥ 1.1
 *   전도(Overturning Fs): 상시 Fs ≥ 1.2, 지진시 Fs ≥ 1.1
 *   직선활동(Base Sliding): 상시 Fs ≥ 1.2, 지진시 Fs ≥ 1.1
 *   지지력(Bearing):      종래식 하중분산법 2단계 검토
 *                         1) 사석 마운드 상면 p1 ≤ qta
 *                         2) 기초지반 상면 p1' ≤ qa
 *   원호활동(Circular Slip): 지반분야 별도 프로그램에서 수행하는 전제
 *
 * 잔류수위(RWL) 정의:
 *   RWL = LLW + residualHead (조차의 1/3)
 *   잔류수압은 모든 하중조합에서 적용 (설계 의도)
 *
 * 수중 겉보기 진도(Apparent Seismic Coefficient):
 *   kh' = kh × γsat / (γsat - γw)
 *   수중 토체의 지진 관성 효과를 정수압 보정하여 산정 (KDS 64 17 00 준용)
 */

const StabilityAnalysis = (function () {

    // 안전율 기준 (KDS 64 55 20)
    const SF_SLIDING   = { normal: 1.2, seismic: 1.1 };
    const SF_OVERTURN  = { normal: 1.2, seismic: 1.1 };

    // 하중조합 정의 (Loading Situations)
    // 잔류수압(residual)은 모든 하중조합에 적용 — 설계 의도
    //
    // 견인력(bollard) 적용 근거 (KDS 64 55 20):
    //   - 중력식 안벽 §4.1에는 명시적 하중조합표가 없으나, 견인력은 외력 목록(§4.1.2 (5))에 포함
    //   - 지진시 제외: §4.1 [참고](11) "지진력과 동시성이 없는 하중… ① 선박의 견인력"
    //   - 견인력은 계류 상태에서만 작용하는 하중 (§4.2 계류시 조합의 성격 참고)
    //   - 따라서 계류 여부를 q1/q2 조합과 독립된 축으로 분리하여 구성
    //
    // 비계류(8조합): bollardForce = 0 일 때 사용
    // 계류 포함(12조합): bollardForce > 0 일 때, 비계류 4 + 계류 4 + 지진 4
    const LOAD_CASES_BASE = [
        // 상시 비계류 (하중조합 1~4)
        { name:'하중조합 1',  group:'normal',  subgroup:'non-mooring', sStr:false, sHint:false, bollard:false, residual:true },
        { name:'하중조합 2',  group:'normal',  subgroup:'non-mooring', sStr:true,  sHint:false, bollard:false, residual:true },
        { name:'하중조합 3',  group:'normal',  subgroup:'non-mooring', sStr:false, sHint:true,  bollard:false, residual:true },
        { name:'하중조합 4',  group:'normal',  subgroup:'non-mooring', sStr:true,  sHint:true,  bollard:false, residual:true },
        // 상시 계류 (하중조합 5~8) — bollardForce > 0 일 때만 활성
        { name:'하중조합 5',  group:'normal',  subgroup:'mooring',     sStr:false, sHint:false, bollard:true,  residual:true },
        { name:'하중조합 6',  group:'normal',  subgroup:'mooring',     sStr:true,  sHint:false, bollard:true,  residual:true },
        { name:'하중조합 7',  group:'normal',  subgroup:'mooring',     sStr:false, sHint:true,  bollard:true,  residual:true },
        { name:'하중조합 8',  group:'normal',  subgroup:'mooring',     sStr:true,  sHint:true,  bollard:true,  residual:true },
        // 지진시 (하중조합 9~12) — 견인력 제외 (§4.1 [참고](11))
        { name:'하중조합 9',  group:'seismic', subgroup:'seismic',     sStr:false, sHint:false, bollard:false, residual:true, inertia:true, hydroDynamic:true },
        { name:'하중조합 10', group:'seismic', subgroup:'seismic',     sStr:true,  sHint:false, bollard:false, residual:true, inertia:true, hydroDynamic:true },
        { name:'하중조합 11', group:'seismic', subgroup:'seismic',     sStr:false, sHint:true,  bollard:false, residual:true, inertia:true, hydroDynamic:true },
        { name:'하중조합 12', group:'seismic', subgroup:'seismic',     sStr:true,  sHint:true,  bollard:false, residual:true, inertia:true, hydroDynamic:true },
    ];

    // bollardForce > 0 → 12조합, 0 → 비계류4 + 지진4 = 8조합 (기존 번호 체계 유지)
    function getLoadCases(bollardForce) {
        if (bollardForce > 0) return LOAD_CASES_BASE;
        // 비계류 + 지진만 (8조합), 번호를 1~8로 재매핑
        const nonMooring = LOAD_CASES_BASE.filter(lc => lc.subgroup !== 'mooring');
        return nonMooring.map((lc, i) => ({ ...lc, name: `하중조합 ${i + 1}` }));
    }

    // 랜킨 토압 계수 (Ka) — 벽면마찰각 미적용
    function rankineKa(phiDeg) {
        const rad = phiDeg * Math.PI / 180;
        return Math.pow(Math.tan(Math.PI / 4 - rad / 2), 2);
    }

    // 쿨롱 토압 계수 (Ka) — 벽면마찰각(δ) 고려
    function coulombKa(phiDeg, deltaDeg) {
        const rad = Math.PI / 180;
        const phi = phiDeg * rad;
        const delta = (deltaDeg || 0) * rad;
        const num = Math.pow(Math.cos(phi), 2);
        const term = Math.sin(phi + delta) * Math.sin(phi);
        const denTerm = Math.cos(delta);
        let sqrtTerm = 0;
        if (denTerm > 0 && term / denTerm > 0) sqrtTerm = Math.sqrt(term / denTerm);
        const den = Math.cos(delta) * Math.pow(1 + sqrtTerm, 2);
        return (den > 0) ? num / den : 1.0;
    }

    // 모노노베-오카베 동토압 계수 (Kea)
    function mononobeOkabeKea(phiDeg, deltaDeg, kh) {
        if (kh <= 0) return coulombKa(phiDeg, deltaDeg);
        const rad = Math.PI / 180;
        const phi = phiDeg * rad;
        const delta = (deltaDeg || 0) * rad;
        const theta = Math.atan(kh);
        
        if (phi - theta <= 0) {
            // 한계 상태 예외 처리: φ가 진도각보다 작으면 파괴면 형성 불가
            const den = Math.cos(theta) * Math.cos(theta + delta);
            return (den > 0) ? Math.pow(Math.cos(phi - theta), 2) / den : 1.0;
        }

        const num = Math.pow(Math.cos(phi - theta), 2);
        const term = Math.sin(phi + delta) * Math.sin(phi - theta);
        const denTerm = Math.cos(theta + delta);
        let sqrtTerm = 0;
        if (denTerm > 0 && term / denTerm > 0) sqrtTerm = Math.sqrt(term / denTerm);
        const den = Math.cos(theta) * Math.cos(theta + delta) * Math.pow(1 + sqrtTerm, 2);
        return (den > 0) ? num / den : 1.0;
    }

    /**
     * 특정 조위 및 특정 층에서의 안정성 수치 계산 (Internal helper)
     * 
     * @param {Object} lc - 하중조합 정의
     * @param {Object} p  - 설계 파라미터 전체
     * @param {number} checkEL - 검토 면의 DL 표고
     * @param {boolean} isBase - 기초면 여부
     * @param {number} currentWaterLevel - 현재 외부 수위 (HHW 또는 LLW)
     */
    function calculateAtLevel(lc, p, checkEL, isBase, currentWaterLevel) {
        const isSeismic = (lc.group === 'seismic');
        // 사용자가 입력한 마찰계수 적용 (기초면: 콘크리트-사석, 블록간: 콘크리트-콘크리트)
        const mu = isBase ? (p.frictionCoeff || 0.6) : (p.frictionCC || 0.5);
        const toeW = (p.toe && p.toe.width) ? p.toe.width : 0;
        const toeArmorH = (p.toe && p.toe.armorHeight) ? p.toe.armorHeight : 0;
        const baseWidth = p.blocks[p.blocks.length - 1].width;
        
        // 1. 현재 검토 층(Joint)의 Pivot 및 유효 폭 설정
        const elementsAbove = [...p.blocks, p.cap].filter(e => e.bottomEL >= checkEL);
        const jointBlock = elementsAbove.find(e => e.bottomEL === checkEL) || p.cap;
        
        // 블록식 안벽은 배면(Back side) 정렬 기준
        // currentB: 현재 검토 층의 유효 폭 (전면 선단 ~ 배면)
        // 기초면에서는 Toe를 하중 지지 구조로 포함 (Toe 포함 전면 ~ 배면)
        const currentB = isBase ? (baseWidth + toeW) : jointBlock.width;

        let V = 0, Mr = 0, H = 0, Mo = 0;
        let totalInertiaH = 0, totalInertiaM = 0;

        // 2. 수직력(V) 및 저항모멘트(Mr) — Pivot: 검토 층의 전면(해측) 선단
        // KDS 64 17 00 §4.2.2: 중력식 안벽 등가정적해석 시 연직지진계수(kv) 고려하지 않음
        const verticalFactor = 1.0;

        elementsAbove.forEach((elem) => {
            const yTop = elem.bottomEL + elem.height;
            const yBot = elem.bottomEL;
            const subH = Math.max(0, Math.min(currentWaterLevel, yTop) - Math.min(currentWaterLevel, yBot));
            const dryH = elem.height - subH;

            // 본체 자중
            const wBody = ((elem.width * dryH * p.concUnitWeight) + (elem.width * subH * (p.concUnitWeight - p.seawaterUW))) * verticalFactor;
            V += wBody;
            Mr += wBody * (currentB - elem.width / 2);

            // 상부 상재하중(구조물 q1) 반영
            const isTopElem = (yTop >= p.cap.bottomEL + p.cap.height - 0.01);
            if (isTopElem && lc.sStr && p.surchargeStructure > 0) {
                // [KDS 기준 적용] 지진시 상재하중은 상시 하중의 50%만 적용함
                const surchargeFactor = isSeismic ? 0.5 : 1.0;
                const wSurcharge = (p.surchargeStructure * elem.width) * surchargeFactor * verticalFactor;
                V += wSurcharge;
                Mr += wSurcharge * (currentB - elem.width / 2);
            }

            // 앞소단(Toe) 중량 — 단면도와 동일한 기하형상으로 산정
            // 시각화 기준 Toe 형상 (_drawBlocks 참조):
            //   Segment 1 (하단 직사각형): 폭=toeW, 높이=armH (피복석 높이)
            //   Segment 2 (45° 사경면 삼각형): 밑변=toeW, 높이=toeW
            // 총 Toe 면적 = toeW × armH + 0.5 × toeW × toeW
            if (isBase && elem.width === baseWidth && toeW > 0 && toeArmorH > 0) {
                const armH = toeArmorH; // 피복석 높이 (Segment 1의 높이)
                const slopeH = toeW;    // 45° 사경면 높이 = toeW (Segment 2의 높이)
                const toeBotEL = elem.bottomEL;

                const γ_toe_dry = p.concUnitWeight || 23.0;
                const γ_toe_sub = (p.concUnitWeight || 23.0) - p.seawaterUW;

                // Segment 1: 하단 직사각형 (폭 toeW × 높이 armH)
                const seg1TopEL = toeBotEL + armH;
                const seg1SubH = Math.max(0, Math.min(currentWaterLevel, seg1TopEL) - Math.min(currentWaterLevel, toeBotEL));
                const seg1DryH = armH - seg1SubH;
                const wSeg1 = (toeW * seg1DryH * γ_toe_dry + toeW * seg1SubH * γ_toe_sub) * verticalFactor;
                const seg1CentroidX = toeW / 2; // Pivot(Toe 선단)으로부터의 거리

                // Segment 2: 45° 사경면 삼각형 (밑변 toeW × 높이 toeW)
                // 삼각형 면적 = 0.5 × toeW × slopeH
                const seg2BotEL = seg1TopEL;
                const seg2TopEL = seg2BotEL + slopeH;
                const seg2SubH = Math.max(0, Math.min(currentWaterLevel, seg2TopEL) - Math.min(currentWaterLevel, seg2BotEL));
                const seg2DryH = slopeH - seg2SubH;
                const seg2Area = 0.5 * toeW * slopeH; // 전체 삼각형 면적
                const seg2AvgWidth = seg2Area / slopeH; // 평균 폭 = toeW/2
                const wSeg2 = (seg2AvgWidth * seg2DryH * γ_toe_dry + seg2AvgWidth * seg2SubH * γ_toe_sub) * verticalFactor;
                const seg2CentroidX = toeW / 3; // 직각삼각형 도심: 밑변으로부터 1/3

                V += (wSeg1 + wSeg2);
                Mr += (wSeg1 * seg1CentroidX + wSeg2 * seg2CentroidX);
            }

            // 가상배면 해측 뒤채움사석
            // 가상배면 해측에 남는 뒤채움사석은 구조물계의 일부로 보고,
            // 검토 단면별로 잘라 자중 수직력(V)과 저항모멘트(Mr)에 포함한다.
            if (elem.width < baseWidth) {
                const sW = baseWidth - elem.width;
                const backfillRubbleVertical = ((sW * dryH * (p.rubbleUnitWeight || 18.0)) + (sW * subH * ((p.rubbleSatUnitWeight || 20.0) - p.seawaterUW))) * verticalFactor;
                V += backfillRubbleVertical;
                Mr += backfillRubbleVertical * (currentB - (elem.width + sW / 2));
                
                // 가상배면 상부 배후지 상재하중(q2)
                if (isTopElem && lc.sHint && p.surchargeHinterland > 0) {
                    // [KDS 기준 적용] 지진시 상재하중은 상시 하중의 50%만 적용함
                    const surchargeFactor = isSeismic ? 0.5 : 1.0;
                    const wHintSurcharge = (p.surchargeHinterland * sW) * surchargeFactor * verticalFactor;
                    V += wHintSurcharge;
                    Mr += wHintSurcharge * (currentB - (elem.width + sW / 2));
                }
            }

            // 지진 관성력 (inertia)
            // 가상배면 해측 뒤채움사석도 구조물계 질량으로 보아 관성력에 포함한다.
            if (isSeismic && lc.inertia) {
                const fi = (
                    elem.width * elem.height * p.concUnitWeight +
                    (baseWidth - elem.width) * elem.height * (p.rubbleUnitWeight || 18.0)
                ) * p.seismicKh;
                totalInertiaH += fi;
                totalInertiaM += fi * ((yBot + elem.height / 2) - checkEL);
            }
        });

        // 3. 수평력(H) 및 전도모멘트(Mo)
        const wallTopEL = p.cap.bottomEL + p.cap.height;

        // [KDS 기준 교정] 잔류수위(RWL) 산정
        // 유저 입력값(residualHead)을 "ALLW로부터의 잔류수위 상승고(Rise)"로 해석함.
        // RWL = ALLW + residualHead
        const rwl_elevation = (p.allw || 0) + (p.residualHead || 0);
        const rwl = lc.residual ? Math.max(currentWaterLevel, rwl_elevation) : currentWaterLevel;
        
        // 토압 이론 선택에 따른 벽면마찰각(δ) 적용
        // - Rankine 토압: δ = 0 (벽면마찰 무시, 가상배면 가정)
        // - Coulomb 토압: δ = 사용자 입력값 (벽면마찰 고려)
        const useRankine = (p.earthPressureMethod === 'rankine');
        const delta = useRankine ? 0 : (p.wallFrictionAngle || 0);
        
        // [KDS 기준 반영] 지진시 토압 계산 규칙:
        // 1. 배면토 건조부: 설계수평진도(kh) 사용
        // 2. 배면토 수중부: 부력에 의한 관성효과 증가를 고려한 '수중 겉보기 진도(kh')' 사용
        //    공식: kh' = kh × γsat / (γsat - γw)
        
        // [단순화 근사] 수중 겉보기 진도 kh' = kh × γsat / (γsat - γw)
        // KDS 64 17 00 해설 식(4.1-6)은 건조층 두께(hi), 포화층 두께(hj), 상재하중(w)을
        // 포함하는 일반식이나, 현재 앱은 단일 균질 토층 가정으로 축약 적용함.
        // 토압 계산에서는 dH/wH를 분리하므로, kh'도 일반식으로 확장하면 더 엄밀해짐.
        const soilSatUW = p.soilSatUnitWeight || 20.0;
        const gammaPrime = soilSatUW - p.seawaterUW;
        const kh_prime = (gammaPrime > 0) ? p.seismicKh * (soilSatUW / gammaPrime) : p.seismicKh;

        let ka_dry, ka_wet;
        if (useRankine) {
            // Rankine 지지: 벽면마찰각 δ = 0 적용
            // 실무 지침: Rankine 선택 시에도 지진시에는 Mononobe-Okabe 공식을 δ=0으로 적용함.
            ka_dry = isSeismic ? mononobeOkabeKea(p.soilPhi, 0, p.seismicKh) : rankineKa(p.soilPhi);
            ka_wet = isSeismic ? mononobeOkabeKea(p.soilPhi, 0, kh_prime) : rankineKa(p.soilPhi);
        } else {
            // Coulomb 지지: 사용자 입력 δ 반영
            ka_dry = isSeismic ? mononobeOkabeKea(p.soilPhi, delta, p.seismicKh) : coulombKa(p.soilPhi, delta);
            ka_wet = isSeismic ? mononobeOkabeKea(p.soilPhi, delta, kh_prime) : coulombKa(p.soilPhi, delta);
        }

        const dH = Math.max(0, wallTopEL - Math.max(rwl, checkEL)); 
        const wH = Math.max(0, Math.min(rwl, wallTopEL) - checkEL); 

        // 3-1. 토압 (건조부 삼각형 + 수중부 사각형/삼각형 분리)
        if (dH > 0) {
            const P1 = 0.5 * p.soilUnitWeight * ka_dry * dH * dH;
            H += P1; Mo += P1 * (wH + dH / 3);
        }
        if (wH > 0) {
            const P2 = (p.soilUnitWeight * dH) * ka_wet * wH; 
            const P3 = 0.5 * p.soilSubmergedUW * ka_wet * wH * wH; 
            H += (P2 + P3); Mo += (P2 * wH / 2 + P3 * wH / 3);
        }

        // 3-2. 상재하중 토압 (수평력)
        let q = 0;
        if(lc.sStr) q += p.surchargeStructure;
        if(lc.sHint) q += p.surchargeHinterland;
        // [KDS 기준 적용] 지진시 상재하중은 상시의 50%만 적용
        const surchargeFactor = isSeismic ? 0.5 : 1.0;
        q *= surchargeFactor;

        if (q > 0) {
            const Pq_dry = q * ka_dry * dH;
            const Pq_wet = q * ka_wet * wH;
            H += (Pq_dry + Pq_wet);
            Mo += (Pq_dry * (wH + dH / 2) + Pq_wet * (wH / 2));
        }

        // 3-3. 잔류수압 (RWL > 외부수위 일 때 발생)
        // [핵심 교정 사항] 검토 단면(checkEL)보다 "위에" 위치한 물기둥만 블록의 수평력으로 작용해야 함.
        if (lc.residual && rwl > currentWaterLevel && rwl > checkEL) {
            const P1 = currentWaterLevel;
            const P2 = rwl;
            const E = checkEL;

            if (E >= P1) {
                // Case 1: 검토 단면이 외부 수위보다 높은 경우 (잔류수압 분포 중 "상단 일부 삼각형"만 해당 단면에 작용)
                const h_tri = P2 - E;
                const Prw_tri = 0.5 * p.seawaterUW * h_tri * h_tri;
                H += Prw_tri;
                Mo += Prw_tri * (h_tri / 3);
            } else {
                // Case 2: 검토 단면이 외부 수위보다 낮은 경우 (전체 삼각형 + 직사각형 일부가 모두 작용)
                const h_tri = P2 - P1;
                const h_rect = P1 - E;
                const Prw_tri = 0.5 * p.seawaterUW * h_tri * h_tri;
                const Prw_rect = p.seawaterUW * h_tri * h_rect;
                
                H += (Prw_tri + Prw_rect);
                Mo += Prw_tri * (h_rect + h_tri / 3) + Prw_rect * (h_rect / 2);
            }
        }

        // 3-4. 지진 관성력 및 동수압 (Westergaard 간편식)
        if (isSeismic) {
            H += totalInertiaH; Mo += totalInertiaM;
            // [부호 규약] 해측 동수압 (Westergaard 해설 식 4.1-14, 작용점 식 4.1-15)
            // KDS 원문은 ± 부호. 현재 앱은 배면토압 증가(해측으로 밀림)를 임계 방향(+H)으로
            // 채택하며, 이 방향에서 전면 동수압은 벽체를 육측으로 되미는 효과(-H)로 작용.
            // 이는 현재 부호 체계와 임계 거동 방향에 대한 설계 판단이며, KDS 고정 규칙은 아님.
            if (lc.hydroDynamic) {
                const hw = Math.max(0, currentWaterLevel - checkEL);
                const Pdw = (7/12) * p.seismicKh * p.seawaterUW * hw * hw;
                H -= Pdw; Mo -= Pdw * (0.4 * hw);
            }
        }

        // 3-5. 견인력 (Bollard − 상치 선단(해측)에 수평 작용)
        if (lc.bollard && p.bollardForce > 0) {
            H += p.bollardForce; Mo += p.bollardForce * (wallTopEL - checkEL);
        }

        // 4. 안정성 수치 산출
        // 활동 안전율: Fs = μV / H
        const sfS = (H > 0) ? (V * mu / H) : Infinity;
        // 전도 안전율: Fs = ΣMr / ΣMo (ΣMv / ΣMH)
        const sfO = (Mo > 0) ? (Mr / Mo) : Infinity;

        // 지지력용 편심 및 반력분포 산정
        const netM = Mr - Mo;
        const xR = (V > 0) ? (netM / V) : (currentB / 2);
        const ecc = (currentB / 2) - xR;

        // 종래식 하중분산법:
        // p1  = 사석 마운드 상면 최대접지압
        // p1' = 기초지반 상면 최대응력
        // b   = 사석 마운드 상면 저면반력분포 폭
        // L   = 기초지반 상면 하중분포 폭
        let p1 = 0;
        let distType = '';
        let b = 0;
        if (V <= 0) {
            p1 = 0;
            distType = '수직력 없음';
        } else if (Math.abs(ecc) >= currentB / 2) {
            p1 = 99999;
            distType = '⚠ 전도 임박';
        } else if (Math.abs(ecc) <= currentB / 6) {
            b = currentB;
            p1 = (V / currentB) * (1 + 6 * Math.abs(ecc) / currentB);
            distType = '사다리꼴 분포';
        } else {
            b = 3 * (currentB / 2 - Math.abs(ecc));
            p1 = (b > 0.01) ? (2 * V / b) : 99999;
            distType = (b > 0.01) ? '삼각형 분포' : '⚠ 전도 임박';
        }

        const alphaRad = (V > 0) ? Math.atan2(H, V) : 0;
        const alphaDeg = alphaRad * 180 / Math.PI;
        const moundThickness = Math.max(0, p.rubbleHeight || 0);
        const rubbleSubUW = (p.rubbleSatUnitWeight || 20.0) - p.seawaterUW;
        const spreadPlus = Math.tan((30 + alphaDeg) * Math.PI / 180);
        const spreadMinus = Math.tan((30 - alphaDeg) * Math.PI / 180);
        const L = (V <= 0 || p1 >= 99999 || b <= 0) ? 0 : Math.max(0.01, b + moundThickness * (spreadPlus + spreadMinus));
        const p1Prime = (V <= 0) ? 0 : ((p1 >= 99999 || L <= 0 || b <= 0) ? 99999 : ((b / L) * p1 + rubbleSubUW * moundThickness));

        return {
            sfS, sfO, ecc, qmax: p1, currentB, V, H, Mr, Mo, distType,
            p1, p1Prime, b, L, alphaDeg, moundThickness
        };
    }

    function calcOneCase(lc, p) {
        const isSeismic = (lc.group === 'seismic');
        const sfReqSlide    = isSeismic ? SF_SLIDING.seismic  : SF_SLIDING.normal;
        const sfReqOverturn = isSeismic ? SF_OVERTURN.seismic : SF_OVERTURN.normal;

        const waterLevels = [
            { name: 'App. HHW', val: p.ahhw ?? 0 },
            { name: 'App. LLW', val: p.allw ?? 0 }
        ];

        // 1. 모든 조위/단면 조합의 데이터 생성
        const allPossibleResults = [];
        waterLevels.forEach(lvl => {
            const checkJoints = [];
            checkJoints.push({ name: '상치하단', el: p.cap.bottomEL, isBase: false });
            p.blocks.forEach((b, i) => checkJoints.push({ name: `블록 ${p.blocks.length-i} 하단`, el: b.bottomEL, isBase: (i===p.blocks.length-1) }));

            checkJoints.forEach(j => {
                const res = calculateAtLevel(lc, p, j.el, j.isBase, lvl.val);
                allPossibleResults.push({ 
                    ...res, 
                    isBase: j.isBase,
                    jointName: j.name, 
                    levelName: lvl.name
                });
            });
        });

        // 2. 검토항목별 임계 조건 독립 추출
        // 2-1. 활동 (Joint Sliding): 기초면 제외한 내부 단면 중 최소 Fs
        const jointResults = allPossibleResults.filter(r => !r.isBase);
        const critJointSliding = jointResults.length > 0 
            ? jointResults.reduce((m, c) => c.sfS < m.sfS ? c : m, jointResults[0]) 
            : allPossibleResults[0];

        // 2-2. 직선활동 (Base Sliding): 최하단 기초면에서의 Fs
        const baseResults = allPossibleResults.filter(r => r.isBase);
        const critBaseSliding = baseResults.length > 0 
            ? baseResults.reduce((m, c) => c.sfS < m.sfS ? c : m, baseResults[0])
            : allPossibleResults[0];

        // 2-3. 전도 (Overturning): 기초면에서의 최소 전도 안전율 검토
        const critOverturn = baseResults.length > 0
            ? baseResults.reduce((m, c) => c.sfO < m.sfO ? c : m, baseResults[0])
            : allPossibleResults[0];

        const qta = isSeismic ? (p.allowableBearingTopSeismic || 600) : (p.allowableBearingTop || 500);
        const qa = isSeismic ? (p.allowableBearingSeismic || 600) : (p.allowableBearing || 500);
        const bearingUtil = r => Math.max(
            qta > 0 ? r.p1 / qta : Infinity,
            qa > 0 ? r.p1Prime / qa : Infinity
        );

        // 2-4. 지지력 (종래식 하중분산법): p1, p1' 조합 중 가장 불리한 조건 검토
        const critBearing = baseResults.length > 0
            ? baseResults.reduce((m, c) => bearingUtil(c) > bearingUtil(m) ? c : m, baseResults[0])
            : allPossibleResults[0];

        return {
            caseName: lc.name,
            group: lc.group,
            slidingJoint: { 
                sf: critJointSliding.sfS, 
                required: sfReqSlide, 
                pass: critJointSliding.sfS >= sfReqSlide,
                criticalLevel: critJointSliding.jointName,
                criticalWater: critJointSliding.levelName
            },
            slidingBase: { 
                sf: critBaseSliding.sfS, 
                required: sfReqSlide, 
                pass: critBaseSliding.sfS >= sfReqSlide,
                criticalLevel: critBaseSliding.jointName,
                criticalWater: critBaseSliding.levelName
            },
            overturning: { 
                sf: critOverturn.sfO, 
                required: sfReqOverturn,
                pass: critOverturn.sfO >= sfReqOverturn,
                criticalLevel: critOverturn.jointName,
                criticalWater: critOverturn.levelName
            },
            bearing: { 
                qmax: critBearing.p1,
                p1: critBearing.p1,
                p1Prime: critBearing.p1Prime,
                qta,
                qa,
                ecc: critBearing.ecc,
                eccLimit: critBearing.currentB / 6,
                currentB: critBearing.currentB,
                b: critBearing.b,
                L: critBearing.L,
                alphaDeg: critBearing.alphaDeg,
                moundThickness: critBearing.moundThickness,
                checkType: 'traditional_load_spread',
                stage1Pass: critBearing.p1 <= qta,
                stage2Pass: critBearing.p1Prime <= qa,
                pass: (
                    critBearing.p1 <= qta &&
                    critBearing.p1Prime <= qa
                ),
                criticalLevel: critBearing.jointName,
                criticalWater: critBearing.levelName,
                distType: critBearing.distType || '',
                circularSlipReview: 'external_required'
            }
        };
    }

    function calculateAll(params) {
        const cases = getLoadCases(params.bollardForce || 0);
        return cases.map(lc => calcOneCase(lc, params));
    }

    // ── 피복석 소요중량 (이스바쉬 공식, KDS 64 10 10 §4.3.10.3) ──
    // M = π·ρᵣ·V⁶ / [48·g³·y⁶·(Sᵣ-1)³·(cosθ-sinθ)³]
    function calcArmorStoneIsbash(p) {
        const V = p.currentVelocity || 0;        // 설계 조류속 (m/s)
        if (V <= 0) return null;

        const rhoR = p.armorDensity || 2.65;     // 피복석 밀도 (t/m³)
        const rhoW = (p.seawaterUW || 10.1) / 9.81; // 해수 밀도 (t/m³)
        const Sr = rhoR / rhoW;                  // 비중
        const y = p.isbashCoeff || 0.86;          // 이스바쉬 정수
        const slopeRatio = 1.5;                   // 전면 경사 1:1.5
        const theta = Math.atan(1 / slopeRatio);  // 경사각 (rad)
        const g = 9.81;

        const cosT = Math.cos(theta);
        const sinT = Math.sin(theta);
        const denom = 48 * Math.pow(g, 3) * Math.pow(y, 6) * Math.pow(Sr - 1, 3) * Math.pow(cosT - sinT, 3);
        if (denom <= 0) return null;

        const M = Math.PI * rhoR * Math.pow(V, 6) / denom; // 소요질량 (t)
        const W = M * 9.81;                      // 소요중량 (kN)
        const volReq = M / rhoR;                  // 소요체적 (m³/ea)
        const dReq = Math.pow(6 * volReq / Math.PI, 1/3); // 등가 구 직경 (m)

        // 현재 설치된 피복석
        const volCurrent = p.armorVolume || 0.2;
        const massCurrent = volCurrent * rhoR;

        return {
            requiredMass: M,        // t
            requiredWeight: W,      // kN
            requiredVolume: volReq,  // m³/ea
            requiredDiameter: dReq,  // m
            currentVolume: volCurrent,
            currentMass: massCurrent,
            pass: massCurrent >= M,
            ratio: M > 0 ? massCurrent / M : Infinity,
            inputs: { V, rhoR, rhoW, Sr, y, theta: theta * 180 / Math.PI, slopeRatio }
        };
    }

    return { calculateAll, getLoadCases, LOAD_CASES_BASE, calcArmorStoneIsbash };
})();

window.StabilityAnalysis = StabilityAnalysis;

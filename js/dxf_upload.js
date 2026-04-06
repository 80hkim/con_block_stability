/**
 * dxf_upload.js — DXF 단면도 업로드 → Gemini AI 자동 인식 → 입력값 세팅
 * 콘크리트 블록식 안벽 전용
 * 의존: dxf-parser (CDN), Gemini API key (geminiApiKey input)
 */
(function () {
    'use strict';

    const fileInput = document.getElementById('dxfFileInput');
    const uploadBtn = document.querySelector('.dxf-upload-btn');
    if (!fileInput || !uploadBtn) return;

    // 호버 효과
    uploadBtn.addEventListener('mouseenter', () => {
        uploadBtn.style.background = 'rgba(59,130,246,0.3)';
        uploadBtn.style.borderColor = 'rgba(59,130,246,0.8)';
    });
    uploadBtn.addEventListener('mouseleave', () => {
        uploadBtn.style.background = 'rgba(59,130,246,0.15)';
        uploadBtn.style.borderColor = 'rgba(59,130,246,0.5)';
    });

    fileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        fileInput.value = ''; // 동일 파일 재선택 허용

        const apiKey = document.getElementById('geminiApiKey')?.value?.trim();
        if (!apiKey) {
            alert('Gemini API Key를 먼저 입력해주세요.');
            return;
        }

        // 상태 표시
        const origText = uploadBtn.innerHTML;
        uploadBtn.innerHTML = '⏳ 파싱 중...';
        uploadBtn.style.pointerEvents = 'none';

        try {
            // 1. DXF 파일 읽기 + 파싱
            const text = await file.text();
            const parser = new DxfParser();
            const dxf = parser.parseSync(text);

            if (!dxf || !dxf.entities || dxf.entities.length === 0) {
                throw new Error('DXF 파일에서 도형을 찾을 수 없습니다.');
            }

            // 2. 엔티티 요약 (Gemini 전달용)
            const entities = summarizeEntities(dxf);
            if (entities.length === 0) {
                throw new Error('인식 가능한 도형(LINE, POLYLINE)이 없습니다.');
            }

            // 3. Gemini AI 분석 요청
            uploadBtn.innerHTML = '🤖 AI 분석 중...';
            const result = await askGemini(apiKey, entities);

            // 4. 입력값 적용
            applyResult(result);

            uploadBtn.innerHTML = '✅ 적용 완료!';
            setTimeout(() => { uploadBtn.innerHTML = origText; }, 2000);

        } catch (err) {
            console.error('DXF upload error:', err);
            alert('DXF 처리 오류: ' + err.message);
            uploadBtn.innerHTML = origText;
        } finally {
            uploadBtn.style.pointerEvents = 'auto';
        }
    });

    /** DXF 엔티티를 간결한 JSON으로 요약 */
    function summarizeEntities(dxf) {
        const result = [];
        for (const e of dxf.entities) {
            if (e.type === 'LINE') {
                result.push({
                    t: 'L',
                    s: [round(e.start.x), round(e.start.y)],
                    e: [round(e.end.x), round(e.end.y)],
                    ly: e.layer || '0'
                });
            } else if (e.type === 'LWPOLYLINE' || e.type === 'POLYLINE') {
                result.push({
                    t: 'PL',
                    v: e.vertices.map(v => [round(v.x), round(v.y)]),
                    c: !!e.shape,
                    ly: e.layer || '0'
                });
            } else if (e.type === 'CIRCLE') {
                result.push({
                    t: 'C',
                    center: [round(e.center.x), round(e.center.y)],
                    r: round(e.radius),
                    ly: e.layer || '0'
                });
            } else if (e.type === 'ARC') {
                result.push({
                    t: 'A',
                    center: [round(e.center.x), round(e.center.y)],
                    r: round(e.radius),
                    sa: round(e.startAngle),
                    ea: round(e.endAngle),
                    ly: e.layer || '0'
                });
            }
        }
        return result;
    }

    function round(v) { return Math.round(v * 1000) / 1000; }

    /** Gemini API 호출 */
    async function askGemini(apiKey, entities) {
        const prompt = `아래는 콘크리트 블록식 안벽의 단면도 DXF 파일에서 추출한 도형 좌표입니다.
t=L: 직선 (s=시작점, e=끝점)
t=PL: 폴리라인 (v=꼭짓점 배열, c=폐합 여부)
t=C: 원 (center, r=반지름)
t=A: 호 (center, r, sa=시작각, ea=끝각)
ly: 레이어명

이 좌표들을 분석하여 콘크리트 블록식 안벽의 단면 치수를 추출해주세요.

콘크리트 블록식 안벽 구조 (위에서 아래로):
- 상치콘크리트 (Cap): 최상단 무근 콘크리트 블록
- 블록 1~N단: 위에서 아래로 적층된 직사각형 콘크리트 블록 (각각 폭과 높이가 다름)
- 최하단 블록 아래에 기초사석(rubble mound)이 위치
- 기초사석 아래가 원지반(해저면)

추출 항목 (JSON):
{
  "crownEL": 마루고 EL (m, 최상단 = 상치콘크리트 상단),
  "capWidth": 상치콘크리트 폭 (m),
  "capBottomEL": 상치콘크리트 하단 EL (m),
  "blocks": [
    {"width": 블록1 폭(m), "bottomEL": 블록1 하단 EL(m)},
    {"width": 블록2 폭(m), "bottomEL": 블록2 하단 EL(m)},
    ...
  ],
  "seabedEL": 원지반(해저면) EL (m, 기초사석 하단)
}

주의사항:
- 도면의 Y좌표가 EL(표고)에 해당합니다
- blocks 배열은 위에서 아래 순서로 나열 (블록1이 최상단)
- 블록은 보통 아래로 갈수록 폭이 넓어집니다
- 상치콘크리트는 블록보다 폭이 좁거나 같습니다
- 블록 수는 도면에서 식별되는 만큼만 포함 (보통 1~10단)
- 불확실한 값은 null로 설정

반드시 위 JSON 형식만 응답하세요. 설명 없이 JSON만 출력하세요.

도형 좌표:
${JSON.stringify(entities)}`;

        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
        const resp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { temperature: 0.1, maxOutputTokens: 1024 }
            })
        });

        if (!resp.ok) {
            const err = await resp.text();
            throw new Error(`Gemini API 오류 (${resp.status}): ${err}`);
        }

        const data = await resp.json();
        const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';

        // JSON 추출 (```json ... ``` 또는 순수 JSON)
        const jsonMatch = rawText.match(/```json\s*([\s\S]*?)```/) || rawText.match(/(\{[\s\S]*\})/);
        if (!jsonMatch) throw new Error('AI 응답에서 JSON을 찾을 수 없습니다.\n' + rawText);

        return JSON.parse(jsonMatch[1]);
    }

    /** AI 결과를 입력 필드에 적용 */
    function applyResult(data) {
        const applied = [];

        // 1. 마루고
        if (data.crownEL != null) {
            setField('crownEL', data.crownEL, applied, '마루고');
        }

        // 2. 상치콘크리트
        if (data.capWidth != null) {
            setField('capWidth', data.capWidth, applied, 'Cap 폭');
        }
        if (data.capBottomEL != null) {
            setField('capBottomEL', data.capBottomEL, applied, 'Cap 하단EL');
        }

        // 3. 해저면
        if (data.seabedEL != null) {
            setField('seabedEL', data.seabedEL, applied, '해저면EL');
        }

        // 4. 블록 단수 및 치수
        if (Array.isArray(data.blocks) && data.blocks.length > 0) {
            const blockCount = Math.min(data.blocks.length, 10);

            // 블록 단수 설정
            const blockCountSelect = document.getElementById('blockCount');
            if (blockCountSelect) {
                blockCountSelect.value = blockCount;
                blockCountSelect.dispatchEvent(new Event('change', { bubbles: true }));
                applied.push(`블록 단수: ${blockCount}`);
            }

            // 블록 단수 변경 후 DOM 업데이트 대기
            setTimeout(() => {
                for (let i = 0; i < blockCount; i++) {
                    const block = data.blocks[i];
                    if (!block) continue;

                    // 폭 입력
                    if (block.width != null) {
                        const widthInput = document.querySelector(`.block-width-input[data-index="${i}"]`);
                        if (widthInput) {
                            widthInput.value = block.width;
                            widthInput.dispatchEvent(new Event('input', { bubbles: true }));
                            highlight(widthInput);
                            applied.push(`블록${i + 1} 폭: ${block.width}m`);
                        }
                    }

                    // 하단 EL 입력
                    if (block.bottomEL != null) {
                        const elInput = document.querySelector(`.block-bottom-input[data-index="${i}"]`);
                        if (elInput) {
                            elInput.value = block.bottomEL;
                            elInput.dispatchEvent(new Event('input', { bubbles: true }));
                            highlight(elInput);
                            applied.push(`블록${i + 1} 하단EL: ${block.bottomEL}m`);
                        }
                    }
                }

                console.log('[DXF] Applied:', applied);
            }, 100);
        }

        console.log('[DXF] Applied (immediate):', applied);

        if (applied.length === 0) {
            alert('AI가 치수를 추출하지 못했습니다. DXF 파일을 확인해주세요.');
        }
    }

    function setField(id, value, applied, label) {
        const el = document.getElementById(id);
        if (!el) return;
        const val = parseFloat(value);
        if (isNaN(val)) return;
        el.value = val;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        highlight(el);
        applied.push(`${label}: ${val}`);
    }

    function highlight(el) {
        el.style.transition = 'background 0.3s';
        el.style.background = 'rgba(59,130,246,0.2)';
        setTimeout(() => { el.style.background = ''; }, 3000);
    }

})();

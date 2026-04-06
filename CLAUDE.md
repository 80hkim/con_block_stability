# Orchestrator — 콘크리트 블록식 안벽 안정검토 Harness

이 파일은 전체 에이전트 파이프라인의 **오케스트레이터**다.
사용자 요청을 받으면 아래 흐름에 따라 적절한 에이전트를 호출하고, 결과를 조율한다.

---

## 파이프라인 흐름

```
사용자 요청
    │
    ├─ 기준 해석이 필요한가? ──► agents/standards_researcher.md
    │                                │
    │                                ▼
    ├─ 계획이 필요한가? ───────► agents/planner.md
    │  (단순 버그는 건너뜀)           │
    │                                ▼  output/plan.md
    │
    ├─────────────────────────► agents/generator.md
    │                                │
    │                                ▼  코드 변경
    │
    ├─── 검증 (조건부 병렬) ────┬── agents/evaluator.md          → output/eval_report.md  [필수]
    │                           ├── agents/numerical_verifier.md → output/verify.md       [계산 로직 변경 시]
    │                           └── agents/ai_prompt_auditor.md  → output/audit.md        [프롬프트 변경 시]
    │
    └─ 결과 종합 → 사용자에게 보고 (PASS / FAIL + 사유)
```

## 에이전트 호출 규칙

1. **Standards Researcher 우선 호출 조건**
   - 새로운 KDS 기준 반영 요청
   - 기존 수식/계수의 정합성 의문
   - 설계기준 문서 간 교차 참조 필요

2. **Planner 호출 조건**
   - 새 기능 추가, 기존 로직 수정, 리팩토링 요청
   - Standards Researcher 결과가 있으면 `output/research.md`를 입력으로 전달

3. **Generator 호출 조건**
   - **모드 A (계획 기반)**: `output/plan.md`가 존재할 때 코드 생성/수정 수행
   - **모드 B (직접 수정)**: 단순 버그 수정(1~2파일, 10줄 이내)은 Planner 없이 직접 호출 가능. 오케스트레이터가 버그 내용과 대상 파일을 직접 전달한다

4. **검증 에이전트 (병렬 호출)**
   - **Evaluator**: 모든 코드 변경 후 필수 실행
   - **Numerical Verifier**: `stability.js` 또는 계산 로직(`calculateAtLevel`, `calcOneCase`, `calculateAll` 등) 변경 시 실행. UI/스타일만 변경한 경우 생략
   - **AI Prompt Auditor**: `ai_chat.js`의 프롬프트/응답 로직 변경 시 실행

5. **재실행 조건**
   - 검증 에이전트가 FAIL을 반환하면 Generator를 재호출하여 수정
   - 최대 2회 반복 후에도 FAIL이면 사용자에게 판단 요청

## 토큰 절약 규칙

- `../항만_어항설계기준_MD/` 폴더는 Standards Researcher만 접근한다
- 다른 에이전트가 설계기준 원문이 필요하면 Standards Researcher의 출력물을 참조한다
- `항설설계기준_반영_정리.md`는 Planner, Evaluator가 요약 참조용으로 읽을 수 있다
- 대용량 파일(`*.xlsx`, `*.pdf`, `upstage_*.json`)은 명시적 요청이 없는 한 읽지 않는다

## 프로젝트 구조

```
├── CLAUDE.md                      ← 이 파일 (오케스트레이터)
├── agents/
│   ├── planner.md                 ← 구현 계획 수립
│   ├── generator.md               ← 코드 생성/수정
│   ├── evaluator.md               ← 코드 품질 + 기준 부합 평가
│   ├── standards_researcher.md    ← KDS 원문 해석 전문가
│   ├── numerical_verifier.md      ← 수치 손계산 대조 검증
│   ├── ai_prompt_auditor.md       ← AI 프롬프트/응답 감수
│   └── evaluation_criteria.md     ← 공용 채점 기준
├── output/                        ← 에이전트 산출물
├── START.md                       ← 실행 방법 안내
├── index.html                     ← SPA 메인
├── css/style.css
├── js/
│   ├── main.js                    ← 컨트롤러
│   ├── stability.js               ← 안정검토 계산 엔진
│   ├── visualization.js           ← 단면도 시각화
│   ├── ai_chat.js                 ← Gemini AI 통합 (자문/NG분석/최적화)
│   └── dxf_upload.js              ← DXF 업로드 → AI 인식
├── ../항만_어항설계기준_MD/            ← KDS 설계기준 원문 (Standards Researcher 전용)
└── 항설설계기준_반영_정리.md         ← 기준 반영 요약 (공용 참조)
```

## Primary edit targets
- `index.html`
- `css/style.css`
- `js/main.js`
- `js/stability.js`
- `js/visualization.js`
- `js/ai_chat.js`
- `js/dxf_upload.js`

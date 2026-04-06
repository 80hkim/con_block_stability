# START — Harness 실행 방법

## 개요

이 프로젝트는 **에이전트 하네스 패턴**으로 구성되어 있다.
`CLAUDE.md`(오케스트레이터)가 사용자 요청에 따라 전문 에이전트를 호출하고, 결과를 조율한다.

---

## 실행 방법

### 1. 일반적인 기능 추가/수정 요청

사용자가 기능 추가나 수정을 요청하면 오케스트레이터가 자동으로 아래 흐름을 실행한다:

```
요청 → [Planner] → [Generator] → [Evaluator] → 완료
```

계산 로직(`stability.js` 등)이 변경된 경우에만 Numerical Verifier가 추가된다:
```
요청 → [Planner] → [Generator] → [Evaluator + Numerical Verifier] → 완료
```

특별히 에이전트를 지정할 필요 없이 요청만 하면 된다.

### 2. 단순 버그 수정

1~2개 파일, 10줄 이내의 단순 버그는 Planner를 건너뛴다.
검증은 아래 표의 호출 기준에 따라 조건부로 실행된다:

```
요청 → [Generator 직접 수정 모드] → [Evaluator (필수)]        → 완료
                                  + [Numerical Verifier]  ← stability.js/계산 로직 변경 시
                                  + [AI Prompt Auditor]   ← ai_chat.js 프롬프트 변경 시
```

### 3. 설계기준 관련 요청

KDS 기준의 해석이나 검증이 필요한 경우:

```
요청 → [Standards Researcher] → [Planner] → [Generator] → [검증] → 완료
```

### 4. AI 프롬프트 관련 요청

Gemini AI의 프롬프트 수정이 필요한 경우:

```
요청 → [Planner] → [Generator] → [AI Prompt Auditor + Evaluator] → 완료
```

### 5. 특정 에이전트 단독 실행

특정 에이전트만 실행하고 싶으면 직접 지정할 수 있다.
단독 실행 시에는 `output/plan.md` 없이 현재 코드 상태를 직접 대상으로 한다:

- "기준 조사만 해줘" → Standards Researcher — 현재 코드와 KDS 원문 대조
- "수치검증만 해줘" → Numerical Verifier — 현재 `stability.js`의 계산 결과를 손계산과 대조
- "프롬프트 감수만 해줘" → AI Prompt Auditor — 현재 `ai_chat.js`의 프롬프트 규칙 점검

---

## 검증 에이전트 호출 기준 (CLAUDE.md와 동일)

| 에이전트 | 호출 조건 |
|----------|----------|
| **Evaluator** | 모든 코드 변경 후 필수 |
| **Numerical Verifier** | `stability.js` 또는 계산 로직(`calculateAtLevel`, `calcOneCase`, `calculateAll`) 변경 시. UI/스타일만 변경한 경우 생략 |
| **AI Prompt Auditor** | `ai_chat.js`의 프롬프트/응답 로직 변경 시 |

---

## 에이전트 목록

| 에이전트 | 파일 | 역할 |
|----------|------|------|
| Planner | `agents/planner.md` | 구현 계획 수립 |
| Generator | `agents/generator.md` | 코드 생성/수정 (계획 기반 + 직접 수정 모드) |
| Evaluator | `agents/evaluator.md` | 코드 품질 + 기준 부합 평가 |
| Standards Researcher | `agents/standards_researcher.md` | KDS 원문 해석 |
| Numerical Verifier | `agents/numerical_verifier.md` | 수치 손계산 대조 |
| AI Prompt Auditor | `agents/ai_prompt_auditor.md` | AI 프롬프트/응답 감수 |

## 산출물

모든 에이전트 산출물은 `output/` 폴더에 저장된다:

| 파일 | 생성 에이전트 |
|------|-------------|
| `output/plan.md` | Planner |
| `output/research.md` | Standards Researcher |
| `output/eval_report.md` | Evaluator |
| `output/verify.md` | Numerical Verifier |
| `output/audit.md` | AI Prompt Auditor |

## 채점 기준

공용 채점 기준은 `agents/evaluation_criteria.md`에 정의되어 있다.
검증 에이전트 3개(Evaluator, Numerical Verifier, AI Prompt Auditor)가 공통으로 참조한다.

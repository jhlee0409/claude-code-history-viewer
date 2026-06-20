---
description: AI PR 리뷰 코멘트를 triage하고 유효한 것만 안전하게 수정
argument-hint: "[PR 번호 — 생략 시 현재 브랜치의 PR]"
---

# PR 리뷰 코멘트 확인

AI 리뷰어(CodeRabbit, Claude bot, Codex, Gemini, Copilot 등)가 남긴 코멘트를 수집 · 분류 · 영향 분석 후, **승인된 유효 이슈만** 한 건씩 원자적으로 수정한다.

**Absolute rules (MUST follow):**
- MUST produce the triage report and get user approval BEFORE modifying any code.
- MUST NOT copy-paste AI-suggested patches verbatim. Understand the concern, then re-derive the fix from scratch.
- MUST fix one issue at a time. NO drive-by refactors, formatting changes, or style cleanups.
- MUST write GitHub replies in English (user preference).
- MUST NOT auto-resolve review threads. Let the reviewer (or the bot's re-review) close them.
- MUST NOT invoke adversarial CLIs (gemini/codex) without explicit user approval.

입력 인자: `$ARGUMENTS` (PR 번호, 생략 가능)

---

## Phase 0 — 수집 (Collect)

1. **PR 번호 결정**: 인자가 있으면 사용, 없으면 `gh pr view --json number -q .number` 로 현재 브랜치의 PR 확인. PR이 없으면 사용자에게 물어본다.
2. **리뷰 데이터 fetch** (REST + GraphQL 조합):
   - `gh api repos/{owner}/{repo}/pulls/{N}/comments` — 인라인 코멘트
   - `gh api repos/{owner}/{repo}/pulls/{N}/reviews` — 리뷰 레벨 body
   - GraphQL로 review threads + resolution 상태:
     ```
     gh api graphql -f query='
       query($owner:String!,$repo:String!,$num:Int!){
         repository(owner:$owner,name:$repo){
           pullRequest(number:$num){
             reviewThreads(first:100){nodes{
               id isResolved isOutdated
               comments(first:20){nodes{id databaseId author{login} body path line originalLine diffHunk}}
             }}
           }
         }
       }' -f owner=... -f repo=... -F num=...
     ```
3. **AI 봇 필터**: author login이 `coderabbitai`, `coderabbitai[bot]`, `claude[bot]`, `chatgpt-codex-connector`, `gemini-code-assist[bot]`, `copilot-pull-request-reviewer[bot]`, `github-actions[bot]` 중 하나인 것만. 인간 리뷰어 코멘트는 이 워크플로우 대상 아님 — 별도로 보고.
4. **resolved/outdated 스레드 제외** (이미 대응 완료).
5. PR의 변경 파일 목록도 같이 확보: `gh pr diff {N} --name-only` — "in-scope" 판정에 사용.

## Phase 1 — 분류 (Triage) — **코드 수정 금지**

각 코멘트에 대해 아래를 판정한다. 결과는 **테이블로 사용자에게 먼저 보고하고 승인 대기**한다.

### 1-1. 중복 제거

여러 봇이 같은 파일+라인+본질적으로 같은 지적을 하면 하나의 행으로 병합. `Sources` 컬럼에 여러 봇 표시.

### 1-2. 분류 축 (4개)

| 축 | 값 |
|----|-----|
| **Severity** | `Critical` (동작 파괴/데이터 유출/롤백 차단) / `Warning` (정확성 위험) / `Suggestion` (개선 제안) / `Nit` (스타일·취향) |
| **Validity** | `valid` / `false-positive` / `needs-investigation` |
| **Scope** | `in-scope` (이 PR diff에 포함된 파일·라인) / `out-of-scope` (기존 코드, 이 PR이 건드린 적 없음) |
| **Action** | `fix-now` / `skip` / `follow-up-issue` / `ask-user` |

### 1-3. 알려진 false-positive 패턴 → 자동 다운그레이드

아래에 해당하면 기본 `false-positive` 또는 `Nit`으로 분류하고 이유 명시:
- 프로젝트 린터/포매터가 이미 처리하는 스타일·포맷
- 타입 시스템상 non-null 보장된 값에 대한 null 체크 요구
- private/internal 헬퍼에 대한 docstring/주석 요구
- 테스트에 불필요한 mock·assertion 추가 요구
- 사소한 네이밍 취향

**단, 비동기 race condition 지적은 CodeRabbit이 ~75% 놓치지만 지적 자체는 자주 하므로 → 항상 `needs-investigation`으로 두고 수동 검증**.

### 1-4. 의도 이해 체크 (logic bug 맹점)

AI 리뷰어는 코드 품질에 최적화되어 있고 **기능의 의도는 모른다**. 각 valid 후보에 대해 자문:
> "이 코멘트가 이 PR이 달성하려는 기능의 의도를 이해하고 있는가?"

아니라고 판단되면 `needs-investigation` + `ask-user`.

### 1-5. Scope 정책

- `in-scope` + valid → `fix-now` 후보
- `out-of-scope` + valid → `follow-up-issue` (이 PR에선 절대 수정 안 함, 별도 이슈 생성)
- `out-of-scope` + not-valid → `skip`

### 1-6. Nit 캡

`Nit`은 최대 5개까지만 개별 행으로 표시. 초과분은 `"plus N similar nits"` 한 줄로 요약.

### 1-7. Questions batch (의문 제기 · 의도 확인)

AI 리뷰는 **기능 의도 · 저장소 컨벤션 · 숨은 제약**을 모른다. Claude가 판단 못하는 경우를 단발성으로 흩뿌리지 말고, triage 리포트와 **같은 출력 안**에 배치로 모아서 한 번에 묻는다. 아래 카테고리를 빠짐없이 점검:

| 카테고리 | 언제 묻는가 | 질문 예시 |
|---------|------------|----------|
| **의도성 확인** | 수정 시 관찰 가능한 동작이 바뀌는 경우 (단순 내부 정리가 아님) | "리뷰어는 에러 throw를 요구하는데 현재는 silent fail. 의도된 설계인가요?" |
| **숨은 제약 확인** | 리뷰어가 repo 컨벤션·기존 구조를 모를 가능성 | "이 패턴은 코드베이스 전반에서 일관되게 쓰이는데, 정말 바꿔도 되나요?" |
| **봇 의견 상충** | 두 AI 리뷰어가 서로 반대 제안 | "CodeRabbit은 A 접근, Gemini는 B 접근 — 어느 쪽으로 갈까요?" |
| **범위 경계 애매** | in-scope / out-of-scope 판정 애매 | "이 파일은 한 줄만 바꿨는데 리뷰어는 전체 리팩터 요구. follow-up으로 뺄까요?" |
| **AI 제안 자체가 의심스러움** | 리뷰어의 suggested fix가 새 버그를 유발할 가능성 | "제안대로 하면 X 테스트가 깨질 것 같은데, 다른 방법으로 해결할까요?" |
| **대적자 불일치** `(adv)` | Phase 1.5 대적자(Gemini/Codex)가 Claude 분류와 다른 의견 | "Gemini는 #3을 valid로 보지만 Claude는 false-positive로 분류. 어느 쪽?" |

**원칙:**
- 질문 없으면 이 섹션 생략.
- 각 질문은 **해당 이슈 번호에 연결** (`Q1 → #2`, `Q2 → #2, #5` 처럼).
- 단답/선택지 형태 선호 — 긴 서술 답변 요구 금지. 가능한 경우 A/B 옵션 제시.
- 대적자 발 질문은 `(adv)` 태그 + 출처(Gemini/Codex) 명시. 두 대적자 모두 반대면 default를 대적자 쪽으로.
- Phase 2 진행 중 **새로운 의문**이 생기면 그 이슈만 단독으로 stop-and-ask (기존 규칙 유지).

### 1-8. 리포트 포맷 (사용자에게 출력)

```
## PR #{N} AI 리뷰 Triage

Total: X comments from Y bots → Z unique issues after dedup

| # | Severity | Validity | Scope | Action | File:Line | Sources | Rationale |
|---|----------|----------|-------|--------|-----------|---------|-----------|
| 1 | Critical | valid | in-scope | fix-now | src/a.ts:42 | coderabbit, gemini | null deref on optional field |
| 2 | Warning  | needs-investigation | in-scope | ask-user | src/b.ts:10 | claude[bot] | async race — verify manually |
| 3 | Nit      | false-positive | in-scope | skip | src/c.ts:5 | coderabbit | style handled by prettier |
| 4 | Warning  | valid | out-of-scope | follow-up-issue | src/legacy.ts:200 | coderabbit | pre-existing, not touched by this PR |
| + | plus 3 similar nits summarized |

## Questions for you (선택 사항 — 질문 없으면 생략)

- **Q1 → #2 (의도성)**: 현재 `doWork()`는 에러를 throw 하지 않고 `null`을 반환. 리뷰어는 throw를 요구.
  - (A) 의도된 silent fail이다 → skip, 답글로 "intentional" 설명
  - (B) 의도 아니었다, throw로 바꿔야 함 → fix-now로 승격
- **Q2 → #5 (봇 상충)**: CodeRabbit은 `useMemo` 추가 권장, Gemini는 불필요하다고 평가. 어느 쪽?
  - (A) CodeRabbit (useMemo 추가)
  - (B) Gemini (그대로 유지)
- **Q3 → #4 (범위)**: `src/legacy.ts`는 이 PR에서 한 줄만 수정. 리뷰어는 파일 전체 리팩터 요구.
  - (A) 이 PR 스코프 밖 → follow-up 이슈 (권장)
  - (B) 이번에 같이 수정

## 다음 단계 제안
- fix-now: #1 (1건, 질문 답변 후 추가될 수 있음)
- ask-user: #2, #5 — 위 Q1, Q2 답변 필요
- follow-up-issue: #4 — 위 Q3 확정 후
- skip: #3, nits

위 질문에 답변 주시면 분류를 확정하고 Phase 2로 진행합니다. 테이블 자체를 수정하고 싶은 항목(승격/강등/제외)도 번호로 알려주세요.
```

**⚠️ MUST NOT proceed to Phase 2 without explicit user approval of the triage table.**

---

## Phase 1.5 — Adversarial triage 검증 (대적자 도전, **조건부**)

**언제 실행**: Phase 1의 내부 분류 완료 후 · **리포트 출력(1-8) 전**. 단, **무조건 호출하지 않는다** — Claude가 먼저 "이거 대적자 필요한가?" 판단 → 사용자 승인 → 그 때만 호출. 대적자 불일치는 **Questions batch(1-7)에 `(adv)` 태그로 편입**되어 사용자 승인 게이트에서 같이 제시됨.

**목적**: Claude와 다른 모델 패밀리(Gemini · Codex)로 triage 판단에 도전. 같은 클래스 모델 간 공유되는 **logic bug 맹점**을 상쇄. 리서치 근거: AI 리뷰어가 놓친 버그의 suggested patch를 같은 클래스 모델이 제안하면 재차 놓칠 확률 1.4~1.7배.

### 1.5-A. Claude의 사전 판단 — "대적자 필요한가?"

Phase 1 분류 직후, 각 항목을 훑어보며 아래 중 하나라도 해당하면 **대적자 후보로 플래그**:

- 분류 신뢰도가 낮음 (내가 확신 못 하는 `needs-investigation`)
- Critical/Warning인데 판정에 근거가 약함
- Logic-bug 위험 카테고리: async/race, 보안, 데이터 정합성, 에러 전파, 경계 조건
- 두 AI 리뷰어가 상충하는 진단을 내린 항목
- Claude 스스로 "내가 놓친 게 있을 수 있다"는 신호가 있는 항목

반대로 **대적자 불필요**:
- 린터가 처리하는 스타일/포맷 nit
- 명백한 false-positive (타입상 non-null 요구받는 등)
- 사용자 컨벤션 무관한 단순 문자열 오타

### 1.5-B. 사용자에게 대적자 요청 제안

플래그한 후보를 모아 사용자에게 **대적자 호출 승인 요청**:

```
## 대적자 리뷰 제안

아래 항목은 제 triage 판단에 독립 검증이 도움될 것 같습니다:

- #2 (Warning, async race) — Claude 신뢰도 낮음. CodeRabbit의 지적이 맞을 가능성.
- #5 — CodeRabbit과 Gemini가 서로 다른 진단을 냈고, 제 판단 근거가 약함.
- #8 (Critical, 보안) — 보안 카테고리는 맹점 상쇄 필요.

사용 가능한 CLI: gemini ✓, codex ✓

(A) 제안한 항목 전부 대적자 호출 (gemini + codex 병렬)
(B) 일부만: 번호 지정
(C) skip — 현재 triage로 진행
```

- 사용자가 (C) skip 선택 → Phase 1.5 전체 생략, 리포트에 `Adversarial review: skipped by user` 표시
- 모든 항목 Claude가 확신 → 1.5-B 자체 생략하고 Phase 1-8 리포트로 직행, 리포트에 `Adversarial review: not requested (Claude confident)` 표시
- 후보는 있지만 CLI 없음 → 1.5-B 단계에서 "gemini/codex CLI가 없어 대적자 리뷰 불가"로 알리고 skip

### 1.5-C. CLI 감지 (승인 받은 후 실제 호출 직전)

```bash
command -v gemini >/dev/null && HAS_GEMINI=1 || HAS_GEMINI=0
command -v codex  >/dev/null && HAS_CODEX=1  || HAS_CODEX=0
```

- 둘 다 없음 → skip, 사용자에게 1줄 알림
- 하나만 → 있는 것만 사용
- 둘 다 → **병렬 호출** (동일 메시지에 두 Bash 호출)

### 1.5-D. 호출

- Gemini: `gemini -p "<prompt>"` (이 repo CLAUDE.md 원칙)
- Codex: `codex` challenge/review 모드 (exact syntax는 환경 확인 후 결정)
- 대상은 **사용자가 승인한 항목만** (전체 triage 아님) — 프롬프트에 해당 항목만 포함하여 토큰 절약

### 프롬프트 (adversarial 프레이밍 — 확증 편향 회피)

외부 CLI로 나가는 프롬프트는 영어로 고정 (구조적 출력 신뢰도 ↑):

```
You are an adversarial code reviewer. Below is a triage of AI review comments
for PR #{N}. CHALLENGE the classification. Specifically look for:

1. Items classified `false-positive` that are actually valid bugs.
2. Items classified `valid` that are actually false positives.
3. Severity that is over- or under-estimated.
4. Logic bugs that both the original AI reviewer and the triage may have missed.

Respond in this format ONLY, one line per item:
- `#N: AGREE`
- `#N: DISAGREE — <alternative classification> — <reason, 1-2 lines>`

If you have no opinion on an item, respond `AGREE`. Max 2 lines per item.
Do not deviate from the format. Do not add a preamble or summary.

---
[triage table + each comment's original body + relevant code snippet]
```

### 불일치 처리

1. Claude 분류 vs 각 대적자 응답 비교.
2. `DISAGREE`한 항목을 **Questions batch(1-7)에 `(adv)` 태그로 편입**:
   ```
   - **Q_adv1 → #3 (대적자 도전)**: Gemini는 이 항목을 `false-positive`가 아니라 `valid/Critical`로 본다.
     - 근거: <Gemini 요약>
     - (A) Claude 분류 유지 (false-positive): <Claude 근거>
     - (B) Gemini 의견 채택 (valid): fix-now로 승격
   ```
3. **두 대적자가 같이 Claude와 다른 의견**이면 strong signal — 권장 default를 (B)로 표시.
4. Claude의 수정안/해결 접근을 대적자가 미리 제안한 경우 Phase 3에서 **복붙 금지 원칙은 유지** — 대적자 제안도 AI 생성이므로 직접 재유도.

### 비용/지연 가시화

리포트에 한 줄 요약:
```
Adversarial review: gemini ✓ (4.2s, 1 disagreement), codex ✓ (3.1s, 0 disagreements)
```

---

## Phase 2 — 영향 분석 (Impact Analysis)

승인된 `fix-now` 항목만 대상. 한 건씩 순차 처리.

1. 코멘트가 지적한 심볼/함수/타입을 grep으로 전 프로젝트에서 탐색 (호출자, 구현체, 테스트, 타입 정의).
2. 해당 파일을 **전체 읽기**(diff hunk만 보지 말 것).
3. 관련 테스트 파일 확인 — 수정이 기존 테스트를 깨는지, 새 테스트가 필요한지.
4. 관련 설정·스키마·i18n 키 등 연쇄 영향 지점 확인.
5. 발견한 의존 관계를 1~3줄로 요약해서 사용자에게 보고 → 수정 전 최종 확인.

만약 영향 분석 중 "지적이 틀렸거나 더 큰 문제가 있다"고 판명되면 **MUST stop-and-ask** and re-classify the item. 절대 혼자 넘어가지 않는다.

## Phase 3 — 수정 (Fix)

**Hard rules (MUST follow):**
- MUST NOT copy-paste any AI-suggested patch or diff. Understand the concern, then write the fix from scratch following this repo's conventions.
- MUST limit the change to the specific issue being fixed. NO formatting, naming, commenting, or refactor changes outside the issue's immediate scope.
- MUST stop and ask (via AskUserQuestion) if intent is ambiguous or bots disagree.
- MUST create one atomic commit per issue. Suggested message format: `review: #{N} comment {comment_id} — {short description}`.

---

## Phase 3.5 — Adversarial fix 검증 (커밋 전 대적자 도전, **조건부**)

**언제 실행**: Phase 3에서 fix 작성 완료 후 · **git commit 전** · Phase 4 검증 전. 단, **무조건 호출하지 않는다** — Claude가 먼저 "이 fix에 대적자 검증이 필요한가?" 판단 → 사용자 승인 → 그 때만 호출.

**목적**: Claude가 쓴 diff가 (a) 원 concern을 실제로 해소하는가, (b) 새 버그/regression을 유발하는가, (c) 스코프를 넘었는가를 독립 모델로 확인. 커밋 전 마지막 게이트.

### 3.5-A. Claude의 사전 판단 — "이 fix에 대적자 필요한가?"

fix 작성 후 스스로 체크:

- 변경이 **critical path**를 건드리는가? (인증, 결제, 데이터 저장, 세션 등)
- async/concurrency, 보안, 데이터 정합성 영역 수정인가?
- diff 규모가 크거나 여러 파일에 걸쳐 있는가?
- 수정 접근에 확신이 없었거나 여러 옵션 중 하나를 고른 상황인가?
- Phase 1.5에서 이 항목에 대적자가 이미 `DISAGREE` 낸 이력이 있는가?

하나라도 해당 → 대적자 후보. 아래 경우는 보통 **불필요**:
- nit 수준의 단순 수정 (타입 세분화, 변수명 변경 등)
- 한 줄짜리 null 체크 추가
- 로컬 영향만 있는 자명한 수정

### 3.5-B. 사용자에게 대적자 요청 제안

대적자 후보면 커밋 전에 승인 요청:

```
## 대적자 fix 검증 제안

이 수정(이슈 #{N})에 독립 검증이 도움될 것 같습니다:
- 이유: <critical path 건드림 / async 영역 / diff 크기 등>
- 사용 가능한 CLI: gemini ✓, codex ✓

(A) 대적자 호출 (권장)
(B) skip — 바로 커밋
```

- (B) skip 선택 → 커밋 메시지 body에 `adversarial-review: skipped by user` 주석
- 대적자 불필요로 Claude가 판단 → 3.5-B 자체 생략, 바로 커밋. 커밋 메시지에 `adversarial-review: not requested (low-risk change)` 주석
- 승인 받으면 3.5-C로

### 3.5-C. CLI 감지 & 호출 (병렬)

Phase 1.5와 동일 CLI 감지. 둘 다 없으면 skip하고 commit 메시지에 `adversarial-review: skipped (no CLI)` 주석.

Gemini · Codex 각각에 fix diff + 원 코멘트 + 해당 파일 컨텍스트 전달.

### 프롬프트

외부 CLI로 나가는 프롬프트는 영어로 고정:

```
You are an adversarial code reviewer. Below is a PR review comment and the
diff written to address it. CHALLENGE this diff:

1. Does the diff actually resolve the concern, or does it only patch the surface?
2. Could it introduce new bugs or regressions? Consider: types, null/undefined,
   async races, boundary conditions, resource leaks, error propagation.
3. Is there a clearly better approach? If yes, be specific.
4. Does the diff include changes outside the scope of this specific issue?

Respond in this format ONLY:
- `OK` — no issues
- `PROBLEM: <specific concern — 1-3 lines>`

If multiple concerns, list them as separate `PROBLEM:` lines.
Do not add a preamble. Do not repeat the diff back.

---
[original review comment body]
[the current diff]
[relevant file context — full file or enough surrounding code]
```

### 결과 처리

| 상황 | 동작 |
|------|------|
| 모든 대적자 `OK` | 커밋 진행 → Phase 4 |
| 하나라도 `PROBLEM` | **stop-and-ask** (아래 포맷) |
| 두 대적자 모두 `PROBLEM` + 같은 지적 | strong signal — default를 "수정 보완"으로 표시 |

### 사용자 결정 포맷

```
⚠️ Adversarial fix review 결과:
- Gemini: <PROBLEM 요약 또는 OK>
- Codex: <PROBLEM 요약 또는 OK>

선택:
(A) 지적 반영해서 수정 보완 (권장)
(B) 지적이 false alarm — 이유를 commit body에 기록하고 진행
(C) 현재 수정 폐기, 접근 재설계
```

**주의**: 대적자가 제시한 "더 나은 접근"도 AI 생성 — 복붙 금지, 이해한 뒤 재유도.

---

## Phase 4 — 검증 (Verify)

수정 직후:
1. 프로젝트 테스트 실행 (해당 영역). 이 repo 기준:
   - `pnpm vitest run` (관련 파일 경로 지정 가능)
   - `pnpm tsc --build .`
   - `pnpm lint`
   - Rust 쪽 변경이면 `cd src-tauri && cargo test -- --test-threads=1 && cargo clippy --all-targets --all-features -- -D warnings`
2. 원래 지적된 concern이 실제로 해소됐는지 재확인 (단순히 코드가 바뀌었다는 것과 다름).
3. 실패하면 되돌리거나 수정 보완 — **스코프 벗어나지 않는 선에서만**.

## Phase 5 — 답글 & 마무리

각 수정 완료된 코멘트에 대해:

1. **답글 작성 (영어, 간결)**: 무엇이 왜 바뀌었는지 + 커밋 SHA.
   ```
   gh api repos/{owner}/{repo}/pulls/{N}/comments/{comment_id}/replies -f body="..."
   ```
   또는 리뷰 스레드에 답: GraphQL `addPullRequestReviewThreadReply`.
   예:
   > Addressed in abc1234 — extracted null check to early return, verified against existing `xxx.test.ts`. Thanks!
2. **스레드 자동 resolve 금지**. 리뷰어가 닫도록 둔다. 사용자가 명시적으로 "resolve" 요청한 건만 예외.
3. **follow-up-issue 항목**: `gh issue create`로 별도 이슈 생성, 원 코멘트에 답글로 이슈 링크 남김.
4. **ask-user 항목**: 사용자 결정에 따라 fix 또는 skip — skip이면 "investigated and intentional" 답글.

모든 처리 끝나면 요약 보고:
```
Handled: #1, #5 (fixed), #4 (follow-up issue #123)
Skipped with reply: #2, #3
Pending user decision: (없음)
```

---

## Execution checklist (MUST verify each before moving on)

- [ ] Phase 0: Filtered to AI-bot authors only? Human reviewer comments reported separately?
- [ ] Phase 1: Produced the triage table and obtained explicit user approval BEFORE any code change?
- [ ] Phase 1: Applied dedup, intent-understanding check, out-of-scope separation, and nit cap?
- [ ] Phase 1: Consolidated ambiguous items into a SINGLE Questions batch (never scatter one-off questions)?
- [ ] Phase 1.5: NEVER invoked CLIs unprompted — first flagged candidates, then asked user, then called only approved ones?
- [ ] Phase 1.5: Detected CLI availability, ran parallel calls only for approved items, and explicitly noted skip if unavailable?
- [ ] Phase 1.5: Merged any adversarial disagreements into the Questions batch with the `(adv)` tag?
- [ ] Phase 2: Read the full file(s) + callers + tests, not just the diff hunk?
- [ ] Phase 3: Wrote the fix from scratch (no verbatim AI patch) and kept scope tight?
- [ ] Phase 3.5: NEVER invoked CLIs unprompted — judged risk (critical path / async / large diff) first, then asked user?
- [ ] Phase 3.5: On any `PROBLEM` response, stopped and asked the user before committing?
- [ ] Phase 4: Actually ran tests/lint (not just assumed they pass)?
- [ ] Phase 5: Replied in English, did NOT auto-resolve threads, and opened follow-up issues for out-of-scope items?

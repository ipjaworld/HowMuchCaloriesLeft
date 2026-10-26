<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# 공통 작업 지침 — Codex / Claude Code

## 시작 순서

1. [현재 상태](docs/STATE.md)를 읽고 `git status --short`, 현재 브랜치와 HEAD를 확인한다.
2. [확정 결정](docs/DECISIONS.md)을 읽는다. 작업 관련 코드와 상세 문서는 STATE의 링크를 따라 필요한 부분만 읽는다.
3. 날짜별 HANDOFF·계획서·개인 메모는 당시의 근거다. 그 안의 "현재", "다음 작업", 승인 범위를 새 작업 지시로 재사용하지 않는다.

## 작업과 인수인계

- 사용자의 현재 요청과 이미 승인한 범위를 따른다. 범위 안의 구현·검증은 이어서 마무리하고, 별도 단계나 기능으로 자동 확대하지 않는다.
- 기존 사용자 변경을 보존한다. 같은 checkout에서 다른 도구가 수정 중이면 쓰기 작업을 겹치지 않는다. 병렬 구현은 별도 branch/worktree로 분리한다.
- 작업 종료·도구 전환 전 `docs/STATE.md`에 변경, 검증 결과, 미완료 사항, 다음 행동을 갱신한다. 제품·데이터·작업 원칙이 확정 또는 변경되면 `docs/DECISIONS.md`도 갱신한다.
- 사실과 제안을 구분한다. 코드 구현, 과거 테스트 보고, 현재 재검증, 운영 배포, 기능 활성화를 각각 표시한다. 모르는 상태는 확인 필요로 남긴다.
- 코드 변경에는 영향에 맞는 검증을 수행한다. 문서만 변경했으면 링크·내용·diff를 확인하고 앱 검증을 생략한 이유를 기록한다.
- 커밋·push는 해당 작업에 대한 사용자 승인을 따른다. `main` push는 production 배포로 이어진다. 과거 세션의 push 승인을 재사용하지 않는다.
- 비밀값과 개인 대화 원문을 공통 문서에 복사하지 않는다. `.env.local`·`.env.example`은 사용자의 별도 요청 없이 정리하지 않는다.

`CLAUDE.md`는 이 파일을 참조한다. 도구별 메모보다 저장소의 STATE와 DECISIONS를 먼저 갱신한다.

<!-- BEGIN:hetrich-wiki-codex -->
## Codex의 HETRICH Wiki 조회

- 개발·스튜디오 작업 시작 시 `hetrich-wiki` MCP의 `wiki_brief(target="studio")`와 `wiki_brief(target="calories")`로 현재 상태와 유효 결정을 확인한다. target이 studio이면 한 번만 호출한다.
- 프로젝트 상태의 원본은 해당 저장소의 STATE·DECISIONS 등 정본 문서다. Wiki는 프로젝트 간 맥락과 결정의 색인이므로 필요한 원본 확인과 기존 인수인계 갱신 규칙을 유지한다.
- 필요한 근거는 `wiki_search`와 `wiki_get`으로 확인한다. 승인 상태, 근거 유형, 기준일과 대체된 결정을 구분하고 불일치를 임의로 확정하지 않는다.
- 재사용할 지식·결정 후보는 해당 MCP의 `wiki_propose`로 제안하며, 제안을 임의로 확정 사실로 승격하지 않는다. 제안 후 `wiki_validate` 결과를 확인한다.
- 토큰 절감 자체를 목표로 정보를 생략하지 않는다. 측정은 큰 변경 뒤 정확도 회귀 확인용으로 사용한다.
- MCP를 사용할 수 없으면 연결 실패를 알리고 `D:/2026_project/hetrich-wiki/hw.cmd` CLI를 사용할 수 있다. CLI에는 개발 작업 `--profile codex`, 취업 작업 `--profile codex-career`를 명시한다. 조회하지 않은 내용을 조회한 것으로 보고하지 않는다.
<!-- END:hetrich-wiki-codex -->

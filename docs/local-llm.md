# Local LLM Router 실험 (개발 환경 전용)

> **결론 (2026-09-29): production 도입 보류.** 같은 67개 eval에서 Jev가 정확도·
> 지연·운영비 모두 앞섰다. 구조는 `off`로 남겨 두고, 더 나은 로컬 모델이 나오면
> 같은 eval로 다시 잰다. 수치는 맨 아래 [§8 측정 결과](#8-측정-결과-2026-09-29).

로컬 LLM(Ollama)이 이 앱에서 **실제로 가치가 있는지 측정**하기 위한 최소 구조다.
로컬 모델은 intent 분류만 맡는다 — 문장을 만들지 않고, 칼로리를 매기지 않고,
기록을 바꾸지 않는다. 결과가 조금이라도 의심스러우면 기존 판정기(Jev, 키가 없으면
mock)가 답한다.

- 기본값은 `off`이고, `off`에서는 기존 코드 경로 그대로다.
- `NODE_ENV=production`에서는 설정과 무관하게 **강제로 off**다. Vercel에서는
  `localhost:11434`에 닿을 수도 없다.

## 1. Ollama 설치와 실행

Windows: <https://ollama.com/download> 에서 설치한다. 설치하면 트레이에서 서버가
자동으로 뜬다. 수동으로 띄우려면:

```sh
ollama serve            # http://localhost:11434
curl http://localhost:11434/api/version   # 떠 있는지 확인
```

macOS/Linux도 같은 명령이다 (`curl -fsSL https://ollama.com/install.sh | sh`).

## 2. 모델 받기

특정 모델에 묶여 있지 않다 — 태그 이름만 환경변수로 넘긴다. 이 PC(RTX 2060
SUPER 8GB, RAM 32GB) 기준의 작은 instruct 후보:

```sh
ollama pull exaone3.5:2.4b    # LG, 한국어 강함, 가벼움
ollama pull qwen2.5:3b        # 다국어, 가벼움
ollama pull qwen2.5:7b        # 더 정확, 더 느림 (8GB VRAM에 q4로 들어감)
ollama list
```

## 3. 모델 단독 테스트

앱 없이 모델이 JSON을 제대로 내는지 먼저 본다:

```sh
ollama run exaone3.5:2.4b "다음 문장의 의도를 JSON으로: 아침에 계란 두 개 먹었어"
```

앱이 실제로 보내는 형태(구조화 출력)로 확인하려면, 본문을 UTF-8 파일로 저장한 뒤
`--data-binary @파일`로 보낸다:

```sh
cat > body.json <<'EOF'
{
  "model": "exaone3.5:2.4b",
  "stream": false,
  "format": {"type":"object","properties":{"intent":{"type":"string"},"confidence":{"type":"number"}},"required":["intent","confidence"]},
  "messages": [{"role":"user","content":"아침에 계란 두 개 먹었어 — intent와 confidence를 JSON으로"}]
}
EOF
curl http://localhost:11434/api/chat --data-binary @body.json
```

> **Windows 주의:** Git Bash에서 `curl -d '<한글>'`처럼 커맨드라인에 한글을 직접
> 넣으면 CP949 바이트로 전송돼 모델이 깨진 문자열을 받는다. 2026-09-29 테스트 중
> 실제로 이 때문에 Jev가 망가진 것처럼 보였다. 한글 본문은 항상 파일로 보낸다.

처음 요청은 모델을 VRAM에 올리느라 수 초 걸린다. 타임아웃 기본값(5초)에 첫 요청이
걸리면 한 번 더 보내면 된다.

## 4. 프로젝트에서 켜기

`.env.local`에 추가한다:

```sh
# Local LLM router — development only. Production is always off.
LOCAL_LLM_MODE=shadow            # off | shadow | active
LOCAL_LLM_BASE_URL=http://localhost:11434
LOCAL_LLM_MODEL=exaone3.5:2.4b
LOCAL_LLM_TIMEOUT_MS=5000
LOCAL_LLM_MIN_CONFIDENCE=0.85
```

그리고 `pnpm dev`. 모드 의미:

| 모드 | 앱이 쓰는 판정 | 로컬 모델 |
|---|---|---|
| `off` | 기존 판정기 | 호출하지 않음 |
| `shadow` | 기존 판정기 | 같은 요청을 병렬로 보내고 비교만 로그 |
| `active` | 로컬 결과가 통과하면 로컬, 아니면 기존 판정기 | 먼저 호출 |

`active`에서 로컬 결과를 쓰는 조건 — 하나라도 어기면 기존 판정기로 fallback:

- 연결 성공, 타임아웃 안, JSON 파싱 성공, 스키마 검증 성공
- intent가 `unknown`이 아님
- confidence ≥ `LOCAL_LLM_MIN_CONFIDENCE`
- intent가 `modify_food` / `delete_food`가 아님 — 어느 기록을 가리키는지는
  이번 단계에서 로컬에 맡기지 않는다

`LOCAL_LLM_MODEL`이 비어 있으면 모드와 무관하게 off로 동작한다(서버 시작 시 한 번 경고).

`shadow`는 두 판정기를 병렬로 부르고 둘 다 끝나야 응답하므로, 개발 중 응답이
로컬 모델 지연만큼 늘 수 있다. 측정 단계에서는 의도된 비용이다.

## 5. 끄기

```sh
LOCAL_LLM_MODE=off     # 또는 줄을 지우기
```

서버를 재시작하면 기존 동작 그대로다. Ollama를 꺼 두기만 해도 `active`는
`connection` 사유로 전부 fallback하므로 앱은 계속 동작한다.

## 6. 로그

개발 서버 콘솔에 요청마다 한 줄. 사용자 문장은 남기지 않는다.

```
[LocalRouter] mode=shadow legacy=add_food(jev 0.97) local=add_food(0.92) matched=true latency=381ms wouldUse=true
[LocalRouter] mode=active intent=add_food confidence=0.92 latency=381ms fallback=false used=7/10
[LocalRouter] mode=active latency=5003ms fallback=true reason=timeout used=7/11
```

`used=a/b`는 이 서버 프로세스에서 로컬 결과로 끝나 **외부 판정 호출을 건너뛴**
요청 수다.

## 7. Eval

```sh
pnpm eval:local-router
```

- `evals/local-router.json`(로컬 라우터용 한국어 케이스)과 기존
  `fixtures/korean-inputs.json`(60개 골든셋) 두 세트를 돈다.
- 판정기: local, mock은 항상, Jev는 `TYPESAFE_API_KEY`가 있을 때.
  `EVAL_JUDGES=local,mock`처럼 골라서 돌릴 수 있다.
- 결과 JSON은 `eval-results/local-router-YYYYMMDD-HHmm.json`에 저장된다(git 제외).
- 모델이 없거나 Ollama가 꺼져 있으면 그렇다고 출력하고 깨끗하게 끝난다.
- confidence 구간별(>= 0.9 / 0.8–0.9 / 0.7–0.8 / < 0.7) 실제 정확도 표와, warm-up
  (모델 로드)·첫 5건·이후 latency를 따로 출력한다.

## 8. 측정 결과 (2026-09-29)

조건: `evals/local-router.json` 67건 중 goal 규칙 4건을 뺀 63건 판정, timeout
5000ms, `LOCAL_LLM_MIN_CONFIDENCE=0.85`, 한 건씩 순차 실행. Ollama 0.34.4,
RTX 2060 SUPER 8GB, 모든 모델 100% GPU. Jev는 `jev-1.13.0`.

| | exaone3.5:2.4b | qwen2.5:3b | qwen2.5:7b | Jev |
|---|---|---|---|---|
| intent 정확도 | 79.4% | 79.4% | 88.9% | **98.4%** |
| 평균 latency | 358ms | 431ms | 593ms | **214ms** |
| p95 latency | 580ms | 619ms | 1,034ms | **259ms** |
| warm-up (모델 로드) | 2.9s | 2.1s | 4.2s | — |
| conf >= 0.9 정확도 | 79.4% (63건 전부) | 79.4% (63건 전부) | 92.7% (55건) | 98.1% |
| conf 0.8–0.9 정확도 | 0건 | 0건 | 62.5% (8건) | 1/1 |
| active 사용 비율 (0.85) | 79.4% | 76.2% | 68.3% | — |
| active 사용분 정확도 | 80.0% | 83.3% | 100% (43/43) | — |
| Jev와 일치 | 81.0% | 81.0% | 90.5% | — |
| parse / timeout / unknown | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 | — |

같은 날 60건 골든셋의 Jev 재측정은 intent 95.0% (09-23: 93.3%) — 회귀 없음.

읽은 것:

- **2–3B는 자기 confidence를 믿을 수 없다.** 63건 모두 0.9 이상을 붙였고 틀린
  답도 0.90–0.99였다. threshold로 걸러낼 신호 자체가 없다.
- **7B부터 신호가 생긴다.** 0.85 기준이 오답 3건을 걸렀고, active가 썼을 43건은
  모두 정답이었다(63건 1회 측정이라 실제 오답률은 대략 7% 이하 정도로만 말할 수 있다).
- **그래도 도입할 이유가 없다.** 7B는 Jev보다 평균 2.8배, p95 4배 느리고, 콜드
  스타트 4.2초. 절감되는 Jev 호출(68%)은 요청 1,000건당 약 $0.03이다. production은
  Vercel이라 로컬 모델을 돌리려면 별도 GPU 인프라까지 필요하다.
- 2–3B의 active 오답은 기록을 잘못 만들지는 않았다. 대신 "커피", "밥" 같은
  음식 이름만 있는 보고를 `other`로 읽어 기록을 빠뜨렸다.

즉 이 프로젝트의 intent routing처럼 좁은 판정에서는 작고 특화된 외부 판정기(Jev)가
정확도·속도·운영비 모두 낫다. 로컬 LLM이 자동으로 싸고 빠른 대안은 아니다.

실험 후 이 PC에서는 Ollama와 모델을 제거했다. 다시 재려면 §1–2부터 시작하면 된다.

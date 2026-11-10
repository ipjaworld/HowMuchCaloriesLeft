# 사진 입력 테스트 자료

이 폴더는 사용자가 제공하는 실제 식사 사진을 로컬에서 보관할 자리다. 현재 사진은 없다. 웹에서 사진을 가져오거나 생성 이미지로 대신하지 않는다.

- 사진 원본과 하위 폴더, 실제 목록(`manifest.csv`)은 Git에서 제외한다. 이 안내와 빈 CSV 양식 2개만 추적한다.
- 사진이 준비되면 `manifest.example.csv`를 `manifest.csv`로 복사하고 사진 한 장당 한 행을 적는다. `file`은 이 폴더 기준 상대 경로, `expected_kind`는 `food` / `not_food` / `unreadable`이다.
- `expected_items`는 사람이 확인한 음식 이름을 `;`로 구분한다. 사진만 보고 모르는 중량을 정답으로 만들지 않는다. 양의 허용 범위와 애매한 점은 `expected_amount_notes`에 적는다.
- 결과 양식은 `results.example.csv`다. 실제 결과는 이미 Git에서 제외된 `../eval-results/` 아래에 둔다. 비용·토큰·실제 모델을 측정하지 못하면 빈칸과 미측정 사유를 남긴다.

Claude Code의 시작 조건·명령·확인 항목은 [사진 테스트 인계](../docs/product/photo-input-test-handoff-2026-11-10.md)를 따른다. **현재 사용자 요청은 세팅만이며, 폴더나 키의 존재를 실제 API 호출 승인으로 해석하지 않는다.**

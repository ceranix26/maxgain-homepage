# ECOUNT 재고 상태 자동 동기화 설정

## GitHub Secrets
Repository > Settings > Secrets and variables > Actions에 아래 값을 등록합니다.

- ECOUNT_COM_CODE: ECOUNT 회사코드
- ECOUNT_USER_ID: API 인증키를 발급한 사용자 ID
- ECOUNT_API_CERT_KEY: 운영 API Key 또는 Test Key
- ECOUNT_ZONE: Zone 조회 결과 (예: CC)
- ECOUNT_API_MODE: 운영 키는 prod, Test Key는 test

## 최초 테스트
Actions > Update ECOUNT inventory status > Run workflow를 실행합니다.
성공하면 data/inventory-status.json이 자동 커밋됩니다.

## 재고 판정
- 품목별 창고 재고 합계가 0보다 크면: 재고 있음
- 합계가 0 이하이면: 재고 없음
- ECOUNT 응답에 없는 품번: 재고 확인 중

## 보안
ECOUNT 회사코드, 사용자 ID, API Key는 HTML/JavaScript/data 파일에 넣지 않습니다.

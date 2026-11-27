# MAXGAIN 홈페이지 운영 상태 — 2026-11-27 KST

이 문서는 공개 홈페이지, GitHub `main`, GitHub Actions를 읽기 전용으로 확인한 결과다. 서버 내부 로그와 Google VM 자체의 작업 목록은 여기서 확인하지 않았다.

> **날짜별 근거:** 현재 상태·후보·문서 목차는 [제품검색 백엔드](PRODUCT-SEARCH-BACKEND.md)를 먼저 확인한다. 아래의 확인값은 11월 27일 시점으로 고정되어 있으며 새 운영 검증으로 자동 갱신되지 않는다.

## 현재 공개 경로

- 홈페이지는 Cloudflare 정적 파일로 응답한다. 방문자 제품검색은 `data/inventory-status.json`과 별도 공개 규격 파일을 읽는다.
- 제품검색 화면은 커밋 `67a82223e8b2a729080cb8c4a2ad07e0240471c7`의 UI다. 결과행의 규격 펼침은 제거됐고, 품번을 선택하면 아래 상세에 규격이 표시된다.
- 승인 규격 표시 파일 `data/catalog-display-specs.v1.json`은 Walsin 두 품번을 포함한다. 공개 SHA256은 `7cf8df785d110a31aeaa7455ae890ce9e8a9acbababf7c80cbe6ed49dfa121b0`이다.
- 팝업 파일 `data/site-popups.v1.json`은 게시물 1건을 포함한다. 공개 SHA256은 `a5e865d0a7d7b57ffeb32a0a67ad59b002b81fe01c8d7e20126df1b422c2d37e`이다.
- 규격 조건검색 파일 `data/catalog-facet-index.v1.json`은 확인 시점에 HTTP 404였다. 승인 규격의 상세 표시와 조건검색 게시 여부는 별개다.

## 재고 수집과 게시

- 2026-11-27 08:00:03 KST 기준 공개 재고는 13,166품번, `baseDate=20261127`이었다. 공개 SHA256은 `99d576423b583b041487f73ffd0019a0f3d197aeaed4ddd50b172b6f73bdee07`이다.
- GitHub `main` 커밋 `8f453d700f9491026c8be3d1419d666604fdee98`은 08:15:06 KST에 Hub 명의로 `data/inventory-status.json` 한 파일을 갱신했다. 수집→Git 게시→공개 결과의 한 주기는 외부에서 확인됐다. 서버 내부 수집·게시 로그, pending 상태와 정리 상태는 이 확인에 포함되지 않았다.
- 예전 `.github/workflows/update-ecount-inventory.yml`은 원격에 남아 있지만 GitHub Actions API에서 `disabled_manually`, 실행 기록 0건이었다. 파일의 예약 표현만으로 실제 실행 중이라고 판단하지 않는다.

## Google VM과 남은 확인

- 현재 홈페이지 소스, 공개 응답, GitHub 게시 이력에서 Google VM으로 방문자 요청을 보내거나 VM이 재고를 게시한다는 증거는 찾지 못했다.
- VM 자체의 다른 cron·서비스·제조사 검토 자료·백업과 Hub 서버의 모든 실행 설정은 별도 확인 대상이다. 이 문서는 VM 전체 미사용이나 삭제 가능 판정이 아니다.
- 팝업 관리자 선택을 홈페이지에 자동 게시하는 정식 경로와 실제 규격 조건검색용 승인·게시도 별도 완료 대상이다.

## 작업본 취급

Codespace 원본 작업 폴더에는 과거 규격 UI 후보와 미리보기·계획 자료가 미커밋 상태로 남아 있다. 이 후보들은 현재 `main`의 배포 화면보다 오래됐거나 운영 계약과 차이가 있으므로 그대로 합치지 않는다. 필요한 작업을 최신 `main`에서 다시 대조한 뒤 별도 범위로 반영한다.

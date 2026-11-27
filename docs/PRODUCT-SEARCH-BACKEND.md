# MAXGAIN 제품검색 백엔드 — 상태와 문서 목차

마지막 공개 읽기 확인: **2026-11-28 01:25~01:30 KST**. 대상은 GitHub `ceranix26/maxgain-homepage`의 `main` `dbdf160b1a6aeccdba6171505e996ac670dc1cf2`와 `www.maxgain.co.kr` 정적 응답이다. 아래 HTTP 결과는 Codespace의 기본 `curl` GET에서 확인했다. 같은 Codespace의 기본 Python `urllib`는 모든 경로에서 HTTP 403을 받았으므로, 403을 방문자 전체 장애나 조건검색 파일의 상태와 혼동하지 않는다. 이 확인에는 실제 방문자 브라우저 클릭 시험과 Hub DB·서버 로그 조회가 포함되지 않는다.

## 어디에서 무엇을 읽는가

| 데이터·기능 | 운영 경로와 현재 확인 | 판정 |
|---|---|---|
| 제품검색 페이지 | `/product-search.html` → `/product-search`, HTTP 200 | 정적 페이지 제공 확인. 이번 브라우저 조작 미검증 |
| 재고 | `data/inventory-status.json`, HTTP 200, SHA `99d576423b583b041487f73ffd0019a0f3d197aeaed4ddd50b172b6f73bdee07`, `baseDate=20261127`, 정확 PN 13,166건 | Hub 수집 후 정적 JSON 게시. 브라우저가 ERP를 직접 조회하지 않음 |
| 승인 규격 표시 | `data/catalog-display-specs.v1.json`, HTTP 200, SHA `7cf8df785d110a31aeaa7455ae890ce9e8a9acbababf7c80cbe6ed49dfa121b0` | Walsin 정확 PN 2건: 1003의 4필드, 1004의 12필드. 공개 파일의 승인 상태 구조 검증됨 |
| 규격 조건검색 | `data/catalog-facet-index.v1.json`, HTTP 404 | 현재 공개 산출물 부재. UI 소비기는 경로를 요청하고 404에서는 품번검색 안내로 돌아감. Hub의 현재 승인·공차 계약 및 trusted publisher 확인 필요 |
| legacy 제품·제조사·별칭·이미지 | `data/product-specs.json`, `product-manufacturers.json`, `product-aliases.json`, `product-image-index.json`과 로컬 WebP | 정적 자료. legacy 후보를 Hub 공식 승인이나 ERP 품목 연결로 자동 승격하지 않음 |

재고·표시 JSON은 코드에서 로드하는 공개 산출물이다. 이 표의 SHA는 **11월 28일 해당 시각의 응답**이며 이후 갱신을 보증하지 않는다. 재고는 매일 08:00 KST 수집, 08:15/08:45 게시 일정으로 운영해 왔으나 이번 확인에서는 서버 내부 cron/pending을 재조회하지 않았다. GitHub의 옛 ECOUNT workflow는 11월 27일 읽기 결과 `disabled_manually`/실행 0건이었다. 제조사·Mouser·이미지 수집 스크립트와 Action의 현재 활성·최근 성공 여부는 이 확인에 포함되지 않는다. 외부 API를 직접 호출하는 코드가 저장소에 남아 있는 것과 **지금 실행 중인 것**을 구분한다.

## 현재 운영, 격리 후보, 남은 연결

1. **운영:** 품번검색 페이지·정적 재고·legacy 상세·승인 규격 표시(2품번). 11월 27일 공개 재고 한 주기 게시를 외부 응답과 Git 커밋에서 확인했으나 내부 실패 복구 상태는 별도 관측 대상이다.
2. **격리 후보:** `/workspaces/maxgain-cutover-recovery`의 `codex/hub-cutover-recovery-20261128`는 원격 `main`에서 분리한 로컬 브랜치다. [복구 기록](../scripts/hub-migration/RECOVERY-MANIFEST.md)에 감사 브랜치 출처, 새로 재구성한 검증 도구, 실제 시험과 private 백업을 구분했다. 이 브랜치의 코드는 운영·공개에 반영되지 않았다.
3. **미완료:** 조건검색용 승인 facet 산출물과 Hub trusted 게시기 결합. Hub에서 `tolerance_percent=±1%`가 승인됐다는 이전 운영 READ 기록과 별개로, `tolerance_bounds_percent`의 게시 해석과 현행 revision/review chain을 발행 시 검증해야 한다. 기존 승인을 다시 요청하거나 미승인 값을 승인으로 바꾸지 않는다.
4. **이미지 후속:** Hub의 실제 제품이미지 core 합성 후보 6파일을 private에서 SHA 교차 검증했지만, 실운영 이미지 수집·검토·게시 경로로 승격된 것은 아니다. 옛 이미지 Action과 Hub 수집 경로의 운영 절체도 미확인이다.

## 문서 지도

- [11월 27일 운영 상태 기록](OPERATIONS-STATUS-20261127.md): 공개 재고·표시규격·팝업·VM 관련 **당일 읽기 근거**. 최신 상태 대신 쓰지 않는다.
- [격리 복구 기록](../scripts/hub-migration/RECOVERY-MANIFEST.md): 원격에 남은 감사 커밋과 소실된 미푸시 절체 후보의 차이, 재구성 코드와 검증 범위.
- [Hub 이전 감사 도구](../scripts/hub-migration/README.md), [필드 대응표](../scripts/hub-migration/CONTRACT-MAPPING.md): 7개 legacy + 3개 생성 산출물의 dry-run. 감사는 Hub 적재·승인·게시의 증거가 아니다.
- [2026-10월 프로젝트 기록](PROJECT-STATE.md): Johanson/Walsin 수집 결과·실패·판정의 역사 기록. VM 및 직접수집 명령은 현재 운영 절차가 아니다.
- [제품검색 화면 설계 기록](product-search-wireframe.md): 11월 19일 구현 전 와이어프레임. 실제 화면 계약은 현재 소스와 공개 응답으로 판단한다.
- [제품 방향](../PRODUCT.md): 사이트 목적과 공개 정보 원칙.

## 안전한 로컬 확인

격리 복사본에서만 다음 도구를 실행한다. 모두 로컬 파일 검사이며 ERP·제조사 API를 호출하거나 공개 push하지 않는다.

```bash
node scripts/hub-migration/verify-public-search-snapshot.mjs .
node scripts/hub-migration/verify-public-search-snapshot.test.mjs
node scripts/hub-migration/verify-product-image-bundle.test.mjs
MAXGAIN_BACKUP_REHEARSAL=.private-backups/public-search-dbdf160 node scripts/hub-migration/backup-public-search-snapshot.test.mjs
```

원래 Codespace 작업 폴더의 미커밋 변경, Hub 승인 원장, VM 자료·백업을 이 문서 정리 과정에서 변경하지 않는다.

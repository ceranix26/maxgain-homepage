# 홈페이지 제품검색 절체 후보 복구 기록 — 2026-11-28 KST

## 격리와 출처

- 원래 작업 폴더 `/workspaces/maxgain-homepage`는 오래된 `main` 6d96782와 미커밋 변경이 있으므로 건드리지 않았다.
- 지속 격리 복사본 `/workspaces/maxgain-cutover-recovery`는 원격 `main` dbdf160b1a6aeccdba6171505e996ac670dc1cf2에서 만들었다. 브랜치는 `codex/hub-cutover-recovery-20261128`이며 공개 push는 하지 않는다.
- 원격에 **실제로 보존된** 감사 브랜치 `codex/hub-homepage-audit-20261127`의 커밋 a36c3bf97eb54bd5c800ed7a2bc27b5dc290881e를 가져왔다. 이 브랜치의 4파일은 새 브랜치에 cherry-pick되어 새 커밋 046ece2로 존재한다.
- 이전 `/tmp`의 미푸시 `codex/hub-cutover-contract-20261127` 커밋 0463f3f~45c01a1은 원격 브랜치 목록에 없고 로컬 임시 복사본도 사라졌다. 정확한 기존 코드/커밋 바이트는 복구했다고 주장하지 않는다. 아래 절체 도구는 확인된 계약과 현재 공개 소스에 따라 **새로 재구성**했다.

## 재구성한 로컬 도구

- `verify-public-search-snapshot.mjs`: 기존 소비기 `validateInventory`, `validateDisplaySpecs`, `validateFacetIndex`를 재사용해 공개 입력의 구조·승인 필드·정확 PN 결합·로컬 WebP/이미지 index·선택적 facet 상태를 검사한다. 예상 SHA를 지정하면 바이트 교체도 차단한다. Hub DB 승인 이력 자체를 증명하는 도구는 아니다.
- `backup-public-search-snapshot.mjs`: 지정한 전체 40자 Git 커밋에서 공개 검색 6개 JSON과 참조된 제품 WebP, 존재하는 경우 facet을 비공개 폴더에 원본 바이트대로 복사하고 SHA manifest를 남긴다. 같은 대상 경로 재사용을 거절한다. 복구는 별도 깨끗한 복사본에서만 리허설했다.
- 실제 고정 바이트 백업은 격리 복사본의 Git 제외 경로 `.private-backups/public-search-dbdf160`에 7파일과 manifest로 남겼다. 이 로컬 백업은 공개 배포나 Hub 원장으로 간주하지 않는다.
- `verify-product-image-bundle.mjs`: Hub private 후보의 원본/후보 JSON, WebP 바이트 SHA, 원본 SHA 기반 공개 경로, 정확 품번·회사·환경·재고 snapshot 결합, `UNREVIEWED/readyForPublication=false`를 검사한다. 이 검증은 공식 출처 확인이나 게시 승인으로 승격시키지 않는다. Hub가 공유한 원래 비밀 없는 합성 6파일의 SHA를 확인한 뒤 이 검증기를 통과시켰다. 합성품번은 `NEW-0001`이며 실품목 근거가 아니다.
- `verify-facet-release.mjs`: Hub가 제공할 공개형 facet 후보와 재고 원본 바이트의 고정 SHA, 현재 승인 공개 스키마, 정확 활성 PN/승인 Legacy 별칭, KST 기준일·36시간/미래 5분, 미승인·비활성 행 제외를 소비기 관점에서 확인한다. 실제 Hub 승인 이력·원본 receipt·현재 revision은 검증하지 못하므로 결과에 `publicationAllowedByThisReport=false`를 고정한다. 실제 Hub 후보는 아직 받지 못해 합성 7회귀만 통과했다.

## 실제 검증 범위

- 현재 격리 복사본: inventory baseDate 20261127/13,166 exact PN/SHA `99d576423b583b041487f73ffd0019a0f3d197aeaed4ddd50b172b6f73bdee07`; approved display 2 PN/SHA `7cf8df785d110a31aeaa7455ae890ce9e8a9acbababf7c80cbe6ed49dfa121b0`; 제품 WebP 참조 1개; facet 파일 없음. 이는 저장소 커밋의 정적 파일 검사이지 이번 공개 CDN 실조회나 Hub DB 재확인이 아니다.
- 공개 snapshot 구조/변조/미승인/이미지 누락 4회귀, 이미지 후보 합성 SHA/미승인 2회귀, 고정 커밋 비공개 백업·변조 탐지·정정 복구 1회귀 통과. 보존된 감사 도구 1시험도 재실행해 통과했다. Hub 원래 합성 묶음의 `candidate.json` SHA는 `dbd302912057b4a54e62f2c17c36dabd2c437988b6cc8d796ac196e01badeb56`, WebP SHA는 `9c3b38a3c4d9fe5a7a26a28e7865148ebc43773936864e90120a550ed349dc82`이며 Git 제외 private 경로에만 보관한다.
- 실제 public push, GitHub Actions 변경, ERP/제조사 HTTP 호출, Hub 승인·게시, VM 변경은 수행하지 않았다.

## 다음 결합 조건

1. root의 공차 검색 계약과 trusted publisher를 대조한다. 사용자가 이미 승인한 `±1%` 원문/`tolerance_percent`를 재승인 요청하지 않는다. `tolerance_bounds_percent` 승인 상태를 임의 변경하거나 기존 공개 JSON에 새 facet을 만들어 게시하지 않는다.
2. root와 publication ID·입력 snapshot SHA·현재 리뷰 버전·Git fast-forward·pending/공개 SHA ACK·복구 계약을 맞춘 다음에만 절체를 판단한다. 이 브랜치와 원래 dirty 작업 폴더는 계속 분리한다.
3. 원격 보존을 검토할 때 대상은 PUBLIC 저장소 `ceranix26/maxgain-homepage`이며 최소 신규 추적 파일은 `scripts/hub-migration/RECOVERY-MANIFEST.md`, `backup-public-search-snapshot.mjs` 및 시험, `verify-public-search-snapshot.mjs` 및 시험, `verify-product-image-bundle.mjs` 및 시험, 그리고 백업 제외 규칙 `.gitignore`다. 원격에 이미 있던 감사 4파일은 별도 중복전송 대상이 아니다. private 백업·합성 fixture·현재 공개 data JSON은 전송 대상에서 제외한다. 이 기록의 절체 단계에서는 공개 `main` push가 없었다.

이후 로컬로 추가한 facet 사전검사와 [이미지 절체 절차](../../docs/PRODUCT-IMAGE-HUB-CUTOVER.md)도 공개 후보가 아닌 **검토용 로컬 문서·도구**다. 위 3번은 당시 원격 보존 최소범위를 기록한 것이며, 실제 전송 범위는 다시 확정해야 한다.

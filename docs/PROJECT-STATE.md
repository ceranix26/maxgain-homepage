# MAXGAIN Project State

Last updated: 2026-10-27

## Stable Systems

### ECOUNT
전체 Product Master pagination과 Inventory Balance 병합이 정상 동작한다.

Validated baseline:
- Unique product codes: 22,546
- Part Numbers: 22,030
- In stock: 3,585
- Out of stock: 18,445

Google VM cron:
- Daily at 08:00 KST
- Uses `scripts/update-ecount-inventory-integrated.mjs`

확인된 문제가 없는 한 이 구조를 변경하지 않는다.

### Product Search
- 전체 ECOUNT Part Number를 검색할 수 있다.
- non-product 항목은 UI에서만 제외한다.
- 한글 `샘플` 항목도 필터링된다.
- 원본 `inventory-status.json`은 유지한다.

### Product Images
GitHub Actions 이미지 pipeline이 end-to-end로 동작한다.

Validated test:
- Part Number: `0402CS-16NXJLW`
- Output: `assets/images/products/d7aff0c0b79e6c7d.webp`
- Remote URL이 local WebP 경로로 자동 변경됨

Pipeline:
remote image -> SHA-256 dedup -> 160x160 WebP -> Git -> Cloudflare

## Manufacturer Database

File: `data/product-manufacturers.json`

Current total:
- 1,750 / 22,030
- Coverage: 7.94%

Breakdown:
- Walsin pattern-high: 1,372
- Walsin verified: 16
- Viking Tech pattern-high: 361
- Coilcraft verified: 1

### Known manufacturer directions
- Viking `CR-...` family is important, but official ordering structure remains the final validation rule.
- Samsung MLCC uses `CL` + two-digit size and an official structured PN format.
- Yageo `RC...` is a high-priority group.
- Murata `GRM...` is a high-priority group.
- ROHM `MCR...` is a high-priority group.
- Johanson numeric Legacy patterns require official search verification.

## Johanson - Highest Priority

Existing script:
- `scripts/update-johanson-technology-specs.mjs`

The script queries:
- Johanson Technology official PN search
- Johanson Dielectrics official PN search

Supported:
- `--dry-run`
- `--retry`
- `--limit`
- `--part-number`
- Legacy exact match
- Global exact match
- manufacturer mapping
- alias mapping
- structured official specs
- official PDF links

Known verified relation:
- Legacy: `0400LP15A0122E`
- Global: `0400LP15A0122001E`

### Current Johanson live result

Command:

```bash
node scripts/update-johanson-technology-specs.mjs \
  --dry-run \
  --retry \
  --part-number 0400LP15A0122E
```

Result:
- `totalRequests: 2`
- Johanson Technology search returned exact Legacy/GPN relation
- Johanson Dielectrics search returned the same exact Legacy/GPN relation
- current importer records `cross-company-exact-match`

### Current Johanson work in progress
Resolve duplicate cross-site exposure when both sites return the SAME normalized Global PN.

Required behavior:
1. Do not immediately mark same-GPN results as a true conflict.
2. Fetch official detail page(s).
3. Resolve ownership from official evidence:
   - canonical/detail URL
   - explicit manufacturer/company field
   - authoritative company-specific product detail
4. Do not hard-code ownership based on category alone.
5. If official evidence remains insufficient, keep review.
6. If the two sites return different Global PNs, keep current conflict behavior.
7. Successful ownership resolution continues to:
   - manufacturer verified
   - Legacy/GPN alias
   - structured official specs
   - official PDF links

No Mouser should be used for this step.

## Samsung

Script created:
- `scripts/update-samsung-mlcc-specs.mjs`

Not live-tested yet.

Official sources:
- Samsung Electro-Mechanics MLCC Product Search
- Samsung MLCC Lineup Search

First intended test PN:
- `CL03A104K03NNNC`

Samsung work must wait until current Johanson changes are finished and committed.

Goal:
official exact product match -> manufacturer verified -> official structured MLCC specs -> datasheet/specsheet

Do not collect images during Samsung official spec enrichment.

## Walsin
Official catalog classifier and manufacturer mapping are complete.

Current:
- verified: 16
- pattern-high: 1,372

## Viking Tech
Official catalog classifier and manufacturer mapping are complete.

Current:
- pattern-high: 361
- CR/AR catalog rules included
- review candidates remain unassigned

## Next Priority
1. Finish Johanson cross-company ownership resolution.
2. Run Johanson Technology single-PN dry-run.
3. Run Johanson Dielectrics single-PN dry-run.
4. Run a small Johanson batch.
5. Run Samsung `CL03A104K03NNNC` single-PN dry-run.
6. Add Samsung official specifications.
7. Add Walsin/Viking official specifications.
8. Use Mouser only as fallback with a strict internal daily quota.

## New Copilot Chat Start Prompt

```text
한국어로 계속 작업해줘.

먼저 다음 파일을 읽고 현재 프로젝트 상태와 작업 원칙을 이해해:
- .github/copilot-instructions.md
- docs/PROJECT-STATE.md

기존 정상 구조를 변경하지 말고 현재 중단 지점부터 이어가.

첫 작업:
scripts/update-johanson-technology-specs.mjs의
Johanson Technology / Johanson Dielectrics 동일 Global PN
cross-company ownership resolution을 마무리해.

데이터 파일은 수정하지 말고 dry-run 가능한 상태까지만 작업해.
```

## Johanson 업데이트 - 2026-10-27

- 공식 회사 표기: Johanson Technology = JTI, Johanson Dielectrics = JDI.
- updater가 JTI/JDI를 각각 올바른 회사로 판별하는 모의 검증을 통과했다.
- 실제 Codespaces 요청은 양사 검색 모두 HTTP 403을 반환했다. 브라우저에서 확인된 결과만으로는 전체 live dry-run을 완료하지 못했다.
- 브라우저에서 `0400LP15A0122001E` 상세 페이지의 Company가 JTI인 것을 확인했다. 양사 페이지가 검색/상세 도구를 공유하고 canonical 도메인이 Company 표기와 다를 수 있으므로, canonical 도메인만으로 소유 회사를 판정하지 않는다.
- 한쪽 상세 요청만 성공한 경우에도 그 페이지에 명시된 JTI/JDI를 기준으로 소유권을 판정할 수 있다. 상세 페이지가 보고한 canonical URL은 규격 source로 사용한다. 명시 회사 코드가 서로 충돌하면 cross-company review에 남긴다.
- 데이터 JSON은 변경하지 않았다.

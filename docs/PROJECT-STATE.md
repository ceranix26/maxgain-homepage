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

- 공식 회사 코드: Johanson Technology = `JTI`, Johanson Dielectrics = `JDI`.
- 공식 상세 페이지의 `Johanson Company` 필드는 `<li>라벨: <span>값</span></li>` 형태다. 파서는 이 list 구조를 읽고 `JTI`/`JDI`를 명시적 소유권 근거로 사용한다.
- 양사의 검색 도구 및 상세 페이지는 결과를 공유할 수 있다. 검색 결과의 회사명이나 페이지 도메인/canonical만으로 소유권을 추정하지 않는다.
- 동일 normalized Global PN이 양쪽 검색에서 반환되면 상세 페이지의 명시 회사 코드로 소유권을 판정한다. 한 상세 요청만 성공해도 그 상세에 명시된 코드가 유일하고 모순이 없으면 해당 소유권을 사용할 수 있다. `JTI`/`JDI` 증거가 서로 충돌하거나 명시 코드가 없으면 `cross-company-exact-match` review로 남긴다.
- 상세 페이지의 안전한 official canonical URL은 specifications source URL로 사용한다. `Johanson Company`, PN 라벨, 제품군 등의 식별 메타데이터는 기술 specs에 넣지 않는다.
- 빈 값 `None` 및 링크 버튼 텍스트 `Download`는 specs에서 제외한다. 실제 기술 필드만 보존한다.
- `0400LP15A0122E`는 Legacy PN, `0400LP15A0122001E`는 확인된 Technology GPN이다. Google VM에서 2026-10-27 실행한 이전 커밋의 dry-run은 양쪽 검색/상세 요청 성공 후 이 관계를 찾았으나 당시 출력에는 빈 specs 값과 Download 텍스트가 포함돼 있었다.
- 최신 정리 커밋 `a86b7ad`는 push 완료됐으나, Google VM에서 아직 pull 및 재검증하지 않았다. 다음 작업은 VM에서 `git pull --ff-only` 후 동일 PN을 `--dry-run --retry`로 재실행하고, 제안된 specs에 `None`/`Download`/회사 및 PN 메타데이터가 없는지 확인하는 것이다.
- 확인 전에는 real write를 실행하지 않는다. 현재까지 `product-manufacturers.json`, `product-aliases.json`, `product-specs.json`은 수정하지 않았다.

## Johanson 업데이트 - 2026-10-28 (수집 완료)

- VM에서 `--limit 100` batch를 후보 소진까지 반복했고 `a86b7ad` 이후 모든 결과를 push했다. 소진 신호는 요청 1~2회, `limit: false`, `added: 0`이다.
- 저장 상태: 제조사 매핑 2,630개(Johanson Technology verified 525, Johanson Dielectrics verified 355, Walsin 1,388, Viking Tech 361, Coilcraft 1), alias 448개, spec 509개, 후보 18건.
- 남은 review: `no-exact-match`는 Johanson 제품이 아닌 PN이라 정상이다. 후보가 여럿인 `ambiguous-exact-matches` 18건은 후보 표시로 처리한다.
- 일반 MLCC 모호 GPN 규칙(Johanson 공식 답변): 500V 이상은 `VB`, 미만은 `TF`로 시작하는 GPN이 검색 결과에 나온다. 설명이 `Capacitors SMT`로 시작하고 전압이 일치하며 후보가 정확히 하나일 때만 확정하고, 그 외에는 review로 남긴다.
- 한 Legacy PN이 여러 GPN으로 나오고 규칙으로 가려지지 않으면 alias/manufacturer/spec을 Legacy PN에 만들지 않는다. 후보 GPN과 공식 URL을 `data/product-candidates.json`에 기록하고, 후보 GPN별 공식 spec만 GPN 키로 `product-specs.json`에 저장한다.
- `-BME` 접미사 Legacy PN은 `electrode: "BME"` 후보로 기록하고 화면에 `(BME)`를 붙인다. PME는 공식 필드가 없어 표기하지 않는다.
- 이미 `verified`인 Johanson PN은 후보에서 제외한다. 후보 파일은 항목이 해결되면 제거될 수 있어 기존 데이터 변경 검사 대상에서 제외한다.
- 화면(`product-search.html`): "변경된 Part Number" 후보 링크를 규격보다 위에 표시한다. 후보 규격은 모든 후보에서 같은 값은 "공통 규격"으로 한 번만, 다른 값은 후보별 비교 표로 보여준다. 링크는 https와 Johanson 두 도메인만 허용한다.
- Johanson 형식 PN(`0400LP15…`, `101R14…` 등)을 후보 앞쪽에 정렬하고 Walsin 패턴(`^\d{4}[NX]`)은 뒤로 보낸다. 제외는 하지 않는다.
- 운영 절차: Codespaces는 Johanson에서 403이라 조회는 VM에서만 한다. 요청 한도는 실행당 200회, 간격 1초다. 일반 batch는 dry-run 없이 실행하고, 실행 후 제조사/alias/spec의 기존 항목 `removed 0, changed 0`을 확인한 뒤 데이터 파일만 `git add`한다. review/backup 파일은 commit하지 않는다. 대화형 shell에서 `set -e`를 쓰면 세션이 닫히므로 `bash -c`로 감싼다.
- 다음 작업: Samsung(`CL03A104K03NNNC` 단일 PN dry-run부터).

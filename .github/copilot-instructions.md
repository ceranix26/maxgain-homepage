# MAXGAIN Homepage - Copilot Instructions

## Communication
- 사용자와 항상 한국어로 대화한다.
- 설명은 짧고 실행 가능한 단계 중심으로 한다.
- 터미널 작업은 그대로 복사해 실행할 수 있는 정확한 명령을 제공한다.
- 복잡한 작업은 한 번에 크게 변경하지 않고 검증 후 다음 단계로 진행한다.
- 현재 정상 동작하는 구조를 불필요하게 리팩터링하지 않는다.
- 기존 파일 구조와 운영 설정을 최대한 보존한다.

## Project Purpose
- MAXGAIN은 B2B 전자부품 검색 및 문의 사이트다.
- 핵심 기능은 Part Number 검색, ECOUNT 재고, 제조사 공식 규격, Datasheet, 대표 이미지, Legacy/GPN alias다.
- 기능 수보다 데이터 정확도와 운영 안정성을 우선한다.
- 제조사 공식 데이터가 최우선 source다.
- Distributor 데이터는 제조사 공식 데이터가 없을 때만 보조한다.

## Architecture

### Google Cloud VM
- ECOUNT 및 공식 제조사 데이터 수집 자동화를 담당한다.
- ECOUNT cron은 매일 08:00 KST에 실행한다.
- ECOUNT 실행 스크립트는 `scripts/update-ecount-inventory-integrated.mjs`다.
- Product Master 전체와 Inventory Balance를 병합한다.
- 재고가 없는 제품도 `data/inventory-status.json`에 반드시 유지한다.
- 재고 있는 제품만 남기는 이전 방식으로 되돌리지 않는다.

Validated ECOUNT baseline:
- Unique product codes: 22,546
- Part Numbers: 22,030
- In stock: 3,585
- Out of stock: 18,445

### GitHub Actions
- 제품 이미지 최적화를 담당한다.
- 승인된 remote image를 SHA-256 exact dedup 후 최대 160x160 WebP로 변환한다.
- 목표 용량은 20 KB 이하, hard maximum은 30 KB다.
- 결과는 `assets/images/products/`에 저장한다.
- ECOUNT 자동화를 GitHub Actions로 옮기지 않는다.

### Cloudflare
- HTML, 운영 JSON, 최적화 이미지를 정적 배포한다.
- `node_modules/**`, `scripts/**`, `references/**`, backup/review/unresolved 파일은 배포하지 않는다.

## Core Data Files

### `data/inventory-status.json`
- ECOUNT 전체 Part Number와 stock status를 저장한다.
- 검색의 원본 데이터이므로 임의로 삭제하거나 제조사 데이터로 대체하지 않는다.

### `data/product-manufacturers.json`
- Part Number별 제조사를 저장한다.
- confidence 값:
  - `verified`
  - `pattern-high`
- `verified`가 항상 `pattern-high`보다 우선한다.
- 기존의 다른 제조사를 자동으로 덮어쓰지 않는다.

Current validated baseline:
- Total mappings: 1,750
- Walsin verified: 16
- Walsin pattern-high: 1,372
- Viking Tech pattern-high: 361
- Coilcraft verified: 1

### `data/product-specs.json`
- 공식적으로 확인된 기술 규격만 저장한다.
- Marketing description에서 기술 규격을 추측하지 않는다.
- 기존의 더 높은 권위의 공식 필드를 낮은 권위의 데이터로 덮어쓰지 않는다.

### `data/product-aliases.json`
- 제조사가 공식 확인한 Legacy PN과 Global PN 관계만 저장한다.
- 문자열 유사성으로 alias를 추론하지 않는다.

### `data/product-image-index.json`
- SHA-256 기반 로컬 최적화 이미지 인덱스다.

## Manufacturer Priority
MAXGAIN은 Johanson 대리점이므로 Johanson 데이터를 최우선으로 완성한다.

Priority:
1. Johanson Technology
2. Johanson Dielectrics
3. Samsung Electro-Mechanics
4. Walsin
5. Viking Tech
6. Yageo
7. Murata
8. ROHM
9. Mouser fallback

## Source Priority
제품 규격 source 우선순위:
1. 공식 제조사 Product Search
2. 공식 제조사 Datasheet / Specsheet
3. 공식 Part Number definition에서 명시된 값
4. Distributor exact-MPN 데이터
5. Mouser fallback

누락된 기술 규격을 Description에서 추측하지 않는다.

## Johanson Rules
- Johanson Technology와 Johanson Dielectrics를 서로 다른 manufacturer로 유지한다.
- ECOUNT에는 Legacy PN과 Global PN이 혼재한다.
- 공식 검색 결과가 확인한 Legacy/GPN만 alias로 저장한다.
- AEC와 non-AEC 제품은 공식 데이터가 동일 제품으로 매핑하지 않는 한 분리한다.
- 두 검색 frontend가 같은 Global PN을 반환할 수 있다.
- 같은 Global PN이라는 이유만으로 cross-company conflict로 단정하지 않는다.
- 공식 detail page, canonical URL, manufacturer/company field 등 공식 증거로 소유 회사를 판정한다.
- 공식 증거로 판정할 수 없으면 review에 남긴다.

Known Johanson example:
- Legacy PN: `0400LP15A0122E`
- Global PN: `0400LP15A0122001E`

## Product Specifications
- 공식 structured Product Search 데이터, 공식 PDF 및 명시적 PN definition만 사용한다.
- 누락 값을 만들지 않는다.
- 공식 필드의 원래 의미와 단위를 보존한다.
- Manufacturer, category, lifecycle/status, source URL, datasheet/specsheet를 함께 보존한다.

## Product Images
- 이미지 처리는 Google VM이 아니라 GitHub Actions가 담당한다.
- 승인된 remote 이미지 URL만 처리한다.
- SHA-256은 원본 다운로드 bytes 기준이다.
- WebP, 최대 160x160, no upscale, target <=20 KB, hard max <=30 KB다.
- verified issue가 없으면 pipeline을 변경하지 않는다.

Validated image test:
- PN: `0402CS-16NXJLW`
- Local file: `assets/images/products/d7aff0c0b79e6c7d.webp`

## Mouser
- Mouser는 fallback이다.
- exact Manufacturer Part Number match만 자동 처리한다.
- Mouser Description에서 기술 규격을 생성하지 않는다.
- 제조사 공식 데이터가 우선한다.
- API rate limit보다 낮은 내부 일일 quota를 사용한다.
- 이미 처리한 exact/unresolved/ambiguous 항목은 retry 요청이 없으면 다시 조회하지 않는다.

## Non-product Search Filter
`inventory-status.json`에서는 삭제하지 않고 customer-facing Product Search에서만 숨긴다.

Known filter patterns:
- 택배
- 배송
- 운임
- 수수료
- 포장비
- 작업비
- 가공비
- 금형비
- 샘플
- SHIPPING
- FREIGHT
- DELIVERY
- HANDLING
- TOOLING
- SAMPLE
- FILTER TAPE
- ADAPTER
- TOOL
- CHIP외

## References
- `references/`는 제조사 공식 카탈로그를 일시적으로 분석하는 로컬 공간이다.
- Git에 commit하지 않는다.
- classifier 완성 후 대용량 PDF를 삭제한다.

## Safe Change Process
데이터 자동화 변경 시 반드시 다음 순서로 진행한다.
1. 현재 구현과 입력 구조 확인
2. 좁은 범위로 변경
3. `node --check`
4. `git diff --check`
5. dry-run
6. Part Number 1개 테스트
7. 소량 batch
8. 실제 write
9. JSON 검증
10. 의도한 파일만 commit

- 데이터 자동화에서 `git add .`를 사용하지 않는다.
- review, unresolved, backup, temp reference 파일을 명시 요청 없이 commit하지 않는다.
- 실제 API endpoint와 응답 형식을 확인하기 전 전체 batch를 실행하지 않는다.

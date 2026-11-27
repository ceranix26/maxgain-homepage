# 홈페이지 legacy 자료의 Hub 이전 감사 도구

이 도구는 홈페이지 저장소의 정적 자료를 **읽기만** 하여 비공개 감사 JSON을 `/tmp`에 생성한다. Hub API, ECOUNT, 제조사 사이트에 접속하거나 운영 JSON을 수정하지 않는다.

```bash
node scripts/hub-migration/audit-homepage-data.mjs . '<Hub에서 읽기 확인한 MAXGAIN 회사 UUID>'
node --test scripts/hub-migration/audit-homepage-data.test.mjs
```

출력 경로는 실행 때 새로 만든 임시 폴더이며 폴더 권한은 `0700`, JSON은 `0600`이다. 출력에는 원문 파일 바이트가 들어가지 않는다. 각 원본 파일의 바이트 SHA256, 정확한 JSON Pointer·원문 키, 레코드의 **파생** 정렬 JSON 해시, 활성 재고 품번의 정확 문자열 일치 여부가 들어간다. 검색용 대문자·공백 정규화는 충돌 진단에만 사용하고 ERP 연결 근거로 쓰지 않는다. 로컬 WebP 자산은 파일 해시·크기만 기록한다.

출력 직전에 10개 원본 파일의 바이트 SHA·건수, 7개 legacy의 모든 JSON Pointer와 파생 레코드 해시, 활성 재고 참조 SHA·기준일·건수, 이미지 자산 해시를 다시 확인한다. 원본이 감사 도중 바뀌면 출력을 중단한다. `audit_id`는 회사·환경·원본 파일·이미지 SHA의 결정적 해시이며, `audited_at`은 **감사 실행 시각**이지 제조사 원문 관측시각이 아니다.

7개 legacy 자료: `product-specs`, `product-manufacturers`, `product-aliases`, `product-candidates`, `product-image-index`, `product-item-groups`, `walsin-chip-resistor-review`. 3개 생성 산출물: `inventory-status`, `catalog-display-specs.v1`, `site-popups.v1`. 생성 산출물은 legacy 승인·팝업 선택 이력으로 재수입하지 않는다.

Hub에서 2026-11-27 KST에 읽기 확인한 MAXGAIN 회사 UUID는 **감사 봉투의 회사 범위**일 뿐, 각 레코드의 회사·정확 ERP 코드 연결 증명은 아니다. 모든 legacy 레코드의 `erp_binding`, `official_raw_sha256`, `source_observed_at`은 `null`이며 `LEGACY_UNVERIFIED`, `import_allowed=false`, `publication_allowed=false`로 고정한다. 원본 JSON의 `source.url`이나 Git 파일 SHA를 공식 제조사 HTML 원본 해시로 승격하지 않는다.

`product-aliases.json` 448건은 로컬 제조사표상 모두 Johanson(Technology 271, Dielectrics 177)이며 대상 품번도 legacy `product-specs`에 존재한다. 이는 Legacy→현재 품번의 **후보 관계**이며 승인 또는 ERP 코드 연결이 아니다. 대상이 현재 활성 재고 PN과 정확 일치하지 않는 건수는 오류·삭제 대상이 아니라 원인 미분류로 남긴다. Hub의 별도 provisional alias 원장과 승인 이력으로 옮기는 방향을 사용자와 합의했다.

이 감사 JSON은 Hub의 provisional staging/receipt 계약을 위한 입력 후보이다. 현재 해당 수신 API는 없다. 실제 이전 전에는 Hub가 원본 파일 바이트와 이미지 원본을 불변 저장소에 받아 SHA·경로·회사/환경을 검증하고, 품번별 ERP 연결과 검토 이력을 별도로 확정해야 한다. 홈페이지 정적 공개 산출물은 그 뒤 현재 승인 상태에서 다시 생성하고 공개 SHA를 확인한다.

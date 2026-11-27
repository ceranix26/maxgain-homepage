# Hub provisional 수신 계약 대조 (2026-11-27)

이 파일은 `hub-homepage-legacy-audit.v1` **dry-run 감사 봉투**의 필드 대응표다. Hub의 원본 수신 API와 DB 적재는 아직 구현·호출되지 않았다.

| Hub 검토 항목 | 감사 필드 | 판정 |
|---|---|---|
| 감사 범위 | `audit_id`, `audited_at`, `repository`, `source_commit`, `company_id`, `environment`, `dry_run` | 회사 UUID는 Hub 운영회사 목록 READ 범위만 증명. 개별 품목 연결은 미확인. |
| 원본 파일 | `files[].dataset_kind`, `repository_relative_path`, `sha256`, `byte_length`, `record_count` | `sha256`은 Git JSON **원본 바이트**. 7 legacy와 3 공개 생성물을 분리. |
| 원본 위치 | `records[].source_file_sha256`, `json_pointer`, `source_key_raw` | 원문 키의 선행 0·대소문자·공백을 보존. 실행 때 모든 pointer와 파일 해시 재검증. |
| 추출값의 무결성 | `record_value_canonical_sha256` | 파생된 정렬 JSON 해시. 원본 바이트 SHA나 공식 제조사 receipt 대체 불가. |
| 연결 후보 | `legacy_mpn_raw`, `manufacturer_raw`, `canonical_mpn_candidate`, `inventory_exact_pn_matches` | 현재 재고의 **정확 문자열**만 진단. ERP 코드 연결이나 승인 근거가 아님. |
| 권위·검토 | `erp_binding=null`, `official_raw_sha256=null`, `source_observed_at=null`, `evidence_state=LEGACY_UNVERIFIED`, `import_allowed=false`, `publication_allowed=false`, `issues` | 현재 홈페이지 정적 자료로는 공식 원문·현재 revision/review chain을 증명할 수 없어 전건 provisional. |
| 재고 조인 기준 | `inventory_reference` | 같은 저장소 snapshot의 재고 원본 SHA·기준일·갱신시각·품번 수 고정. `source_commit`과 함께 보존. |
| 이미지 | `assets[].path`, `sha256`, `bytes` | 로컬 공개 최적화 WebP 3개. 제조사 원본 이미지나 Hub 비공개 원본으로 자동 분류하지 않음. |
| 결과 통계 | `dataset_summary`, `coverage` | 별칭 대상의 활성 재고 PN 미일치, 검색 정규화 충돌은 **미분류 진단**. 자동 삭제·병합 없음. |

별칭 448건은 로컬 제조사 분류상 Johanson Technology 271건·Johanson Dielectrics 177건이다. Legacy→현재 PN 관계는 Hub의 별도 provisional alias 원장으로 수신한 뒤 공식 원문·현재 품목 revision·사람 검토를 통해 승인한다. 기존 Hub의 승인 별칭 이력과 감사 후보를 섞지 않는다.

현재 공개 `catalog-display-specs.v1.json`의 2품번·16필드는 이미 별도 검토 체계에서 나온 **생성 산출물**이다. 이 감사는 원본 승인 이벤트나 전체 lineage를 재구성하지 않으며, 그 파일을 legacy 승인으로 재수입하지 않는다. 공개 `inventory-status.json`과 `site-popups.v1.json`도 동일하게 생성 산출물로만 기록한다.

재현 명령과 파일 권한은 [README.md](README.md)에 있다. 실제 실행 시 `verifyAuditAgainstSource()`가 파일·레코드·이미지 해시를 다시 확인하고, 결과 JSON을 새 `/tmp` 폴더에만 쓴다. 원본 파일/원문 고객정보 전송, ERP 호출, 공개 게시, 데이터 삭제는 이 도구 범위가 아니다.

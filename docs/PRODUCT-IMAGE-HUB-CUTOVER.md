# 제품이미지 Hub 절체 준비 — 실행 전 절차

기준: 2026-11-28 KST. **현재 운영 절체 지시서가 아니다.** 옛 GitHub Action과 새 Hub 게시기를 동시에 제품이미지 작성자로 두지 않기 위한 순서·복구 기준이다. 코드·Action·공개 파일을 이 문서 작업에서 변경하지 않는다.

## 현재 확인과 아직 모르는 것

- `.github/workflows/sync-product-images.yml`은 `main`의 `data/product-specs.json` push와 수동 실행으로 시작하고, 원격 이미지 URL이 있으면 `scripts/sync-product-images.mjs`를 실행해 직접 외부 GET한 뒤 제품 WebP·specs·index를 다시 `main`에 push하도록 작성돼 있다. 저장소 코드 확인이며 **현재 GitHub workflow 활성 여부·진행 중 run은 이 문서 작성 시 재조회하지 않았다**.
- 현재 공개 입력에는 원격 이미지 URL 0건과 로컬 WebP 참조 1건이 있었다. 새 원격 URL이 들어오면 옛 Action 직접 경로가 다시 작동할 수 있으므로, 0건만 보고 절체 완료로 판정하지 않는다.
- Hub 제품이미지 core는 원본/가공 SHA와 exact PN·회사/환경을 가진 합성 6파일 후보를 생성한다. 홈페이지 검증기는 해당 합성 묶음의 바이트 SHA·경로·미승인 상태를 확인했다. 실제 API/DB 검토 승인, 안전한 게시기, 실제 제조사 이미지의 권리·출처 검토는 별개다.

## GO 전 기술 관문

| 순서 | 담당 | 통과 근거 |
|---|---|---|
| 1 | Hub | 제품이미지 API/원본 영속보관/현재 승인 revision·review chain/공개 후보 emitter와 게시기가 운영 준비됐다는 증거. 원본 URL `null`은 그대로 두고 공식 출처로 추정하지 않음 |
| 2 | 홈페이지 | `verify-product-image-bundle.mjs`로 Hub 후보의 회사·환경·정확 PN, 활성 재고 바이트 SHA, 원본·가공 WebP SHA, specs/index 연결과 충돌을 확인. 합성 시험은 실제 승인·실게시 시험으로 계산하지 않음 |
| 3 | 홈페이지+Hub | 현재 `main`의 전체 40자 커밋과 공개 재고·승인규격·팝업 SHA를 고정. `backup-public-search-snapshot.mjs`로 이전 정상본의 정확 바이트와 manifest를 별도 보관·검증. 새 게시 파일 허용목록은 `data/product-specs.json`, `data/product-image-index.json`, 정확 SHA 경로의 `assets/images/products/<원본SHA앞16>.webp`뿐 |
| 4 | 운영 담당 | GitHub에서 옛 이미지 Action의 상태·진행 중 run을 읽고 기존 실행 종료를 확인. 그다음 **root 절체 GO가 있을 때만** 해당 workflow를 비활성화하고 실제 비활성 상태를 재확인. 파일 삭제는 하지 않음 |
| 5 | Hub 게시기 | 전용 게시 잠금 아래 후보/현재 승인·원본SHA·재고SHA를 다시 검사하고 최신 `main` 부모에 정확 세 파일만 한 커밋으로 일반 fast-forward push. 강제 push·다른 자료 포함·불명확 결과 자동 재시도 금지 |
| 6 | 홈페이지+Hub | 원격 commit 및 공개 specs/index/WebP의 정확 SHA·재고/기존규격/팝업 불변 확인. 실제 PN 검색·이미지 표시와 실패 복구 절차 확인 후 새 작성자 경로를 운영으로 기록 |

현재는 **2번의 비밀 없는 합성 묶음 검사와 3번의 고정 커밋 백업·손상 후 정정 복구 리허설만 완료**했다. 1·4·5·6번은 운영 완료가 아니다. 실제 새 이미지가 없어도 API/DB/게시기/충돌·복구의 격리 시험을 먼저 마칠 수 있다.

## 실패 또는 결과 불명확 때

- Action 비활성 **전** Hub 후보·승인·백업 검사가 실패하면 기존 운영 파일과 Action 상태를 유지하고 중단한다.
- Action을 비활성화한 뒤 새 Git push **전** 실패하면 기존 공개 파일은 그대로다. Hub의 원인·운영 준비 상태를 확인한 후 기존 작성자 재가동 여부를 root가 결정한다. 검사 실패를 무시하고 신규 이미지를 공개하지 않는다.
- push 응답이 없거나 timeout이면 원격 `main` 커밋과 허용 세 파일의 SHA, 공개 응답을 읽어 반영 여부를 판별한다. 같은 후보를 무조건 다시 push하지 않는다.
- 새 커밋이 반영됐지만 공개 bytes·화면이 틀리면 이전 manifest에서 specs/index의 정확 바이트를 복원한 **새 정정 커밋**을 최신 `main` 위에 만든다. 강제 push/reset은 금지하며 WebP 파일은 다른 참조 여부를 확인하기 전 삭제하지 않는다. 재고·승인규격·팝업 파일은 정정 커밋에 넣지 않는다.
- 승인 철회·새 revision·원본 변조·회사/품번 충돌은 Hub 게시를 차단하고 기존 정상 공개 파일을 유지한다. 검증 실패를 우회하려고 옛 Action을 병행 실행하지 않는다.

## 수집 경로 구분

Hub의 승인된 이미지 **원본 bytes 업로드**와 향후 허용 호스트/경로에 한정한 Hub 수집은 다른 경로다. 옛 Action의 임의 원격 URL 직접 GET을 새 Hub 경로의 fallback으로 사용하지 않는다. 브라우저는 공개 정적 WebP만 읽고 Hub 토큰·ERP 키·내부 원본을 받지 않는다.

절체 결과의 publication ID, 원본/후보 SHA, Git commit, 공개 SHA 확인 시각, Action 이전/이후 상태와 복구 결과는 Hub와 홈페이지 운영 기록에 각각 남긴다. 빈 이미지 수집 주기는 실제 새 이미지 게시 성공으로 계산하지 않는다.

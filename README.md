# 소중한병원 휴가관리 웹앱

React + Vite + Zustand + Cloudflare Pages Functions (Hono) + Cloudflare D1 기반의 모바일 우선 휴가관리 파일럿입니다.

## 포함 범위

- 사번/비밀번호 로그인
- 직원 개인 대시보드
- 잔여 연차 계산
- 휴가 신청
- 팀장 1차 승인
- 인사 최종 승인
- 원장/관리자 예외 승인 조회

## 데모 계정

모든 계정의 비밀번호는 `Pilot2026!` 입니다.

- 직원: `SH-2024-013`
- 팀장: `SH-2021-004`
- 인사: `SH-2020-001`
- 원장: `SH-2018-001`

## 로컬 준비

1. 의존성 설치
2. `.dev.vars.example` 을 복사해 `.dev.vars` 생성
3. `wrangler d1 create hospital-staff-leave-db`
4. 생성된 `database_id` 를 [wrangler.toml](/C:/Users/Dennis%20Heo/Desktop/%EC%86%8C%EC%A4%91%ED%95%9C%20%EB%B3%91%EC%9B%90/wrangler.toml)에 반영
5. `npm run db:migrate:local`
6. `npm run db:seed:local`
7. `npm run build`
8. `npm run cf:dev`

## 배포 순서

1. Cloudflare 로그인
2. D1 생성 및 마이그레이션/시드 반영
3. `npm run cf:deploy`
4. 생성된 `pages.dev` 주소를 QR 코드로 배포

## 참고

- 기존 단일 HTML 파일럿은 [병원 연차.html](/C:/Users/Dennis%20Heo/Desktop/%EC%86%8C%EC%A4%91%ED%95%9C%20%EB%B3%91%EC%9B%90/%EB%B3%91%EC%9B%90%20%EC%97%B0%EC%B0%A8.html)에 남겨뒀습니다.

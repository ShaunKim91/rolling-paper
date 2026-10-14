# 📝 우리 팀 롤링페이퍼

실시간 포스트잇 롤링페이퍼. 하트 ♥ · 폴라로이드 사진 📷 · 마감 후 공개 🎁 · QR 초대 · CSV 보관 · 모바일 자동 전환.

## Docker로 실행 (로컬 환경을 건드리지 않음)
```bash
docker compose up --build -d      # http://localhost:4174, 로그에 임시 공개 URL 출력
docker compose logs -f
docker compose down               # 종료하면 서비스·공개 링크·데이터가 모두 사라짐
```
컨테이너는 1시간(`SERVICE_LIFETIME_SECONDS`) 뒤 자동 종료됩니다.

## Supabase 연결 (선택)
1. SQL Editor에서 `supabase.sql` 실행 (테이블은 `rp_` 접두사라 기존 프로젝트에 재사용해도 충돌 없음)
2. `public/js/config.js`에 Project URL + Publishable key 입력 (secret/service_role 키 금지)

키가 비어 있으면 컨테이너 메모리 모드로 동작합니다.

## Vercel 배포 (선택)
GitHub 저장소를 Vercel에 import하면 `vercel.json` 설정으로 push마다 자동 배포되며,
모바일 UA는 같은 주소에서 `/m/`으로 자동 이동합니다(`?view=desktop`으로 PC 화면 강제 가능).
Vercel 모드는 Supabase 키가 필요합니다(정적 호스팅이라 메모리 API 없음).

# docs/ — 設計書・ADR 管理

## 設計書更新ルール (CRITICAL)
- **実装 = 設計**: 実装した機能は必ず対応する設計書に反映する。
- **更新対象**:
  - API 追加 → `07-API設計書.md`
  - DB 変更 → `08-データベース設計書.md`
  - UI 変更 → `06-UI設計書.md`
  - LP 変更 → `lp-content-map.md`

## ADR (Architecture Decision Records)
- **意思決定の記録**: `docs/decisions/` に新規 ADR を追加。
- **共有知識**: AI のメモリではなく、チームで共有すべき知識は ADR に置く。

## LP メトリクス ratchet (#1163)
- `mobileHeight` (15000px) / `desktopHeight` (8000px) の上限を破らない。
- 禁止用語（技術用語など）を LP に含めない。

## 認証検証 (npm run dev:cognito)
- 認証、管理画面、プラン別 UI を変更した際は、必ず `cognito-dev` モードで目視確認を行う。
- `DEV_USERS` の各種アカウント（owner/free/family等）でテストする。

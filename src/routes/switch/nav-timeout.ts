// src/routes/switch/nav-timeout.ts
// /switch → /admin ハードナビのタイムアウト SSOT (#3101 / #3416)。
//
// +page.svelte (本番実装) と tests/e2e/parent-gate.spec.ts (回帰 test) の双方が
// 本値を import する。test がマジックナンバー直書きだと、将来 NAV_TIMEOUT_MS を
// 変更したとき test が誤検知するため、結合を SSOT 1 箇所に集約する (ADR-0061)。

/**
 * ナビ失敗とみなすまでの待機時間 (ms)。一般的なサーバータイムアウト
 * (CloudFront/Lambda の上限 ~30s) に合わせる。正常時はナビ完了でページごと
 * 置換されるため本タイマーは発火しない (真にハングした場合のみ error 表示)。
 */
export const NAV_TIMEOUT_MS = 30_000;

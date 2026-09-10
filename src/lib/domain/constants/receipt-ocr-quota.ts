// src/lib/domain/constants/receipt-ocr-quota.ts
// 領収書読み取りの 1 世帯あたり回数上限 (PO 決裁 2026-09-10 決定 5)。
//
// **route file (`+server.ts`) に置けない。** SvelteKit は `+server.ts` の export を
// HTTP verb (と `_` 始まり) に限っており、それ以外を export すると `npm run build` が
//   Invalid export 'RECEIPT_OCR_QUOTA_PER_TENANT' in /api/v1/points/ocr-receipt
// で落ちる。値を route と test の両方から参照する必要があるので、constants に置く。

/**
 * 1 世帯 (tenant) が 24 時間に領収書を読み取れる回数。
 *
 * **プランでは分けない** (決定 5(a))。`site/pricing.html` が挙げる AI 自動提案 3 種に
 * 領収書の読み取りは入っておらず、有料機能として売っていないものを後から有料化する
 * ことになるため。したがって**上限に達してもアップグレード導線は出さない** —
 * 上限は売った機能の制限ではなく、1 世帯の誤操作 / 連打がベンダーコストを
 * 青天井にしないための線であり、上位プランでも外れない。
 */
export const RECEIPT_OCR_QUOTA_PER_TENANT = 20;

/** 上限のリセット間隔 (24 時間)。 */
export const RECEIPT_OCR_QUOTA_WINDOW_MS = 24 * 60 * 60 * 1000;

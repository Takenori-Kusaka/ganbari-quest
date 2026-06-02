// tests/unit/server/stripe/client-api-version.test.ts
//
// Phase 7 PR-3b / Issue #2721: Stripe API version 物理 bump regression test。
//
// 補強 PR #2684 (2026-05-30) で docs SSOT は `'2026-04-22.dahlia'` 維持 (`'2026-05-27.dahlia'`
// は preview リリースで本番不採用) と確定したが、`src/lib/server/stripe/client.ts` の物理
// `STRIPE_API_VERSION` 定数 bump が同 PR では実施されておらず、本 PR-3b cutover で物理同期した。
//
// 本 test は将来 `'2026-05-27.dahlia'` (preview) や任意の他値への意図しない bump を CI で検知し、
// 副次制約 4 (Webhook destination api_version immutable、#2683) に違反する apiVersion 変更を
// PR レビュー前に hard-fail させる regression gate として load-bearing。
//
// 設計 SSOT:
//   - docs/decisions/0059-phase7-cutover-sequence.md
//   - docs/design/billing-redesign/phase5-stripe-product-architecture.md §3.4 (#2683 訂正)
//   - docs/design/billing-redesign/phase6-context-decisions-6.md §5 (5 phase migration 手順)
//
// Stripe 公式根拠:
//   - https://docs.stripe.com/api/versioning (72h rollback window + stable / preview 区別)

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const CLIENT_TS_PATH = resolve(__dirname, '../../../../src/lib/server/stripe/client.ts');

describe('Stripe API version SSOT (Phase 7 PR-3b #2721 / 補強 PR #2684 docs 物理同期)', () => {
	const source = readFileSync(CLIENT_TS_PATH, 'utf-8');

	it('STRIPE_API_VERSION は stable リリース `2026-04-22.dahlia` を維持する (preview 不採用)', () => {
		// docs SSOT (phase5-stripe-product-architecture §3.4 #2683 訂正) との物理同期。
		// 値変更時は ADR-0059 + phase6-context-decisions-6 §5 の 4 step migration 手順
		// (Changelog 確認 → Webhook destination 新規作成 → SDK bump → 72h 監視) を完遂してから。
		expect(source).toMatch(/const STRIPE_API_VERSION = '2026-04-22\.dahlia'/);
	});

	it('preview リリース `2026-05-27.dahlia` を使用していない (production 非推奨、副次制約 4 違反 prevention)', () => {
		// Stripe 公式 API versioning policy: `YYYY-MM-DD.codename` の preview リリースは
		// backward incompatible change の評価用で production 非推奨。誤って戻し書きされていないか確認。
		expect(source).not.toMatch(/STRIPE_API_VERSION = '2026-05-27\.dahlia'/);
	});
});

// tests/e2e/ops-export-authz.spec.ts
// #4309: /ops/export が未認証で売上台帳 CSV を返していた欠陥の E2E 回帰 (ADR-0002 要件 1)。
//
// staging 実測 (2026-08-06): cookie 無し・認証ヘッダ無しの
//   GET /ops/export?type=sales&year=2026
// が **200 + 実顧客の売上台帳 CSV** を返した。原因は `/ops` の認可を
// `+layout.server.ts` にだけ置いていたこと (SvelteKit の layout load は page にしか適用されず
// `+server.ts` には走らない)。
//
// 本 spec は unit (`tests/unit/routes/ops-export-authz.test.ts`) と違い、**実際の HTTP 経路**
// (hooks.server.ts の identity 解決 → 認可層 → route handler) を通して塞がったことを確認する。
// unit は handler を直接呼ぶため、hooks / 認可層の側で穴が開いても検出できない。
//
// 実行: npx playwright test --config playwright.cognito-dev.config.ts tests/e2e/ops-export-authz.spec.ts

import { expect, test } from '@playwright/test';

const EXPORT_TYPES = ['sales', 'expenses', 'summary'] as const;

/**
 * 認可が**クエリ解釈より前**に走ることを確かめるための不正 type。
 *
 * - 認可を通れば handler の validation に到達して 400 (Invalid export type)
 * - 認可で止まれば 403
 *
 * 400 と 403 を撃ち分けられるので、「通った / 止まった」を外部サービス
 * (Stripe / AWS Cost Explorer) に一切依存せず決定的に判定できる。
 */
const INVALID_TYPE = 'not-a-real-type';

test.describe('未認証は /ops/export に到達できない (#4309)', () => {
	// 認証情報を持たない素の状態。storageState を明示的に空にする。
	test.use({ storageState: { cookies: [], origins: [] } });

	for (const type of EXPORT_TYPES) {
		test(`type=${type} は 403 を返し CSV を渡さない`, async ({ request }) => {
			const res = await request.get(`/ops/export?type=${type}&year=2026`);

			expect(res.status()).toBe(403);
			// 200 に戻る回帰では body に台帳のヘッダ行が載る。status だけでなく中身も見る。
			const body = await res.text();
			expect(body).not.toContain('取引日');
		});
	}

	test('認可はクエリ解釈より前に走る (不正 type でも 400 ではなく 403)', async ({ request }) => {
		// ここが 400 になる = validation が先に走っている = 認可前にリクエストが解釈されている。
		const res = await request.get(`/ops/export?type=${INVALID_TYPE}`);
		expect(res.status()).toBe(403);
	});
});

test.describe('ops group 非所属の認証済ユーザも到達できない (#4309)', () => {
	// 通常の顧客 (保護者)。ログイン済みでも /ops は運営専用。
	test.use({ storageState: 'playwright/.auth/free.json' });

	for (const type of EXPORT_TYPES) {
		test(`type=${type} は 403 を返す`, async ({ request }) => {
			const res = await request.get(`/ops/export?type=${type}&year=2026`);
			expect(res.status()).toBe(403);
		});
	}
});

test.describe('正規の ops ユーザは従来どおり通過する (塞ぎすぎ回帰、#4309)', () => {
	test.use({ storageState: 'playwright/.auth/ops.json' });

	test('認可を通過し handler の validation に到達する (403 ではなく 400)', async ({ request }) => {
		// 正常 type (sales 等) の 200 は Stripe / AWS Cost Explorer への実アクセスに依存し
		// E2E 環境では非決定的なため、**認可を通過したこと**を不正 type の 400 で判定する。
		// 403 が返れば運営者を締め出す回帰 (over-blocking) であり、ここで必ず落ちる。
		// CSV 中身の正常性は unit (service mock) が担保する。
		const res = await request.get(`/ops/export?type=${INVALID_TYPE}`);

		expect(res.status()).toBe(400);
	});
});

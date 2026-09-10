// tests/unit/routing/setup-gate.test.ts
//
// **セットアップ必須 redirect が、顧客が先にやる必要のあることを塞がない**
// (PO 決裁 2026-09-10c)。
//
// ## なぜ要るか
//
// 除外リストは `authMode === 'local'` 向けに育ったもので、**local には存在しない導線**が
// cognito にはある。gate を cognito へ広げるとき、そのままだと次が塞がる:
//
//   - お金 (請求 / 領収書 / 解約 / 決済の完了確認) — 契約直後の顧客を setup に閉じ込める
//   - ログアウト — **local には無い**。塞ぐと setup を終えるまでログアウトできない
//   - 同意 — 再同意が必要な顧客は、同意できないまま何もできなくなる
//   - 法務文書 — 規約・プライバシーはいつでも読めなければならない
//
// ## 固定する不変条件
//
//   [S1] setup へ連れて行くべき path は除外しない (gate が空振りしていない)
//   [S2] お金 / 認証 / 同意 / 法務の 4 系統は除外される
//   [S3] Stripe checkout の完了確認は **path を問わず**先に通る (金の確認が先)
//   [S4] 除外の理由が全件書いてある (次に導線が増えたとき同じ判断をやり直せる)
//   [S5] gate を回す先が local / 認証済み cognito だけ (demo と未認証には広げない)

import { describe, expect, it } from 'vitest';
import {
	isSetupRedirectExempt,
	resolveSetupGateTenantId,
	SETUP_REDIRECT_EXEMPT_PATHS,
} from '../../../src/lib/server/routing/setup-gate';

describe('[S1] setup へ連れて行くべき path は除外しない', () => {
	// ここが全部 true になったら gate は何もしていない。空振りの検出。
	const MUST_REDIRECT = [
		'/admin',
		'/admin/children',
		'/admin/activities',
		'/admin/settings',
		'/switch',
		'/',
		'/api/v1/activities',
	];

	for (const path of MUST_REDIRECT) {
		it(`${path} は除外しない`, () => {
			expect(
				isSetupRedirectExempt(path),
				`${path} を除外すると、子供が 1 人も居ない世帯がウィザードに入らない`,
			).toBe(false);
		});
	}
});

describe('[S2] 顧客が setup より先にやる必要があることは塞がない', () => {
	const MUST_PASS: [string, string][] = [
		// お金 — 契約直後に「請求はどうなっている」と見に来る人を閉じ込めない
		['/admin/subscription', '課金画面'],
		['/admin/subscription/cancel', '解約'],
		['/api/stripe/portal', 'ポータルを開く (解約・領収書の実行経路)'],
		['/api/stripe/checkout', '申込の実行経路'],
		// 認証 — local にはログアウトが無い。cognito で塞ぐと出られなくなる
		['/auth/logout', 'ログアウト'],
		['/auth/login', 'ログイン'],
		['/auth/signout', 'サインアウト'],
		['/api/v1/auth/logout', 'ログアウト API'],
		// 同意 — 塞ぐと同意できないまま何もできない
		['/consent', '再同意'],
		// 法務 — いつでも読めなければならない
		['/legal/terms', '利用規約'],
		['/legal/privacy', 'プライバシーポリシー'],
		['/legal/tokushoho', '特商法表記'],
	];

	for (const [path, why] of MUST_PASS) {
		it(`${path} (${why}) は通す`, () => {
			expect(isSetupRedirectExempt(path), `${why} を setup で塞いではいけない`).toBe(true);
		});
	}
});

describe('[S3] Stripe checkout の完了確認は path を問わず先に通る', () => {
	// success_url は returnPath 次第で任意の相対 path になる
	// (`api/stripe/checkout/+server.ts` の successBase)。path で列挙すると取りこぼす。
	it('既定の着地 (/admin/subscription?session_id=…)', () => {
		expect(isSetupRedirectExempt('/admin/subscription', '?session_id=cs_test_123')).toBe(true);
	});

	it('returnPath 指定の着地 (setup で塞がる path + session_id)', () => {
		expect(
			isSetupRedirectExempt('/admin', '?session_id=cs_test_123'),
			'金の確認が先、設定は後。着地先が塞がれると「課金されたのか分からないまま setup に入る」',
		).toBe(true);
	});

	it('session_id が無ければ通常どおり判定する', () => {
		expect(isSetupRedirectExempt('/admin', '?from=setup')).toBe(false);
	});
});

describe('[S4] 除外には全件 理由が書いてある', () => {
	it('reason が空の entry が無い', () => {
		expect(SETUP_REDIRECT_EXEMPT_PATHS.length).toBeGreaterThan(0);
		for (const entry of SETUP_REDIRECT_EXEMPT_PATHS) {
			expect(entry.reason.trim().length, `${entry.path} に理由が無い`).toBeGreaterThan(10);
		}
	});

	it('path が重複していない (同じものを 2 つの理由で持たない)', () => {
		const seen = new Set<string>();
		for (const entry of SETUP_REDIRECT_EXEMPT_PATHS) {
			expect(seen.has(entry.path), `${entry.path} が重複している`).toBe(false);
			seen.add(entry.path);
		}
	});
});

describe('[S5] gate を回す先', () => {
	it('cognito は認証済み (テナントが解決できている) なら回す', () => {
		expect(
			resolveSetupGateTenantId({ authMode: 'cognito', tenantId: 't-1' }),
			'PO 決裁 2026-09-10c の本体。お金を払った保護者がウィザードを一度も通らない状態を直す',
		).toBe('t-1');
	});

	it('cognito 未認証は回さない', () => {
		expect(
			resolveSetupGateTenantId({ authMode: 'cognito', tenantId: undefined }),
			'テナント解決前に倒すと、ログインしに来た人を /setup へ飛ばしてログインできなくする',
		).toBeUndefined();
	});

	it('local は context が無くても回す (単一世帯、旧実装の挙動)', () => {
		expect(resolveSetupGateTenantId({ authMode: 'local', tenantId: undefined })).toBe('local');
		expect(resolveSetupGateTenantId({ authMode: 'local', tenantId: 't-9' })).toBe('t-9');
	});

	it('demo (anonymous) には広げない', () => {
		expect(
			resolveSetupGateTenantId({ authMode: 'anonymous', tenantId: 'demo' }),
			'demo は書き込みが no-op でセットアップを完了できない。入れたら永久に出られない',
		).toBeUndefined();
	});
});

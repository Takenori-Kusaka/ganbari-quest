// tests/unit/routes/marketplace-auth-redirect.test.ts
// #2303: マーケプレ未ログイン CTA リダイレクト先が /auth/login であることを保証する
//
// 設計背景:
// - 旧実装は /auth/signup へ redirect していたが、既存ユーザが CTA を押すと
//   「新規アカウント作成」画面に飛ばされ、誤って二重登録するリスクがあった
//   (Cognito / Stripe / DB 二重作成 = data integrity 侵害)
// - PO 推奨ロジック: /auth/login へ redirect することで
//   - 既存ユーザ → 既存アカウントでログイン (data integrity 保護)
//   - 新規ユーザ → login 画面内「新規アカウント作成」リンクで signup へ到達可能
//
// 検証対象 (本 spec):
// - 1) `src/routes/marketplace/+page.svelte` 一覧画面の CTA `href` が `/auth/login`
// - 2) `src/routes/marketplace/[type]/[itemId]/+page.svelte` 詳細画面の各 CTA
//      (reward / checklist / rule-preset / challenge-set / fallback) `href` が `/auth/login`
// - 3) `src/routes/marketplace/[type]/[itemId]/+page.server.ts` action の
//      未ログイン redirect 先が `/auth/login`
//
// 並行実装ペア:
// - marketplace 配下に `/auth/signup` 直接 href が 0 件 (回帰防止)
//
// AC マッピング:
// - AC1 (一覧画面 href) → it('一覧画面 CTA は /auth/login')
// - AC2 (詳細画面 href × 5) → it('詳細画面 ... CTA は /auth/login') 5 件
// - AC3 (server-side action × 3) → it('server action の未ログイン redirect は /auth/login') 3 件

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

function readMarketplaceFile(relPath: string): string {
	return readFileSync(path.join(REPO_ROOT, relPath), 'utf-8');
}

describe('#2303 marketplace 未ログイン CTA は /auth/login redirect', () => {
	describe('AC1 一覧画面 (`src/routes/marketplace/+page.svelte`)', () => {
		const content = readMarketplaceFile('src/routes/marketplace/+page.svelte');

		it('一覧画面 CTA は /auth/login へ遷移する', () => {
			// `/auth/login` を href とする `<a>` が存在する
			expect(content).toMatch(/href=["']\/auth\/login["']/);
		});

		it('一覧画面に /auth/signup 直接遷移が残っていない (data integrity 保護)', () => {
			// /auth/signup を href に持つ `<a>` は無いこと (新規登録誘導の事故防止)
			expect(content).not.toMatch(/href=["']\/auth\/signup/);
		});
	});

	describe('AC2 詳細画面 (`src/routes/marketplace/[type]/[itemId]/+page.svelte`)', () => {
		const content = readMarketplaceFile('src/routes/marketplace/[type]/[itemId]/+page.svelte');

		it('詳細画面 reward-set 未ログイン CTA は /auth/login へ遷移する', () => {
			// reward-set CTA: `href="/auth/login?redirect=/marketplace/{item.type}/{item.itemId}"`
			expect(content).toMatch(
				/href=["']\/auth\/login\?redirect=\/marketplace\/\{item\.type\}\/\{item\.itemId\}["']/,
			);
		});

		it('詳細画面 checklist 未ログイン CTA は /auth/login へ遷移する', () => {
			// checklist CTA: `href="/auth/login?next=/marketplace/{item.type}/{item.itemId}"`
			expect(content).toMatch(
				/href=["']\/auth\/login\?next=\/marketplace\/\{item\.type\}\/\{item\.itemId\}["']/,
			);
		});

		it('詳細画面 rule-preset 未ログイン CTA は /auth/login へ遷移する', () => {
			// rule-preset CTA: `href="/auth/login?next=/marketplace/rule-preset/{item.itemId}"`
			expect(content).toMatch(
				/href=["']\/auth\/login\?next=\/marketplace\/rule-preset\/\{item\.itemId\}["']/,
			);
		});

		it('詳細画面 challenge-set 未ログイン CTA は /auth/login へ遷移する', () => {
			// challenge-set CTA: `href="/auth/login?next=/marketplace/challenge-set/{item.itemId}"`
			expect(content).toMatch(
				/href=["']\/auth\/login\?next=\/marketplace\/challenge-set\/\{item\.itemId\}["']/,
			);
		});

		it('詳細画面 fallback (activity-pack) 未ログイン CTA は /auth/login へ遷移する', () => {
			// fallback: `<a href="/auth/login" class="block">`
			expect(content).toMatch(/href=["']\/auth\/login["']\s+class=["']block["']/);
		});

		it('詳細画面に /auth/signup 直接遷移が残っていない (data integrity 保護)', () => {
			// /auth/signup を含む href が一切無いこと (5 種の CTA + fallback すべて login 経由)
			expect(content).not.toMatch(/href=["']\/auth\/signup/);
		});
	});

	describe('AC3 server action (`src/routes/marketplace/[type]/[itemId]/+page.server.ts`)', () => {
		const content = readMarketplaceFile('src/routes/marketplace/[type]/[itemId]/+page.server.ts');

		it('importRewardSet action の未ログイン redirect は /auth/login', () => {
			// `redirect(303, \`/auth/login?redirect=/marketplace/${type}/${itemId}\`)`
			expect(content).toMatch(
				/redirect\(\d+,\s*`\/auth\/login\?redirect=\/marketplace\/\$\{type\}\/\$\{itemId\}`\)/,
			);
		});

		it('importChecklist action の未ログイン redirect は /auth/login', () => {
			// `redirect(302, \`/auth/login?next=/marketplace/checklist/${params.itemId}\`)`
			expect(content).toMatch(
				/redirect\(\d+,\s*`\/auth\/login\?next=\/marketplace\/checklist\/\$\{params\.itemId\}`\)/,
			);
		});

		it('importRulePreset action の未ログイン redirect は /auth/login', () => {
			// `redirect(302, \`/auth/login?next=/marketplace/rule-preset/${params.itemId}\`)`
			expect(content).toMatch(
				/redirect\(\d+,\s*`\/auth\/login\?next=\/marketplace\/rule-preset\/\$\{params\.itemId\}`\)/,
			);
		});

		it('server action に /auth/signup redirect が残っていない (data integrity 保護)', () => {
			// `redirect(..., '/auth/signup...')` の形が一切無いこと
			expect(content).not.toMatch(/redirect\([^)]*\/auth\/signup/);
		});
	});
});

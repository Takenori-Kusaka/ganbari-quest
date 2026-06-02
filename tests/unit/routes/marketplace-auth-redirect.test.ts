// tests/unit/routes/marketplace-auth-redirect.test.ts
// #2303: マーケプレ未ログイン CTA リダイレクト先が /auth/login であることを保証する
// #2774: 5 type 取込 CTA 統一 — `<a>` 形式 + `?import=` query 一本化を保証
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
//      未ログイン redirect 先が `/auth/login` (rule-preset exchange のみ残存)
// - 4) #2774: 認証済 CTA が `<a href="/admin/<page>?import=${itemId}">` 形式に統一
//      (reward-set / checklist / rule-preset bonus / challenge-set / activity-pack 5 type)
//
// 並行実装ペア:
// - marketplace 配下に `/auth/signup` 直接 href が 0 件 (回帰防止)
// - marketplace 配下に `?marketplace-import=` query が 0 件 (#2774、5 type 統一)
//
// AC マッピング:
// - AC1 (一覧画面 href) → it('一覧画面 CTA は /auth/login')
// - AC2 (詳細画面 href × 5) → it('詳細画面 ... CTA は /auth/login') 5 件
// - AC3 (server-side action × 1) → it('server action の未ログイン redirect は /auth/login') 1 件 (rule-preset のみ)
// - AC4 (#2774): 認証済 CTA が `<a href>` + testid `<typeCode>-import-cta` 統一

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

		it('詳細画面 activity-pack 未ログイン CTA は /auth/login へ遷移する (#2362 PR-3 Phase 5)', () => {
			// #2362 PR-3 Phase 5: activity-pack 未ログイン CTA は admin auto-open を next に持つ
			// `href="/auth/login?next=/admin/activities?import={item.itemId}"`
			// (CWE-598 / docs/design/marketplace-import-flow.md §3.1 整合: childId を URL に含めない)
			expect(content).toMatch(
				/href=["']\/auth\/login\?next=\/admin\/activities\?import=\{item\.itemId\}["']/,
			);
		});

		it('詳細画面 activity-pack ログイン済 CTA は /admin/activities?import= へ遷移する (#2362 PR-3 Phase 5)', () => {
			// #2362 PR-3 Phase 5: activity-pack ログイン済 + 子供登録済の CTA は admin/activities へ
			// (ChildSelectionDialog auto-open mechanism Phase 4 と接続)
			// Round 18 Cluster H (#2767): href が template literal の動的式に変更されたため、
			// 静的 href={...} だけでなく `/admin/activities?import=${item.itemId}` 形式も許容。
			expect(content).toMatch(
				/href=["']\/admin\/activities\?import=\{item\.itemId\}["']|\/admin\/activities\?import=\$\{item\.itemId\}/,
			);
		});

		it('詳細画面に /auth/signup 直接遷移が残っていない (data integrity 保護)', () => {
			// /auth/signup を含む href が一切無いこと (5 種の CTA + fallback すべて login 経由)
			expect(content).not.toMatch(/href=["']\/auth\/signup/);
		});

		it('詳細画面 activity-pack 関連 href に childId が含まれない (CWE-598、#2362 PR-3 Phase 5)', () => {
			// activity-pack 関連 CTA (data-testid="activity-pack-*") の周辺 href に
			// `childId=` が出現しないこと。marketplace-import-flow.md §4 privacy 検証必須項目。
			// activity-pack-* CTA とその href= は同一行 / 隣接行に書かれる
			const activityPackCtaMatches = content.match(
				/activity-pack-(import-cta|signup-redirect)[\s\S]{0,200}/g,
			);
			for (const match of activityPackCtaMatches ?? []) {
				expect(match).not.toMatch(/childId/);
			}
		});
	});

	describe('AC3 server action (`src/routes/marketplace/[type]/[itemId]/+page.server.ts`)', () => {
		const content = readMarketplaceFile('src/routes/marketplace/[type]/[itemId]/+page.server.ts');

		it('importRulePreset action の未ログイン redirect は /auth/login', () => {
			// `redirect(302, \`/auth/login?next=/marketplace/rule-preset/${params.itemId}\`)`
			// #2774: rule-preset exchange のみ残存。reward-set / checklist / challenge-set は
			// `<a href="/admin/<page>?import=">` 直遷移に統一されたため server action は撤去済。
			expect(content).toMatch(
				/redirect\(\d+,\s*`\/auth\/login\?next=\/marketplace\/rule-preset\/\$\{params\.itemId\}`\)/,
			);
		});

		it('server action に /auth/signup redirect が残っていない (data integrity 保護)', () => {
			// `redirect(..., '/auth/signup...')` の形が一切無いこと
			expect(content).not.toMatch(/redirect\([^)]*\/auth\/signup/);
		});

		it('#2774: 撤去済 server action (importRewardSet / importChecklist / importChallengeSet) が再生していない', () => {
			// 5 type 取込 CTA 統一 (User 指摘 #2 #4 根治) で 3 action を撤去した。
			// 再追加で `<form action="?/import...">` 経路が再生するのを回帰防止。
			expect(content).not.toMatch(/importRewardSet:\s*async/);
			expect(content).not.toMatch(/importChecklist:\s*async/);
			expect(content).not.toMatch(/importChallengeSet:\s*async/);
		});
	});

	describe('AC4 (#2774): 5 type 取込 CTA 統一 — `<a href>` + testid `<typeCode>-import-cta`', () => {
		const content = readMarketplaceFile('src/routes/marketplace/[type]/[itemId]/+page.svelte');

		it('reward-set 認証済 CTA は `<a href="/admin/rewards?import=...">` + testid=reward-set-import-cta', () => {
			expect(content).toMatch(/href=["']\/admin\/rewards\?import=\{item\.itemId\}["']/);
			expect(content).toMatch(/data-testid=["']reward-set-import-cta["']/);
		});

		it('checklist 認証済 CTA は `<a href="/admin/checklists?import=...">` + testid=checklist-import-cta', () => {
			expect(content).toMatch(/href=["']\/admin\/checklists\?import=\{item\.itemId\}["']/);
			expect(content).toMatch(/data-testid=["']checklist-import-cta["']/);
		});

		it('rule-preset bonus CTA は testid=rule-preset-import-bonus-cta', () => {
			// bonus は admin/settings/rules?import= 経由で既存。testid 命名統一のみ。
			expect(content).toMatch(/data-testid=["']rule-preset-import-bonus-cta["']/);
		});

		it('challenge-set CTA は `<a href="/admin/challenges?import=...">` (旧 ?marketplace-import= 廃止)', () => {
			expect(content).toMatch(/href=["']\/admin\/challenges\?import=\{item\.itemId\}["']/);
			expect(content).toMatch(/data-testid=["']challenge-set-import-cta["']/);
		});

		it('activity-pack CTA は `<a href="/admin/activities?import=...">` + testid=activity-pack-import-cta (#2362 PR-3 既存)', () => {
			// 5 type 統一の基準形 (本 PR では変更なし、回帰防止のため assertion を残す)
			expect(content).toMatch(
				/href=["']\/admin\/activities\?import=\{item\.itemId\}["']|\/admin\/activities\?import=\$\{item\.itemId\}/,
			);
			expect(content).toMatch(/data-testid=["']activity-pack-import-cta["']/);
		});

		it('marketplace 詳細画面に `?marketplace-import=` query が残っていない (5 type 統一)', () => {
			// 旧 challenge-set 専用 query 名は廃止 (#2774)。reward / checklist / activity-pack /
			// rule-preset bonus / challenge-set 全て `?import=` 一本化。
			expect(content).not.toMatch(/\?marketplace-import=/);
		});

		it('marketplace 詳細画面に form action="?/import..." が残っていない (rule-preset exchange を除く)', () => {
			// `<form method="POST" action="?/importRewardSet">` 等が撤去済 (5 type のうち
			// reward-set / checklist / challenge-set 3 件)。残存可能性は rule-preset exchange のみ
			// (Phase 2 で撤去予定、本 PR scope 外)。
			expect(content).not.toMatch(/action=["']\?\/importRewardSet["']/);
			expect(content).not.toMatch(/action=["']\?\/importChecklist["']/);
			expect(content).not.toMatch(/action=["']\?\/importChallengeSet["']/);
		});
	});
});

// tests/unit/architecture/setup-route-role-guard-fitness.test.ts
// #4700: 初期セットアップ (`src/routes/setup/**`) の全 step が「child ロールは入れない /
// 未認証は /auth/login」で守られていることを **FS 列挙**で固定する fitness function。
//
// 背景: `/setup` が `isPublicRoute` に含まれロール検査が無かったため、招待 child が 9 step 全てに
// 入り子供追加 / 一括取込 / 初期設定の書き換えができた。`ROUTE_RULES` の `/setup` 前方一致が
// 担うが、「新 step を足したら守られているか」を列挙で毎回確認する (除外リストを持たない
// no-silent-gap 設計。cron-route-auth-fitness / ops-route-auth-fitness と同型)。
//
// 走査は `src/routes/setup` の単一 dir (depth 1) に閉じるが、静的判定は `src/routes` 配下の
// 走査として保守的に 'repo' と見なすため、判定に合わせて明示 timeout を置く (repo-scan-test-registry)。

import { readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { asChildId } from '../../../src/lib/domain/ids';
import { authorizeCognito } from '../../../src/lib/server/auth/authorization';
import type { AuthContext, Identity } from '../../../src/lib/server/auth/types';

vi.setConfig({ testTimeout: 30_000 });

const REPO_ROOT = path.resolve(__dirname, '../../..');
const SETUP_DIR = path.join(REPO_ROOT, 'src/routes/setup');

/** `src/routes/setup` 直下の route dir を列挙 (SvelteKit の route group / param は setup 配下に無い前提) */
function listSetupRoutes(): string[] {
	const dirs = readdirSync(SETUP_DIR, { withFileTypes: true })
		.filter((e) => e.isDirectory() && !e.name.startsWith('_') && !e.name.startsWith('('))
		.map((e) => `/setup/${e.name}`);
	return ['/setup', ...dirs];
}

const identity: Identity = { type: 'cognito', userId: 'u-1', email: 'u@example.com' };
const ctx = (overrides: Partial<AuthContext>): AuthContext => ({
	tenantId: 't-1',
	role: 'owner',
	licenseStatus: 'active',
	...overrides,
});

describe('#4700 /setup 全 step のロールガード (FS 列挙)', () => {
	const routes = listSetupRoutes();

	it('列挙結果が空でない (検査しなかったことを silent に通さない)', () => {
		expect(routes.length).toBeGreaterThan(5);
	});

	for (const route of routes) {
		it(`${route}: child は拒否 (403 → /switch?reason=admin_forbidden)`, () => {
			const r = authorizeCognito(route, identity, ctx({ role: 'child', childId: asChildId(1) }));
			expect(r.allowed).toBe(false);
			if (!r.allowed) {
				expect(r.status).toBe(403);
				expect(r.redirect).toBe('/switch?reason=admin_forbidden');
			}
		});
		it(`${route}: 未認証は 401 → /auth/login`, () => {
			const r = authorizeCognito(route, null, null);
			expect(r.allowed).toBe(false);
			if (!r.allowed) expect(r.redirect).toBe('/auth/login');
		});
		it(`${route}: owner / parent は通る`, () => {
			expect(authorizeCognito(route, identity, ctx({ role: 'owner' })).allowed).toBe(true);
			expect(authorizeCognito(route, identity, ctx({ role: 'parent' })).allowed).toBe(true);
		});
	}
});

// tests/unit/features/admin-resource-model-registry.test.ts
// #3134: admin リソース正準契約の no-silent-gap guard。
// DESIGN.md §10 の全 admin リソース管理画面が、正準 registry か明示除外リストの
// いずれかで必ず説明されること (= 契約が自身の網羅漏れを silent に見逃さない) を保証する。

import { existsSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
	ADMIN_RESOURCE_MODEL_REGISTRY,
	ADMIN_RESOURCE_PAGE_ROUTE_TO_KEY,
	ALL_ADMIN_RESOURCE_PAGES,
	classifyAdminPageRoute,
	NON_CANONICAL_ADMIN_RESOURCES,
	NON_RESOURCE_ADMIN_PAGE_ROUTES,
} from '../../../src/lib/features/admin/admin-resource-model-registry';

// #3164: admin route の実 FS から「admin 直下で +page.* を持つ route dir」を導出する。
// 母数を手管理 literal でなく実 route に固定することで、新規 admin 画面の登録漏れを silent pass させない。
const ADMIN_ROUTES_DIR = resolve(
	dirname(fileURLToPath(import.meta.url)),
	'../../../src/routes/(parent)/admin',
);

function discoverAdminPageRoutes(): string[] {
	if (!existsSync(ADMIN_ROUTES_DIR)) {
		throw new Error(`admin routes dir not found: ${ADMIN_ROUTES_DIR}`);
	}
	return readdirSync(ADMIN_ROUTES_DIR, { withFileTypes: true })
		.filter((e) => e.isDirectory())
		.filter((e) =>
			['+page.svelte', '+page.server.ts', '+page.ts'].some((f) =>
				existsSync(resolve(ADMIN_ROUTES_DIR, e.name, f)),
			),
		)
		.map((e) => e.name)
		.sort();
}

describe('#3134 admin リソース正準契約の網羅性 (no silent gap)', () => {
	const registryKeys = Object.keys(ADMIN_RESOURCE_MODEL_REGISTRY);
	const nonCanonicalKeys = Object.keys(NON_CANONICAL_ADMIN_RESOURCES);

	it('§10 の全 admin リソース画面が registry か明示除外のいずれかで説明される', () => {
		const accounted = new Set([...registryKeys, ...nonCanonicalKeys]);
		for (const page of ALL_ADMIN_RESOURCE_PAGES) {
			expect(
				accounted.has(page),
				`admin リソース画面 "${page}" が registry にも NON_CANONICAL_ADMIN_RESOURCES にも無い ` +
					'(暗黙の網羅漏れ = fitness function blind spot)。registry 登録か除外理由の記載が必要',
			).toBe(true);
		}
	});

	it('registry と明示除外は二重定義しない (同一 key が両方に無い)', () => {
		for (const key of registryKeys) {
			expect(nonCanonicalKeys, `${key} が registry と除外リストの両方に存在する`).not.toContain(
				key,
			);
		}
	});

	it('明示除外の各エントリは route と reason を持つ (silent 除外を作らない)', () => {
		for (const [key, entry] of Object.entries(NON_CANONICAL_ADMIN_RESOURCES)) {
			expect(entry.route, `${key} の除外理由に route が無い`).toBeTruthy();
			expect(entry.reason.length, `${key} の除外理由 (reason) が空`).toBeGreaterThan(0);
		}
	});

	it('registry / 除外を合わせると §10 既知集合と過不足なく一致する', () => {
		const accounted = [...registryKeys, ...nonCanonicalKeys].sort();
		const known = [...ALL_ADMIN_RESOURCE_PAGES].sort();
		expect(accounted).toEqual(known);
	});
});

describe('#3164 母数を実 route FS から導出する (literal 未更新の silent pass を封殺)', () => {
	const discovered = discoverAdminPageRoutes();

	it('admin 直下の page route が実在し空でない (FS 走査が機能している sanity)', () => {
		expect(discovered.length).toBeGreaterThan(0);
		// 既知の代表 route が含まれること (走査ロジックが壊れていない確認)
		expect(discovered).toContain('activities');
		expect(discovered).toContain('settings');
	});

	it('実在する全 admin page route が resource / non-resource のいずれかで説明される (unclassified 0)', () => {
		const unclassified = discovered.filter((r) => classifyAdminPageRoute(r) === 'unclassified');
		expect(
			unclassified,
			`admin 直下の page route ${JSON.stringify(unclassified)} が ADMIN_RESOURCE_PAGE_ROUTE_TO_KEY ` +
				'にも NON_RESOURCE_ADMIN_PAGE_ROUTES にも無い (新規画面の登録漏れ = fitness function blind spot)。' +
				'resource-list 管理画面なら ADMIN_RESOURCE_PAGE_ROUTE_TO_KEY + registry/除外へ、そうでなければ ' +
				'NON_RESOURCE_ADMIN_PAGE_ROUTES へ reason 付きで登録する',
		).toEqual([]);
	});

	it('分類定数が実 FS と過不足なく一致する (stale エントリ / 走査漏れの双方向検出)', () => {
		const classified = [
			...Object.keys(ADMIN_RESOURCE_PAGE_ROUTE_TO_KEY),
			...Object.keys(NON_RESOURCE_ADMIN_PAGE_ROUTES),
		].sort();
		expect(classified).toEqual(discovered);
	});

	it('resource page route の map 先 key が registry か明示除外に存在する (#3134 整合)', () => {
		const accounted = new Set([
			...Object.keys(ADMIN_RESOURCE_MODEL_REGISTRY),
			...Object.keys(NON_CANONICAL_ADMIN_RESOURCES),
		]);
		for (const [route, key] of Object.entries(ADMIN_RESOURCE_PAGE_ROUTE_TO_KEY)) {
			expect(
				accounted.has(key),
				`resource route "${route}" の map 先 key "${key}" が registry にも除外にも無い`,
			).toBe(true);
		}
	});

	it('未知の admin route は unclassified に分類される (新規登録漏れを guard が fail させる固定)', () => {
		// 実在しない仮の新規画面名 → どの分類定数にも無いので unclassified。
		// これにより「新規 admin 画面を登録せず追加 → FS 走査 test が fail」を unit で固定する (AC2)。
		expect(classifyAdminPageRoute('badges-not-registered-yet')).toBe('unclassified');
		expect(classifyAdminPageRoute('activities')).toBe('resource');
		expect(classifyAdminPageRoute('settings')).toBe('non-resource');
	});
});

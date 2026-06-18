// tests/unit/features/admin-resource-model-registry.test.ts
// #3134: admin リソース正準契約の no-silent-gap guard。
// DESIGN.md §10 の全 admin リソース管理画面が、正準 registry か明示除外リストの
// いずれかで必ず説明されること (= 契約が自身の網羅漏れを silent に見逃さない) を保証する。

import { describe, expect, it } from 'vitest';
import {
	ADMIN_RESOURCE_MODEL_REGISTRY,
	ALL_ADMIN_RESOURCE_PAGES,
	NON_CANONICAL_ADMIN_RESOURCES,
} from '../../../src/lib/features/admin/admin-resource-model-registry';

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

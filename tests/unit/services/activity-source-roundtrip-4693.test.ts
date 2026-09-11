// tests/unit/services/activity-source-roundtrip-4693.test.ts (#4693 QM)
//
// backup → restore で `source` が落ちると、保護者が自分で作った活動 (`custom`) が
// repo 既定の `seed` に化けて quota の集計から消える。
// 「オリジナル活動の作成：3個まで」という無料プランの約束が、復元 1 回で無効になる。

import { describe, expect, it } from 'vitest';
import {
	ACTIVITY_SOURCES,
	countsTowardActivityQuota,
	PARENT_CREATED_SOURCE,
	sanitizeActivitySource,
} from '../../../src/lib/domain/activity-source';

describe('#4693 activity source の import 境界正規化', () => {
	it('値域内の値はそのまま通す', () => {
		for (const code of Object.keys(ACTIVITY_SOURCES)) {
			expect(sanitizeActivitySource(code)).toBe(code);
		}
	});

	it('未知値 / 型違い / 欠落は seed (quota 非対象) に倒す — default-deny', () => {
		for (const bad of [undefined, null, '', 'CUSTOM', 'admin', 42, {}, [], true]) {
			const got = sanitizeActivitySource(bad);
			expect(got, `${JSON.stringify(bad)} が既定に落ちていない`).toBe(ACTIVITY_SOURCES.seed.value);
			expect(
				countsTowardActivityQuota(got),
				'改竄 backup で quota 集計を歪められてはいけない',
			).toBe(false);
		}
	});

	it('custom は quota 対象、seed / curriculum は非対象 (集計の前提)', () => {
		expect(countsTowardActivityQuota(PARENT_CREATED_SOURCE)).toBe(true);
		expect(countsTowardActivityQuota(ACTIVITY_SOURCES.seed.value)).toBe(false);
		expect(countsTowardActivityQuota(ACTIVITY_SOURCES.curriculum.value)).toBe(false);
	});

	it('custom を round-trip しても custom のまま (復元で quota から消えない)', () => {
		// export → (JSON 直列化) → import の往復を最小再現する
		const exported = JSON.parse(JSON.stringify({ source: PARENT_CREATED_SOURCE }));
		expect(sanitizeActivitySource(exported.source)).toBe(PARENT_CREATED_SOURCE);
		expect(countsTowardActivityQuota(sanitizeActivitySource(exported.source))).toBe(true);
	});
});

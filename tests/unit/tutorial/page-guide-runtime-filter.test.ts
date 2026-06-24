// tests/unit/tutorial/page-guide-runtime-filter.test.ts
// #3291: filterGuideStepsByRuntime の回帰ガード。
//
// /admin/subscription は nuc-prod で NucLicensePanel (現在のプラン / プラン管理セクション無し)
// を描画するため、SaaS 専用ガイド手順 (requiredRuntime='saas') の selector が解決できず空
// spotlight + 実装にない操作案内 (ADR-0013 違反) になる。本テストは NUC で SaaS 専用手順が
// 除外され、SaaS では全手順が残ることを機械検証する (人の注意依存にしない、ADR-0061)。

import { describe, expect, it } from 'vitest';
import { filterGuideStepsByRuntime } from '../../../src/lib/ui/tutorial/page-guide-registry';
import type { PageGuide } from '../../../src/lib/ui/tutorial/page-guide-types';
import { SUBSCRIPTION_GUIDE } from '../../../src/routes/(parent)/admin/subscription/_guide';

const fixture: PageGuide = {
	pageId: 'test-page',
	title: 'テスト',
	icon: '🧪',
	steps: [
		{ id: 'intro', title: '概要', what: 'a', how: 'b', goal: 'c' },
		{ id: 'saas-only', title: 'SaaS', what: 'a', how: 'b', goal: 'c', requiredRuntime: 'saas' },
	],
};

describe('#3291 filterGuideStepsByRuntime', () => {
	it('nuc-prod では requiredRuntime=saas の手順を除外する', () => {
		const filtered = filterGuideStepsByRuntime(fixture, 'nuc-prod');
		expect(filtered).not.toBeNull();
		expect(filtered?.steps.map((s) => s.id)).toEqual(['intro']);
	});

	it('SaaS 系モード (aws-prod / local-debug / demo / undefined) では全手順を残す', () => {
		for (const mode of ['aws-prod', 'local-debug', 'demo', 'build', undefined]) {
			const filtered = filterGuideStepsByRuntime(fixture, mode);
			expect(
				filtered?.steps.map((s) => s.id),
				`mode=${mode}`,
			).toEqual(['intro', 'saas-only']);
		}
	});

	it('nuc-prod で SaaS 専用手順のみのガイドは null を返す (❓ 抑止)', () => {
		const saasOnly: PageGuide = {
			...fixture,
			steps: [fixture.steps[1] as PageGuide['steps'][number]],
		};
		expect(filterGuideStepsByRuntime(saasOnly, 'nuc-prod')).toBeNull();
	});

	it('SUBSCRIPTION_GUIDE: nuc-prod では intro のみ残り、SaaS では全 3 手順', () => {
		// NUC では NucLicensePanel に存在しない現在のプラン / プラン管理 step を除外し、
		// 画面中央 intro (selector 無し) だけが残る = 空 spotlight を作らない。
		const nuc = filterGuideStepsByRuntime(SUBSCRIPTION_GUIDE, 'nuc-prod');
		expect(nuc?.steps.map((s) => s.id)).toEqual(['subscription-intro']);

		const saas = filterGuideStepsByRuntime(SUBSCRIPTION_GUIDE, 'aws-prod');
		expect(saas?.steps.map((s) => s.id)).toEqual([
			'subscription-intro',
			'subscription-current-plan',
			'subscription-plan-management',
		]);

		// SaaS 専用 step には selector が必ず付く (NUC で除外される対象 = NucLicensePanel に無い UI)
		for (const step of SUBSCRIPTION_GUIDE.steps) {
			if (step.requiredRuntime === 'saas') {
				expect(
					step.selector,
					`${step.id} は SaaS UI を spotlight するため selector 必須`,
				).toBeTruthy();
			}
		}
	});
});

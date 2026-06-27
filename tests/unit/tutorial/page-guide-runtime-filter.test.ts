// tests/unit/tutorial/page-guide-runtime-filter.test.ts
// #3291 / #3296: filterGuideStepsByRuntime / filterGuideStepsByStripe の回帰ガード。
//
// /admin/subscription は実行モード (NUC / SaaS) と Stripe 有効性で描画 UI が変わるため、
// ガイド手順を環境に合わせて出し分けないと selector 未解決の空 spotlight + 実装にない操作案内
// (ADR-0013 違反) になる。本テストは以下を機械検証する (人の注意依存にしない、ADR-0061):
//   - requiredRuntime='saas' → SaaS のみ表示 / 'nuc' → NUC のみ表示 (#3296 NUC 専用 step)
//   - runtimeMode 未確定 (undefined) は fail-closed で saas/nuc 限定手順を除外 (#3296 Part 3)
//   - requiredStripe='enabled' → Stripe 有効時のみ表示、無効/未確定は fail-closed で除外 (#3296 Part 1)

import { describe, expect, it } from 'vitest';
import {
	filterGuideStepsByRuntime,
	filterGuideStepsByStripe,
} from '../../../src/lib/ui/tutorial/page-guide-registry';
import type { PageGuide } from '../../../src/lib/ui/tutorial/page-guide-types';
import { SUBSCRIPTION_GUIDE } from '../../../src/routes/(parent)/admin/subscription/_guide';

const fixture: PageGuide = {
	pageId: 'test-page',
	title: 'テスト',
	icon: '🧪',
	steps: [
		{ id: 'intro', title: '概要', what: 'a', how: 'b', goal: 'c' },
		{ id: 'saas-only', title: 'SaaS', what: 'a', how: 'b', goal: 'c', requiredRuntime: 'saas' },
		{ id: 'nuc-only', title: 'NUC', what: 'a', how: 'b', goal: 'c', requiredRuntime: 'nuc' },
	],
};

describe('#3291/#3296 filterGuideStepsByRuntime', () => {
	it('nuc-prod では requiredRuntime=saas を除外し、=nuc を残す', () => {
		const filtered = filterGuideStepsByRuntime(fixture, 'nuc-prod');
		expect(filtered?.steps.map((s) => s.id)).toEqual(['intro', 'nuc-only']);
	});

	it('SaaS 系モード (aws-prod / local-debug / demo / build) では =saas を残し、=nuc を除外', () => {
		for (const mode of ['aws-prod', 'local-debug', 'demo', 'build']) {
			const filtered = filterGuideStepsByRuntime(fixture, mode);
			expect(
				filtered?.steps.map((s) => s.id),
				`mode=${mode}`,
			).toEqual(['intro', 'saas-only']);
		}
	});

	it('runtimeMode 未確定 (undefined / 未知値) は fail-closed で saas/nuc 限定手順を除外する (#3296 Part 3)', () => {
		// 配布 regression (locals.runtimeMode 欠落) 時に NUC へ SaaS 専用手順が露出するのを断つ。
		for (const mode of [undefined, 'unknown-mode']) {
			const filtered = filterGuideStepsByRuntime(fixture, mode);
			expect(
				filtered?.steps.map((s) => s.id),
				`mode=${mode}`,
			).toEqual(['intro']);
		}
	});

	it('nuc-prod で SaaS 専用手順のみのガイドは null を返す (❓ 抑止)', () => {
		const saasOnly: PageGuide = {
			...fixture,
			steps: [fixture.steps[1] as PageGuide['steps'][number]],
		};
		expect(filterGuideStepsByRuntime(saasOnly, 'nuc-prod')).toBeNull();
	});

	it('SUBSCRIPTION_GUIDE: nuc-prod では intro + NUC 専用 2 手順、SaaS では intro + SaaS 2 手順', () => {
		// NUC: NucLicensePanel の Edition badge / 利用状況を spotlight する NUC 専用 step を表示し、
		// SaaS 専用 (現在のプラン / プラン管理) は除外 → 空 spotlight を作らない。
		const nuc = filterGuideStepsByRuntime(SUBSCRIPTION_GUIDE, 'nuc-prod');
		expect(nuc?.steps.map((s) => s.id)).toEqual([
			'subscription-intro',
			'subscription-nuc-edition',
			'subscription-nuc-usage',
		]);

		const saas = filterGuideStepsByRuntime(SUBSCRIPTION_GUIDE, 'aws-prod');
		expect(saas?.steps.map((s) => s.id)).toEqual([
			'subscription-intro',
			'subscription-current-plan',
			'subscription-plan-management',
		]);

		// undefined は fail-closed で intro のみ (#3296 Part 3)
		const unknown = filterGuideStepsByRuntime(SUBSCRIPTION_GUIDE, undefined);
		expect(unknown?.steps.map((s) => s.id)).toEqual(['subscription-intro']);

		// 環境限定 step には selector が必ず付く (除外対象 = 当該 Panel にしか無い UI)
		for (const step of SUBSCRIPTION_GUIDE.steps) {
			if (step.requiredRuntime) {
				expect(
					step.selector,
					`${step.id} は環境固有 UI を spotlight するため selector 必須`,
				).toBeTruthy();
			}
		}
	});
});

describe('#3296 filterGuideStepsByStripe', () => {
	const stripeFixture: PageGuide = {
		pageId: 'test-page',
		title: 'テスト',
		icon: '🧪',
		steps: [
			{ id: 'intro', title: '概要', what: 'a', how: 'b', goal: 'c' },
			{
				id: 'stripe-only',
				title: 'Stripe',
				what: 'a',
				how: 'b',
				goal: 'c',
				requiredStripe: 'enabled',
			},
		],
	};

	it('stripeEnabled=true では requiredStripe=enabled を残す', () => {
		const filtered = filterGuideStepsByStripe(stripeFixture, true);
		expect(filtered?.steps.map((s) => s.id)).toEqual(['intro', 'stripe-only']);
	});

	it('stripeEnabled=false / undefined は fail-closed で requiredStripe=enabled を除外する', () => {
		for (const enabled of [false, undefined]) {
			const filtered = filterGuideStepsByStripe(stripeFixture, enabled);
			expect(
				filtered?.steps.map((s) => s.id),
				`stripeEnabled=${enabled}`,
			).toEqual(['intro']);
		}
	});

	it('全手順が requiredStripe=enabled で Stripe 無効なら null を返す (❓ 抑止)', () => {
		const stripeOnly: PageGuide = {
			...stripeFixture,
			steps: [stripeFixture.steps[1] as PageGuide['steps'][number]],
		};
		expect(filterGuideStepsByStripe(stripeOnly, false)).toBeNull();
	});

	it('SUBSCRIPTION_GUIDE: runtime=saas → stripe=false で plan-management が落ちる (空 spotlight 回避)', () => {
		// AdminLayout の適用順 (runtime → stripe) を再現: SaaS かつ Stripe 無効な local-debug/demo では
		// プラン管理 step が除外され、現在のプラン step (Stripe 非依存) は残る。
		const runtime = filterGuideStepsByRuntime(SUBSCRIPTION_GUIDE, 'local-debug');
		expect(runtime).not.toBeNull();
		const stripeOff = filterGuideStepsByStripe(runtime as PageGuide, false);
		expect(stripeOff?.steps.map((s) => s.id)).toEqual([
			'subscription-intro',
			'subscription-current-plan',
		]);

		// Stripe 有効なら 3 手順すべて残る
		const stripeOn = filterGuideStepsByStripe(runtime as PageGuide, true);
		expect(stripeOn?.steps.map((s) => s.id)).toEqual([
			'subscription-intro',
			'subscription-current-plan',
			'subscription-plan-management',
		]);
	});
});

// tests/unit/services/trial-tier-premium-4501.test.ts (#4501)
//
// トライアルが **premium (内部コード 'family') tier で始まる**ことを固定する。
//
// # 何を守るか
// LP は「7 日間すべての有料機能をお試し」と訴求し、pricing は AI 自動提案 /
// きょうだいランキングを明示列挙している。旧実装は `tier: 'standard'` ハードコードで、
// これらの premium 限定機能は**トライアル中も使えなかった**。トライアルは 1 tenant
// 1 回限り (FR-8) なので、体験機会は恒久的に失われる (#4501 GAMMA-LP-03 / FAQ-06)。
//
// 設計 SSOT: docs/design/billing-redesign/phase1-trial-requirements.md
//   FR-2 対象 tier は family 固定 / FR-6 トライアル中は対象 tier の全 capability 解放

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('$lib/server/debug-plan', () => ({
	getDebugPlanTier: () => null,
	getDebugTrialOverride: () => null,
}));

vi.mock('$lib/server/auth/factory', () => ({
	getAuthMode: () => 'cognito',
}));

const setSettingCalls: Array<[string, string]> = [];

vi.mock('$lib/server/db/factory', () => ({
	getRepos: () => ({
		settings: {
			getSetting: vi.fn().mockResolvedValue(null),
			setSetting: vi.fn(async (key: string, value: string) => {
				setSettingCalls.push([key, value]);
			}),
		},
	}),
}));

vi.mock('$lib/server/request-context', () => ({
	getRequestContext: () => null,
	invalidateRequestCaches: vi.fn(),
}));

import { getPlanLimits, resolvePlanTier } from '$lib/server/services/plan-limit-service';
import { TRIAL_TIER } from '$lib/server/services/trial-service';

beforeEach(() => {
	setSettingCalls.length = 0;
});

describe('#4501 トライアル tier は premium 固定 (FR-2)', () => {
	it('TRIAL_TIER が family (= premium の内部コード) である', () => {
		expect(TRIAL_TIER).toBe('family');
	});

	it('トライアル中の tier 解決が premium になる', () => {
		const future = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
		expect(resolvePlanTier('none', undefined, future, TRIAL_TIER)).toBe('family');
	});

	// FR-6: トライアル中は対象 tier の全 capability が開く。LP (pricing) が明示列挙している
	// 3 機能を名指しで pin する。きょうだいランキング / ひとことメッセージは PlanLimits の
	// flag、AI 提案は UI 側が `planTier === 'family'` で見る (plan-limit の flag ではない)。
	it('premium トライアル中はきょうだいランキング / ひとことメッセージが使える', () => {
		const limits = getPlanLimits('family');

		expect(limits.canSiblingRanking, 'きょうだいランキング').toBe(true);
		expect(limits.canFreeTextMessage, 'ひとことメッセージ').toBe(true);
	});

	it('AI 提案の gate 値 (planTier === family) をトライアルが満たす', () => {
		const future = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
		// admin/activities・checklists の AI 提案パネルは planTier を 'family' と比較する。
		// トライアルの解決結果がその値と一致していなければ「全機能お試し」は成立しない。
		expect(resolvePlanTier('none', undefined, future, TRIAL_TIER)).toBe('family');
	});

	it('standard tier では上記機能が閉じている (トライアルが standard だと体験できない)', () => {
		const limits = getPlanLimits('standard');

		expect(limits.canSiblingRanking).toBe(false);
		expect(limits.canFreeTextMessage).toBe(false);
	});

	it('呼び出し側が tier を選べない形になっている (source を読んで固定値であることを確認)', async () => {
		const { readFileSync } = await import('node:fs');
		const { resolve } = await import('node:path');
		const repoRoot = resolve(__dirname, '../../..');

		const subscription = readFileSync(
			resolve(repoRoot, 'src/routes/(parent)/admin/subscription/+page.server.ts'),
			'utf8',
		);
		expect(subscription, 'tier をリテラルで書くと再び standard 固定に戻りうる').toContain(
			'tier: TRIAL_TIER',
		);
		expect(subscription).not.toMatch(/tier:\s*'standard'/);

		const signup = readFileSync(
			resolve(repoRoot, 'src/routes/auth/signup/+page.server.ts'),
			'utf8',
		);
		expect(signup).toContain('tier: TRIAL_TIER');
		expect(signup, '?plan= から tier を決める旧経路が残っていない').not.toContain(
			'parsePlanForTrial',
		);
	});
});

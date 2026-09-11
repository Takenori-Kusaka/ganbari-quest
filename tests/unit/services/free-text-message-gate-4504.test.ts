// tests/unit/services/free-text-message-gate-4504.test.ts (#4504)
//
// ひとことメッセージ (自由テキスト) の premium ゲートを固定する。
//
// # 何が壊れていたか
// LP は自由テキストを premium 限定と訴求しているのに、送信経路 2 本 (cheer action /
// messages API) はどちらも tier を見ておらず、**全プランが送信できた**。
// `PLAN_LIMITS.canFreeTextMessage` は定義だけで参照ゼロのデッド設定だった。
//
// # 何を検査するか
//   1. 述語そのもの (free / standard 拒否、premium 許可)
//   2. `canFreeTextMessage` が述語から導出されている (デッド設定に戻らない)
//   3. トライアル中 (premium tier 解決) は許可される
//   4. 送信経路 2 本が **述語を実際に呼んでいる** (UI を隠すだけで終わっていない)
//   5. 定型スタンプはゲートしない (全プランのまま)

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('$lib/server/debug-plan', () => ({
	getDebugPlanTier: () => null,
	getDebugTrialOverride: () => null,
}));
// #4723: モード判定の実体は auth-mode.ts (factory は re-export)。plan-limit-service など
// 直接 auth-mode を import する側にも同じ値が見えるよう、両方を差し替える。
vi.mock('$lib/server/auth/auth-mode', () => ({ getAuthMode: () => 'cognito' }));
vi.mock('$lib/server/auth/factory', () => ({ getAuthMode: () => 'cognito' }));
vi.mock('$lib/server/db/factory', () => ({ getRepos: () => ({}) }));
vi.mock('$lib/server/request-context', () => ({
	getRequestContext: () => null,
	invalidateRequestCaches: vi.fn(),
}));

import { isFreeTextMessageUnlocked } from '$lib/domain/free-text-message-gate';
import { getPlanLimits, resolvePlanTier } from '$lib/server/services/plan-limit-service';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoFile = (p: string) => readFileSync(resolve(__dirname, '../../../', p), 'utf-8');

describe('#4504 自由テキストの premium ゲート', () => {
	describe('述語', () => {
		it('free / standard は拒否、premium (family) は許可', () => {
			expect(isFreeTextMessageUnlocked('free')).toBe(false);
			expect(isFreeTextMessageUnlocked('standard')).toBe(false);
			expect(isFreeTextMessageUnlocked('family')).toBe(true);
		});

		it('canFreeTextMessage が述語から導出されている (デッド設定に戻らない)', () => {
			for (const tier of ['free', 'standard', 'family'] as const) {
				expect(getPlanLimits(tier).canFreeTextMessage).toBe(isFreeTextMessageUnlocked(tier));
			}
		});

		it('premium トライアル中は許可される (別分岐を書かない)', () => {
			const future = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
			// trial tier = 'family' (#4501 FR-2)。resolvePlanTier がそれを返し、述語が許可する
			const tier = resolvePlanTier('none', undefined, future, 'family');
			expect(tier).toBe('family');
			expect(isFreeTextMessageUnlocked(tier)).toBe(true);
		});

		it('standard トライアル中は拒否される (tier がそのまま効く)', () => {
			const future = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
			const tier = resolvePlanTier('none', undefined, future, 'standard');
			expect(isFreeTextMessageUnlocked(tier)).toBe(false);
		});
	});

	// UI を隠すだけでは form / API を直接叩かれると素通しする。**server 側で落ちること**を
	// 経路ごとに固定する (経路が増えたらここに足す)。
	describe('送信経路が述語を実際に呼んでいる', () => {
		const ENFORCEMENT_SITES = [
			'src/routes/api/v1/messages/[childId]/+server.ts',
			'src/routes/(parent)/admin/cheer/+page.server.ts',
		];

		it.each(ENFORCEMENT_SITES)('%s が isFreeTextMessageUnlocked を呼ぶ', (file) => {
			const src = repoFile(file);
			expect(src).toContain('isFreeTextMessageUnlocked');
			expect(src, 'tier を解決せずに判定はできない').toContain('resolveFullPlanTier');
		});

		it('API は messageType=text のときだけゲートする (スタンプは全プラン)', () => {
			const src = repoFile('src/routes/api/v1/messages/[childId]/+server.ts');
			expect(src).toContain("parsed.data.messageType === 'text'");
			// #4710: プラン制限の 403 は要求 tier 込みで返す (planLimitError)。固定 userMessage の
			// apiError('PLAN_LIMIT_EXCEEDED', …) は「スタンダード以上でご利用いただけます」しか言えず、
			// premium 限定である自由テキストの案内として成立しない (既にスタンダードな顧客が動けない)。
			expect(src, 'premium 限定なので要求 tier は family').toMatch(/planLimitError\(\s*'family'/);
		});

		it('cheer action は body があるときだけゲートする (ポイント付与とスタンプは全プラン)', () => {
			const src = repoFile('src/routes/(parent)/admin/cheer/+page.server.ts');
			expect(src).toContain('if (validation.data.body)');
		});

		it('UI も同じ述語を読む (表示と認可が別式にならない)', () => {
			const src = repoFile('src/routes/(parent)/admin/cheer/+page.svelte');
			expect(src).toContain('isFreeTextMessageUnlocked(data.planTier)');
			// page が読む field は load が返していること (silent undefined を防ぐ)
			expect(repoFile('src/routes/(parent)/admin/cheer/+page.server.ts')).toContain('planTier,');
		});
	});
});

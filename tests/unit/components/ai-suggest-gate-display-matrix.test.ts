// tests/unit/components/ai-suggest-gate-display-matrix.test.ts
// #4506 (EPIC #4495): AI 提案パネルの「プラン × 画面」表示状態マトリクス。
//
// ## なぜ画面横断のマトリクスが要るか
//
// AI 提案の enforcement は server (`suggest-plan-gate.ts`) が premium 限定で行う。UI が
// それと違う状態を見せると、顧客には 2 方向の実害が出る。
//
// - server 許可 / UI ロック → **購入済み機能が使えない** (money。checklists で発生 = #4506 本丸)
// - server 拒否 / UI 解放 → **含まれない機能を含まれるかのように提示** (legal。activities で発生中)
//
// 個々のパネルの単体挙動は `ai-suggest-panel-plan-gate.test.ts` (#722) が既に見ているので、
// 本 file は **画面ごとの導出結果が server 契約と一致するか** を tier ごとに突き合わせる。
//
// ## activities が期待値として「不一致」を持っている理由
//
// activities の standard は現在 **解放表示** (既知の不整合)。PO の順序制約により、この引き締めは
// #4501 (プレミアムのトライアル化) と同 wave か後に行う (LP が「全機能お試し」を約束している
// 間に先に締めると見込み客への新たな誤認を作るため)。よって本 file は**現状を pin する**。
// #4501 wave で activities を共有述語に移せば本 test が落ち、期待値の更新を強制する。

import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { isAiSuggestUnlocked } from '$lib/domain/ai-suggest-gate';
import type { PlanTier } from '$lib/domain/constants/plan-tier';
import AiSuggestChecklistPanel from '$lib/features/admin/components/AiSuggestChecklistPanel.svelte';
import AiSuggestPanel from '$lib/features/admin/components/AiSuggestPanel.svelte';
import AiSuggestRewardPanel from '$lib/features/admin/components/AiSuggestRewardPanel.svelte';

const TIERS: readonly PlanTier[] = ['free', 'standard', 'family'];

/** server 側 enforcement (`validateSuggestRequest`) が許可する tier。UI の答え合わせ基準。 */
function serverAllows(tier: PlanTier): boolean {
	return tier === 'family';
}

interface ScreenUnderTest {
	name: string;
	// biome-ignore lint/suspicious/noExplicitAny: Svelte component 型は panel ごとに props が異なる
	component: any;
	/** 当該画面の `+page.svelte` が isFamily prop に渡している導出式と同じもの。 */
	derive: (tier: PlanTier) => boolean;
	/** panel ごとに data-testid の接頭辞が異なる (`ai-suggest-` / `ai-suggest-checklist-` ...)。 */
	testidPrefix: string;
	/** server 契約と一致しているか。false の画面は理由 (追跡 Issue) を必須にする。 */
	matchesServerContract: boolean;
	deferredReason?: string;
}

const SCREENS: readonly ScreenUnderTest[] = [
	{
		name: 'checklists (#4506 で是正)',
		component: AiSuggestChecklistPanel,
		testidPrefix: 'ai-suggest-checklist-',
		derive: (tier) => isAiSuggestUnlocked(tier),
		matchesServerContract: true,
	},
	{
		name: 'rewards (対照実装)',
		component: AiSuggestRewardPanel,
		testidPrefix: 'ai-suggest-reward-',
		derive: (tier) => isAiSuggestUnlocked(tier),
		matchesServerContract: true,
	},
	{
		name: 'activities (#4501 wave 待ちの既知の不整合)',
		component: AiSuggestPanel,
		testidPrefix: 'ai-suggest-',
		// `+page.svelte` は `data.isPremium` を渡す。isPremium = isPaidTier(tier) = free 以外。
		derive: (tier) => tier !== 'free',
		matchesServerContract: false,
		deferredReason:
			'#4501 (プレミアムのトライアル化) と同 wave で引き締める。LP が「全機能お試し」を約束している間に先に締めると見込み客への新たな誤認を作るため、PO 順序制約で本 PR では変更しない (#4506)',
	},
];

/** パネルを描画してロック状態 (顧客が見る状態) を読む。 */
function renderLockState(screen_: ScreenUnderTest, tier: PlanTier): boolean {
	cleanup();
	render(screen_.component, { onaccept: () => {}, isFamily: screen_.derive(tier) });
	return (
		screen.getByTestId(`${screen_.testidPrefix}panel`).getAttribute('data-plan-locked') === 'true'
	);
}

describe('AI 提案パネル プラン × 画面 表示状態マトリクス (#4506)', () => {
	afterEach(() => {
		cleanup();
	});

	describe.each(SCREENS)('$name', (screenUnderTest) => {
		it.each(TIERS)('%s: 表示状態が定義どおりである', (tier) => {
			const locked = renderLockState(screenUnderTest, tier);
			expect(locked).toBe(!screenUnderTest.derive(tier));
		});

		it.each(TIERS)('%s: server 契約との一致/不一致が宣言どおりである', (tier) => {
			const locked = renderLockState(screenUnderTest, tier);
			const consistentWithServer = locked === !serverAllows(tier);
			if (screenUnderTest.matchesServerContract) {
				expect(consistentWithServer).toBe(true);
			} else {
				// 宣言済みの未移行画面。free / family は元々一致し、standard だけがずれる。
				expect(consistentWithServer).toBe(tier !== 'standard');
			}
		});

		it('ロック時はアップグレード CTA が、非ロック時は入力が出る (顧客に見える差)', () => {
			const lockedForFree = renderLockState(screenUnderTest, 'free');
			expect(lockedForFree).toBe(true);
			expect(screen.getByTestId(`${screenUnderTest.testidPrefix}upgrade-cta`)).toBeDefined();

			renderLockState(screenUnderTest, 'family');
			expect(screen.queryByTestId(`${screenUnderTest.testidPrefix}upgrade-cta`)).toBeNull();
			expect(document.querySelector<HTMLInputElement>('input[type="text"]')?.disabled).toBe(false);
		});
	});

	// ============================================================
	// #4506 本丸: プレミアム加入者が checklists でロックされない
	// ============================================================

	it('プレミアム加入者の checklists AI 提案はロックされない (回帰: 購入済み機能の不可視)', () => {
		const checklists = SCREENS.find((s) => s.component === AiSuggestChecklistPanel);
		if (!checklists) throw new Error('checklists の行がマトリクスにありません');
		expect(renderLockState(checklists, 'family')).toBe(false);
		expect(screen.queryByTestId('ai-suggest-checklist-locked-badge')).toBeNull();
		expect(screen.queryByTestId('ai-suggest-checklist-upgrade-card')).toBeNull();
	});

	// ============================================================
	// 未移行画面の理由を空にさせない (#4030 と同型: 除外に理由を強制する)
	// ============================================================

	it('server 契約と一致しない画面は追跡可能な理由を持つ', () => {
		for (const s of SCREENS.filter((x) => !x.matchesServerContract)) {
			expect(s.deferredReason, `${s.name} に deferredReason が無い`).toBeTruthy();
			expect(s.deferredReason?.trim().length ?? 0).toBeGreaterThan(12);
			// 追跡先 Issue が書かれていること (「あとで直す」で終わらせない)
			expect(s.deferredReason).toMatch(/#\d{3,}/);
		}
	});
});

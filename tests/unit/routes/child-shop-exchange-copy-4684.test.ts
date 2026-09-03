// tests/unit/routes/child-shop-exchange-copy-4684.test.ts
// #4684: 交換確認ダイアログ / トーストの説明を「実際に起きること」に一致させる。
//
// なぜ必要か:
//   - 即時交換 ON (reward_auto_approve) の家庭でも「おうちのひとにれんらくがいくよ」と出て、
//     「はい」を押すとその場でポイントが減っていた。連絡は行かない (#4684 症状 1)。
//   - 承認モードでも push / メール通知は無く、親が /admin を開いたときのバナーだけ。
//     「れんらくがいく」「へんじを まってね」は実装の事実と違う (#4684 症状 2 / F2)。
//   - 「いまこうかんできる」フィルタが押せない (承認待ち) カードまで数えていた (#4684 症状 3 / F3)。
//
// ダイアログ文言は component 層 (実際の描画) で、フィルタ判定は domain SSOT 関数で固定する。

import { render, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';

vi.mock('$app/forms', () => ({
	enhance: () => ({ destroy: () => {} }),
}));
vi.mock('$app/navigation', () => ({ invalidateAll: vi.fn(async () => {}) }));
vi.mock('$lib/features/reward-celebration', () => ({
	playRewardCelebration: vi.fn(async () => {}),
}));
vi.mock('$lib/ui/primitives/Toast.svelte', () => ({ showToast: vi.fn(), default: () => {} }));
vi.mock('$lib/features/point-flight/point-flight.svelte', () => ({
	animateBalanceChange: vi.fn(async () => {}),
	captureFlightOrigin: vi.fn(() => null),
}));

import { CHILD_SHOP_LABELS } from '../../../src/lib/domain/labels';
import { canExchangeReward } from '../../../src/lib/domain/shop-availability';
import ConfirmExchangeDialog from '../../../src/routes/(child)/[uiMode=uiMode]/shop/ConfirmExchangeDialog.svelte';

async function mountDialog(autoApprove: boolean) {
	const rendered = render(ConfirmExchangeDialog, {
		props: {
			open: true,
			rewardId: 'reward-1',
			rewardTitle: 'ゲームじかん +30ぷん',
			rewardPoints: 10,
			rewardIcon: '🎮',
			balance: 100,
			// #4690: 文言は年齢帯で文体が変わる。本 test の assert 対象 (ひらがな) は
			// baby / preschool / elementary 側の文言なので preschool を渡す。
			uiMode: 'preschool',
			autoApprove,
			pointSettings: { mode: 'point' as const, currency: 'JPY' as const, rate: 1 },
			onClose: () => {},
		},
	});
	// Ark UI Dialog は Portal 経由で content を出すため、描画完了を待つ。
	await waitFor(() => {
		if (!document.body.textContent?.includes(CHILD_SHOP_LABELS.exchangeConfirmHeading)) {
			throw new Error('dialog がまだ mount されていない');
		}
	});
	return rendered;
}

describe('#4684 AC1 交換確認ダイアログの説明は即時交換 ON / OFF で切り替わる', () => {
	it('即時交換 ON では「すぐに減る」ことを言い、連絡が行くとは言わない', async () => {
		await mountDialog(true);
		const text = document.body.textContent ?? '';

		expect(text).toContain(CHILD_SHOP_LABELS.exchangeConfirmDescriptionInstant);
		expect(text).not.toContain(CHILD_SHOP_LABELS.exchangeConfirmDescriptionApproval);
	});

	it('承認モードでは「おうちのひとが みたら」と言い、通知が飛ぶとは言わない', async () => {
		await mountDialog(false);
		const text = document.body.textContent ?? '';

		expect(text).toContain(CHILD_SHOP_LABELS.exchangeConfirmDescriptionApproval);
		expect(text).not.toContain(CHILD_SHOP_LABELS.exchangeConfirmDescriptionInstant);
	});

	it('どちらの文言も「れんらく」「つうち」を約束しない (F2: 通知経路が存在しない)', () => {
		for (const copy of [
			CHILD_SHOP_LABELS.exchangeConfirmDescriptionInstant,
			CHILD_SHOP_LABELS.exchangeConfirmDescriptionApproval,
			CHILD_SHOP_LABELS.exchangeRequestedToastBody('ごほうび', 1),
		]) {
			expect(copy, `実装に無い通知を約束しない: ${copy}`).not.toMatch(/れんらく|連絡|つうち|通知/);
		}
	});
});

describe('#4684 AC2 「いまこうかんできる」は押せるカードと同条件', () => {
	it('残高が足りていても承認待ちなら「こうかんできる」に数えない', () => {
		expect(
			canExchangeReward({ points: 50, latestRequestStatus: 'pending_parent_approval' }, 100),
		).toBe(false);
	});

	it('残高が足りていて承認待ちでなければ数える (approved / rejected / 未申請)', () => {
		for (const status of [null, 'approved', 'rejected', 'expired']) {
			expect(canExchangeReward({ points: 50, latestRequestStatus: status }, 100)).toBe(true);
		}
	});

	it('残高が足りなければ数えない', () => {
		expect(canExchangeReward({ points: 500, latestRequestStatus: null }, 100)).toBe(false);
	});

	it('ちょうど同額は買える (境界)', () => {
		expect(canExchangeReward({ points: 100, latestRequestStatus: null }, 100)).toBe(true);
	});
});

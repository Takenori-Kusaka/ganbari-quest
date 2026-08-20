// tests/unit/routes/child-shop-exchange-celebration.test.ts
// #4449: ごほうび交換の演出を「実際に起きたこと」に一致させる。
//
// なぜ必要か: 既定設定 (親の承認が要る) では押した時点で作られるのは申請だけで、
// ポイントは 1 も減っていない。にもかかわらず紙吹雪 + ファンファーレ 2 音 + 振動が鳴っていた
// (ADR-0012: 起きていないことを祝うのは演出の濫用 / ADR-0013: 顧客に見えるフィードバックの
// SSOT は実装の事実)。
//
// 演出を止める唯一の gate は「server が返す instant を見て分岐する」ことなので、
// ここが緩むと既定経路で祝福が復活する。逆に即時交換 (減算済) で鳴らなくなると
// 成立した交換が無音になる。両方向を固定する。
// あわせて AC2 (どちらの経路でも文字で結果が出る) / AC3 (失敗経路で祝福しない) も pin する。

import { render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `use:enhance` に渡された submit 関数を捕まえる。
 * これで「server の応答 → component が何をしたか」を実際の component 上で検証できる。
 */
const { capturedSubmit } = vi.hoisted(() => ({
	capturedSubmit: { fn: null as ((input: unknown) => unknown) | null },
}));
vi.mock('$app/forms', () => ({
	enhance: (_node: HTMLFormElement, submit: (input: unknown) => unknown) => {
		capturedSubmit.fn = submit;
		return { destroy: () => {} };
	},
}));
vi.mock('$app/navigation', () => ({ invalidateAll: vi.fn(async () => {}) }));

const { playRewardCelebration } = vi.hoisted(() => ({
	playRewardCelebration: vi.fn(async () => {}),
}));
vi.mock('$lib/features/reward-celebration', () => ({ playRewardCelebration }));

const { showToast } = vi.hoisted(() => ({ showToast: vi.fn() }));
vi.mock('$lib/ui/primitives/Toast.svelte', () => ({
	showToast,
	default: () => {},
}));

// 数字の増減演出 (#4449 のスコープ外) は本 test の対象ではないので、
// rAF / 実座標に依存しないよう最小 stub にする (commit は必ず走らせる)。
const { animateBalanceChange, captureFlightOrigin } = vi.hoisted(() => ({
	animateBalanceChange: vi.fn(async (opts: { commit: () => Promise<void> | void }) => {
		await opts.commit();
	}),
	captureFlightOrigin: vi.fn(() => null),
}));
vi.mock('$lib/features/point-flight/point-flight.svelte', () => ({
	animateBalanceChange,
	captureFlightOrigin,
}));

import { CHILD_SHOP_LABELS } from '../../../src/lib/domain/labels';
import ConfirmExchangeDialog from '../../../src/routes/(child)/[uiMode=uiMode]/shop/ConfirmExchangeDialog.svelte';

const REWARD_TITLE = 'ゲームじかん +30ぷん';

async function mountDialog() {
	const rendered = render(ConfirmExchangeDialog, {
		props: {
			open: true,
			rewardId: 'reward-1',
			rewardTitle: REWARD_TITLE,
			rewardPoints: 10,
			rewardIcon: '🎮',
			balance: 100,
			pointSettings: { mode: 'point' as const, currency: 'JPY' as const, rate: 1 },
			// #4690: 文言の文体は年齢帯で変わる。本 spec は従来どおりひらがな変種を検証する。
			uiMode: 'elementary',
			onClose: () => {},
		},
	});
	// Ark UI Dialog は Portal 経由で content を出すため、form の mount を待ってから submit する。
	await waitFor(() => {
		if (!capturedSubmit.fn) throw new Error('form がまだ mount されていない');
	});
	return rendered;
}

/** server 応答を `use:enhance` の callback に流し込む。 */
async function submitWith(result: unknown): Promise<void> {
	if (!capturedSubmit.fn) throw new Error('use:enhance の submit 関数が捕まえられていない');
	const callback = (await capturedSubmit.fn({ formData: new FormData() })) as (input: {
		result: unknown;
		update: () => Promise<void>;
	}) => Promise<void>;
	await callback({ result, update: async () => {} });
}

describe('ごほうび交換の演出は「実際に起きたこと」に一致する (#4449)', () => {
	beforeEach(() => {
		capturedSubmit.fn = null;
		playRewardCelebration.mockClear();
		showToast.mockClear();
		animateBalanceChange.mockClear();
	});
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('AC1 既定 (申請だけ / ポイントは減っていない) では祝福しない', async () => {
		await mountDialog();
		await submitWith({ type: 'success', data: { instant: false, quantity: 1, balance: 100 } });

		expect(
			playRewardCelebration,
			'減っていないポイントを祝わない (紙吹雪 / ファンファーレ / 振動なし)',
		).not.toHaveBeenCalled();
	});

	it('AC1 即時交換 (ポイントが実際に減った) なら祝福する', async () => {
		await mountDialog();
		await submitWith({ type: 'success', data: { instant: true, quantity: 1, balance: 90 } });

		expect(playRewardCelebration, '成立した交換は祝う').toHaveBeenCalledTimes(1);
	});

	it('AC1 instant が欠けた応答 (旧 server / 想定外) では祝福しない', async () => {
		await mountDialog();
		await submitWith({ type: 'success', data: undefined });

		expect(playRewardCelebration, '不明なら祝わない側に倒す').not.toHaveBeenCalled();
	});

	it('AC2 申請だけの経路でも「何を」「返事待ち」が文字で出る', async () => {
		await mountDialog();
		await submitWith({ type: 'success', data: { instant: false, quantity: 1, balance: 100 } });

		expect(showToast).toHaveBeenCalledTimes(1);
		const [title, body, variant] = showToast.mock.calls[0] as [string, string, string];
		expect(title).toBe(CHILD_SHOP_LABELS.exchangeRequestedToastTitle);
		expect(body).toContain(REWARD_TITLE);
		expect(body).toBe(CHILD_SHOP_LABELS.exchangeRequestedToastBody(REWARD_TITLE, 1));
		expect(variant).toBe('success');
	});

	it('AC2 即時交換の経路でも「何を」「交換できた」が文字で出る', async () => {
		await mountDialog();
		await submitWith({ type: 'success', data: { instant: true, quantity: 2, balance: 80 } });

		const [title, body] = showToast.mock.calls[0] as [string, string];
		expect(title).toBe(CHILD_SHOP_LABELS.exchangeSuccessToastTitle);
		expect(body).toBe(CHILD_SHOP_LABELS.exchangeSuccessToastBody(REWARD_TITLE, 2, 80));
	});

	it.each([
		['INSUFFICIENT_POINTS', CHILD_SHOP_LABELS.errorInsufficientPoints],
		['ALREADY_PENDING', CHILD_SHOP_LABELS.errorAlreadyPending],
		['REWARD_NOT_FOUND', CHILD_SHOP_LABELS.errorRewardNotFound],
	])('AC3 %s で fail(400) が返っても祝福せず、理由を文字で出す', async (_code, message) => {
		await mountDialog();
		await submitWith({ type: 'failure', status: 400, data: { error: message } });

		expect(playRewardCelebration, '失敗を祝わない').not.toHaveBeenCalled();
		expect(showToast).toHaveBeenCalledWith(message, undefined, 'error');
	});

	it('AC3 error 文言が無い失敗応答でも祝福せず、汎用の文言を出す', async () => {
		await mountDialog();
		await submitWith({ type: 'failure', status: 400, data: undefined });

		expect(playRewardCelebration).not.toHaveBeenCalled();
		expect(showToast).toHaveBeenCalledWith(CHILD_SHOP_LABELS.errorGeneric, undefined, 'error');
	});

	it('AC3 error (500) / redirect でも祝福しない', async () => {
		await mountDialog();
		await submitWith({ type: 'error', error: new Error('boom') });

		expect(playRewardCelebration).not.toHaveBeenCalled();
		expect(showToast).toHaveBeenCalledWith(CHILD_SHOP_LABELS.errorGeneric, undefined, 'error');
	});
});

// tests/unit/components/cancel-flow-downgrade-selection.test.ts
// #4585 分割 1 — 解約フロー (/admin/subscription/cancel) を既存の選択 UI に合流させる。
//
// ## 旧実装の何が壊れていたか
//
// 解約の入口は 2 つある。管理画面の請求パネル (SaasLicensePanel.requestPortal) は
// downgrade-preview を取り、超過があれば DowngradeResourceSelector で「どれを残すか」を
// 顧客に選ばせてから Stripe へ送る。ところが解約フロー (/admin/subscription/cancel) は
// `downgrade` への参照が 0 件で、理由フォーム → portal 直行だった (#4166 の副作用)。
// **同じ解約なのに通る道で挙動が変わり**、こちらを通った顧客は選択の機会を得られないまま
// 期末に自動 archive (古い順に残す) される。顧客からは「解約したら 3 人目の子の記録が
// 消えた。選ばせてもらえなかった」に見える (Issue #4585 ②、PO 決裁 = 案 A)。
//
// ## 何を固定するか
//
// - 有料プランの解約フローが**選択 UI に到達する** (submit で即 portal へ送らない)
// - 選択せずに進めた場合に何が残るか (fallback 規則) を**解約画面に提示する** (PO 必須指示)
// - free プランでは選択 UI を挟まない (落とすものが無いのに 1 画面増やさない)
// - 選択が取得できない場合でも解約を**行き止まりにしない** (#4329 と同じ特商法の実効性)

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CANCELLATION_LABELS } from '../../../src/lib/domain/labels';
import CancelPage from '../../../src/routes/(parent)/admin/subscription/cancel/+page.svelte';

// `$app/forms` の enhance は SvelteKit client runtime (applyAction / goto) を掴むため、
// jsdom 単体では action 応答の適用時に落ちる。ここでは **enhance の契約だけ**を再現する
// test double を置く: submit を横取りし、submit 関数が `cancel()` を呼んだ場合は送信しない。
// 検証対象 (選択 UI を挟むか / 挟まず送るか) はこの契約の上で本物のまま動く。
vi.mock('$app/forms', () => ({
	enhance: (form: HTMLFormElement, submitFn?: (arg: unknown) => unknown) => {
		const handler = async (event: Event) => {
			event.preventDefault();
			let cancelled = false;
			const callback = await submitFn?.({
				formElement: form,
				formData: new FormData(form),
				action: new URL('http://localhost/admin/subscription/cancel'),
				controller: new AbortController(),
				submitter: null,
				cancel: () => {
					cancelled = true;
				},
			});
			if (cancelled) return;
			await fetch('/admin/subscription/cancel', { method: 'POST' });
			await (callback as ((arg: unknown) => unknown) | undefined)?.({
				result: { type: 'redirect', location: '/' },
				update: async () => {},
			});
		};
		form.addEventListener('submit', handler);
		return { destroy: () => form.removeEventListener('submit', handler) };
	},
}));

const PREVIEW_URL = '/api/v1/admin/downgrade-preview?targetTier=free';

const previewWithExcess = {
	targetTier: 'free',
	children: {
		current: [
			{ id: 'c1', name: 'たろう', uiMode: 'elementary' },
			{ id: 'c2', name: 'はなこ', uiMode: 'preschool' },
			{ id: 'c3', name: 'じろう', uiMode: 'junior' },
		],
		max: 2,
		excess: 1,
	},
	activities: { current: [], max: 3, excess: 0 },
	checklistTemplates: { current: [], maxPerChild: 3, excessByChild: [] },
	retentionChange: { currentDays: null, targetDays: 90, willLoseHistory: true },
	hasExcess: true,
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
	fetchMock = vi.fn(async (input: unknown) => {
		const url = String(input);
		if (url.startsWith('/api/v1/admin/downgrade-preview')) {
			return new Response(JSON.stringify(previewWithExcess), {
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			});
		}
		// use:enhance が action を呼ぶ経路 (ここに来たら「選択を挟まず送信された」)
		return new Response('{}', { status: 200 });
	});
	vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
	vi.unstubAllGlobals();
	cleanup();
});

function renderPage(props: Record<string, unknown> = {}) {
	return render(CancelPage as never, {
		props: {
			data: {
				plan: 'standard',
				planTier: 'standard',
				isPaidPlan: true,
				hasStripeCustomer: true,
				stripeEnabled: true,
				categories: ['graduation', 'churn', 'pause'],
				freeTextMaxLength: CANCELLATION_LABELS.freeTextMaxLength,
				freeLimits: { maxChildren: 2, maxActivities: 3, maxChecklistTemplates: 3 },
				...props,
			},
			form: null,
		} as never,
	});
}

/** 解約理由 (必須) を選んで submit ボタンを押す */
async function submitWithReason() {
	await fireEvent.click(screen.getByTestId('cancellation-category-churn'));
	await fireEvent.click(screen.getByTestId('cancellation-submit'));
}

/** preview 応答を差し替える (超過 / 保持期間の組み合わせごとの分岐検証用) */
function mockPreview(overrides: Record<string, unknown>) {
	fetchMock.mockImplementation(async (input: unknown) => {
		if (String(input).startsWith('/api/v1/admin/downgrade-preview')) {
			return new Response(JSON.stringify({ ...previewWithExcess, ...overrides }), {
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			});
		}
		return new Response('{}', { status: 200 });
	});
}

/**
 * 選択ダイアログの開閉状態。
 *
 * Ark UI の Dialog は一度 mount されると閉じても DOM に残る (hidden + data-state="closed") ため、
 * 「要素があるか」ではなく **開いているか** を見る。
 */
function selectorState(): 'open' | 'closed' {
	const el = screen.queryByTestId('downgrade-resource-selector');
	return el?.getAttribute('data-state') === 'open' ? 'open' : 'closed';
}

function actionCalls() {
	return fetchMock.mock.calls.filter(
		(call) => !String(call[0]).startsWith('/api/v1/admin/downgrade-preview'),
	);
}

describe('#4585-1 解約フローが選択 UI に合流する', () => {
	it('AC1: 有料プランの submit は選択 UI に到達する (即 portal へ送らない)', async () => {
		renderPage();
		await submitWithReason();

		await waitFor(() => {
			expect(fetchMock).toHaveBeenCalledWith(PREVIEW_URL);
		});
		// 旧実装はここで即 action へ POST し、顧客は選択画面を見なかった
		await waitFor(() => {
			expect(selectorState()).toBe('open');
		});
		expect(screen.getByTestId('downgrade-child-list')).toBeTruthy();
		expect(actionCalls()).toHaveLength(0);
	});

	it('AC2: 選択を確定すると archive を実行してから解約手続きへ進む', async () => {
		renderPage();
		await submitWithReason();
		await waitFor(() => {
			expect(screen.getByTestId('downgrade-child-list')).toBeTruthy();
		});

		// 超過 1 人分をアーカイブ対象に選ぶ
		const item = screen.getByTestId('downgrade-child-item-c3');
		const checkbox = item.querySelector('input[type="checkbox"]');
		expect(checkbox).not.toBeNull();
		await fireEvent.click(checkbox as HTMLInputElement);
		await fireEvent.click(screen.getByTestId('downgrade-confirm-button'));

		await waitFor(() => {
			const archiveCall = fetchMock.mock.calls.find(
				(call) => String(call[0]) === '/api/v1/admin/downgrade-archive',
			);
			expect(archiveCall).toBeDefined();
			expect(JSON.parse(String((archiveCall?.[1] as RequestInit)?.body))).toMatchObject({
				targetTier: 'free',
				childIds: ['c3'],
			});
		});
		// archive 後は解約手続き (form action) へ進む
		await waitFor(() => {
			expect(actionCalls().length).toBeGreaterThan(0);
		});
	});

	it('AC3: 選ばずに進めた場合に何が残るかを解約画面に提示する', () => {
		renderPage();

		const notice = screen.getByTestId('cancellation-archive-fallback-notice');
		expect(notice.textContent).toContain(CANCELLATION_LABELS.archiveFallbackHeading);
		// 「古い順に残す」規則と、アーカイブが削除ではないこと
		expect(notice.textContent).toContain(CANCELLATION_LABELS.archiveFallbackRule(2, 3, 3));
		expect(notice.textContent).toContain(CANCELLATION_LABELS.archiveFallbackRestore);
	});

	it('AC4: free プランでは選択 UI を挟まず、fallback 提示も出さない', async () => {
		renderPage({ plan: 'free', planTier: 'free', isPaidPlan: false, hasStripeCustomer: false });

		expect(screen.queryByTestId('cancellation-archive-fallback-notice')).toBeNull();
		await submitWithReason();

		expect(
			fetchMock.mock.calls.filter((call) =>
				String(call[0]).startsWith('/api/v1/admin/downgrade-preview'),
			),
		).toHaveLength(0);
		await waitFor(() => {
			expect(actionCalls().length).toBeGreaterThan(0);
		});
	});

	it('AC5: 失うものが無ければ選択 UI を挟まずそのまま解約手続きへ進む', async () => {
		mockPreview({
			children: { current: [], max: 2, excess: 0 },
			retentionChange: { currentDays: 90, targetDays: 90, willLoseHistory: false },
			hasExcess: false,
		});
		renderPage();
		await submitWithReason();

		await waitFor(() => {
			expect(actionCalls().length).toBeGreaterThan(0);
		});
		expect(selectorState()).toBe('closed');
	});

	it('AC7: 超過は無くても保持期間が縮むなら選択 UI を開く (請求パネルと同一判定、#4530)', async () => {
		mockPreview({
			children: { current: [], max: 2, excess: 0 },
			retentionChange: { currentDays: null, targetDays: 90, willLoseHistory: true },
			hasExcess: false,
		});
		renderPage();
		await submitWithReason();

		await waitFor(() => {
			expect(selectorState()).toBe('open');
		});
		expect(actionCalls()).toHaveLength(0);
	});

	it('AC6: 選択情報を取得できなくても解約を行き止まりにしない (理由を出して再送信で進める)', async () => {
		fetchMock.mockImplementation(async (input: unknown) => {
			if (String(input).startsWith('/api/v1/admin/downgrade-preview')) {
				return new Response('{}', { status: 500 });
			}
			return new Response('{}', { status: 200 });
		});
		renderPage();
		await submitWithReason();

		await waitFor(() => {
			expect(screen.getByTestId('cancellation-selection-unavailable').textContent).toContain(
				CANCELLATION_LABELS.selectionUnavailable,
			);
		});
		// 1 回目は止まる (無言で自動 archive に倒さない)
		expect(actionCalls()).toHaveLength(0);

		// 2 回目の submit は手続きを続行できる (dead-end を作らない、#4329 整合)
		await fireEvent.click(screen.getByTestId('cancellation-submit'));
		await waitFor(() => {
			expect(actionCalls().length).toBeGreaterThan(0);
		});
	});
});

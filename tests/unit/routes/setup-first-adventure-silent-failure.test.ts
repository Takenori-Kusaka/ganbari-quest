// tests/unit/routes/setup-first-adventure-silent-failure.test.ts
//
// `/setup/first-adventure` (セットアップ 9 step の山場 = 子供と一緒に最初の 1 件を記録する)
// は `fail(400, { error })` を返していたのに、画面が `form.error` を一度も描画していなかった。
// 同日 2 回目 / 1 日の上限に達した状態で「きろくする」を押すと、ボタンは押せるまま何も起きない
// = 無音の失敗 (ADR-0062: WCAG 3.3.1 Error Identification + 4.1.3 Status Messages の二重違反)。
// 同じウィザードの `/setup/children` は同じ `fail` を `ErrorAlert` で出している。
//
// 固定する不変条件:
//   [A] server は失敗理由 (ALREADY_RECORDED / DAILY_LIMIT_REACHED / NOT_FOUND) を捨てず、
//       それぞれ別の顧客向け文言にして返す (内部コードは画面に出さない)
//   [B] 画面はその `form.error` を role="alert" で描画し、次アクション (別の活動 / スキップ) を示す
//   [C] 失敗後も操作を続けられる (活動カードと「あとでやる」が残っている)

import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	getSetupFirstAdventureRecordError,
	SETUP_FIRST_ADVENTURE_LABELS,
} from '../../../src/lib/domain/labels';
import FirstAdventurePage from '../../../src/routes/setup/first-adventure/+page.svelte';

const recordActivity = vi.fn();

vi.mock('$lib/server/auth/factory', () => ({
	requireTenantId: () => 'tenant-1',
}));
vi.mock('$lib/server/services/activity-log-service', () => ({
	recordActivity: (...args: unknown[]) => recordActivity(...args),
}));
vi.mock('$lib/server/services/activity-service', () => ({
	getChildActivities: vi.fn().mockResolvedValue([]),
}));
vi.mock('$lib/server/services/child-service', () => ({
	getAllChildren: vi.fn().mockResolvedValue([]),
}));
vi.mock('$lib/server/services/setup-funnel-service', () => ({
	trackSetupFunnel: vi.fn(),
}));

function formRequest(): Request {
	const body = new FormData();
	body.set('childId', 'child-1');
	body.set('activityId', 'activity-1');
	return new Request('http://localhost/setup/first-adventure?/record', { method: 'POST', body });
}

/** `actions.record` を実経路で呼び、`fail()` が返した data を取り出す。 */
async function runRecordAction(): Promise<{ status: number; error: string }> {
	const { actions } = await import('../../../src/routes/setup/first-adventure/+page.server');
	const record = actions.record;
	if (!record) throw new Error('actions.record が定義されていない');
	const result = (await record({
		request: formRequest(),
		locals: { context: { tenantId: 'tenant-1' } },
	} as never)) as unknown as { status: number; data: { error: string } };
	return { status: result.status, error: result.data.error };
}

describe('[A] 記録失敗の理由が捨てられない (server action)', () => {
	beforeEach(() => {
		recordActivity.mockReset();
	});

	it('同日 2 回目 (ALREADY_RECORDED) は「今日すでに記録ずみ」と返す', async () => {
		recordActivity.mockResolvedValueOnce({ error: 'ALREADY_RECORDED' });
		const { status, error } = await runRecordAction();
		expect(status).toBe(400);
		expect(error).toBe(SETUP_FIRST_ADVENTURE_LABELS.errorAlreadyRecorded);
	});

	it('上限到達 (DAILY_LIMIT_REACHED) は同日 2 回目と別の文言を返す', async () => {
		recordActivity.mockResolvedValueOnce({ error: 'DAILY_LIMIT_REACHED' });
		const { error } = await runRecordAction();
		expect(error).toBe(SETUP_FIRST_ADVENTURE_LABELS.errorDailyLimitReached);
		expect(error).not.toBe(SETUP_FIRST_ADVENTURE_LABELS.errorAlreadyRecorded);
	});

	it('活動が見つからない (NOT_FOUND) は読み込み直しを案内する', async () => {
		recordActivity.mockResolvedValueOnce({ error: 'NOT_FOUND', target: 'activity' });
		const { error } = await runRecordAction();
		expect(error).toBe(SETUP_FIRST_ADVENTURE_LABELS.errorActivityNotFound);
	});

	it('未知の理由でも汎用文言に落ちる (画面が空にならない)', async () => {
		recordActivity.mockResolvedValueOnce({ error: 'SOMETHING_ELSE' });
		const { error } = await runRecordAction();
		expect(error).toBe(SETUP_FIRST_ADVENTURE_LABELS.errorRecordFailed);
	});

	it('内部コードをそのまま画面に出さない (docs/DESIGN.md §6 内部コード露出禁止)', () => {
		for (const reason of ['ALREADY_RECORDED', 'DAILY_LIMIT_REACHED', 'NOT_FOUND']) {
			expect(getSetupFirstAdventureRecordError(reason)).not.toContain(reason);
		}
	});

	it('状態起因の失敗には次アクションが書かれている (ADR-0062 §1)', () => {
		for (const reason of ['ALREADY_RECORDED', 'DAILY_LIMIT_REACHED']) {
			expect(getSetupFirstAdventureRecordError(reason)).toContain(
				SETUP_FIRST_ADVENTURE_LABELS.skipButton,
			);
		}
	});
});

const ACTIVITIES = [
	{ id: 'activity-1', name: 'はみがき', icon: '🪥', basePoints: 10, isVisible: true },
];

// biome-ignore lint/suspicious/noExplicitAny: SvelteKit の PageData 型を test で最小化する
function renderPage(form: unknown): any {
	return render(FirstAdventurePage as never, {
		props: {
			data: {
				child: { id: 'child-1', nickname: 'たろう' },
				activities: ACTIVITIES,
				imported: 0,
				skipped: 0,
			},
			form,
		} as never,
	});
}

describe('[B][C] 失敗が画面に出る (component)', () => {
	afterEach(() => cleanup());

	it('form.error を role="alert" で描画する (旧実装は一度も描画していなかった)', () => {
		renderPage({ error: SETUP_FIRST_ADVENTURE_LABELS.errorAlreadyRecorded });

		const banner = screen.getByTestId('first-adventure-error');
		expect(banner.querySelector('[role="alert"]')).not.toBeNull();
		expect(banner.textContent).toContain(SETUP_FIRST_ADVENTURE_LABELS.errorAlreadyRecorded);
	});

	it('失敗後も別の活動を選べて「あとでやる」で先に進める (行き止まりにしない)', () => {
		renderPage({ error: SETUP_FIRST_ADVENTURE_LABELS.errorDailyLimitReached });

		expect(screen.getByText(ACTIVITIES[0]?.name ?? '')).toBeTruthy();
		expect(screen.getByText(SETUP_FIRST_ADVENTURE_LABELS.skipButton)).toBeTruthy();
	});

	it('失敗していないときはエラー領域を出さない', () => {
		renderPage(null);
		expect(screen.queryByTestId('first-adventure-error')).toBeNull();
	});

	it('成功時は成功演出に切り替わりエラー領域は出ない', () => {
		renderPage({ success: true, activityName: 'はみがき', totalPoints: 10, levelUp: null });
		expect(screen.queryByTestId('first-adventure-error')).toBeNull();
		expect(screen.getByText(SETUP_FIRST_ADVENTURE_LABELS.pointsGetLabel)).toBeTruthy();
	});
});

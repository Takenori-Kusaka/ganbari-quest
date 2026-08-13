// tests/unit/routes/child-checklist-display.test.ts
// #4509 ③/④: チェックリスト画面の「獲得ポイント表示」と「年齢帯文言」を固定する。
//
// ## 旧実装の何が壊れていたか
//
// ③ 完了ダイアログは `'+' + pointsAwarded + 'ポイント！'` を素で組んでおり、フッターの
//    fmtPts (換算あり) と表示系が分裂していた。通貨モードの家庭では、同じページの
//    フッターが「+25円」なのにダイアログは「+50 ポイント」と出る。
// ④ 文言がひらがな 1 セット固定で、13-18 歳がナビの「持ち物チェック」(漢字) から遷移すると
//    「にちようび」「おやにおねがいしてね」という幼児文体に着地していた。

import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getChildChecklistLabels } from '../../../src/lib/domain/labels';
import type { PointSettings } from '../../../src/lib/domain/point-display';
import { UI_MODES } from '../../../src/lib/domain/validation/age-tier';

class ResizeObserverStub {
	observe() {}
	unobserve() {}
	disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;

// use:enhance の submit ハンドラを掴み、サーバ応答を注入して完了ダイアログを実際に開く。
// (ダイアログの数値は「記録後にしか見えない」ため、ここを通さないと ③ の回帰を固定できない)
type EnhanceCallback = (arg: { result: unknown }) => Promise<void> | void;
let capturedEnhance: (() => EnhanceCallback) | null = null;

vi.mock('$app/forms', () => ({
	enhance: (_form: HTMLFormElement, cb: () => EnhanceCallback) => {
		capturedEnhance = cb;
		return { destroy() {} };
	},
}));
vi.mock('$app/navigation', () => ({ invalidateAll: vi.fn(), goto: vi.fn() }));
vi.mock('../../../src/lib/ui/sound', () => ({
	soundService: { playRecordComplete: vi.fn(), play: vi.fn() },
}));

afterEach(() => cleanup());
beforeEach(() => {
	capturedEnhance = null;
});

const POINT_MODE: PointSettings = { mode: 'point', currency: 'JPY', rate: 1 };
const YEN_MODE: PointSettings = { mode: 'currency', currency: 'JPY', rate: 0.5 };

const CHECKLIST = {
	templateId: 'tpl-1',
	templateName: 'がっこうのもちもの',
	templateIcon: '🎒',
	timeSlot: 'morning',
	checkedCount: 1,
	totalCount: 2,
	completedAll: false,
	pointsAwarded: 0,
	pointsPerItem: 10,
	completionBonus: 30,
	items: [
		{ id: 'i-1', name: 'ふでばこ', icon: '✏️', checked: true },
		{ id: 'i-2', name: 'すいとう', icon: '🥤', checked: false },
	],
};

let ChecklistPage: unknown;
beforeAll(async () => {
	ChecklistPage = (await import('../../../src/routes/(child)/checklist/+page.svelte')).default;
}, 60_000);

function renderChecklist(opts: { uiMode: string; pointSettings?: PointSettings }) {
	render(ChecklistPage as never, {
		props: {
			data: {
				checklists: [CHECKLIST],
				currentTimeSlot: 'morning',
				uiMode: opts.uiMode,
				pointSettings: opts.pointSettings ?? POINT_MODE,
			},
		} as never,
	});
}

/** 完了ダイアログを「サーバが完了を返した」状態で開く */
async function completeChecklist(pointsAwarded: number) {
	expect(capturedEnhance, 'use:enhance が張られていること').not.toBeNull();
	const inner = (capturedEnhance as unknown as () => EnhanceCallback)();
	await inner({
		result: {
			type: 'success',
			data: { completedAll: true, pointsAwarded, newlyCompleted: true },
		},
	});
}

describe('#4509 ③ 完了ダイアログの獲得ポイント', () => {
	it('通貨モードではフッターと同じ換算表示になる (表示系が分裂しない)', async () => {
		renderChecklist({ uiMode: 'elementary', pointSettings: YEN_MODE });
		await completeChecklist(50);

		const dialogPoints = await screen.findByTestId('checklist-complete-points');
		expect(dialogPoints.textContent).toBe('+25円');
		// 生ポイント + 固定「ポイント」に戻っていないこと
		expect(dialogPoints.textContent).not.toContain('ポイント');
		expect(dialogPoints.textContent).not.toContain('50');
	});

	it('ポイントモードでは符号付きポイント表示になる', async () => {
		renderChecklist({ uiMode: 'elementary', pointSettings: POINT_MODE });
		await completeChecklist(50);

		expect((await screen.findByTestId('checklist-complete-points')).textContent).toBe('+50P');
	});

	it('フッターの見込みポイントも同じ換算を通る', () => {
		renderChecklist({ uiMode: 'elementary', pointSettings: YEN_MODE });
		// 10pt * 2 + bonus 30pt = 50pt → 25 円
		expect(document.body.textContent).toContain('+25円');
	});
});

describe('#4509 ④ 年齢帯文言 — 5 モードすべてが自分の文体で着地する', () => {
	for (const mode of UI_MODES) {
		it(`${mode}: labels SSOT の variant がそのまま描画される`, () => {
			renderChecklist({ uiMode: mode });
			const t = getChildChecklistLabels({ ageTier: mode });
			expect(screen.getByText(t.todayPrefix)).toBeTruthy();
			// 曜日は JST 実日付で決まるため、7 件のどれかが出ていることを確認する
			const body = document.body.textContent ?? '';
			expect(
				t.dayNames.some((d) => body.includes(d)),
				`${mode} の曜日名`,
			).toBe(true);
		});
	}

	it('junior / senior が幼児文体 (「にちようび」「おやにおねがいしてね」) に着地しない', () => {
		for (const mode of ['junior', 'senior']) {
			renderChecklist({ uiMode: mode });
			const body = document.body.textContent ?? '';
			expect(body, mode).not.toContain('にちようび');
			expect(body, mode).not.toContain('のじかん');
			cleanup();
		}
	});

	it('preschool はひらがな文体のまま (漢字に格上げしない)', () => {
		renderChecklist({ uiMode: 'preschool' });
		expect(document.body.textContent).toContain('いまは');
	});
});

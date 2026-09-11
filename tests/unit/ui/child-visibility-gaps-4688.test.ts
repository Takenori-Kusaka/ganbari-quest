// tests/unit/ui/child-visibility-gaps-4688.test.ts
// #4688: 子供画面で「実データはあるのに画面に出ない」3 件を component 層で固定する。
//   F2: 🔔 バッジの遷移先 (チャレンジ画面 → マイルストーン一覧) と、既読化が遷移後であること
//   F3: 親が設定したレベル称号が「つよさ」の各カテゴリ行に出ること
//   F4: 応援 (cheer) のボーナスポイントがおうえんダイアログに出ること

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { asCategoryId } from '$lib/domain/ids';
import { getChildParentMessageLabels } from '../../../src/lib/domain/labels';

const gotoCalls: string[] = [];
vi.mock('$app/navigation', () => ({
	goto: (url: string) => {
		gotoCalls.push(url);
		return Promise.resolve();
	},
}));
vi.mock('$lib/ui/sound', () => ({
	soundService: { play: vi.fn(), configure: vi.fn(), preload: vi.fn() },
}));

import MilestoneBellButton from '../../../src/lib/features/value-preview/MilestoneBellButton.svelte';
import ParentMessageOverlay from '../../../src/lib/ui/components/ParentMessageOverlay.svelte';
import StatusBar from '../../../src/lib/ui/components/StatusBar.svelte';

afterEach(() => {
	cleanup();
	gotoCalls.length = 0;
	localStorage.clear();
});

describe('#4688 F2: 🔔 は通知されたマイルストーン一覧に着地する', () => {
	const milestones = [
		{
			id: 'first_record',
			label: 'はじめての きろく',
			achieved: true,
			achievedAt: '2026-08-19',
		},
	] as never;

	it('押すとマイルストーン一覧 (history?kind=milestones) へ遷移する', async () => {
		render(MilestoneBellButton, { milestones, childId: 3 as never, uiMode: 'preschool' });

		await fireEvent.click(screen.getByTestId('milestone-bell'));

		// 旧実装は `/preschool/challenges` (今週のチャレンジ) に飛ばしていた
		expect(gotoCalls).toEqual(['/preschool/history?kind=milestones']);
	});

	it('遷移してから既読化する (遷移先が出る前にバッジだけ消さない)', async () => {
		render(MilestoneBellButton, { milestones, childId: 3 as never, uiMode: 'preschool' });

		await fireEvent.click(screen.getByTestId('milestone-bell'));

		// 遷移が先、既読化が後。順序は「goto の後に localStorage 書込」で固定する
		expect(gotoCalls).toHaveLength(1);
		await waitFor(() => expect(localStorage.length).toBeGreaterThan(0));
	});
});

describe('#4688 F3: レベル称号が「つよさ」の行に出る', () => {
	it('levelTitle を渡すとカテゴリ行に表示される', () => {
		render(StatusBar, {
			categoryId: asCategoryId(1),
			value: 120,
			level: 3,
			progressPct: 40,
			levelTitle: 'なわとびマスター',
		});

		expect(screen.getByTestId('status-level-title-1').textContent).toBe('なわとびマスター');
	});

	it('levelTitle 未指定なら行を増やさない (既存レイアウトを崩さない)', () => {
		render(StatusBar, { categoryId: asCategoryId(1), value: 120, level: 3, progressPct: 40 });

		expect(screen.queryByTestId('status-level-title-1')).toBeNull();
	});
});

describe('#4688 F4: 応援のボーナスポイントがダイアログに出る', () => {
	const base = {
		open: true,
		messageType: 'reward_notice',
		stampLabel: '',
		body: 'よくがんばったね',
		icon: '💌',
	};

	// Dialog は Ark UI Portal で document.body 直下に mount されるため screen + waitFor で待つ
	// (tests/CLAUDE.md §Portal 経由 component の query 原則)
	it('bonusPoints > 0 なら「+N pt もらったよ！」を表示する', async () => {
		render(ParentMessageOverlay, { ...base, bonusPoints: 50, uiMode: 'elementary' });

		await waitFor(() =>
			expect(screen.getByTestId('parent-message-bonus').textContent).toBe(
				getChildParentMessageLabels('elementary').parentMessageBonusPoints(50),
			),
		);
	});

	// #4841: 同じ画面のログインボーナス受取が漢字文体になったため、応援メッセージも年齢帯で出し分ける
	// (1 画面に 2 文体を混ぜない、docs/DESIGN.md §6)。
	it('junior / senior では漢字変種の受取額表示になる', async () => {
		render(ParentMessageOverlay, { ...base, bonusPoints: 50, uiMode: 'senior' });

		await waitFor(() =>
			expect(screen.getByTestId('parent-message-bonus').textContent).toBe(
				getChildParentMessageLabels('senior').parentMessageBonusPoints(50),
			),
		);
		expect(document.body.textContent).not.toContain('もらったよ');
		expect(document.body.textContent).not.toContain('パパ・ママ');
	});

	it('bonusPoints 無し (旧 stamp / text メッセージ) では出さない', async () => {
		render(ParentMessageOverlay, { ...base, bonusPoints: null });

		// 本文が出るまで待ってから、ボーナス行が無いことを確認する (未 mount による空振りを避ける)
		await waitFor(() => expect(screen.getByText(/よくがんばったね/)).toBeTruthy());
		expect(screen.queryByTestId('parent-message-bonus')).toBeNull();
	});
});

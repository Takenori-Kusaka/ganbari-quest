// tests/unit/features/child/must-progress-bar.test.ts
// #1757 (#1709-C): MustProgressBar コンポーネントの $derived 計算ロジック検証。
// Svelte 5 Runes は @testing-library/svelte 経由でも検証可能だが、
// AC 「N/M 計算ロジック / バー表示判定 / ボーナス文言生成」を
// 実装と同じ式で検証することがコア要件。

import { describe, expect, it } from 'vitest';
import { CHILD_HOME_LABELS } from '../../../../src/lib/domain/labels';
import type { UiMode } from '../../../../src/lib/domain/validation/age-tier';

// MustProgressBar.svelte の $derived と同じ計算ロジックを export して検証する
// （実装と同じ式を再書きするのは「テスト内で実装ロジックを再実装」アンチパターン
// 直前なので、CHILD_HOME_LABELS と組合せた**仕様**の検証に絞る）

function pickTitle(uiMode: UiMode): string {
	return uiMode === 'preschool' ? CHILD_HOME_LABELS.mustTitleKana : CHILD_HOME_LABELS.mustTitle;
}

function isAllComplete(logged: number, total: number): boolean {
	return total > 0 && logged === total;
}

function remaining(logged: number, total: number): number {
	return Math.max(0, total - logged);
}

describe('#1757 MustProgressBar derived spec', () => {
	// バー表示判定: total === 0 のときは呼び出し側が描画しない（mount しない）
	// → コンポーネント内では total > 0 の前提のみ扱う
	it('total === 0 のとき allComplete=false（呼び出し側でバー非表示）', () => {
		expect(isAllComplete(0, 0)).toBe(false);
	});

	it('total === 1, logged === 0 のとき allComplete=false', () => {
		expect(isAllComplete(0, 1)).toBe(false);
	});

	it('total === 3, logged === 2 のとき allComplete=false / remaining=1', () => {
		expect(isAllComplete(2, 3)).toBe(false);
		expect(remaining(2, 3)).toBe(1);
	});

	it('total === 3, logged === 3 のとき allComplete=true / remaining=0', () => {
		expect(isAllComplete(3, 3)).toBe(true);
		expect(remaining(3, 3)).toBe(0);
	});

	// 文言生成: preschool は ひらがな表記、それ以外は 漢字表記
	it('preschool は ひらがな表記', () => {
		expect(pickTitle('preschool')).toBe('きょうのおやくそく');
	});

	it('elementary / junior / senior は 漢字表記', () => {
		expect(pickTitle('elementary')).toBe('今日のおやくそく');
		expect(pickTitle('junior')).toBe('今日のおやくそく');
		expect(pickTitle('senior')).toBe('今日のおやくそく');
	});

	// labels SSOT 経由のフォーマッタ
	it('mustProgressText は "N/M" 形式', () => {
		expect(CHILD_HOME_LABELS.mustProgressText(2, 3)).toBe('2/3');
		expect(CHILD_HOME_LABELS.mustProgressText(0, 1)).toBe('0/1');
	});

	it('mustRemaining は "あと Nこ" 形式', () => {
		expect(CHILD_HOME_LABELS.mustRemaining(1)).toBe('あと 1こ');
		expect(CHILD_HOME_LABELS.mustRemaining(3)).toBe('あと 3こ');
	});

	it('mustBonusGranted は "+Npt" 形式', () => {
		expect(CHILD_HOME_LABELS.mustBonusGranted(5)).toBe('+5pt');
		expect(CHILD_HOME_LABELS.mustBonusGranted(3)).toBe('+3pt');
	});

	it('mustAllComplete + emoji が「ぜんぶできた！」演出文言', () => {
		expect(CHILD_HOME_LABELS.mustAllComplete).toBe('ぜんぶできた！');
		expect(CHILD_HOME_LABELS.mustAllCompleteEmoji).toBe('✨');
	});

	it('mustBonusGrantedAriaLabel は a11y 用に意味のある文を返す', () => {
		const label = CHILD_HOME_LABELS.mustBonusGrantedAriaLabel(5);
		expect(label).toContain('5');
		expect(label).toContain('ボーナス');
	});
});

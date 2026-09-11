import { describe, expect, it } from 'vitest';
import { CHILD_COPY_RESULT_LABELS } from '$lib/domain/labels';

/**
 * #4694: 「別のお子さまからコピー」の結果表示 SSOT。
 *
 * 旧実装は結果を読まずに固定文「コピーが完了しました」を出していたため、
 * 2 回押して丸ごと二重登録されても、1 件も増えなくても同じ表示だった。
 * 3 画面 (活動 / ごほうび / チェックリスト) が共有するこの関数が、
 * 「何件入って何件スキップしたか」を必ず文に含めることを固定する。
 */
describe('CHILD_COPY_RESULT_LABELS.format', () => {
	it('コピー 0 件 / スキップ 0 件 — 何も入らなかったことを言う (成功偽装しない)', () => {
		const msg = CHILD_COPY_RESULT_LABELS.format('活動', 0, 0);
		expect(msg).toContain('ありませんでした');
		expect(msg).not.toContain('コピーが完了しました');
	});

	it('コピー 0 件 / スキップあり — スキップ件数を必ず出す (2 回目の押下)', () => {
		const msg = CHILD_COPY_RESULT_LABELS.format('活動', 0, 43);
		expect(msg).toContain('43');
		expect(msg).toMatch(/すでに/);
	});

	it('コピーあり / スキップ 0 件 — コピー件数を必ず出す', () => {
		const msg = CHILD_COPY_RESULT_LABELS.format('ごほうび', 5, 0);
		expect(msg).toContain('5');
		expect(msg).toContain('ごほうび');
	});

	it('コピーあり / スキップあり — 両方の件数を出す (部分コピー)', () => {
		const msg = CHILD_COPY_RESULT_LABELS.format('チェックリスト', 2, 3);
		expect(msg).toContain('2');
		expect(msg).toContain('3');
	});

	it('resourceNoun を必ず文中に反映する (画面ごとの言い換えを SSOT で吸収)', () => {
		for (const noun of ['活動', 'ごほうび', 'チェックリスト']) {
			expect(CHILD_COPY_RESULT_LABELS.format(noun, 1, 1)).toContain(noun);
			expect(CHILD_COPY_RESULT_LABELS.format(noun, 0, 0)).toContain(noun);
		}
	});
});

describe('CHILD_COPY_RESULT_LABELS.tone', () => {
	it('0 件は success と呼ばない', () => {
		expect(CHILD_COPY_RESULT_LABELS.tone(0)).toBe('info');
	});

	it('1 件以上は success', () => {
		expect(CHILD_COPY_RESULT_LABELS.tone(1)).toBe('success');
	});
});

describe('CHILD_COPY_RESULT_LABELS.demo', () => {
	it('デモは件数 0 を実結果として出さず、demo であることを言う', () => {
		const msg = CHILD_COPY_RESULT_LABELS.demo('活動');
		expect(msg).toContain('デモ');
		expect(msg).toContain('活動');
		// 「コピーできる活動がありませんでした」= 重複判定の結果と誤読される文言を出さない
		expect(msg).not.toContain('ありませんでした');
	});
});

// tests/unit/ui/toast-stack.test.ts
// #3225 (EPIC #3217): Toast dedup + stack-cap の純粋関数検証。

import { describe, expect, it } from 'vitest';
import { MAX_TOASTS, reconcileToastStack, type ToastItem } from '../../../src/lib/ui/toast-stack';

const mk = (id: number, title: string, type: ToastItem['type'] = 'error'): ToastItem => ({
	id,
	title,
	type,
});

describe('reconcileToastStack (#3225)', () => {
	it('空スタックに追加できる', () => {
		const next = reconcileToastStack([], mk(0, 'A'));
		expect(next).toHaveLength(1);
		expect(next[0]?.title).toBe('A');
	});

	it('同一 (title/description/type) は多重表示せず current を参照同一で返す (dedup)', () => {
		const cur = [mk(0, 'エラーが発生しました')];
		const next = reconcileToastStack(cur, mk(1, 'エラーが発生しました'));
		expect(next).toBe(cur); // 参照同一 = 呼出側が dedup を検知できる
		expect(next).toHaveLength(1);
	});

	it('title が同じでも type が違えば別 Toast として追加', () => {
		const cur = [mk(0, '完了', 'success')];
		const next = reconcileToastStack(cur, mk(1, '完了', 'error'));
		expect(next).toHaveLength(2);
	});

	it('description 差異も別 Toast 扱い', () => {
		const cur: ToastItem[] = [{ id: 0, title: 'X', description: 'a', type: 'error' }];
		const next = reconcileToastStack(cur, { id: 1, title: 'X', description: 'b', type: 'error' });
		expect(next).toHaveLength(2);
	});

	it('MAX_TOASTS を超えたら最古を切り捨てる (stack-cap)', () => {
		let stack: ToastItem[] = [];
		for (let i = 0; i < MAX_TOASTS + 2; i++) {
			stack = reconcileToastStack(stack, mk(i, `エラー${i}`));
		}
		expect(stack).toHaveLength(MAX_TOASTS);
		// 最新 MAX_TOASTS 件が残り、最古 (0,1) は溢れている
		expect(stack[0]?.title).toBe(`エラー2`);
		expect(stack.at(-1)?.title).toBe(`エラー${MAX_TOASTS + 1}`);
	});

	it('max を明示指定できる', () => {
		let stack: ToastItem[] = [];
		for (let i = 0; i < 5; i++) stack = reconcileToastStack(stack, mk(i, `T${i}`), 2);
		expect(stack).toHaveLength(2);
		expect(stack.map((t) => t.title)).toEqual(['T3', 'T4']);
	});
});

// tests/unit/cron/time-budget.test.ts
// #3695: cron 30 秒 self-limiting 規約の時間予算ヘルパ (13-AWS設計書 §3.3)

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CRON_TIME_BUDGET_MS, createTimeBudget } from '$lib/server/cron/time-budget';

describe('time-budget (#3695)', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('既定予算は 20 秒 (アプリ Lambda 30 秒 − ヘッドルーム 10 秒)', () => {
		expect(CRON_TIME_BUDGET_MS).toBe(20_000);
	});

	it('予算内は exceeded() が false', () => {
		const budget = createTimeBudget();
		vi.advanceTimersByTime(CRON_TIME_BUDGET_MS - 1);
		expect(budget.exceeded()).toBe(false);
	});

	it('予算到達で exceeded() が true になる', () => {
		const budget = createTimeBudget();
		vi.advanceTimersByTime(CRON_TIME_BUDGET_MS);
		expect(budget.exceeded()).toBe(true);
	});

	it('budgetMs を指定できる + elapsedMs が経過時間を返す', () => {
		const budget = createTimeBudget(1_000);
		vi.advanceTimersByTime(500);
		expect(budget.exceeded()).toBe(false);
		expect(budget.elapsedMs()).toBe(500);
		vi.advanceTimersByTime(500);
		expect(budget.exceeded()).toBe(true);
		expect(budget.elapsedMs()).toBe(1_000);
	});
});

// tests/unit/domain/scheduler-health.test.ts
// #4721: 「scheduler が動いていない」を鮮度で捕まえる判定。
//
// scheduler コンテナが起動していなければジョブは 1 度も走らず、失敗も log も 0 件になる。
// **異常が「何も起きない」形で現れる**ので、失敗件数では検出できない。

import { describe, expect, it } from 'vitest';
import {
	evaluateSchedulerHealth,
	expectedIntervalMinutes,
} from '../../../src/lib/domain/scheduler-health';

const NOW = new Date('2026-08-20T10:00:00Z');
/** 十分前から起動している (deploy 直後の猶予を効かせない) */
const LONG_RUNNING = new Date('2026-08-01T00:00:00Z');

function job(name: string, intervalMinutes: number, lastRunAt: string | null) {
	return { name, expectedIntervalMinutes: intervalMinutes, lastRunAt };
}

describe('evaluateSchedulerHealth', () => {
	it('全ジョブが想定間隔内なら ok', () => {
		const verdict = evaluateSchedulerHealth(
			[job('daily', 1440, '2026-08-20T02:00:00Z'), job('every15', 15, '2026-08-20T09:50:00Z')],
			NOW,
			LONG_RUNNING,
		);
		expect(verdict.level).toBe('ok');
		expect(verdict.staleJobs).toEqual([]);
	});

	// **これが本命**: コンテナが上がっていなければ全ジョブが「未実行」になる。
	// 個別ジョブの失敗と区別できるよう、専用の文言で critical にする。
	it('全ジョブが一度も走っていなければ critical + コンテナ起動を示唆する', () => {
		const verdict = evaluateSchedulerHealth(
			[job('daily', 1440, null), job('every15', 15, null)],
			NOW,
			LONG_RUNNING,
		);
		expect(verdict.level).toBe('critical');
		expect(verdict.neverRanJobs).toEqual(['daily', 'every15']);
		expect(verdict.summary).toContain('--profile scheduler');
	});

	// deploy 直後は「まだ来ていないだけ」。ここを誤検知すると deploy のたびに赤くなり、
	// 本物の停止に気付けなくなる。
	it('起動直後の未実行は猶予内なら ok', () => {
		const justStarted = new Date(NOW.getTime() - 60 * 60 * 1000); // 1 時間前に起動
		const verdict = evaluateSchedulerHealth([job('daily', 1440, null)], NOW, justStarted);
		expect(verdict.level).toBe('ok');
	});

	it('一部だけ遅延なら warning、全部なら critical', () => {
		const partial = evaluateSchedulerHealth(
			[
				job('fresh', 15, '2026-08-20T09:55:00Z'),
				job('stale', 15, '2026-08-20T08:00:00Z'), // 15 分 × 3 = 45 分超過
			],
			NOW,
			LONG_RUNNING,
		);
		expect(partial.level).toBe('warning');
		expect(partial.staleJobs).toEqual(['stale']);

		const all = evaluateSchedulerHealth(
			[job('stale', 15, '2026-08-20T08:00:00Z')],
			NOW,
			LONG_RUNNING,
		);
		expect(all.level).toBe('critical');
	});

	it('壊れた timestamp は遅延として扱う (握り潰さない)', () => {
		const verdict = evaluateSchedulerHealth([job('broken', 15, 'not-a-date')], NOW, LONG_RUNNING);
		expect(verdict.staleJobs).toEqual(['broken']);
	});
});

describe('expectedIntervalMinutes', () => {
	it('registry の cron 式から想定間隔を導く', () => {
		expect(expectedIntervalMinutes('*/15 * * * *')).toBe(15); // 15 分毎
		expect(expectedIntervalMinutes('*/5 * * * *')).toBe(5); // 5 分毎
		expect(expectedIntervalMinutes('5 * * * *')).toBe(60); // 毎時 5 分
		expect(expectedIntervalMinutes('0 1 * * *')).toBe(1440); // 毎日 01:00
		expect(expectedIntervalMinutes('0 9 1 6,12 *')).toBe(1440); // 年 2 回 → 日次と同じ猶予に丸める
	});
});

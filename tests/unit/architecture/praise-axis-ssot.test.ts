// tests/unit/architecture/praise-axis-ssot.test.ts
//
// #4268 AC4 — 「褒める軸」が称賛表示側と報酬発行側の両方に適用されたことを機械検査する
// fitness function (ADR-0061 same-class-N→guard)。
//
// ## なぜ必要か
//
// #4172 は「褒める対象を『記録の量』から『月間の習慣化』へ変える」と宣言し、
// #4215 (撤去) / #4220 (代替) で**報酬の発行経路**を是正した。しかし
// **称賛の表示経路** (`value-preview-service` の `MILESTONES` と `labels.ts` の文言) に
// `records_5` / `records_10` が残り、子供の画面では旧軸で褒め続けていた。
// 両者が別ファイル・別機構にあり、片方だけ直しても機械検査が落ちなかったことが根本原因。
//
// ## 本 guard が落とすもの
//
// 1. 量ベース (累計回数) の称賛軸を足した     → [P1] / [P2]
// 2. 称賛表示側と判定側の ID 集合がずれた      → [P3]
// 3. 表示文言の無い / 余った ID を作った       → [P4]
// 4. 報酬発行側が日数 SSOT を離れて独自閾値を持った → [P5] / [P6]
//
// **この guard を外すと落ちるか**: `PRAISE_MILESTONE_IDS` に `records_5` を足して
// labels / MILESTONES を追従させると [P1] が落ちる (量ベース軸の混入を検出) 。

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	MONTHLY_HABIT_DAYS_THRESHOLD,
	PRAISE_MILESTONE_IDS,
	PRAISE_START_MILESTONE_ID,
	STREAK_MILESTONE_DAYS,
} from '../../../src/lib/domain/constants/habit-milestones';
import { MILESTONE_LABEL_IDS } from '../../../src/lib/domain/labels';
import { MILESTONES } from '../../../src/lib/server/services/value-preview-service';

const REPO_ROOT = join(import.meta.dirname, '../../..');

function readSource(relPath: string): string {
	return readFileSync(join(REPO_ROOT, relPath), 'utf-8');
}

describe('褒める軸 SSOT (#4268 AC4 / #4172 方針の両側適用)', () => {
	it('[P1] 称賛表示側に量ベース (累計回数) の軸が無い — 開始の 1 件だけが count 種', () => {
		const countAxes = MILESTONES.filter((m) => m.kind === 'count');

		expect(countAxes.map((m) => m.id)).toEqual([PRAISE_START_MILESTONE_ID]);
		// 閾値 1 = 「開始」。2 以上は「量」なので置けない (#4172)
		for (const axis of countAxes) {
			expect(axis.threshold).toBe(1);
		}
	});

	it('[P2] 日数ベース以外の軸を増やしていない — count 種は 1 件を上限とする', () => {
		const streakAxes = MILESTONES.filter((m) => m.kind === 'streak');

		expect(MILESTONES.length).toBe(streakAxes.length + 1);
		expect(streakAxes.length).toBeGreaterThan(0);
	});

	it('[P3] 判定側 (MILESTONES) の ID 集合が SSOT (PRAISE_MILESTONE_IDS) と一致する', () => {
		expect(MILESTONES.map((m) => m.id)).toEqual([...PRAISE_MILESTONE_IDS]);
	});

	it('[P4] 表示側 (labels.ts) の ID 集合が SSOT と一致する — 文言欠落も余剰も許さない', () => {
		expect([...MILESTONE_LABEL_IDS].sort()).toEqual([...PRAISE_MILESTONE_IDS].sort());
	});

	it('[P5] 称賛表示側の streak 閾値が報酬発行側と同じ日数 SSOT の部分集合である', () => {
		const streakDays = MILESTONES.filter((m) => m.kind === 'streak').map((m) => m.threshold);

		for (const days of streakDays) {
			expect(STREAK_MILESTONE_DAYS as readonly number[]).toContain(days);
		}
	});

	it('[P6] 報酬発行側 (certificate-service) が日数 SSOT を import して独自閾値を持たない', () => {
		const source = readSource('src/lib/server/services/certificate-service.ts');

		expect(source).toContain('MONTHLY_HABIT_DAYS_THRESHOLD');
		expect(source).toContain('STREAK_MILESTONE_DAYS');
		expect(source).toContain("from '$lib/domain/constants/habit-milestones'");
		// 月間習慣化は「日数」で判定する (量に戻していない)
		expect(MONTHLY_HABIT_DAYS_THRESHOLD).toBeGreaterThan(0);
	});

	it('[P7] 撤去した量ベース軸の識別子が src 配下に残っていない', () => {
		const sources = [
			'src/lib/server/services/value-preview-service.ts',
			'src/lib/domain/labels.ts',
			'src/lib/domain/constants/habit-milestones.ts',
			'src/lib/server/services/activity-log-service.ts',
			'src/lib/server/demo/demo-data.ts',
		];

		for (const rel of sources) {
			const source = readSource(rel);
			expect(source, `${rel} に量ベース軸の残存`).not.toMatch(/\brecords_(5|10)\b/);
		}
	});
});

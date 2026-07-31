// tests/unit/domain/backup-health.test.ts
// #4087 (E3 / EPIC #4119) — バックアップ状態の判定。
//
// 本 Issue の実害は「検出はできていたが 18 日間誰にも届かなかった」。したがって本テストが
// 固定すべきは **「落ちている」だけでなく「動いていない」を捕まえること**。
//
//   [BH1] 一度も成功していない = critical (2026-07-12 cutover 後に実際に 18 日続いた状態)
//   [BH2] **成功が古いだけで failure が 0 でも critical になる** — job が起動しなかったケース。
//         push 通知では原理的に捕まらない経路をここで捕まえる
//   [BH3] 26h 超は warn (1 回飛んだ)、50h 超で critical (2 回連続で飛んだ)
//   [BH4] 連続失敗 2 回以上は critical、1 回は warn (再起動時の 1 回で狼少年にしない)
//   [BH5] **通知経路が無いこと自体が warn** — 「通知できないので黙る」を無くす (#4087 AC1)
//   [BH6] 正常時は ok

import { describe, expect, it } from 'vitest';
import {
	BACKUP_CONSECUTIVE_FAILURE_CRITICAL,
	BACKUP_STALE_CRITICAL_HOURS,
	BACKUP_STALE_WARN_HOURS,
	type BackupHealthInput,
	evaluateBackupHealth,
} from '../../../src/lib/domain/backup-health';

const NOW = new Date('2026-08-01T03:30:00.000Z');

/** NOW から `hours` 時間前の ISO 文字列。 */
function hoursAgo(hours: number): string {
	return new Date(NOW.getTime() - hours * 3_600_000).toISOString();
}

/** 正常系の入力。各テストは崩したい 1 項目だけを上書きする。 */
function healthy(overrides: Partial<BackupHealthInput> = {}): BackupHealthInput {
	return {
		lastSuccessAt: hoursAgo(1),
		consecutiveFailures: 0,
		lastFailureMessage: null,
		notificationConfigured: true,
		...overrides,
	};
}

describe('#4087 バックアップ状態の判定 (evaluateBackupHealth)', () => {
	it('[BH1] 一度も成功していなければ critical', () => {
		const v = evaluateBackupHealth(healthy({ lastSuccessAt: null }), NOW);
		expect(v.level).toBe('critical');
		expect(v.reason).toBe('never-succeeded');
		expect(v.hoursSinceLastSuccess).toBeNull();
	});

	it('[BH2] 失敗 0 回でも成功が古ければ critical (job が起動しなかったケース)', () => {
		// **これが push 通知では捕まえられない経路**。job が動いていないので throw も alert も無い。
		const v = evaluateBackupHealth(
			healthy({ lastSuccessAt: hoursAgo(BACKUP_STALE_CRITICAL_HOURS + 1), consecutiveFailures: 0 }),
			NOW,
		);
		expect(v.level).toBe('critical');
		expect(v.reason).toBe('stale-critical');
		expect(v.consecutiveFailures).toBe(0);
	});

	it('[BH3] 26h 超は warn、50h 超で critical に上がる', () => {
		const warn = evaluateBackupHealth(
			healthy({ lastSuccessAt: hoursAgo(BACKUP_STALE_WARN_HOURS + 0.5) }),
			NOW,
		);
		expect(warn.level).toBe('warn');
		expect(warn.reason).toBe('stale-warn');

		// 境界の直前は ok のまま (日次 03:00 + 実行時間の揺れで毎日 warn を出さない)。
		const stillOk = evaluateBackupHealth(
			healthy({ lastSuccessAt: hoursAgo(BACKUP_STALE_WARN_HOURS - 0.5) }),
			NOW,
		);
		expect(stillOk.level).toBe('ok');
	});

	it('[BH4] 連続失敗は 1 回で warn、2 回以上で critical', () => {
		const once = evaluateBackupHealth(healthy({ consecutiveFailures: 1 }), NOW);
		expect(once.level).toBe('warn');
		expect(once.reason).toBe('last-run-failed');

		const twice = evaluateBackupHealth(
			healthy({ consecutiveFailures: BACKUP_CONSECUTIVE_FAILURE_CRITICAL }),
			NOW,
		);
		expect(twice.level).toBe('critical');
		expect(twice.reason).toBe('consecutive-failures-critical');
	});

	it('[BH5] 直近成功していても通知経路が無ければ warn (#4087 AC1)', () => {
		// 「今は取れている」と「壊れたら気づける」は別。後者が欠けていることを黙らせない。
		const v = evaluateBackupHealth(healthy({ notificationConfigured: false }), NOW);
		expect(v.level).toBe('warn');
		expect(v.reason).toBe('no-notification-channel');
		expect(v.notificationMissing).toBe(true);
	});

	it('[BH5] critical のときも notificationMissing は独立に立つ', () => {
		// level が critical でも「届かない」ことは別途伝える必要がある (対処が変わるため)。
		const v = evaluateBackupHealth(
			healthy({ lastSuccessAt: null, notificationConfigured: false }),
			NOW,
		);
		expect(v.level).toBe('critical');
		expect(v.notificationMissing).toBe(true);
	});

	it('[BH6] 直近成功 + 失敗 0 + 通知経路あり なら ok', () => {
		const v = evaluateBackupHealth(healthy(), NOW);
		expect(v.level).toBe('ok');
		expect(v.reason).toBe('healthy');
		expect(v.notificationMissing).toBe(false);
	});

	it('2026-07-31 の実害と同じ入力を critical と判定する (回帰固定)', () => {
		// 実測値: cutover (2026-07-12) 以降 pglite の成功 0 件 / webhook 未設定 / 毎晩 throw。
		const v = evaluateBackupHealth(
			{
				lastSuccessAt: null,
				consecutiveFailures: 18,
				lastFailureMessage: 'CRON_SECRET が未設定です (/api/cron/pglite-backup の認証に必要)',
				notificationConfigured: false,
			},
			NOW,
		);
		expect(v.level).toBe('critical');
		expect(v.notificationMissing).toBe(true);
	});
});

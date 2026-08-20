// tests/unit/cron/job-wiring-symmetry.test.ts
// #4721: cron の「定義はあるのに走らない / 片側だけ走る」を構造として塞ぐ。
//
// 本 Issue の 3 症状はどれも **配線の非対称**である:
//   (1) AWS は物理削除の EventBridge Rule を作っていないのに、削除予定日を告げる
//       予告メールの Rule だけが動いていた
//   (2) NUC の scheduler は `profiles: [scheduler]` gate 配下で、deploy が profile を
//       付けないため起動も更新もされない (registry にジョブを足しても NUC で走らない)
//   (3) 送信済マーカーが無い job があり、retry / 手動再実行で同じメールが 2 通届く
//
// いずれも「動いていない / 二重に動いた」ことが画面にも log にも出ないため、
// **構造 (設定ファイルの中身) を test で固定する**しかない。

import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// repo 走査 test (実行時間が入力サイズに比例する)。区分宣言は
// scripts/lib/ci/repo-scan-test-registry.mjs が SSOT。
vi.setConfig({ testTimeout: 30_000 });

import { scheduleRegistry } from '../../../src/lib/server/cron/schedule-registry';

const ROOT = path.resolve(__dirname, '../../..');

function read(rel: string): string {
	return fs.readFileSync(path.join(ROOT, rel), 'utf-8');
}

describe('[1] 削除と予告の対称性 (#4721)', () => {
	// CDK は grace-period-deletion の Rule を作らない構成 (#4304)。その事実を
	// `GRACE_PERIOD_DELETION_DISABLED` env に反映しないと、アプリ側は「削除は有効」と
	// 誤解したまま予告メールを送り続ける。
	it('[1a] CDK が CRON_JOBS の有無から GRACE_PERIOD_DELETION_DISABLED を導出する', () => {
		const computeStack = read('infra/lib/compute-stack.ts');

		expect(computeStack).toContain("scheduledCronJobNames.includes('grace-period-deletion')");
		expect(
			computeStack,
			'Rule の有無を env に反映していないと、削除が走らないのに予告だけ出る非対称が残る',
		).toContain('|| !gracePeriodJobScheduled');
	});

	// 予告メール側が同じ flag を見ることで、Rule を戻せば文面も自動的に元へ戻る。
	//
	// **挙動の固定は `deletion-warning-service.test.ts` [W9] が behavioral に行う**
	// (kill-switch 有効時に retentionOnly:true で送る / 無効時に false で送る)。
	// ここでは「退会受付メールも同じ判定を通る」ことだけを見る — こちらが最も権威ある
	// 1 通で、予告だけ直しても「削除します」という断定が残るため。
	it('[1b] 退会受付メールも同じ kill-switch 判定を通る (最も権威ある 1 通を残さない)', () => {
		const service = read('src/lib/server/services/grace-period-service.ts');
		const reservedCall = /sendDeletionReservedEmail\(\{[\s\S]*?\}\)/.exec(service)?.[0] ?? '';

		expect(reservedCall, 'sendDeletionReservedEmail の呼び出しが見つからない').not.toBe('');
		expect(
			reservedCall,
			'退会受付メールに retentionOnly を渡していない = 削除の断定が残る',
		).toContain('retentionOnly: isPhysicalDeletionDisabled()');
	});
});

describe('[2] NUC scheduler の起動・更新 (#4721)', () => {
	// `profiles: [scheduler]` gate 配下のサービスは、profile を付けない deploy では
	// build / up の対象外になる。backup profile が #2985 で同じ罠を踏んでいる。
	it('[2a] deploy-nuc が scheduler profile を build / up の両方で指定する', () => {
		const workflow = read('.github/workflows/deploy-nuc.yml');
		const buildLine = workflow
			.split('\n')
			.find((line) => line.includes('docker compose') && line.includes('build'));
		const upLine = workflow
			.split('\n')
			.find((line) => line.includes('docker compose') && line.includes('up -d'));

		expect(buildLine, 'docker compose build 行が見つからない').toBeDefined();
		expect(upLine, 'docker compose up 行が見つからない').toBeDefined();
		for (const line of [buildLine as string, upLine as string]) {
			expect(line, `profile 未指定だと scheduler が更新されない: ${line}`).toContain(
				'--profile scheduler',
			);
			// 既存の backup profile を落としていない (#2985 の再発防止)
			expect(line).toContain('--profile backup');
		}
	});

	it('[2b] docker-compose の scheduler は profile gate 配下のままである (前提の確認)', () => {
		const compose = read('docker-compose.yml');
		// この前提が崩れた (gate が外れた) なら [2a] の profile 指定は不要になる。
		// 前提そのものを test で見ておくことで、片方だけ変えたときに気付ける。
		expect(compose).toMatch(/scheduler:[\s\S]*?profiles:\s*\n\s*- scheduler/);
	});

	// 「動いていない」は沈黙と区別がつかない。最終実行時刻を残して外から読めるようにする。
	//
	// grep は「配線されているか」しか見られないので、**path 判定と AWS 除外は実挙動で固定**する
	// (grep だけだと import 行が残っているだけで通ってしまう)。
	it('[2c] cron path だけを job 名として拾う', async () => {
		const { cronJobNameFromPath } = await import('../../../src/lib/server/cron/cron-heartbeat');
		expect(cronJobNameFromPath('/api/cron/retention-cleanup')).toBe('retention-cleanup');
		expect(cronJobNameFromPath('/api/cron/export-build/')).toBe('export-build');
		// cron 以外は拾わない (全リクエストで FS を触らないための第 1 関門)
		expect(cronJobNameFromPath('/api/v1/children')).toBeUndefined();
		expect(cronJobNameFromPath('/admin/checklists')).toBeUndefined();
	});

	// Lambda の作業ディレクトリは read-only。記録を試みると毎回 EROFS を catch して warn を吐き、
	// 日 400 件超の無意味な log が本物の障害を薄める。
	it('[2d] AWS (dsql) では記録しない / NUC (pglite) では記録する', async () => {
		const { recordCronRun, readCronHeartbeat } = await import(
			'../../../src/lib/server/cron/cron-heartbeat'
		);
		const original = process.env.DATA_SOURCE;
		try {
			process.env.DATA_SOURCE = 'dsql';
			const before = JSON.stringify(readCronHeartbeat());
			recordCronRun('never-recorded-on-aws');
			expect(JSON.stringify(readCronHeartbeat())).toBe(before);

			process.env.DATA_SOURCE = 'pglite';
			recordCronRun('recorded-on-nuc');
			expect(readCronHeartbeat().lastRunAt['recorded-on-nuc']).toBeDefined();
		} finally {
			process.env.DATA_SOURCE = original;
		}
	});

	// CRON_SECRET 未設定だと /api/cron/* は無認証で、第三者が heartbeat を書き換えられる。
	// 「死んでいても ok に見える」状態を判定側が黙って信じないことを固定する。
	it('[2e] CRON_SECRET 未設定なら heartbeat を信用しない', async () => {
		const { isHeartbeatTrustworthy } = await import('../../../src/lib/server/cron/cron-heartbeat');
		const original = process.env.CRON_SECRET;
		try {
			process.env.CRON_SECRET = '';
			expect(isHeartbeatTrustworthy()).toBe(false);
			process.env.CRON_SECRET = 'secret';
			expect(isHeartbeatTrustworthy()).toBe(true);
		} finally {
			if (original === undefined) delete process.env.CRON_SECRET;
			else process.env.CRON_SECRET = original;
		}
	});

	it('[2f] 記録と判定が /api/health に配線されている', () => {
		expect(read('src/hooks.server.ts')).toContain('recordCronRun(cronJobName)');
		const health = read('src/routes/api/health/+server.ts');
		expect(health).toContain('evaluateSchedulerHealth');
		expect(health).toContain('isHeartbeatTrustworthy');
	});
});

describe('[3] 送信済マーカー (#4721)', () => {
	// dispatcher の Lambda 非同期 retry / 手動再実行で同じメールが 2 通届いていた。
	it('[3a] トライアル通知が送信済マーカーを読み書きする', () => {
		const service = read('src/lib/server/services/trial-notification-service.ts');
		expect(service).toContain('trialNotificationSentKey');
		expect(service).toContain('getSetting(sentKey');
		expect(service).toContain('setSetting(sentKey');
	});

	it('[3b] 更新リマインドが送信済マーカーを読み書きする', () => {
		const service = read('src/lib/server/services/lifecycle-email-service.ts');
		expect(service).toContain('RENEWAL_REMINDER_SENT_KEY');
		expect(service).toContain('dueRenewalMilestone');
	});
});

describe('[4] registry のジョブは両 runtime で走る (#4721)', () => {
	// NUC は `scripts/scheduler.ts` が registry を丸ごと回すため、registry に載れば走る。
	// **その前提が壊れていないこと** (一部だけ回す / 別の一覧を持つ等) を固定する。
	// 新しいジョブ (#4682 の 30 日失効 cron 等) が registry に載ったとき、
	// NUC 側で追加作業が要らないことの根拠がここにある。
	it('[4a] NUC scheduler は registry 全件を回す (独自の一覧を持たない)', () => {
		const scheduler = read('scripts/scheduler.ts');

		expect(scheduler).toContain('for (const job of scheduleRegistry)');
		// 部分集合を作る filter / slice を持っていないこと
		expect(scheduler).not.toMatch(/scheduleRegistry\s*\.\s*(filter|slice)\(/);
	});

	it('[4b] registry の各ジョブが JST / UTC 両方の cron 式を持つ', () => {
		expect(scheduleRegistry.length).toBeGreaterThan(0);
		for (const job of scheduleRegistry) {
			expect(job.cronExpression, `${job.name} に JST cron 式が無い`).toBeTruthy();
			expect(job.utcCronExpression, `${job.name} に UTC cron 式が無い`).toMatch(/^cron\(.+\)$/);
			expect(job.endpoint, `${job.name} の endpoint が /api/cron/ 配下でない`).toMatch(
				/^\/api\/cron\//,
			);
		}
	});
});

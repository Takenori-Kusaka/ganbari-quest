import { json } from '@sveltejs/kit';
import {
	type BackupHealthVerdict,
	evaluateBackupHealth,
	isBackupNotificationConfigured,
} from '$lib/domain/backup-health';
import {
	evaluateSchedulerHealth,
	expectedIntervalMinutes,
	type SchedulerHealthVerdict,
} from '$lib/domain/scheduler-health';
import { isHeartbeatTrustworthy, readCronHeartbeat } from '$lib/server/cron/cron-heartbeat';
import { scheduleRegistry } from '$lib/server/cron/schedule-registry';
import { probePg, probeSqlite, type SqliteProbeResult } from '$lib/server/db/probe';
import {
	getPgliteBackupStatus,
	type PgliteBackupStatus,
} from '$lib/server/services/pglite-backup-service';
import { APP_VERSION } from '$lib/version';
import type { RequestHandler } from './$types';

const DATA_SOURCE = process.env.DATA_SOURCE ?? 'sqlite';

// #3184 item4: liveness probe の raw DB touch は db/probe facade に集約 (route↔DB 境界 / ADR-0061)。
// #3620 AC-C5: dsql/pglite は probePg で**実 backend を実接続 probe** する (従来は sqlite 以外を
// 一律 sqlite probe しており、pg 系 backend でも空 sqlite 経由で 200 を返す偽陽性だった)。
// DynamoDB backend probe は EPIC #3424 / #3438 Phase 3 で撤去済 (prod=dsql)。
export const GET: RequestHandler = async () => {
	let schemaInfo: Partial<SqliteProbeResult> = {};
	try {
		if (DATA_SOURCE === 'dsql' || DATA_SOURCE === 'pglite') {
			schemaInfo = await probePg(DATA_SOURCE);
		} else {
			schemaInfo = await probeSqlite();
		}
	} catch (e) {
		return json(
			{
				status: 'error',
				error: e instanceof Error ? e.message : 'db_unreachable',
				dataSource: DATA_SOURCE,
			},
			{ status: 503 },
		);
	}

	// #3977: PGlite (= NUC セルフホスト) のときだけ最終バックアップ状態を載せる。
	//
	// なぜ pglite 限定か: 本フィールドは「いつからバックアップが止まっているか」を外部に
	// 教えうる運用情報である。クラウド (dsql) の /api/health は未認証で公開されているため、
	// そこに載せるのは露出範囲の判断 (PO 決裁) を要する。**pglite は NUC 内でしか成立しない
	// 分岐**なので、クラウド公開 Lambda のレスポンスは本変更で一切変わらない。
	//
	// なぜ載せるか: #3967 の backup-nuc.cjs が backend 同定のために既に /api/health を
	// 参照する。バックアップの生死も同じ口から読めると、運用側の参照点が 1 つで済む。
	// (`getPgliteBackupStatus` は #3950 で「運用調査から読む口」として export されたが
	//  caller が存在せず dead export になっていた。本配線がその caller である)
	const backup = DATA_SOURCE === 'pglite' ? await readBackupStatus() : undefined;

	// #4087: 生の status に加えて **判定結果** を載せる。
	//
	// 生値だけだと「lastSuccessAt が 3 日前」を読んだ人が毎回自分で深刻度を判断することになり、
	// 実際 2026-07-31 は 18 日間誰もその判断をしなかった (#4119)。判定は 1 箇所 (domain) に置き、
	// push (Discord) / pull (本 endpoint / admin 画面) が同じ結論を見る。
	//
	// **失敗 0 回でも成功が古ければ critical** になるのが要点 — job が起動しなかった場合、
	// job 内から投げる push 通知は原理的に発火しないため、鮮度でしか捕まえられない。
	const backupHealth: BackupHealthVerdict | undefined = backup
		? evaluateBackupHealth(
				{
					lastSuccessAt: backup.lastSuccessAt,
					consecutiveFailures: backup.consecutiveFailures,
					lastFailureMessage: backup.lastFailureMessage,
					notificationConfigured: isBackupNotificationConfigured(process.env),
					// #4162: guard 発火中は「取得は成功 / ローテーションが保留」。
					// 欠損時 0 扱いで旧 status file と後方互換。
					rotationPendingCount: backup.rotationPendingCount ?? 0,
					// #4162: 放置の長さで critical へ昇格させるために渡す (guard は自己解除しない)。
					rotationBlockedSince: backup.rotationBlockedSince ?? null,
				},
				new Date(),
			)
		: undefined;

	// #4721: NUC の scheduler が動いているかを同じ口から読めるようにする。
	//
	// **pglite (= NUC セルフホスト) のときだけ載せる。** backup 状態 (#3977) と同じ理由で、
	// クラウド (dsql) の /api/health は未認証で公開されており、そこに運用情報を足すのは
	// 露出範囲の判断を要する。AWS 側は EventBridge / cron-dispatcher の CloudWatch metric と
	// `ganbari-quest-cron-dispatcher-errors` alarm が同じ役割を果たすため、この分岐で足りる。
	//
	// **「失敗 0 回」では判定できない**のが要点。scheduler コンテナが起動していなければ
	// ジョブは 1 度も走らず失敗も log も 0 件になる — 異常が「何も起きない」形で現れるので
	// 鮮度で捕まえる。
	const scheduler = DATA_SOURCE === 'pglite' ? evaluateScheduler() : undefined;

	return json({
		status: 'ok',
		timestamp: new Date().toISOString(),
		version: APP_VERSION,
		dataSource: DATA_SOURCE,
		region: process.env.AWS_REGION ?? 'local',
		uptime: Math.floor(process.uptime()),
		schema: schemaInfo,
		...(backup ? { backup } : {}),
		...(backupHealth ? { backupHealth } : {}),
		...(scheduler ? { scheduler } : {}),
	});
};

/**
 * scheduler の生死判定。**liveness probe を落とさない** (backup 側と同じ方針)。
 *
 * 想定間隔は registry の cron 式から導出する — ジョブを足したら判定対象も自動で増える
 * (一覧を二重管理すると、増えたジョブが黙って観測対象から漏れる)。
 */
function evaluateScheduler():
	| (SchedulerHealthVerdict & { lastRunAt: Record<string, string>; trustworthy: boolean })
	| undefined {
	try {
		const heartbeat = readCronHeartbeat();
		const verdict = evaluateSchedulerHealth(
			scheduleRegistry.map((job) => ({
				name: job.name,
				expectedIntervalMinutes: expectedIntervalMinutes(job.cronExpression),
				lastRunAt: heartbeat.lastRunAt[job.name] ?? null,
			})),
			new Date(),
			new Date(Date.now() - process.uptime() * 1000),
		);

		// #4721: `CRON_SECRET` 未設定だと `/api/cron/*` が無認証になり、到達できる第三者が
		// endpoint を叩くだけで heartbeat を書き換えられる = 「死んでいても ok に見える」。
		// **判定を ok のまま返さない** — 観測装置が偽装可能なことを黙っていると、
		// この endpoint を信じた運用が成立してしまう。
		const trustworthy = isHeartbeatTrustworthy();
		if (!trustworthy) {
			return {
				...verdict,
				level: 'critical',
				summary: `${SCHEDULER_UNTRUSTED_SUMMARY}（元の判定: ${verdict.summary}）`,
				lastRunAt: heartbeat.lastRunAt,
				trustworthy,
			};
		}
		return { ...verdict, lastRunAt: heartbeat.lastRunAt, trustworthy };
	} catch {
		return undefined;
	}
}

/**
 * heartbeat を信用できないときの文言 (#4721)。
 *
 * 対処 (CRON_SECRET を配る) までを 1 行で言う。読んだ人がその場で行動できないと、
 * 「critical だが何をすればいいか分からない」= 無視される警告になる。
 */
const SCHEDULER_UNTRUSTED_SUMMARY =
	'CRON_SECRET が未設定のため /api/cron/* が無認証で、定期ジョブの実行記録を第三者が書き換えられます。この判定は信用できません（.env に CRON_SECRET を設定してください）';

/**
 * バックアップ状態の読み取り。**liveness probe を落とさない**ことを優先する。
 *
 * 状態ファイルが読めないこと自体は DB の生死と無関係なので、ここで 503 にすると
 * 「バックアップ状態ファイルが無いだけでヘルスチェックが赤」になり、監視の意味が変わる。
 */
async function readBackupStatus(): Promise<PgliteBackupStatus | undefined> {
	try {
		return await getPgliteBackupStatus();
	} catch {
		return undefined;
	}
}

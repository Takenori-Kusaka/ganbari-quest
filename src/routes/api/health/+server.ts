import { json } from '@sveltejs/kit';
import {
	type BackupHealthVerdict,
	evaluateBackupHealth,
	isBackupNotificationConfigured,
} from '$lib/domain/backup-health';
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
				},
				new Date(),
			)
		: undefined;

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
	});
};

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

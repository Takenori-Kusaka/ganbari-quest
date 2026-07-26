// src/routes/api/cron/pglite-backup/+server.ts
// #3950: NUC PGlite 本番データの日次バックアップ起動エンドポイント。
//
// PGlite は dataDir を単一プロセスで占有するため、整合したスナップショットを採れるのは DB を
// 掴んでいる **アプリプロセス自身**だけ (詳細: src/lib/server/db/pglite/backup.ts 冒頭)。
// 外部 (docker compose の backup サービス / crond) からは本エンドポイントを叩いて起動する。
//
// 認証は既存 cron 群と同じ verifyCronAuth (x-cron-secret / Authorization: Bearer)。
//
// ⚠️ scheduleRegistry には **登録しない**。tests/unit/cron/schedule-consistency.test.ts が
// 「registry の全 job が AWS cron-dispatcher の KNOWN_ENDPOINTS にも存在すること」を強制するため、
// 登録すると AWS (DATA_SOURCE=dsql) 側にも PGlite バックアップ job を生やすことになる。本 job は
// NUC 専用なので、NUC ローカルの crond (docker-compose backup profile) から起動する。
//
// 使い方:
//   POST /api/cron/pglite-backup
//   x-cron-secret: <CRON_SECRET>
//
// レスポンス:
//   200 { ok: true, filename, bytes, verification, rotated, generationsKept, durationMs }
//   401 Unauthorized
//   409 DATA_SOURCE が pglite でない (誤配線を silent success にしない)
//   500 取得 or 復元検証に失敗

import { json } from '@sveltejs/kit';
import { getEnv } from '$lib/runtime/env';
import { verifyCronAuth } from '$lib/server/auth/cron-auth';
import { logger } from '$lib/server/logger';
import { runPgliteBackup } from '$lib/server/services/pglite-backup-service';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	const authError = verifyCronAuth(request);
	if (authError) return authError;

	const dataSource = getEnv().DATA_SOURCE;
	if (dataSource !== 'pglite') {
		// 200 を返すと「バックアップが回っている」と誤認させる (#3950 の事故そのもの) ため 409。
		return json(
			{
				ok: false,
				error: `DATA_SOURCE=${dataSource} では PGlite バックアップは実行できません (pglite 専用)`,
			},
			{ status: 409 },
		);
	}

	logger.info('[pglite-backup] endpoint started', { service: 'pglite-backup' });

	try {
		const result = await runPgliteBackup();
		return json({ ok: true, ...result });
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e);
		// 失敗は必ず 500 で返す。呼び出し側 (crond) が exit code とアラートに変換する。
		return json({ ok: false, error: message }, { status: 500 });
	}
};

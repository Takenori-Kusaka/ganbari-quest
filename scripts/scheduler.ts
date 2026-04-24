// scripts/scheduler.ts
// #1375: NUC scheduler コンテナのエントリポイント
//
// docker compose --profile scheduler up で起動する専用コンテナから実行される。
// schedule-registry.ts を SSOT として参照し、node-cron で定期的に
// /api/cron/* エンドポイントへ HTTP POST する。
//
// 環境変数:
//   CRON_SECRET  — cron 認証トークン（必須）
//   APP_URL      — SvelteKit アプリの URL（デフォルト: http://app:3000）
//
// 注意: DB への直接アクセス禁止。HTTP POST 経由のみ。

import cron from 'node-cron';
import { scheduleRegistry } from '../src/lib/server/cron/schedule-registry.js';

const APP_URL = process.env.APP_URL ?? 'http://app:3000';
const CRON_SECRET = process.env.CRON_SECRET ?? '';

if (!CRON_SECRET) {
	console.error('[scheduler] CRON_SECRET is not set. Exiting.');
	process.exit(1);
}

async function callEndpoint(job: { name: string; endpoint: string }): Promise<void> {
	const url = `${APP_URL}${job.endpoint}`;
	const startedAt = new Date().toISOString();
	try {
		const res = await fetch(url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				// license-expire は Authorization: Bearer を使用。
				// retention-cleanup / trial-notifications は x-cron-secret を使用。
				// 両ヘッダを送ることで既存 endpoint の auth パターン差異を吸収する。
				Authorization: `Bearer ${CRON_SECRET}`,
				'x-cron-secret': CRON_SECRET,
			},
		});
		if (res.ok) {
			console.log(`[scheduler] ${startedAt} ${job.name}: OK (${res.status})`);
		} else {
			const body = await res.text().catch(() => '');
			console.error(`[scheduler] ${startedAt} ${job.name}: FAILED (${res.status}) ${body}`);
		}
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error(`[scheduler] ${startedAt} ${job.name}: ERROR ${message}`);
	}
}

for (const job of scheduleRegistry) {
	cron.schedule(
		job.cronExpression,
		() => {
			void callEndpoint(job);
		},
		{ timezone: 'Asia/Tokyo' },
	);
	console.log(
		`[scheduler] registered: ${job.name} (${job.cronExpression} JST) → ${APP_URL}${job.endpoint}`,
	);
}

console.log(`[scheduler] started. APP_URL=${APP_URL}, jobs=${scheduleRegistry.length}`);

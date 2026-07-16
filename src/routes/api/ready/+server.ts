import { json } from '@sveltejs/kit';
import { APP_VERSION } from '$lib/version';
import type { RequestHandler } from './$types';

// LWA (Lambda Web Adapter) readiness 専用の shallow probe (#3657)。
// 「プロセスが HTTP を受けられる」ことのみを証明し、DB には一切触れない。
// deep DB probe は /api/health が監視用途 (health-check Lambda / post-deploy smoke /
// NUC Docker healthcheck) で担う — readiness を deep probe に結合すると DB 障害時に
// LWA が never-ready → 全リクエスト 502 (アプリの fail-close 503 が外に出ない) +
// cold start init timeout ループになるため分離する (13-AWSサーバレスアーキテクチャ設計書 §3.3)。
export const GET: RequestHandler = () =>
	json({
		status: 'ok',
		version: APP_VERSION,
		uptime: Math.floor(process.uptime()),
	});

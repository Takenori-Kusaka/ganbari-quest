// tests/unit/cron/cron-trigger-marker.test.ts
// #4338: 自動 (スケジューラ) 呼び出しが「自分は自動である」と名乗る marker を、
// 実際に送っていることを 2 経路とも固定する。
//
// なぜ固定するか: 削除記録の経路 (`grace-expiry` / `manual`) は endpoint がこの marker の
// 有無だけで決める。marker を送らなくなると、定時実行がすべて「人がやった」と記録され、
// 記録が静かに嘘をつく。ヘッダの追加漏れは型でも lint でも捕まらないため test で押さえる。
//
// 対象 (自動呼び出しはこの 2 経路のみ):
//   - AWS: infra/lambda/cron-dispatcher/index.ts (EventBridge → dispatcher → Function URL)
//   - NUC: scripts/scheduler.ts                  (node-cron → APP_URL)

import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	CRON_TRIGGER_HEADER,
	CRON_TRIGGER_SCHEDULED,
} from '../../../src/lib/server/cron/cron-trigger';

const originalEnv = { ...process.env };

afterEach(() => {
	process.env = { ...originalEnv };
	vi.resetModules();
	vi.restoreAllMocks();
});

/** 受信したリクエストのヘッダとパスを記録する使い捨てサーバー。 */
async function startRecordingServer(): Promise<{
	url: string;
	received: Array<{ path: string; headers: http.IncomingHttpHeaders }>;
	close: () => Promise<void>;
}> {
	const received: Array<{ path: string; headers: http.IncomingHttpHeaders }> = [];
	const server = http.createServer((req, res) => {
		received.push({ path: req.url ?? '', headers: req.headers });
		req.resume();
		req.on('end', () => {
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ ok: true }));
		});
	});
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	const { port } = server.address() as AddressInfo;
	return {
		url: `http://127.0.0.1:${port}`,
		received,
		close: () => new Promise<void>((resolve) => server.close(() => resolve())),
	};
}

describe('#4338 AWS cron-dispatcher は自動である marker を送る', () => {
	it('grace-period-deletion の POST に marker が載る', async () => {
		const server = await startRecordingServer();
		try {
			process.env.FUNCTION_URL = server.url;
			process.env.CRON_SECRET = 'test-secret';
			const { handler } = await import('../../../infra/lambda/cron-dispatcher/index');

			const result = await handler({ cronJob: 'grace-period-deletion' });

			expect(result.statusCode).toBe(200);
			expect(server.received).toHaveLength(1);
			const req = server.received[0];
			expect(req?.path).toBe('/api/cron/grace-period-deletion');
			expect(req?.headers[CRON_TRIGGER_HEADER]).toBe(CRON_TRIGGER_SCHEDULED);
			// 認証は従来どおり (marker は認証の代わりではない)
			expect(req?.headers.authorization).toBe('Bearer test-secret');
		} finally {
			await server.close();
		}
	});
});

describe('#4338 NUC scheduler は自動である marker を送る', () => {
	beforeEach(() => {
		process.env.CRON_SECRET = 'test-secret';
		process.env.APP_URL = 'http://app.test';
	});

	it('登録された cron ジョブの実行時に marker が載る', async () => {
		const scheduled: Array<() => void> = [];
		vi.doMock('node-cron', () => ({
			default: {
				schedule: (_expr: string, fn: () => void) => {
					scheduled.push(fn);
					return { stop: () => {} };
				},
			},
		}));
		const fetchMock = vi.fn(
			async (_url: string, _init?: RequestInit) => new Response('{}', { status: 200 }),
		);
		vi.stubGlobal('fetch', fetchMock);

		await import('../../../scripts/scheduler');

		expect(scheduled.length).toBeGreaterThan(0);
		// 1 ジョブ発火させ、実際に送られるヘッダを見る
		scheduled[0]?.();
		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());

		const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
		const headers = init?.headers as Record<string, string>;
		expect(headers[CRON_TRIGGER_HEADER]).toBe(CRON_TRIGGER_SCHEDULED);
		expect(headers.Authorization).toBe('Bearer test-secret');
	});
});

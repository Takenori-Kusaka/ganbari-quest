// tests/unit/routes/api-ready.test.ts
// #3657: LWA readiness 専用 shallow probe (/api/ready) の契約テスト。
//
// 契約:
// 1. 常に 200 + status:'ok' を返す (DB 状態に依存しない — DB 障害時に LWA が
//    never-ready → 全 502 化するのを防ぐ分離の根幹)
// 2. DB 層 (probe facade / db client) を一切 import しない (shallow 保証。
//    route↔DB 境界は tests/unit/architecture/route-db-boundary.test.ts が機械強制)

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GET } from '../../../src/routes/api/ready/+server';

describe('GET /api/ready (#3657 LWA readiness shallow probe)', () => {
	it('常に 200 + status:ok を返す (DB 非依存)', async () => {
		// biome-ignore lint/suspicious/noExplicitAny: RequestEvent 全体は不要 (handler は event を参照しない)
		const res = await GET({} as any);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.status).toBe('ok');
		expect(typeof body.version).toBe('string');
		expect(typeof body.uptime).toBe('number');
	});

	it('route source が DB 層を import しない (shallow probe 保証)', () => {
		const src = readFileSync(
			resolve(__dirname, '../../../src/routes/api/ready/+server.ts'),
			'utf-8',
		);
		// deep probe 化 (probe facade / db client / drizzle への依存追加) を regression として検出する。
		// readiness を deep DB probe に再結合すると DB 障害時に LWA never-ready → 全 502 +
		// cold start init timeout ループが再発する (#3657 / 13-AWS設計書 §3.3)。
		expect(src).not.toMatch(/\$lib\/server\/db/);
		expect(src).not.toMatch(/drizzle/);
	});
});

// tests/unit/infra/health-check-lambda.test.ts
// #1257 health-check Lambda 通知品質改善 Phase 1 の AC 検証:
//   G1. Discord 通知で生 URL (`lambda-url.us-east-1.on.aws`) が描画されない
//       代わりに `App Lambda (/api/health)` 論理名が出る
//   G2. DEGRADED_THRESHOLD_MS が 8000ms になっている (env 未設定時のデフォルト)
//   G3. 二段プローブ: 1 回目 degraded + 2 回目 ok → 通知 0 件、2 回連続 degraded → 通知 1 件
// #1469 週次ハートビート:
//   G4. 週次統計が SSM に累積され、週が変わったら Discord にサマリーが送信される

import * as http from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ----------------------------------------------------------------
// SSM mock state (mutable — shared between factory closure and tests)
// vi.mock is hoisted but its factory runs lazily, so this object is
// already initialized when the factory is first called.
// ----------------------------------------------------------------

interface SsmStoreState {
	stored: string | null;
	putCalls: Array<{ Name: string; Value: string }>;
}
const ssmStore: SsmStoreState = { stored: null, putCalls: [] };

vi.mock('@aws-sdk/client-ssm', () => {
	class ParameterNotFound extends Error {
		constructor() {
			super('ParameterNotFound');
			this.name = 'ParameterNotFound';
		}
	}
	class GetParameterCommand {
		constructor(public input: { Name: string }) {}
	}
	class PutParameterCommand {
		constructor(public input: { Name: string; Value: string; [k: string]: unknown }) {}
	}
	class MockSSMClient {
		send(cmd: unknown): Promise<unknown> {
			if (cmd instanceof GetParameterCommand) {
				if (ssmStore.stored === null) {
					return Promise.reject(new ParameterNotFound());
				}
				return Promise.resolve({ Parameter: { Value: ssmStore.stored } });
			}
			if (cmd instanceof PutParameterCommand) {
				const { Name, Value } = (cmd as PutParameterCommand).input;
				ssmStore.stored = Value;
				ssmStore.putCalls.push({ Name, Value });
				return Promise.resolve({});
			}
			return Promise.resolve({});
		}
	}
	return { SSMClient: MockSSMClient, GetParameterCommand, PutParameterCommand, ParameterNotFound };
});

// ----------------------------------------------------------------
// Test harness
// ----------------------------------------------------------------

// @aws-sdk/client-ssm は Lambda ランタイム組み込み。vitest 環境ではモックで代替。
// send() は常に {} を返す → getLastNotifiedStatus() は Parameter.Value が undefined のため null を返す（初回扱い）。
// setLastNotifiedStatus() は PutParameterCommand を送信するが、テストでは no-op。
vi.mock('@aws-sdk/client-ssm', () => {
	class ParameterNotFound extends Error {
		constructor() {
			super('ParameterNotFound');
			this.name = 'ParameterNotFound';
		}
	}
	class MockSSMClient {
		send(_cmd: unknown) {
			return Promise.resolve({});
		}
	}
	class GetParameterCommand {
		constructor(public input: unknown) {}
	}
	class PutParameterCommand {
		constructor(public input: unknown) {}
	}
	return {
		SSMClient: MockSSMClient,
		GetParameterCommand,
		PutParameterCommand,
		ParameterNotFound,
	};
});

type ProbeBehavior =
	| { kind: 'ok'; delayMs?: number }
	| { kind: 'slow'; delayMs: number }
	| { kind: 'down'; statusCode: number };

interface TestHarness {
	appServer: http.Server;
	discordServer: http.Server;
	appPort: number;
	discordPort: number;
	probes: ProbeBehavior[];
	discordPosts: unknown[];
}

async function startHarness(probes: ProbeBehavior[]): Promise<TestHarness> {
	const discordPosts: unknown[] = [];

	const appServer = http.createServer((_req, res) => {
		const behavior = probes.shift() ?? { kind: 'ok' };
		const respond = () => {
			if (behavior.kind === 'down') {
				res.statusCode = behavior.statusCode;
				res.end('down');
			} else {
				res.statusCode = 200;
				res.end('{"ok":true}');
			}
		};
		const delay =
			behavior.kind === 'slow'
				? behavior.delayMs
				: behavior.kind === 'ok' && behavior.delayMs
					? behavior.delayMs
					: 0;
		if (delay > 0) setTimeout(respond, delay);
		else respond();
	});

	const discordServer = http.createServer((req, res) => {
		let body = '';
		req.on('data', (chunk: Buffer) => {
			body += chunk.toString();
		});
		req.on('end', () => {
			try {
				discordPosts.push(JSON.parse(body));
			} catch {
				discordPosts.push(body);
			}
			res.statusCode = 204;
			res.end();
		});
	});

	await new Promise<void>((resolve) => appServer.listen(0, '127.0.0.1', resolve));
	await new Promise<void>((resolve) => discordServer.listen(0, '127.0.0.1', resolve));

	const appAddr = appServer.address();
	const discordAddr = discordServer.address();
	if (typeof appAddr === 'string' || appAddr === null) throw new Error('appServer address');
	if (typeof discordAddr === 'string' || discordAddr === null)
		throw new Error('discordServer address');

	return {
		appServer,
		discordServer,
		appPort: appAddr.port,
		discordPort: discordAddr.port,
		probes,
		discordPosts,
	};
}

async function stopHarness(h: TestHarness): Promise<void> {
	await new Promise<void>((resolve) => h.appServer.close(() => resolve()));
	await new Promise<void>((resolve) => h.discordServer.close(() => resolve()));
}

async function loadHandler(h: TestHarness, envOverrides: Record<string, string> = {}) {
	vi.resetModules();
	process.env.HEALTH_CHECK_URL = `http://127.0.0.1:${h.appPort}`;
	process.env.DISCORD_WEBHOOK_HEALTH = `http://127.0.0.1:${h.discordPort}/webhook`;
	process.env.HEALTH_CHECK_RETRY_DELAY_MS = '20';
	for (const [k, v] of Object.entries(envOverrides)) {
		process.env[k] = v;
	}
	const mod = await import('../../../infra/lambda/health-check/index.ts');
	return mod.handler;
}

// Replicates getSundayWeekStart() from the lambda for test assertions
function currentWeekStart(): string {
	const d = new Date();
	d.setUTCDate(d.getUTCDate() - d.getUTCDay());
	d.setUTCHours(0, 0, 0, 0);
	return d.toISOString().slice(0, 10);
}

function prevWeekStart(): string {
	const d = new Date();
	d.setUTCDate(d.getUTCDate() - d.getUTCDay() - 7);
	d.setUTCHours(0, 0, 0, 0);
	return d.toISOString().slice(0, 10);
}

// ----------------------------------------------------------------
// Tests
// ----------------------------------------------------------------

describe('#1257 health-check Lambda Phase 1', () => {
	let harness: TestHarness | null = null;

	afterEach(async () => {
		if (harness) {
			await stopHarness(harness);
			harness = null;
		}
		delete process.env.HEALTH_CHECK_URL;
		delete process.env.DISCORD_WEBHOOK_HEALTH;
		delete process.env.HEALTH_CHECK_LABEL;
		delete process.env.DEGRADED_THRESHOLD_MS;
		delete process.env.HEALTH_CHECK_RETRY_DELAY_MS;
		delete process.env.HEALTH_CHECK_ENVIRONMENT;
		ssmStore.stored = null;
		ssmStore.putCalls = [];
	});

	describe('G1. URL masking', () => {
		it('Discord embed に生 Function URL が描画されず 論理名が表示される', async () => {
			harness = await startHarness([
				{ kind: 'down', statusCode: 500 },
				{ kind: 'down', statusCode: 500 },
			]);
			const handler = await loadHandler(harness);

			await handler();

			expect(harness.discordPosts).toHaveLength(1);
			const post = harness.discordPosts[0] as { embeds: Array<{ description: string }> };
			const embed = post.embeds[0];
			if (!embed) throw new Error('embed missing');
			expect(embed.description).not.toMatch(/lambda-url\.us-east-1\.on\.aws/);
			expect(embed.description).not.toMatch(/127\.0\.0\.1/);
			expect(embed.description).toContain('App Lambda (/api/health)');
		});

		it('HEALTH_CHECK_LABEL env で論理名を差し替えられる', async () => {
			harness = await startHarness([
				{ kind: 'down', statusCode: 500 },
				{ kind: 'down', statusCode: 500 },
			]);
			const handler = await loadHandler(harness, {
				HEALTH_CHECK_LABEL: 'Staging Lambda (/api/health)',
			});

			await handler();

			const post = harness.discordPosts[0] as { embeds: Array<{ description: string }> };
			const embed = post.embeds[0];
			if (!embed) throw new Error('embed missing');
			expect(embed.description).toContain('Staging Lambda (/api/health)');
		});

		it('embed fields に 環境 が含まれる', async () => {
			harness = await startHarness([
				{ kind: 'down', statusCode: 500 },
				{ kind: 'down', statusCode: 500 },
			]);
			const handler = await loadHandler(harness, { HEALTH_CHECK_ENVIRONMENT: 'production' });

			await handler();

			const post = harness.discordPosts[0] as {
				embeds: Array<{ fields: Array<{ name: string; value: string }> }>;
			};
			const embed = post.embeds[0];
			if (!embed) throw new Error('embed missing');
			const envField = embed.fields.find((f) => f.name === '環境');
			expect(envField?.value).toBe('production');
		});
	});

	describe('G2. DEGRADED_THRESHOLD_MS', () => {
		it('env 未設定時のデフォルトは 8000ms (7999ms は ok, 8001ms は degraded)', async () => {
			// 7999ms は ok として扱われ、二段プローブも発火せず通知なし
			harness = await startHarness([{ kind: 'ok', delayMs: 0 }]);
			const handler = await loadHandler(harness);

			const result = await handler();

			expect(result.status).toBe('normal');
			expect(harness.discordPosts).toHaveLength(0);
		});

		it('env で閾値を短縮すると degraded になる', async () => {
			// 閾値 50ms、レスポンス 150ms → degraded
			harness = await startHarness([
				{ kind: 'slow', delayMs: 150 },
				{ kind: 'slow', delayMs: 150 },
			]);
			const handler = await loadHandler(harness, { DEGRADED_THRESHOLD_MS: '50' });

			const result = await handler();

			expect(result.status).toBe('degraded');
			expect(harness.discordPosts).toHaveLength(1);
		});
	});

	describe('G3. 二段プローブ', () => {
		it('1 回目 degraded + 2 回目 ok → 通知なし (silent blip)', async () => {
			harness = await startHarness([
				{ kind: 'slow', delayMs: 150 }, // 1 回目 → degraded
				{ kind: 'ok', delayMs: 0 }, // 2 回目 → ok
			]);
			const handler = await loadHandler(harness, { DEGRADED_THRESHOLD_MS: '50' });

			const result = await handler();

			expect(result.status).toBe('normal');
			expect(harness.discordPosts).toHaveLength(0);
		});

		it('1 回目 down + 2 回目 ok → 通知なし', async () => {
			harness = await startHarness([
				{ kind: 'down', statusCode: 503 },
				{ kind: 'ok', delayMs: 0 },
			]);
			const handler = await loadHandler(harness);

			const result = await handler();

			expect(result.status).toBe('normal');
			expect(harness.discordPosts).toHaveLength(0);
		});

		it('2 回連続 degraded → 通知 1 件', async () => {
			harness = await startHarness([
				{ kind: 'slow', delayMs: 150 },
				{ kind: 'slow', delayMs: 150 },
			]);
			const handler = await loadHandler(harness, { DEGRADED_THRESHOLD_MS: '50' });

			const result = await handler();

			expect(result.status).toBe('degraded');
			expect(harness.discordPosts).toHaveLength(1);
		});

		it('2 回連続 down → 通知 1 件', async () => {
			harness = await startHarness([
				{ kind: 'down', statusCode: 500 },
				{ kind: 'down', statusCode: 500 },
			]);
			const handler = await loadHandler(harness);

			const result = await handler();

			expect(result.status).toBe('down');
			expect(harness.discordPosts).toHaveLength(1);
		});

		it('1 回目 ok → 即座に通知なし (retry しない)', async () => {
			harness = await startHarness([{ kind: 'ok', delayMs: 0 }]);
			const handler = await loadHandler(harness);

			const result = await handler();

			expect(result.status).toBe('normal');
			expect(harness.discordPosts).toHaveLength(0);
			// probes の残数が 0 (= 1 回しか消費されていない)
			expect(harness.probes).toHaveLength(0);
		});
	});

	describe('G4. 週次ハートビート (#1469)', () => {
		beforeEach(() => {
			ssmStore.stored = null;
			ssmStore.putCalls = [];
		});

		it('初回実行（SSM なし）→ 今週の統計が SSM に書き込まれる', async () => {
			harness = await startHarness([{ kind: 'ok' }]);
			const handler = await loadHandler(harness);

			await handler();

			expect(ssmStore.putCalls).toHaveLength(1);
			const written = JSON.parse(ssmStore.putCalls[0]!.Value);
			expect(written.weekStart).toBe(currentWeekStart());
			expect(written.total).toBe(1);
			expect(written.normal).toBe(1);
			expect(written.degraded).toBe(0);
			expect(written.down).toBe(0);
		});

		it('同じ週の 2 回目実行 → カウンタが累積される', async () => {
			ssmStore.stored = JSON.stringify({
				weekStart: currentWeekStart(),
				total: 5,
				normal: 4,
				degraded: 1,
				down: 0,
				totalResponseMs: 2500,
			});

			harness = await startHarness([{ kind: 'ok' }]);
			const handler = await loadHandler(harness);

			await handler();

			// 同週なのでハートビート通知なし
			expect(harness.discordPosts).toHaveLength(0);
			expect(ssmStore.putCalls).toHaveLength(1);
			const written = JSON.parse(ssmStore.putCalls[0]!.Value);
			expect(written.weekStart).toBe(currentWeekStart());
			expect(written.total).toBe(6);
			expect(written.normal).toBe(5);
			expect(written.degraded).toBe(1);
		});

		it('週が変わった → ハートビート Discord 通知 + 新週の統計を書き込む', async () => {
			const prev = prevWeekStart();
			ssmStore.stored = JSON.stringify({
				weekStart: prev,
				total: 168,
				normal: 165,
				degraded: 2,
				down: 1,
				totalResponseMs: 252_000,
			});

			harness = await startHarness([{ kind: 'ok' }]);
			const handler = await loadHandler(harness);

			await handler();

			// ハートビート通知が 1 件送信される
			expect(harness.discordPosts).toHaveLength(1);
			const post = harness.discordPosts[0] as {
				embeds: Array<{
					title: string;
					fields: Array<{ name: string; value: string }>;
				}>;
			};
			const embed = post.embeds[0];
			if (!embed) throw new Error('embed missing');
			expect(embed.title).toContain('週次サマリー');

			const totalField = embed.fields.find((f) => f.name === '実行回数');
			expect(totalField?.value).toBe('168 回');
			const abnormalField = embed.fields.find((f) => f.name === '異常（degraded + down）');
			expect(abnormalField?.value).toBe('3 回');

			// SSM に新週の統計が書き込まれる
			expect(ssmStore.putCalls).toHaveLength(1);
			const written = JSON.parse(ssmStore.putCalls[0]!.Value);
			expect(written.weekStart).toBe(currentWeekStart());
			expect(written.total).toBe(1);
		});

		it('週切替 + 障害 → ハートビート 1 件 + 障害通知 1 件 = 合計 2 件', async () => {
			const prev = prevWeekStart();
			ssmStore.stored = JSON.stringify({
				weekStart: prev,
				total: 10,
				normal: 10,
				degraded: 0,
				down: 0,
				totalResponseMs: 10_000,
			});

			harness = await startHarness([
				{ kind: 'down', statusCode: 500 },
				{ kind: 'down', statusCode: 500 },
			]);
			const handler = await loadHandler(harness);

			await handler();

			// 障害通知 + ハートビートの 2 件
			expect(harness.discordPosts).toHaveLength(2);
			// 1 件目: 障害通知
			const failPost = harness.discordPosts[0] as { embeds: Array<{ title: string }> };
			expect(failPost.embeds[0]?.title).toContain('down');
			// 2 件目: ハートビート
			const heartbeatPost = harness.discordPosts[1] as { embeds: Array<{ title: string }> };
			expect(heartbeatPost.embeds[0]?.title).toContain('週次サマリー');
		});

		it('degraded で終わった週 → 統計の degraded カウントが反映される', async () => {
			harness = await startHarness([
				{ kind: 'slow', delayMs: 150 },
				{ kind: 'slow', delayMs: 150 },
			]);
			const handler = await loadHandler(harness, { DEGRADED_THRESHOLD_MS: '50' });

			await handler();

			expect(ssmStore.putCalls).toHaveLength(1);
			const written = JSON.parse(ssmStore.putCalls[0]!.Value);
			expect(written.total).toBe(1);
			expect(written.degraded).toBe(1);
			expect(written.normal).toBe(0);
		});
	});
});

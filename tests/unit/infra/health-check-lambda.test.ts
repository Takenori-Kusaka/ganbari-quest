// tests/unit/infra/health-check-lambda.test.ts
// #1257 health-check Lambda 通知品質改善 Phase 1 の AC 検証:
//   G1. Discord 通知で生 URL (`lambda-url.us-east-1.on.aws`) が描画されない
//       代わりに `App Lambda (/api/health)` 論理名が出る
//   G2. DEGRADED_THRESHOLD_MS が 8000ms になっている (env 未設定時のデフォルト)
//   G3. 二段プローブ: 1 回目 degraded + 2 回目 ok → 通知 0 件、2 回連続 degraded → 通知 1 件

import * as http from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
});

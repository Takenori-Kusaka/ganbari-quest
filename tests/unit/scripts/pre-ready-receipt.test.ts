/**
 * tests/unit/scripts/pre-ready-receipt.test.ts (#4006)
 *
 * ## 何が壊れていたか
 *
 * PR body の「`npm run pre-ready -- --pr <num>` 全 Step PASS」チェックボックスは、
 * `pre-ready.mjs` が証跡を一切残さないため **機械検証不能な自己申告**だった。単日で
 * #3994 (存在しない PR 番号を証跡に引用) と #4002 (未実行のまま `[x]`) が発生している。
 *
 * ## 本 test が固定すること
 *
 * receipt writer 側 = 「実行の事実 (PR / HEAD SHA / 各 step の結果 / 開始終了時刻)」が
 * 落ちずに記録されること。gate 側 = 「receipt 不在 / 別 PR / 古い HEAD / ALL_PASS でない」を
 * それぞれ**別の理由として**弾くこと。1 つでも通ると、そのパターンの流用が復活する。
 *
 * `--pr` の実在確認 (AC4) は `gh pr view <N> --json number` が存在しない PR でも
 * `{"number":N}` を返す (実クエリが飛ばない) ため使えない。`gh api .../pulls/<N>` を
 * 使っていることを、exec を差し替えて固定する。
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import {
	acquireRunLock,
	buildReceipt,
	checkPrePushEnvIntegrity,
	countOtherLivePreReadyRuns,
	fetchPrHeadSha,
	formatReceiptBlock,
	PRE_READY_IN_PROGRESS_ENV,
	parseReceiptFromBody,
	RECEIPT_SCHEMA_VERSION,
	releaseRunLock,
	verifyReceipt,
	writeReceipt,
} from '../../../scripts/lib/ci/pre-ready-receipt.mjs';

const repoRoot = resolve(fileURLToPath(import.meta.url), '../../../..');
const HEAD = 'a'.repeat(40);
const OTHER_HEAD = 'b'.repeat(40);
const tempRoots: string[] = [];

function makeTempRoot(): string {
	const dir = mkdtempSync(join(tmpdir(), 'pre-ready-receipt-'));
	tempRoots.push(dir);
	return dir;
}

function makeReceipt(overrides: Record<string, unknown> = {}) {
	return {
		...buildReceipt({
			pr: 4006,
			headSha: HEAD,
			startedAt: '2026-07-28T00:00:00.000Z',
			finishedAt: '2026-07-28T00:20:00.000Z',
			status: 'ALL_PASS',
			steps: [
				{ name: 'biome', outcome: 'pass', durationMs: 1200 },
				{ name: 'lp-dimensions', outcome: 'skipped-na' },
			],
			otherLivePreReadyRuns: 0,
			prExistenceVerified: true,
		}),
		...overrides,
	};
}

afterAll(() => {
	for (const dir of tempRoots) rmSync(dir, { recursive: true, force: true });
});

describe('#4006 receipt writer — 実行の事実が落ちずに記録される (AC1)', () => {
	it('[R1] PR 番号 / HEAD SHA / 開始終了時刻 / 各 step の結果を含む', () => {
		const receipt = makeReceipt();
		expect(receipt.pr).toBe(4006);
		expect(receipt.headSha).toBe(HEAD);
		expect(receipt.startedAt).toBe('2026-07-28T00:00:00.000Z');
		expect(receipt.finishedAt).toBe('2026-07-28T00:20:00.000Z');
		expect(receipt.durationMs).toBe(20 * 60 * 1000);
		expect(receipt.status).toBe('ALL_PASS');
		// step ごとの結果 (#4018 の 4 分類 + fail) がそのまま残ること
		expect(receipt.steps).toEqual([
			{ name: 'biome', outcome: 'pass', durationMs: 1200 },
			{ name: 'lp-dimensions', outcome: 'skipped-na' },
		]);
	});

	it('[R2] 並走状況のフィールド名が実際に測ったものを表している (AC5)', () => {
		const receipt = makeReceipt();
		// os.loadavg() は Windows で常に [0,0,0] のため記録しない。記録するのは
		// 「起動時点で生きていた他の pre-ready プロセス数」であり、名前もそう読める必要がある。
		expect(receipt.runEnvironment).not.toHaveProperty('loadavg');
		expect(receipt.runEnvironment.otherLivePreReadyRuns).toBe(0);
		expect(typeof receipt.runEnvironment.cpuCount).toBe('number');
	});

	it('[R3] gitignore 下に書き出され、PR body 貼付用ブロックから読み戻せる', () => {
		const root = makeTempRoot();
		const receipt = makeReceipt();
		const path = writeReceipt(root, receipt);
		expect(path).toContain('tmp');
		expect(JSON.parse(readFileSync(path, 'utf-8'))).toEqual(receipt);
		expect(parseReceiptFromBody(`前置き\n${formatReceiptBlock(receipt)}\n後書き`)).toEqual(receipt);
	});

	it('[R3b] 先行する ```console ブロックがあっても receipt を取り出せる', () => {
		// info string を json に限定すると、先行ブロックの閉じ fence を開き fence と誤認し
		// receipt を丸ごと飲み込んで「receipt 不在」の誤検出になる (実 PR body で観測)。
		const receipt = makeReceipt();
		const body = [
			'## 検証ログ',
			'```console',
			'$ node scripts/check-pr-body.mjs --pr 4043',
			'[check-pr-body] OK',
			'```',
			'## receipt',
			formatReceiptBlock(receipt),
		].join('\n');
		expect(parseReceiptFromBody(body)).toEqual(receipt);
	});

	it('[R4] lock file で他 run 数を数え、release 後は 0 に戻る', () => {
		const root = makeTempRoot();
		const { lockPath, otherLivePreReadyRuns } = acquireRunLock(root);
		expect(otherLivePreReadyRuns).toBe(0);
		// 自 PID の lock は「他 run」に数えない / 別 PID 視点では 1 件に見える
		expect(countOtherLivePreReadyRuns(root)).toBe(0);
		expect(countOtherLivePreReadyRuns(root, process.pid + 1)).toBe(1);
		releaseRunLock(lockPath);
		expect(countOtherLivePreReadyRuns(root, process.pid + 1)).toBe(0);
	});
});

describe('#4006 gate 無効化 env の遮断 (pre-push)', () => {
	// PRE_READY_IN_PROGRESS=1 は receipt gate を無効化する。pre-ready は push しないので、
	// pre-push 実行時にこの env が立っているのは環境汚染か gate 迂回のいずれかしかない。
	// 「無視して続行」にすると ADR-0006 禁止の「env 1 つで gate を切れる」状態に戻る。
	it('[R14] env が立っていたら拒否する', () => {
		const denied = checkPrePushEnvIntegrity({ [PRE_READY_IN_PROGRESS_ENV]: '1' });
		expect(denied.ok).toBe(false);
		if (denied.ok === false) {
			expect(denied.message).toContain('unset');
			expect(denied.message).toContain('pre-ready は push しない');
		}
		// '1' 以外でも立っている時点で異常 (将来 '1' 以外を許容値に増やした瞬間に穴が開くのを防ぐ)
		expect(checkPrePushEnvIntegrity({ [PRE_READY_IN_PROGRESS_ENV]: 'true' }).ok).toBe(false);
		expect(checkPrePushEnvIntegrity({ [PRE_READY_IN_PROGRESS_ENV]: '0' }).ok).toBe(false);
	});

	it('[R15] env が無い / 空なら通す', () => {
		expect(checkPrePushEnvIntegrity({})).toEqual({ ok: true });
		expect(checkPrePushEnvIntegrity({ [PRE_READY_IN_PROGRESS_ENV]: '' })).toEqual({ ok: true });
	});

	it('[R16] .husky/pre-push が --pre-push を渡している (検査が実際に配線されている)', () => {
		// 関数だけ足して hook 側に渡し忘れると、実運用では 1 度も呼ばれない。
		const hook = readFileSync(resolve(repoRoot, '.husky/pre-push'), 'utf8');
		const invocation = hook
			.split('\n')
			.find((l) => l.includes('scripts/check-pr-body.mjs') && !l.trimStart().startsWith('#'));
		expect(invocation).toBeDefined();
		expect(invocation).toContain('--pre-push');
	});
});

describe('#4006 PR 実在確認 — gh api を使う (AC4)', () => {
	it('[R5] gh pr view --json number ではなく gh api .../pulls/<N> を叩く', () => {
		const calls: string[] = [];
		const res = fetchPrHeadSha(4006, {
			exec: (cmd) => {
				calls.push(cmd);
				return `${HEAD}\n`;
			},
		});
		expect(res).toEqual({ ok: true, sha: HEAD });
		expect(calls[0]).toContain('gh api "repos/{owner}/{repo}/pulls/4006"');
		// 存在しない PR でも {"number":N} を返してしまう経路を使っていないこと
		expect(calls[0]).not.toContain('--json number');
	});

	it('[R6] 404 は「不在確定」、それ以外の失敗と区別される', () => {
		const notFound = fetchPrHeadSha(99999, {
			exec: () => {
				throw new Error('gh: Not Found (HTTP 404)');
			},
		});
		expect(notFound).toMatchObject({ ok: false, notFound: true });
		const offline = fetchPrHeadSha(4006, {
			exec: () => {
				throw new Error('dial tcp: lookup api.github.com: no such host');
			},
		});
		expect(offline).toMatchObject({ ok: false, notFound: false });
	});
});

describe('#4006 gate — receipt の 4 つの不合格理由を区別する (AC2 / AC3)', () => {
	it('[R7] receipt 不在は missing として弾く', () => {
		const result = verifyReceipt({ receipt: null, pr: 4006, actualHeadSha: HEAD });
		expect(result).toMatchObject({ ok: false, code: 'missing' });
	});

	it('[R8] 別 PR の receipt は pr-mismatch として弾く (#3994 同型)', () => {
		const result = verifyReceipt({
			receipt: makeReceipt({ pr: 3993 }),
			pr: 4006,
			actualHeadSha: HEAD,
		});
		expect(result).toMatchObject({ ok: false, code: 'pr-mismatch' });
		if (result.ok === false) expect(result.message).toContain('3993');
	});

	it('[R9] 古い HEAD の receipt は head-mismatch として弾く (TTL の代替)', () => {
		const result = verifyReceipt({
			receipt: makeReceipt({ headSha: OTHER_HEAD }),
			pr: 4006,
			actualHeadSha: HEAD,
		});
		expect(result).toMatchObject({ ok: false, code: 'head-mismatch' });
	});

	it('[R9b] これから push する commit の receipt は通る (pre-push は push 反映前に走る)', () => {
		// pre-push hook 時点では PR 側 HEAD は 1 つ前のまま。PR 側だけを基準にすると
		// 「pre-ready 実行 → push」という正しい順序が常に落ちる。
		expect(
			verifyReceipt({
				receipt: makeReceipt({ headSha: OTHER_HEAD }),
				pr: 4006,
				actualHeadSha: HEAD,
				localHeadSha: OTHER_HEAD,
			}),
		).toEqual({ ok: true });
		// どちらとも一致しない receipt は落ちたまま
		expect(
			verifyReceipt({
				receipt: makeReceipt({ headSha: 'e'.repeat(40) }),
				pr: 4006,
				actualHeadSha: HEAD,
				localHeadSha: OTHER_HEAD,
			}),
		).toMatchObject({ ok: false, code: 'head-mismatch' });
	});

	it('[R10] PARTIAL_PASS / FAIL の receipt で「全 Step PASS」を名乗らせない', () => {
		for (const status of ['PARTIAL_PASS', 'FAIL']) {
			const result = verifyReceipt({
				receipt: makeReceipt({ status }),
				pr: 4006,
				actualHeadSha: HEAD,
			});
			expect(result).toMatchObject({ ok: false, code: 'status-not-all-pass' });
		}
	});

	it('[R11] schemaVersion 不一致は素通りさせない', () => {
		const result = verifyReceipt({
			receipt: makeReceipt({ schemaVersion: RECEIPT_SCHEMA_VERSION + 1 }),
			pr: 4006,
			actualHeadSha: HEAD,
		});
		expect(result).toMatchObject({ ok: false, code: 'schema-unsupported' });
	});

	it('[R12] 一致する receipt だけが通る', () => {
		expect(verifyReceipt({ receipt: makeReceipt(), pr: 4006, actualHeadSha: HEAD })).toEqual({
			ok: true,
		});
	});

	it('[R13] HEAD SHA が取れない環境でも不在 / 別 PR は検出し続ける (fail-open にしない)', () => {
		expect(verifyReceipt({ receipt: null, pr: 4006, actualHeadSha: null })).toMatchObject({
			ok: false,
			code: 'missing',
		});
		expect(
			verifyReceipt({ receipt: makeReceipt({ pr: 1 }), pr: 4006, actualHeadSha: null }),
		).toMatchObject({ ok: false, code: 'pr-mismatch' });
	});
});

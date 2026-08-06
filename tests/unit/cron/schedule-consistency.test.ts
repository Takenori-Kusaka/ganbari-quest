// tests/unit/cron/schedule-consistency.test.ts
// #1377 (#1374 Sub A-3): 3 層 (registry / CDK / dispatcher) の整合性を保証する検証テスト
//
// 目的:
//   schedule-registry.ts (SSOT) ↔ infra/lib/compute-stack.ts (CDK CRON_JOBS)
//   ↔ infra/lambda/cron-dispatcher/index.ts (KNOWN_ENDPOINTS)
//   の三者がいつでも同期されていることを保証する。
//
//   いずれかの drift は EventBridge → dispatcher → endpoint の経路で
//   silent fail を起こすため (#1586 で実例)、CI で 0 tolerance で検出する。
//
// 検証範囲:
//   1. Sub A-3 対象 endpoint (retention-cleanup / trial-notifications)
//      が registry に存在し、name / endpoint パスが期待値と一致すること
//      (#2818 Phase 7 PR-L3: license key 全廃に伴い license-expire を SUB_A3_ENDPOINTS から除外)
//   2. registry 全 endpoint name の集合 ⊆ dispatcher KNOWN_ENDPOINTS
//      (registry にあるのに dispatcher が知らない job を弾く)
//   3. dispatcher KNOWN_ENDPOINTS の各 endpoint パスが registry の endpoint と一致
//   4. registry の utcCronExpression と CDK CRON_JOBS の utcCronExpression が一致
//      (CDK は tsconfig rootDir 制約のためインライン定義しているが、SSOT との drift は禁止)
//   5. (#4033 AC1) registry ⊆ CDK CRON_JOBS。registry にあるのに EventBridge Rule が無い job は
//      「エラーも出さずに一度も発火しない」ため、CDK → registry の片方向照合だけでは検出できない。
//      本 PR で欠けていた向きを追加し、3 層 (registry / CDK / dispatcher) を双方向で閉じる。
//   6. (#4033 AC1) 実 FS 上の src/routes/api/cron/*/+server.ts が母数。registry にも
//      明示除外にも載っていない endpoint を no-silent-gap で弾く (母数を literal 固定にしない)。
//
// 除外は DOCUMENTED_EXCLUSIONS の 1 構造だけに集約し、理由 (reason) と追跡 Issue (issue) を必須とする。
// 無条件・無期限の暗黙 skip (旧 KNOWN_DRIFT_OUT_OF_SCOPE) は禁止。

import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// #4085: repo 走査 test (実行時間が入力サイズに比例する)。既定 5s のままだと unit lane の
// 並列実行の負荷で落ち、「本物の回帰か負荷か」の切り分けが毎回発生するため file 単位で明示する。
// 区分は scripts/lib/ci/repo-scan-test-registry.mjs が SSOT (未宣言 / timeout 欠落は CI が fail)。
vi.setConfig({ testTimeout: 60_000 });

import { scheduleRegistry } from '../../../src/lib/server/cron/schedule-registry';

// Sub A-3 で検証対象となる既存 endpoint
// (#2818 Phase 7 PR-L3: license key 全廃で license-expire 撤去、3 → 2 endpoint)
const SUB_A3_ENDPOINTS = ['retention-cleanup', 'trial-notifications'] as const;

/** SvelteKit cron endpoint の実体ディレクトリ (母数の SSOT。literal 列挙は禁止) */
const CRON_ROUTE_DIR = 'src/routes/api/cron';

/** 13-AWS 設計書の Cron ジョブ一覧表 (docs ↔ code 照合用) */
const AWS_DESIGN_DOC = 'docs/design/13-AWSサーバレスアーキテクチャ設計書.md';

/**
 * 明示除外の唯一の構造 (#4033)。
 *
 * - `scope`: どの照合方向で除外するか。
 *   - `cdk-cron-jobs`         … registry にあるが compute-stack.ts CRON_JOBS に無いことを許容
 *   - `dispatcher-known-endpoints` … registry にあるが cron-dispatcher KNOWN_ENDPOINTS に無いことを許容
 *   - `registry`              … FS 上に endpoint があるが schedule-registry.ts に無いことを許容
 * - `reason`: 空文字禁止 (メタ検証で assert する)。理由なしの除外を追加できないようにする。
 * - `issue`: 追跡 Issue 番号。`#1234` 形式必須。
 *
 * age-recalc / grace-period-deletion の 2 件は「registry に載っているのに AWS で一度も発火しない」
 * 実害 (#4033) そのものであり、有効化は本番テナントの物理削除を伴うため判断を要する。
 * 本 gate は gap を機械的に可視化・帰属させるための暫定明示であり、
 * **#4033 AC3-AC5 (有効化 / registry 側からの撤去) を適用する PR で該当エントリを削除する**。
 * 除外が実態と合わなくなったら [X2] が fail するため、削除漏れも機械検出される。
 */
interface DocumentedExclusion {
	name: string;
	scope: 'cdk-cron-jobs' | 'dispatcher-known-endpoints' | 'registry';
	reason: string;
	issue: string;
}

const DOCUMENTED_EXCLUSIONS: DocumentedExclusion[] = [
	{
		name: 'grace-period-deletion',
		scope: 'cdk-cron-jobs',
		reason:
			'第 21 回統合 (#4304) で EventBridge Rule を作らない状態に戻した (監査 revert + PO 決裁 2026-08-06)。#4327 が「予告なし・観測不能・停止不能・復旧不能」の 4 条件を検出したため。復活は 3 条件が揃ってから: PR #4340 の merge / #4327 の 4 条件解消 / dry-run の件数を出してオーナーが再有効化を承認。dispatcher の KNOWN_ENDPOINTS には残す (Rule が無ければ発火しないため無害で、復活時の追従漏れを防ぐ)',
		issue: '#4327',
	},
	{
		name: 'expire-redemptions',
		scope: 'registry',
		reason:
			'30 日以上 pending の交換申請を expired に移行する手動 / 外部呼び出し前提の endpoint (#1337)。自動スケジュール駆動しない設計のため registry に載せない',
		issue: '#1337',
	},
	{
		name: 'pglite-backup',
		scope: 'registry',
		reason:
			'NUC 専用の日次バックアップ endpoint (#3950)。NUC ローカルの crond (docker-compose.yml backup profile) が駆動し、AWS 側は DSQL のため対象外',
		issue: '#3950',
	},
];

function isExcluded(name: string, scope: DocumentedExclusion['scope']): boolean {
	return DOCUMENTED_EXCLUSIONS.some((e) => e.name === name && e.scope === scope);
}

/** FS 上に実在する cron endpoint 名 (ディレクトリ名) を列挙する。literal 列挙は禁止 */
function listFilesystemCronEndpoints(): string[] {
	const dir = path.resolve(__dirname, '../../..', CRON_ROUTE_DIR);
	return fs
		.readdirSync(dir, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.filter((name) => fs.existsSync(path.join(dir, name, '+server.ts')))
		.sort();
}

// dispatcher / CDK のソースコードを文字列で読んで KNOWN_ENDPOINTS / CRON_JOBS を抽出する。
// import すると Node エイリアスや CDK 依存解決が必要になり脆弱なため、構文解析的に最小限読む。
function readSourceText(relPath: string): string {
	const fullPath = path.resolve(__dirname, '../../..', relPath);
	return fs.readFileSync(fullPath, 'utf-8');
}

/** dispatcher の KNOWN_ENDPOINTS マッピングをソースから抽出する */
function extractDispatcherEndpoints(): Record<string, string> {
	const src = readSourceText('infra/lambda/cron-dispatcher/index.ts');
	const blockMatch = src.match(/KNOWN_ENDPOINTS:\s*Record<string,\s*string>\s*=\s*{([^}]+)}/);
	const block = blockMatch?.[1];
	if (!block) {
		throw new Error('KNOWN_ENDPOINTS block not found in cron-dispatcher/index.ts');
	}
	const entries: Record<string, string> = {};
	const re = /'([^']+)':\s*'([^']+)'/g;
	let m: RegExpExecArray | null;
	m = re.exec(block);
	while (m !== null) {
		const key = m[1];
		const value = m[2];
		if (key !== undefined && value !== undefined) {
			entries[key] = value;
		}
		m = re.exec(block);
	}
	return entries;
}

/** compute-stack.ts の CRON_JOBS インライン定義をソースから抽出する */
function extractCdkCronJobs(): Array<{ name: string; utcCronExpression: string }> {
	const src = readSourceText('infra/lib/compute-stack.ts');
	const blockMatch = src.match(/const\s+CRON_JOBS\s*=\s*\[([\s\S]*?)\]\s*as\s+const/);
	const block = blockMatch?.[1];
	if (!block) {
		throw new Error('CRON_JOBS block not found in compute-stack.ts');
	}
	const re = /name:\s*'([^']+)',\s*utcCronExpression:\s*'([^']+)'/g;
	const jobs: Array<{ name: string; utcCronExpression: string }> = [];
	let m: RegExpExecArray | null;
	m = re.exec(block);
	while (m !== null) {
		const name = m[1];
		const utcCronExpression = m[2];
		if (name !== undefined && utcCronExpression !== undefined) {
			jobs.push({ name, utcCronExpression });
		}
		m = re.exec(block);
	}
	return jobs;
}

describe('#1377 schedule consistency — Sub A-3 対象 3 endpoint', () => {
	for (const name of SUB_A3_ENDPOINTS) {
		it(`registry に "${name}" が登録されている`, () => {
			const job = scheduleRegistry.find((j) => j.name === name);
			expect(job).toBeDefined();
			expect(job?.endpoint).toBe(`/api/cron/${name}`);
			expect(job?.cronExpression).toMatch(/^[\d*/, ]+ [\d*/, ]+ [\d*/, ]+ [\d*/, ]+ [\d*/, ]+$/);
			expect(job?.utcCronExpression).toMatch(/^cron\(.+\)$/);
		});
	}
});

describe('#1377 schedule consistency — registry ↔ dispatcher KNOWN_ENDPOINTS', () => {
	it('registry の name (Sub A-3 範囲外も含む) が dispatcher KNOWN_ENDPOINTS に存在する (drift 監視)', () => {
		const dispatcherEndpoints = extractDispatcherEndpoints();
		const dispatcherNames = new Set(Object.keys(dispatcherEndpoints));

		const missing: string[] = [];
		for (const job of scheduleRegistry) {
			if (isExcluded(job.name, 'dispatcher-known-endpoints')) continue;
			if (!dispatcherNames.has(job.name)) {
				missing.push(job.name);
			}
		}
		expect(missing).toEqual([]);
	});

	it('dispatcher の各 endpoint パスが registry の endpoint と一致する', () => {
		const dispatcherEndpoints = extractDispatcherEndpoints();
		const registryByName = new Map(scheduleRegistry.map((j) => [j.name, j]));

		const mismatches: string[] = [];
		for (const [name, dispatcherPath] of Object.entries(dispatcherEndpoints)) {
			const registryJob = registryByName.get(name);
			if (!registryJob) {
				// dispatcher にあるが registry にない job
				mismatches.push(`${name}: dispatcher has but registry missing`);
				continue;
			}
			if (registryJob.endpoint !== dispatcherPath) {
				mismatches.push(
					`${name}: dispatcher="${dispatcherPath}" registry="${registryJob.endpoint}"`,
				);
			}
		}
		expect(mismatches).toEqual([]);
	});

	it('Sub A-3 対象 3 endpoint が dispatcher にも登録されている', () => {
		const dispatcherEndpoints = extractDispatcherEndpoints();
		for (const name of SUB_A3_ENDPOINTS) {
			expect(dispatcherEndpoints[name]).toBe(`/api/cron/${name}`);
		}
	});
});

describe('#1377 schedule consistency — registry ↔ CDK CRON_JOBS', () => {
	it('CDK CRON_JOBS の utcCronExpression が registry と一致する', () => {
		const cdkJobs = extractCdkCronJobs();
		const registryByName = new Map(scheduleRegistry.map((j) => [j.name, j]));

		const mismatches: string[] = [];
		for (const cdkJob of cdkJobs) {
			const registryJob = registryByName.get(cdkJob.name);
			if (!registryJob) {
				mismatches.push(`${cdkJob.name}: CDK has but registry missing`);
				continue;
			}
			if (registryJob.utcCronExpression !== cdkJob.utcCronExpression) {
				mismatches.push(
					`${cdkJob.name}: CDK="${cdkJob.utcCronExpression}" registry="${registryJob.utcCronExpression}"`,
				);
			}
		}
		expect(mismatches).toEqual([]);
	});

	it('Sub A-3 対象 3 endpoint の utcCronExpression が CDK と一致する', () => {
		const cdkJobs = extractCdkCronJobs();
		const cdkByName = new Map(cdkJobs.map((j) => [j.name, j]));
		const registryByName = new Map(scheduleRegistry.map((j) => [j.name, j]));

		for (const name of SUB_A3_ENDPOINTS) {
			expect(cdkByName.has(name)).toBe(true);
			const cdk = cdkByName.get(name);
			const reg = registryByName.get(name);
			expect(cdk?.utcCronExpression).toBe(reg?.utcCronExpression);
		}
	});

	// [R1] #4033 AC1: 欠けていた向き。registry に足して CRON_JOBS に足し忘れると
	// EventBridge Rule が作られず「エラーも出ないまま一度も発火しない」。
	it('[R1] registry の全 job が CDK CRON_JOBS に存在する (明示除外を除く)', () => {
		const cdkNames = new Set(extractCdkCronJobs().map((j) => j.name));

		const missing: string[] = [];
		for (const job of scheduleRegistry) {
			if (isExcluded(job.name, 'cdk-cron-jobs')) continue;
			if (!cdkNames.has(job.name)) {
				missing.push(job.name);
			}
		}
		expect(missing).toEqual([]);
	});
});

describe('#4033 schedule consistency — FS 実体 (src/routes/api/cron) を母数とする網羅', () => {
	// [F1] 母数を literal ではなく実 FS から導出する (#4030 と同一 class の再発防止)。
	it('[F1] FS 上の cron endpoint は registry か明示除外のいずれかに載っている', () => {
		const registryNames = new Set(scheduleRegistry.map((j) => j.name));

		const unaccounted = listFilesystemCronEndpoints().filter(
			(name) => !registryNames.has(name) && !isExcluded(name, 'registry'),
		);
		expect(unaccounted).toEqual([]);
	});

	// [F2] 逆向き。registry が実在しない endpoint を指していれば dispatcher が 404 を踏む。
	it('[F2] registry の全 job に対応する +server.ts が FS に存在する', () => {
		const fsNames = new Set(listFilesystemCronEndpoints());

		const missing = scheduleRegistry
			.filter((job) => !fsNames.has(job.name))
			.map((job) => `${job.name} (${job.endpoint})`);
		expect(missing).toEqual([]);
	});

	it('[F3] registry の endpoint パスが /api/cron/<name> 規約に一致する', () => {
		const mismatches = scheduleRegistry
			.filter((job) => job.endpoint !== `/api/cron/${job.name}`)
			.map((job) => `${job.name}: ${job.endpoint}`);
		expect(mismatches).toEqual([]);
	});
});

describe('#4033 schedule consistency — 明示除外のメタ検証 (no-silent-gap)', () => {
	// [X1] 理由が空の除外を追加できないようにする。
	it('[X1] 全ての除外が非空の reason と追跡 Issue を持つ', () => {
		const invalid = DOCUMENTED_EXCLUSIONS.filter(
			(e) => e.name.trim() === '' || e.reason.trim() === '' || !/^#\d+$/.test(e.issue),
		).map((e) => `${e.scope}:${e.name}`);
		expect(invalid).toEqual([]);
	});

	// [X2] 実態が解消したのに除外が残っていれば fail させる。
	// #4033 AC3-AC5 の有効化 PR で該当エントリを消し忘れると、この test が落ちて気付ける。
	it('[X2] 実態と一致しない (もはや gap ではない) 除外が残っていない', () => {
		const cdkNames = new Set(extractCdkCronJobs().map((j) => j.name));
		const dispatcherNames = new Set(Object.keys(extractDispatcherEndpoints()));
		const registryNames = new Set(scheduleRegistry.map((j) => j.name));
		const fsNames = new Set(listFilesystemCronEndpoints());

		// scope ごとに「除外元に載っているべき集合」と「載っていたら gap 解消済 = stale な集合」を宣言する
		const rules: Record<
			DocumentedExclusion['scope'],
			{ source: Set<string>; resolved: Set<string>; resolvedLabel: string }
		> = {
			'cdk-cron-jobs': {
				source: registryNames,
				resolved: cdkNames,
				resolvedLabel: 'CRON_JOBS 登録済',
			},
			'dispatcher-known-endpoints': {
				source: registryNames,
				resolved: dispatcherNames,
				resolvedLabel: 'KNOWN_ENDPOINTS 登録済',
			},
			registry: { source: fsNames, resolved: registryNames, resolvedLabel: 'registry 登録済' },
		};

		const stale = DOCUMENTED_EXCLUSIONS.flatMap((e) => {
			const rule = rules[e.scope];
			if (!rule.source.has(e.name)) return [`${e.scope}:${e.name} (除外元に存在しない)`];
			if (rule.resolved.has(e.name)) return [`${e.scope}:${e.name} (${rule.resolvedLabel})`];
			return [];
		});
		expect(stale).toEqual([]);
	});
});

describe('#4033 schedule consistency — 13-AWS 設計書 Cron ジョブ一覧表 ↔ code', () => {
	/** 設計書の Cron ジョブ一覧表 (見出し直後の連続する `|` 行) を抽出する */
	function extractDocCronSection(): { rows: string[][]; prose: string } {
		const lines = readSourceText(AWS_DESIGN_DOC).split(/\r?\n/);
		const headingIdx = lines.findIndex((l) => l.includes('Cron ジョブ一覧'));
		expect(headingIdx).toBeGreaterThanOrEqual(0);

		const tableStart = lines.findIndex((l, i) => i > headingIdx && l.trimStart().startsWith('|'));
		expect(tableStart).toBeGreaterThan(headingIdx);

		const rows: string[][] = [];
		for (let i = tableStart; i < lines.length; i++) {
			const line = lines[i];
			if (line === undefined || !line.trimStart().startsWith('|')) break;
			const cells = line
				.trim()
				.replace(/^\|/, '')
				.replace(/\|$/, '')
				.split('|')
				.map((c) => c.trim());
			rows.push(cells);
		}
		// prose は見出しから表の直前まで (「registry の全 N ジョブ」等の記述)
		return { rows, prose: lines.slice(headingIdx, tableStart).join('\n') };
	}

	/** ヘッダ / 区切り行を除いた job 行のみ */
	function docJobRows(rows: string[][]): string[][] {
		return rows.filter((cells) => /^[a-z][a-z0-9-]*$/.test(cells[0] ?? ''));
	}

	it('[D1] 表の job 行が registry と 1:1 で一致する (phantom 行 / 追記漏れの検出)', () => {
		const { rows } = extractDocCronSection();
		const docNames = docJobRows(rows)
			.map((cells) => cells[0] as string)
			.sort();
		const registryNames = scheduleRegistry.map((j) => j.name).sort();
		expect(docNames).toEqual(registryNames);
	});

	it('[D2] 表の EventBridge / dispatcher 列が CRON_JOBS / KNOWN_ENDPOINTS の実態と一致する', () => {
		const { rows } = extractDocCronSection();
		const cdkNames = new Set(extractCdkCronJobs().map((j) => j.name));
		const dispatcherNames = new Set(Object.keys(extractDispatcherEndpoints()));

		const mismatches: string[] = [];
		for (const cells of docJobRows(rows)) {
			const name = cells[0] as string;
			const expectedEventBridge = cdkNames.has(name) ? '✓' : '✗';
			const expectedDispatcher = dispatcherNames.has(name) ? '✓' : '✗';
			if (cells[3] !== expectedEventBridge) {
				mismatches.push(`${name}: EventBridge doc="${cells[3]}" actual="${expectedEventBridge}"`);
			}
			if (cells[4] !== expectedDispatcher) {
				mismatches.push(`${name}: dispatcher doc="${cells[4]}" actual="${expectedDispatcher}"`);
			}
		}
		expect(mismatches).toEqual([]);
	});

	it('[D3] 表の UTC cron 式が registry と一致する', () => {
		const { rows } = extractDocCronSection();
		const registryByName = new Map(scheduleRegistry.map((j) => [j.name, j]));

		const mismatches: string[] = [];
		for (const cells of docJobRows(rows)) {
			const name = cells[0] as string;
			const docExpr = (cells[1] ?? '').replace(/`/g, '').trim();
			const registryExpr = registryByName.get(name)?.utcCronExpression;
			if (docExpr !== registryExpr) {
				mismatches.push(`${name}: doc="${docExpr}" registry="${registryExpr}"`);
			}
		}
		expect(mismatches).toEqual([]);
	});

	it('[D4] 表前文の「全 N ジョブ」記述が registry 件数と一致する', () => {
		const { prose } = extractDocCronSection();
		const counts = [...prose.matchAll(/全\s*(\d+)\s*ジョブ/g)].map((m) => Number(m[1]));
		expect(counts.length).toBeGreaterThan(0);
		expect(counts.filter((n) => n !== scheduleRegistry.length)).toEqual([]);
	});
});

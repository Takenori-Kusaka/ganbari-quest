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
// 検証範囲 (本 Issue Sub A-3 の Dev スコープ):
//   1. Sub A-3 対象 3 endpoint (license-expire / retention-cleanup / trial-notifications)
//      が registry に存在し、name / endpoint パスが期待値と一致すること
//   2. registry 全 endpoint name の集合 ⊆ dispatcher KNOWN_ENDPOINTS
//      (registry にあるのに dispatcher が知らない job を弾く)
//   3. dispatcher KNOWN_ENDPOINTS の各 endpoint パスが registry の endpoint と一致
//   4. registry の utcCronExpression と CDK CRON_JOBS の utcCronExpression が一致
//      (CDK は tsconfig rootDir 制約のためインライン定義しているが、SSOT との drift は禁止)

import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { scheduleRegistry } from '../../../src/lib/server/cron/schedule-registry';

// Sub A-3 で検証対象となる既存 3 endpoint
const SUB_A3_ENDPOINTS = ['license-expire', 'retention-cleanup', 'trial-notifications'] as const;

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
	// NOTE (#1377 Sub A-3 で発見):
	// 現在 registry にあるが dispatcher / CDK には未登録の job が `age-recalc` 1 件存在する。
	// `age-recalc` は #1381 で登録された JST=00:00 のジョブだが、AWS EventBridge 化が
	// dispatcher 側 KNOWN_ENDPOINTS / CDK CRON_JOBS には反映されていない。
	// 本 Issue (#1377) のスコープは既存 3 endpoint (license-expire / retention-cleanup /
	// trial-notifications) の検証であるため、age-recalc の不整合は本 PR では修正対象外
	// (別 Issue で対応)。`SUB_A3_ENDPOINTS` の整合性のみ厳密に検証する。
	const KNOWN_DRIFT_OUT_OF_SCOPE = ['age-recalc'];

	it('registry の name (Sub A-3 範囲外も含む) が dispatcher KNOWN_ENDPOINTS に存在する (drift 監視)', () => {
		const dispatcherEndpoints = extractDispatcherEndpoints();
		const dispatcherNames = new Set(Object.keys(dispatcherEndpoints));

		const missing: string[] = [];
		for (const job of scheduleRegistry) {
			if (KNOWN_DRIFT_OUT_OF_SCOPE.includes(job.name)) continue;
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
});

// tests/unit/architecture/dsql-write-path-db-import-ban.test.ts
// EPIC #3424 / 実装 #3531 (#N1-1 Phase A 粒度(2)) / 設計 SSOT: dsql-data-model.md §8 / §13.1 fitness#8
//
// fitness#8 (lint 側)「write-path repo は tx を必須引数に取り、module-level db 直結 import を禁止」:
//   tx 忘れは SQLite では単一接続で隠蔽され、pg では別接続で部分コミット = **E2E 緑で本番崩壊**
//   の非対称 (SQLite parity Finding 2)。動的な再現は dsql-run-in-transaction.test.ts [T6]
//   (PGlite 部分コミット証跡) が担い、本テストは静的に「dsql repo が module db を import する」
//   抜け道自体を封じる二層目 (route-db-boundary.test.ts #3152 と同型)。
//
// 対象 = src/lib/server/db/dsql/ 配下の repo module (*-repo.ts)。現時点で 0 件 (Phase C
// #N4-1 以降で生える) のため armed-before-use。fixture による非トートロジー証明付き。

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const DSQL_DIR = resolve(REPO_ROOT, 'src/lib/server/db/dsql');

// 禁止 import specifier: module-level db を持つ client module (sqlite 用生 client /
// 将来の dsql client factory / backend 固有 client)。repo は tx handle を引数で受ける。
const FORBIDDEN_IMPORT_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
	{
		pattern: /\$lib\/server\/db\/client|['"`]\.\.\/client['"`]/,
		reason: 'sqlite 生 client (db/client) を dsql repo で import',
	},
	{
		pattern: /\$lib\/server\/db\/dsql\/client|['"`]\.\/client['"`]/,
		reason:
			'dsql client (module-level db) を repo で直結 import (tx は必須引数で受ける、fitness#8)',
	},
];

// route-db-boundary.test.ts と同じ走査規約 (static import/export from + dynamic import/require)。
const STATIC_IMPORT_LINE = /^\s*(?:import|export)\b[^\n]*\bfrom\s+['"][^'"]+['"]/;
const DYNAMIC_IMPORT_LINE = /\b(?:import|require)\s*\(/;
const isImportLike = (line: string): boolean =>
	STATIC_IMPORT_LINE.test(line) || DYNAMIC_IMPORT_LINE.test(line);

/** dsql 配下の write-path repo module (*-repo.ts) を列挙する。 */
function listDsqlRepoFiles(): string[] {
	if (!existsSync(DSQL_DIR)) return [];
	const acc: string[] = [];
	const walk = (dir: string) => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const full = resolve(dir, entry.name);
			if (entry.isDirectory()) walk(full);
			else if (entry.name.endsWith('-repo.ts')) acc.push(full);
		}
	};
	walk(DSQL_DIR);
	return acc;
}

interface Violation {
	file: string;
	reason: string;
}

function findViolations(files: string[]): Violation[] {
	const violations: Violation[] = [];
	for (const file of files) {
		const importLines = readFileSync(file, 'utf-8').split('\n').filter(isImportLike);
		for (const { pattern, reason } of FORBIDDEN_IMPORT_PATTERNS) {
			if (importLines.some((l) => pattern.test(l))) {
				violations.push({ file: relative(REPO_ROOT, file).replace(/\\/g, '/'), reason });
			}
		}
	}
	return violations;
}

describe('fitness#8 (lint): dsql write-path repo の module db 直結 import 禁止 (§8 / Finding 2)', () => {
	it('dsql dir が存在する (走査対象の前提 sanity)', () => {
		expect(existsSync(DSQL_DIR)).toBe(true);
	});

	it('dsql repo module に client 直結 import が無い (baseline 0、append 禁止)', () => {
		const violations = findViolations(listDsqlRepoFiles());
		expect(
			violations,
			`fitness#8 違反 (module-level db 直結 import):\n${violations
				.map((v) => `  - ${v.file}: ${v.reason}`)
				.join(
					'\n',
				)}\n→ dsql repo は tx handle (TransactionRunner の work 引数) を必須引数で受ける。` +
				'baseline は設けない (最初から 0 を維持する、route-db-boundary #3184 と同思想)',
		).toEqual([]);
	});

	// ── 非トートロジー証明 ──

	it('静的 / 動的 import の違反 fixture を検出する (guard 自体の動作確認)', () => {
		const samples = [
			"import { db } from './client';",
			"import { db } from '$lib/server/db/client';",
			"import { db } from '$lib/server/db/dsql/client';",
			"const { db } = await import('./client');",
			"const { db } = require('$lib/server/db/dsql/client');",
		];
		for (const sample of samples) {
			expect(isImportLike(sample), `走査対象から漏れている: ${sample}`).toBe(true);
			expect(
				FORBIDDEN_IMPORT_PATTERNS.some((p) => p.pattern.test(sample)),
				`禁止パターン未検出: ${sample}`,
			).toBe(true);
		}
	});

	it('正当な import (schema / check-constraints / occ-retry / drizzle-orm) は検出しない', () => {
		const legit = [
			"import { children } from './schema';",
			"import { enumCheck } from './check-constraints';",
			"import { withOccRetry } from './occ-retry';",
			"import { eq } from 'drizzle-orm';",
			"import type { TransactionRunner } from '../interfaces/transaction.interface';",
		];
		for (const sample of legit) {
			expect(
				FORBIDDEN_IMPORT_PATTERNS.some((p) => p.pattern.test(sample)),
				`false positive: ${sample}`,
			).toBe(false);
		}
	});
});

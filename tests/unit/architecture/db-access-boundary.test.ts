// tests/unit/architecture/db-access-boundary.test.ts
// #3438 Phase 3 (EPIC #3424): DynamoDB backend 撤去後の regression guard。
//
// EPIC #3424 で DynamoDB → Aurora DSQL 移管が完了し、app 層の DynamoDB backend
// (`src/lib/server/db/dynamodb/client.ts` / `keys.ts`) + SDK deps
// (`@aws-sdk/client-dynamodb` / `@aws-sdk/lib-dynamodb`) は #3438 Phase 3 で撤去済。
//
// 本 fitness function は **`@aws-sdk/*-dynamodb` が src/ のどこからも import されない
// (= DynamoDB backend 再導入 0)** を機械強制する (ADR-0061 same-class→guard)。かつて
// fitness#16 (dsql-data-model.md §13.1) は「DynamoDB SDK を repo 実装層 db/dynamodb/ 内に
// 隔離」する境界だったが、backend 撤去により allowlist を 0 に狭め「どこにも存在しない」を
// 不変条件とする regression net に転じた。新規ツール導入ゼロ (既存 vitest + node fs)。
//
// 検出は static `import ... from '...'` に加え dynamic `import('...')` / `require('...')` /
// backtick specifier / 改行 wrap も対象 (route-db-boundary #3152 / 旧 fitness#16 detector を踏襲)。
//
// ⚠️ scope: DynamoDB SDK のみ。S3 等他 SDK は対象外 (広げない)。

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const SRC_DIR = resolve(REPO_ROOT, 'src');

// ── 禁止 import ルール (specifier pattern) ──────────────────────────────────────
// DynamoDB SDK は撤去済のため、src/ のどこからも import してはならない (allowlist 0)。
const FORBIDDEN_SPECIFIER = /^@aws-sdk\/(?:client-dynamodb|lib-dynamodb)(?:\/|$)/;
const FORBIDDEN_REASON =
	'DynamoDB SDK (@aws-sdk/*-dynamodb) を import している。DynamoDB backend は #3438 Phase 3 で撤去済 (prod=dsql)。再導入は不可 (DSQL/PGlite/SQLite backend を使う)';

// ── import specifier 抽出 (static from + dynamic import()/require()) ──────────
const STATIC_IMPORT_SPECIFIER = /\b(?:import|export)\b[^;'"]*?\bfrom\s*(['"])([^'"\n]+)\1/g;
const DYNAMIC_IMPORT_SPECIFIER = /\b(?:import|require)\s*\(\s*(['"`])([^'"`\n]+)\1\s*\)/g;

/** file 全文から import 対象の module specifier を全件抽出する。 */
function extractImportSpecifiers(content: string): string[] {
	const specifiers: string[] = [];
	for (const re of [STATIC_IMPORT_SPECIFIER, DYNAMIC_IMPORT_SPECIFIER]) {
		re.lastIndex = 0;
		for (const m of content.matchAll(re)) {
			const specifier = m[2];
			if (specifier) specifiers.push(specifier);
		}
	}
	return specifiers;
}

function walkTsFiles(dir: string, acc: string[]): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = resolve(dir, entry.name);
		if (entry.isDirectory()) {
			walkTsFiles(full, acc);
		} else if (entry.name.endsWith('.ts')) {
			acc.push(full);
		}
	}
	return acc;
}

function toRepoRelative(file: string): string {
	return relative(REPO_ROOT, file).replace(/\\/g, '/');
}

interface Violation {
	file: string;
	reason: string;
}

function findViolations(): Violation[] {
	const violations: Violation[] = [];
	for (const file of walkTsFiles(SRC_DIR, [])) {
		const specifiers = extractImportSpecifiers(readFileSync(file, 'utf-8'));
		if (specifiers.some((s) => FORBIDDEN_SPECIFIER.test(s))) {
			violations.push({ file: toRepoRelative(file), reason: FORBIDDEN_REASON });
		}
	}
	return violations;
}

describe('#3438 DynamoDB backend 撤去 regression guard (@aws-sdk/*-dynamodb import 0)', () => {
	const tsFiles = walkTsFiles(SRC_DIR, []);

	it('src/ の .ts file を FS 走査できている (sanity)', () => {
		expect(tsFiles.length).toBeGreaterThan(0);
	});

	it('src/ のどこからも DynamoDB SDK (@aws-sdk/*-dynamodb) を import しない (static + dynamic import)', () => {
		const violations = findViolations();
		expect(
			violations,
			`DynamoDB SDK の再導入を検出しました (backend 撤去済 #3438):\n${violations
				.map((v) => `  - ${v.file}: ${v.reason}`)
				.join('\n')}`,
		).toEqual([]);
	});

	it('detector が静的 / 動的 / require / backtick / 改行 wrap の各 import 形を検出する (非トートロジー証明)', () => {
		const forbiddenSamples = [
			// 静的 import
			"import { QueryCommand } from '@aws-sdk/lib-dynamodb';",
			'import { DescribeTableCommand } from "@aws-sdk/client-dynamodb";',
			// re-export も import 同等の依存
			"export { DynamoDBClient } from '@aws-sdk/client-dynamodb';",
			// 動的 import (単一行)
			"const { PutCommand } = await import('@aws-sdk/lib-dynamodb');",
			// 動的 import (biome 改行 wrap)
			"const { DynamoDBClient } = await import(\n\t'@aws-sdk/client-dynamodb'\n);",
			// require
			"const sdk = require('@aws-sdk/client-dynamodb');",
			// backtick specifier
			'const mod = await import(`@aws-sdk/lib-dynamodb`);',
		];
		for (const sample of forbiddenSamples) {
			const specifiers = extractImportSpecifiers(sample);
			expect(specifiers.length, `specifier 抽出漏れ: ${sample}`).toBeGreaterThan(0);
			const hit = specifiers.some((s) => FORBIDDEN_SPECIFIER.test(s));
			expect(hit, `禁止パターン未検出: ${sample}`).toBe(true);
		}
	});

	it('コメント内の言及や無関係 module は検出しない (false-positive guard)', () => {
		const benignSamples = [
			// コメントでの言及は import ではない
			'// かつて @aws-sdk/lib-dynamodb を使っていたが #3438 で撤去した',
			// 無関係 SDK (S3 等) は scope 外
			"import { S3Client } from '@aws-sdk/client-s3';",
			// 他の @aws-sdk module も対象外
			"import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';",
			// facade 直下 module は禁止対象でない
			"import { getPointRepo } from '$lib/server/db/point-repo';",
		];
		for (const sample of benignSamples) {
			const specifiers = extractImportSpecifiers(sample);
			const hit = specifiers.some((s) => FORBIDDEN_SPECIFIER.test(s));
			expect(hit, `false positive: ${sample}`).toBe(false);
		}
	});
});

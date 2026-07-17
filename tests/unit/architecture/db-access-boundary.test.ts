// tests/unit/architecture/db-access-boundary.test.ts
// #N0-2 (EPIC #3424 / Phase 0): fitness#16「DB アクセス経路の一本化」の architecture fitness function。
//
// dsql-data-model.md §13.1 fitness#16 / dsql-implementation-plan.md #N0-2 / ADR-0061 (same-class→guard):
// **DynamoDB SDK (`@aws-sdk/client-dynamodb` / `@aws-sdk/lib-dynamodb`) の直接 import は
// backend 固有 repo 実装層 `src/lib/server/db/dynamodb/` 内でのみ許可**。services / routes /
// analytics 等それ以外のレイヤは repo facade (`$lib/server/db/*` 直下) 経由必須。同様に
// backend 固有 repo 実装 (`$lib/server/db/dynamodb/*`) 自体の import も `src/lib/server/db/`
// (factory / facade 層) の外からは禁止する。route-db-boundary.test.ts (#3152、routes 限定) と
// 同型の Architecture Fitness Function (Building Evolutionary Architecture / Neal Ford 他) を
// **src/ 全レイヤ** に拡張したもの。新規ツール導入ゼロ (既存 vitest + node fs)。
//
// 検出は static `import ... from '...'` に加え dynamic `import('...')` / `require('...')` も
// 対象 (route-db-boundary #3152 QM BLOCK の教訓を踏襲)。ただし本 detector は行単位でなく
// **file 全文から import specifier を抽出**する: analytics/providers/dynamo.ts の実コードが
// `await import(\n  '$lib/server/db/dynamodb/client'\n)` と改行 wrap されており (biome 整形)、
// 行単位 detector では specifier 行が走査から漏れるため (実測で確認済)。
//
// scope integrity 調査 (dsql-data-model.md §12.1 N3) で判明した既存の非 repo DynamoDB
// アクセス 4 file は Phase Z (#3438) で撤去予定のため、1 件単位の documented baseline とし
// (route-db-boundary の BASELINE_VIOLATIONS + length-freeze パターン)、baseline 超過 =
// 新規違反として CI hard-fail させる。baseline の拡大は不可、縮小 (migration) のみ歓迎。
//
// ⚠️ scope: fitness#16 は DynamoDB 境界のみ。S3 等他 SDK は対象外 (広げない)。

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const SRC_DIR = resolve(REPO_ROOT, 'src');

// ── 禁止 import ルール (specifier pattern + 許可 scope dir prefix) ──────────────
// allowedDirPrefixes 配下の file からの import のみ許可。それ以外は違反。
interface BoundaryRule {
	/** import specifier にマッチする pattern */
	specifier: RegExp;
	/** この specifier の import が許可される dir prefix (repo-root 相対、posix 区切り) */
	allowedDirPrefixes: string[];
	reason: string;
}

const BOUNDARY_RULES: BoundaryRule[] = [
	{
		// DynamoDB SDK 本体。backend 固有 repo 実装層のみが触れてよい。
		specifier: /^@aws-sdk\/(?:client-dynamodb|lib-dynamodb)(?:\/|$)/,
		allowedDirPrefixes: ['src/lib/server/db/dynamodb/'],
		reason:
			'DynamoDB SDK (@aws-sdk/*-dynamodb) を src/lib/server/db/dynamodb/ 外で直接 import (repo facade 経由にする)',
	},
	{
		// backend 固有 repo 実装。factory / facade (`src/lib/server/db/` 直下等) だけが
		// dispatch のために import してよい。services / routes / analytics からの直 import は
		// backend lock-in であり DSQL 移管 (EPIC #3424) の障害になる。
		specifier: /^\$lib\/server\/db\/dynamodb(?:\/|$)/,
		allowedDirPrefixes: ['src/lib/server/db/'],
		reason:
			'backend 固有実装 ($lib/server/db/dynamodb/*) を src/lib/server/db/ (factory/facade 層) 外から直接 import',
	},
];

// ── import specifier 抽出 (static from + dynamic import()/require()) ──────────
// 静的 import/export: `import ... from '...'` / `export ... from '...'`
// (multi-line named import でも `from '...'` 部で捕捉できる)
const STATIC_IMPORT_SPECIFIER = /\b(?:import|export)\b[^;'"]*?\bfrom\s*(['"])([^'"\n]+)\1/g;
// 動的 import / require: `import('...')` / `await import(\n  '...'\n)` / `require('...')`。
// `\s*` が改行を跨ぐため biome の改行 wrap にも追従する。backtick specifier も対象
// (テンプレートリテラル経由のすり抜けを塞ぐ)。
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

function violationKey(v: Violation): string {
	return `${v.file}::${v.reason}`;
}

// ── 既知の baseline 違反 (Phase Z #3438 で撤去予定、新規追加禁止) ───────────────
// dsql-data-model.md §12.1 N3 の「非 repo DynamoDB アクセス 4 file」を 1 件単位で固定。
// 「baseline 超過 = 新規違反」のみ hard-fail させ、移管中の新規散在を機械封鎖する。
//
// 新規 file がここに該当した場合は **baseline に足すのではなく repo facade / getRepos()
// 経由に書き直す** こと。baseline の縮小 (migration / Phase Z 撤去) のみ歓迎、拡大は QM 指摘対象。
const BASELINE_VIOLATIONS: Violation[] = [
	// #3805: analytics DynamoDB event pipeline (providers/dynamo.ts + analytics-aggregate-service.ts)
	// を撤去し、marketing 分析を DSQL main data 由来の on-demand 集計へ載せ替えたため、
	// 該当 4 violation は baseline から縮小 (repo facade 経由の縮小のみ歓迎の原則に整合)。
	{
		// /api/health liveness probe が使う DescribeTable。src/lib/server/db/ 直下だが
		// SDK 直 import (rule 1) は db/dynamodb/ 限定のため violation。撤去予定 tooling。
		file: 'src/lib/server/db/probe.ts',
		reason:
			'DynamoDB SDK (@aws-sdk/*-dynamodb) を src/lib/server/db/dynamodb/ 外で直接 import (repo facade 経由にする)',
	},
	{
		// SQLite→DynamoDB writeback migration tooling。Phase Z (#3438) で撤去予定。
		file: 'src/lib/server/db/migration/writeback.ts',
		reason:
			'DynamoDB SDK (@aws-sdk/*-dynamodb) を src/lib/server/db/dynamodb/ 外で直接 import (repo facade 経由にする)',
	},
];

// length-freeze: baseline は上記 6 entry (4 file) で凍結。entry を削除 (migration) したら
// この値も同時に下げる。**増やす変更は fitness#16 の存在意義を破壊するため禁止** (QM 指摘対象)。
const BASELINE_LENGTH_FREEZE = 6;

function findViolations(): Violation[] {
	const violations: Violation[] = [];
	for (const file of walkTsFiles(SRC_DIR, [])) {
		const rel = toRepoRelative(file);
		const specifiers = extractImportSpecifiers(readFileSync(file, 'utf-8'));
		for (const rule of BOUNDARY_RULES) {
			if (rule.allowedDirPrefixes.some((p) => rel.startsWith(p))) continue;
			if (specifiers.some((s) => rule.specifier.test(s))) {
				violations.push({ file: rel, reason: rule.reason });
			}
		}
	}
	return violations;
}

describe('#N0-2 fitness#16: DB アクセス経路の一本化 (DynamoDB 境界、dsql-data-model.md §13.1)', () => {
	const tsFiles = walkTsFiles(SRC_DIR, []);

	it('src/ の .ts file を FS 走査できている (sanity)', () => {
		expect(tsFiles.length).toBeGreaterThan(0);
		// 許可 scope 側 (db/dynamodb/) も走査対象に含まれている = allowlist が実 file を除外している証明
		expect(tsFiles.some((f) => toRepoRelative(f).startsWith('src/lib/server/db/dynamodb/'))).toBe(
			true,
		);
	});

	it('DynamoDB SDK / backend 固有 repo を許可 scope 外から import しない (documented baseline 超過 0、static + dynamic import)', () => {
		const violations = findViolations();
		const baselineKeys = new Set(BASELINE_VIOLATIONS.map(violationKey));
		const newViolations = violations.filter((v) => !baselineKeys.has(violationKey(v)));
		expect(
			newViolations,
			`新規 DB アクセス境界違反 (fitness#16):\n${newViolations
				.map((v) => `  - ${v.file}: ${v.reason}`)
				.join(
					'\n',
				)}\n→ DynamoDB へのアクセスは src/lib/server/db/dynamodb/ (repo 実装層) 内に閉じ、他レイヤは repo facade (\`$lib/server/db/*\` 直下) / \`$lib/server/services/*\` 経由にする (dsql-data-model.md §13.1 fitness#16 / ADR-0061)。baseline には足さず facade へ移譲すること`,
		).toEqual([]);
	});

	it('baseline 違反が stale でない (migration 済みなら baseline から削除する)', () => {
		// 実コードに存在しない baseline エントリが残っていると、その file が再び違反しても
		// 黙って許容されてしまう。baseline は「現に存在する違反」と完全一致させる。
		const actualKeys = new Set(findViolations().map(violationKey));
		const staleBaseline = BASELINE_VIOLATIONS.filter((v) => !actualKeys.has(violationKey(v)));
		expect(
			staleBaseline,
			`既に解消済みの baseline エントリ (削除し BASELINE_LENGTH_FREEZE も下げてください):\n${staleBaseline
				.map((v) => `  - ${v.file}: ${v.reason}`)
				.join('\n')}`,
		).toEqual([]);
	});

	it('baseline は凍結値を超えない (append 禁止、縮小のみ歓迎)', () => {
		expect(
			BASELINE_VIOLATIONS.length,
			'BASELINE_VIOLATIONS への追記は禁止 (新規違反は facade へ移譲する)。縮小した場合は BASELINE_LENGTH_FREEZE も同時に下げること',
		).toBeLessThanOrEqual(BASELINE_LENGTH_FREEZE);
		// 4 file を超える file 数への拡大も禁止 (entry 単位凍結の補助 guard)
		expect(new Set(BASELINE_VIOLATIONS.map((v) => v.file)).size).toBeLessThanOrEqual(4);
	});

	it('detector が静的 / 動的 / require / backtick / 改行 wrap の各 import 形を検出する (非トートロジー証明)', () => {
		const forbiddenSamples = [
			// 静的 import
			"import { QueryCommand } from '@aws-sdk/lib-dynamodb';",
			'import { DescribeTableCommand } from "@aws-sdk/client-dynamodb";',
			// re-export も import 同等の依存
			"export { getDocClient } from '$lib/server/db/dynamodb/client';",
			// 動的 import (単一行)
			"const { PutCommand } = await import('@aws-sdk/lib-dynamodb');",
			// 動的 import (biome 改行 wrap — 行単位 detector がすり抜けていた形、実コード dynamo.ts と同形)
			"const { getDocClient } = await import(\n\t'$lib/server/db/dynamodb/client'\n);",
			// require
			"const sdk = require('@aws-sdk/client-dynamodb');",
			// backtick specifier
			'const mod = await import(`$lib/server/db/dynamodb/client`);',
		];
		for (const sample of forbiddenSamples) {
			const specifiers = extractImportSpecifiers(sample);
			expect(specifiers.length, `specifier 抽出漏れ: ${sample}`).toBeGreaterThan(0);
			const hit = specifiers.some((s) => BOUNDARY_RULES.some((r) => r.specifier.test(s)));
			expect(hit, `禁止パターン未検出: ${sample}`).toBe(true);
		}
	});

	it('コメント内の言及や無関係 module は検出しない (false-positive guard)', () => {
		const benignSamples = [
			// コメントでの言及 (実コード dynamo.ts L213 と同形) は import ではない
			'// により `$lib/server/db/dynamodb/*` を直接 import できないため、constants は providers/',
			// 無関係 SDK (S3 等) は fitness#16 の scope 外
			"import { S3Client } from '@aws-sdk/client-s3';",
			// facade 直下 module は禁止対象でない
			"import { getPointRepo } from '$lib/server/db/point-repo';",
		];
		for (const sample of benignSamples) {
			const specifiers = extractImportSpecifiers(sample);
			const hit = specifiers.some((s) => BOUNDARY_RULES.some((r) => r.specifier.test(s)));
			expect(hit, `false positive: ${sample}`).toBe(false);
		}
	});

	it('許可 scope 内 (db/dynamodb/ 実装層) の SDK import は違反にならない (allowlist の動作確認)', () => {
		// 実 repo 実装 file が SDK を import している (= 許可 scope が実在し使われている) こと、
		// かつ findViolations がそれを violation に含めないことを確認する。
		const clientFile = resolve(REPO_ROOT, 'src/lib/server/db/dynamodb/client.ts');
		const specifiers = extractImportSpecifiers(readFileSync(clientFile, 'utf-8'));
		expect(specifiers.some((s) => /^@aws-sdk\//.test(s))).toBe(true);
		const violations = findViolations();
		expect(violations.some((v) => v.file.startsWith('src/lib/server/db/dynamodb/'))).toBe(false);
	});
});

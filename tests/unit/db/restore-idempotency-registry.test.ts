// tests/unit/db/restore-idempotency-registry.test.ts
// #3394: restore 冪等 guard 分類 SSOT (restore-idempotency.ts) の fitness function (ADR-0061)。
//
// backup-entity-registry.test.ts の no-silent-gap パターンと同型:
//   1. no-silent-gap: 3 backend (sqlite/dsql/demo) の `*ForRestore` 関数は全て registry に
//      分類されている (新規 restore 関数を追加して分類を忘れると本テストが fail する)
//   2. guard 対称性: kind='natural-key' entity は宣言された backend guard 実装
//      (ConditionExpression / onConflictDoNothing / ON CONFLICT) がソース上に存在する
//      (#3385/#3391 の「DynamoDB だけ guard を欠く」同型欠陥を CI で機械検出)
//   3. demo null-stub: demo backend の restore stub は null/false/undefined を返し
//      import カウントを偽装しない (#3420 / #2263 count 偽装 class)
//
// ソース走査 fitness は「関数出現位置から一定範囲に guard マーカーが存在する」ことを検査する
// 近似だが、guard を丸ごと外す退行 (silent overwrite 化) は確実に検出できる。

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	declaredRestoreFunctions,
	RESTORE_IDEMPOTENCY_REGISTRY,
	type RestoreGuardImpl,
} from '../../../src/lib/server/db/restore-idempotency';

const DB_DIR = join(__dirname, '../../../src/lib/server/db');
// #3438 Phase 2B: DynamoDB backend 撤去により backend は sqlite / dsql / demo の 3 本。
const BACKENDS = ['sqlite', 'dsql', 'demo'] as const;
type Backend = (typeof BACKENDS)[number];

/** backend dir 配下の *-repo.ts から `<basename>:<fn>` の ForRestore 関数集合を抽出する。 */
function scanRestoreFunctions(backend: Backend): Set<string> {
	const dir = join(DB_DIR, backend);
	const found = new Set<string>();
	for (const file of readdirSync(dir)) {
		if (!file.endsWith('-repo.ts')) continue;
		const source = readFileSync(join(dir, file), 'utf-8');
		const basename = file.replace(/\.ts$/, '');
		// sqlite/demo: `export async function xxxForRestore(` /
		// dsql (object literal repo): `async xxxForRestore(`
		const re = /(?:export\s+async\s+function|(?<![\w.])async)\s+(\w*ForRestore)\s*[(<]/g;
		for (const m of source.matchAll(re)) {
			found.add(`${basename}:${m[1]}`);
		}
	}
	return found;
}

/** file 内の関数名出現位置以降のスライス (関数本体近傍) を返す。 */
function functionVicinity(backend: Backend, repoFile: string, fn: string): string {
	const source = readFileSync(join(DB_DIR, backend, `${repoFile}.ts`), 'utf-8');
	const idx = source.indexOf(`${fn}(`);
	expect(idx, `${backend}/${repoFile}.ts に ${fn} が存在する`).toBeGreaterThanOrEqual(0);
	return source.slice(idx, idx + 2600);
}

/** guard 実装方式ごとのソースマーカー。 */
const GUARD_MARKERS: Record<Exclude<RestoreGuardImpl, 'none' | 'service-layer'>, RegExp> = {
	'on-conflict-do-nothing': /onConflictDoNothing/,
	'on-conflict-sql': /ON CONFLICT/,
	'null-stub': /return (?:null|false|undefined)/,
};

describe('#3394 restore-idempotency registry fitness (ADR-0061 same-class → guard)', () => {
	it('no-silent-gap: 全 backend の *ForRestore 関数が registry に分類されている (双方向一致)', () => {
		const union = new Set<string>();
		for (const backend of BACKENDS) {
			for (const key of scanRestoreFunctions(backend)) union.add(key);
		}
		const declared = new Set(declaredRestoreFunctions());

		const undeclared = [...union].filter((k) => !declared.has(k)).sort();
		expect(
			undeclared,
			'registry 未分類の ForRestore 関数 (restore-idempotency.ts に追記が必要)',
		).toEqual([]);

		// 逆方向: registry 宣言がどの backend にも実在しない (typo / 撤去漏れ) を検出
		const missing = [...declared].filter((k) => !union.has(k)).sort();
		expect(missing, 'registry に宣言されたがソースに存在しない ForRestore 関数').toEqual([]);
	});

	it('guard 対称性: natural-key entity は宣言された backend guard がソース上に存在する', () => {
		for (const [name, entry] of Object.entries(RESTORE_IDEMPOTENCY_REGISTRY)) {
			for (const backend of BACKENDS) {
				const guard = entry.guards[backend];
				if (guard === 'none' || guard === 'service-layer') continue;
				const marker = GUARD_MARKERS[guard];
				for (const fn of entry.functionNames) {
					const vicinity = functionVicinity(backend, entry.repoFile, fn);
					expect(
						marker.test(vicinity),
						`${name}: ${backend}/${entry.repoFile}.ts ${fn} に guard (${guard} = ${marker}) が必要`,
					).toBe(true);
				}
			}
		}
	});

	it('service-layer guard (dsql certificates 等) は import-service に dedup 実装が存在する', () => {
		// DSQL certificates は DB unique 制約を持たないため、import-service の service 層 dedup が
		// backend 間機能等価の唯一の防御。実装 (findCertificates prefetch + certificateType Set) の
		// 存在をマーカーで検査する。
		const serviceLayerEntities = Object.entries(RESTORE_IDEMPOTENCY_REGISTRY).filter(([, e]) =>
			Object.values(e.guards).includes('service-layer'),
		);
		expect(serviceLayerEntities.map(([n]) => n)).toEqual(['certificate']);

		const importService = readFileSync(
			join(__dirname, '../../../src/lib/server/services/import-service.ts'),
			'utf-8',
		);
		expect(/seenTypesByChild|certificateType.*Set|Set.*certificateType/s.test(importService)).toBe(
			true,
		);
	});

	it('content-dedup entity (parentMessage / siblingCheer) は import-service に content key dedup が存在する', () => {
		const importService = readFileSync(
			join(__dirname, '../../../src/lib/server/services/import-service.ts'),
			'utf-8',
		);
		// parentMessage: (messageType, stampCode, body, sentAt) content key
		// biome-ignore lint/suspicious/noTemplateCurlyInString: source-scan fitness — import-service 内の template literal を文字列として照合する
		expect(importService).toContain('${m.messageType}|${m.stampCode ?? ');
		// siblingCheer: (fromChildId, toChildId, stampCode, sentAt) content key
		// biome-ignore lint/suspicious/noTemplateCurlyInString: source-scan fitness — import-service 内の template literal を文字列として照合する
		expect(importService).toContain('${fromChildId}|${toChildId}|${c.stampCode}|${c.sentAt}');
	});
});

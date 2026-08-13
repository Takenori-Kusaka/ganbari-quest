// tests/unit/architecture/avatar-url-write-guard-fitness.test.ts
// #4546 ②: `children.avatar_url` に書く経路が tenant prefix 検証を通っていることの fitness function。
//
// # なぜ要るか
//
// PR #4469 は `assertTenantScopedStorageKey` を **削除時**に置いた (「他人のファイルを消さない」)。
// しかし `avatar_url` に**何を書けるか**は無検査のままだった。他テナントを指す URL を書けると:
//   - 配信経路がそのまま他人の顔写真を返す (IDOR)
//   - account 削除の `deleteByPrefix('tenants/<tenantId>/')` から漏れて孤児バイトが残る
//     (COPPA 16CFR312.10 / GDPR Art.17)
//
// 当時のレビューは「import 経路が cross-tenant な値を注入しないこと」しか見ておらず、
// **全書き込み経路を列挙していない**。列挙とその網羅性の維持を人手に任せないのが本 fitness。
//
// # 何を検査するか
//
// `children` の `avatar_url` を書く文 (drizzle の `.set({ avatarUrl })` / 生 SQL の
// `SET avatar_url =`) を repo 層から抽出し、**同じ関数内で `assertTenantScopedAvatarUrl` を
// 呼んでいること**を要求する。新しい書き込み経路を足すと落ちる。
//
// # 除外
//
// demo backend (`src/lib/server/db/demo/`) は書き込みを一切永続しない Stub (ADR-0048) のため対象外。
// 守るべき DB 行も配信されるバイトも存在せず、guard を置いても検査するものが無い。

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

/** `avatar_url` を書きうる repo 実装 (永続する backend のみ)。 */
const PERSISTENT_REPO_FILES = [
	'src/lib/server/db/sqlite/image-repo.ts',
	'src/lib/server/db/dsql/image-repo.ts',
];

const GUARD_CALL = 'assertTenantScopedAvatarUrl(';

/** ソース中の「関数らしき単位」に分割する (drizzle 実装 = export function / dsql 実装 = async メソッド)。 */
function splitIntoUnits(src: string): { name: string; body: string }[] {
	const units: { name: string; body: string }[] = [];
	const header = /(?:export\s+(?:async\s+)?function\s+(\w+)|async\s+(\w+)\s*\([^)]*\)\s*\{)/g;
	const starts: { name: string; index: number }[] = [];
	let m: RegExpExecArray | null;
	// biome-ignore lint/suspicious/noAssignInExpressions: exec ループの定型
	while ((m = header.exec(src)) !== null) {
		starts.push({ name: m[1] ?? m[2] ?? '(anonymous)', index: m.index });
	}
	for (const [i, start] of starts.entries()) {
		const end = starts[i + 1]?.index ?? src.length;
		units.push({ name: start.name, body: src.slice(start.index, end) });
	}
	return units;
}

/** その単位が `children.avatar_url` を書いているか。 */
function writesAvatarUrl(body: string): boolean {
	// drizzle: `.update(children)` + `.set({ avatarUrl, ... })`
	const drizzleWrite = /\.update\(\s*children\s*\)/.test(body) && /\bavatarUrl\b/.test(body);
	// 生 SQL: `UPDATE children SET avatar_url = ...` / `INSERT INTO children (... avatar_url ...)`
	const rawWrite = /UPDATE\s+children\s+SET[\s\S]{0,200}?avatar_url\s*=/i.test(body);
	return drizzleWrite || rawWrite;
}

describe('children.avatar_url 書き込み guard fitness (#4546 ②)', () => {
	it('永続する backend の avatar_url 書き込みは全て assertTenantScopedAvatarUrl を通る', () => {
		const writeUnits: string[] = [];
		const unguarded: string[] = [];

		for (const rel of PERSISTENT_REPO_FILES) {
			const src = readFileSync(resolve(REPO_ROOT, rel), 'utf-8');
			for (const unit of splitIntoUnits(src)) {
				if (!writesAvatarUrl(unit.body)) continue;
				writeUnits.push(`${rel} :: ${unit.name}`);
				if (!unit.body.includes(GUARD_CALL)) unguarded.push(`${rel} :: ${unit.name}`);
			}
		}

		// 経路が 1 つも見つからない = 抽出が壊れている (guard が空回りして緑になるのを防ぐ)。
		expect(
			writeUnits.length,
			'avatar_url の書き込み経路が 1 件も抽出できていない。書き込みの書き方が変わったなら writesAvatarUrl を追随させること',
		).toBeGreaterThanOrEqual(4);

		expect(
			unguarded,
			[
				'children.avatar_url を書きながら assertTenantScopedAvatarUrl を通していない経路がある。',
				'他テナントを指す URL を書けると IDOR / account 削除からの漏れになる ($lib/server/storage-keys)。',
				'書き込む値 (expectedAvatarUrl ではない) を guard に渡すこと。',
			].join('\n'),
		).toEqual([]);
	});

	it('avatar_url を書く経路は image-repo に閉じている (child-repo 経由の抜け道が無い)', () => {
		for (const rel of [
			'src/lib/server/db/sqlite/child-repo.ts',
			'src/lib/server/db/dsql/child-repo.ts',
		]) {
			const src = readFileSync(resolve(REPO_ROOT, rel), 'utf-8');
			for (const unit of splitIntoUnits(src)) {
				expect(
					writesAvatarUrl(unit.body),
					[
						`${rel} :: ${unit.name} が children.avatar_url を書いている。`,
						'avatar_url の書き込みは image-repo (guard 済) に集約すること。',
						'ここに増やす場合は同じ guard を通し、本 test の対象に含めること。',
					].join('\n'),
				).toBe(false);
			}
		}
	});
});

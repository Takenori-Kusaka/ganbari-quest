// tests/unit/architecture/dsql-uuid-guard-ssot-fitness.test.ts
// #3581 ② follow-up / ADR-0061 (same-class N→guard) / ADR-0063 (アプリ層単一強制点) /
// 設計 SSOT: docs/design/14-セキュリティ設計書.md §5.2.7
//
// **DSQL cutover trust 境界 id validation の SSOT + observability を機械保証する fitness**:
//   cutover (旧 SQLite 数値 id → uuid) 後に stale/非 uuid な id (Cookie `selectedChildId` の
//   旧数値 '3' 等 / form / URL param / API beacon) が uuid 列 WHERE に直達すると Postgres が
//   22P02 (invalid input syntax for type uuid) を throw し、route の graceful not-found 処理
//   (cookie clear + /switch redirect) を貫通して 500 になる (CWE-20)。この同一クラスは
//   #3709 → #3714 → #3792 と 3 ラウンド再発した。
//
//   #3709/#3792 は個別メソッドに `isUuidFormat` guard + `warnInvalidUuidId` を配線したが、
//   「新経路で guard を書き忘れる / observability 無しの silent guard を足す / uuid 検証を
//   別実装して単一強制点を迂回する」再発は **人の注意** に依存したままだった。ADR-0061 の
//   same-class-N→guard に従い、本 fitness で以下 2 不変条件を CI hard-fail 化する
//   (人の注意 → 機械強制へ shift-left)。
//
//   [SSOT-1] uuid 形式判定の hand-rolled regex は `pg-uuid.ts` の 1 箇所のみ (単一強制点)。
//            別実装は observability (warnInvalidUuidId) / 正規化契約を迂回するため src/ で
//            2 箇所目を禁止する。
//   [OBS-2]  trust 境界 guard modules (dsql repos + child-cookie-guard) で `isUuidFormat` を
//            guard 判定に使う各 module は、`warnInvalidUuidId` を同数以上呼ぶ
//            (silent guard 禁止。#3581 ② comment「guard 発火の観測点ゼロ」の再発防止)。

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const SRC_DIR = resolve(REPO_ROOT, 'src');
const DSQL_DIR = resolve(REPO_ROOT, 'src/lib/server/db/dsql');
const CHILD_COOKIE_GUARD = resolve(REPO_ROOT, 'src/lib/server/auth/child-cookie-guard.ts');
// #3799: form-field 由来 id の trust 境界 guard (cookie guard の form 版)。
const CHILD_FORM_FIELD_GUARD = resolve(REPO_ROOT, 'src/lib/server/auth/child-form-field-guard.ts');

/** uuid 形式判定の SSOT モジュール (単一強制点)。 */
const UUID_SSOT_FILE = resolve(DSQL_DIR, 'pg-uuid.ts');

/** hand-rolled な uuid-shape regex (canonical uuid の第 1 グループ `[0-9a-f]{8}`)。 */
const UUID_REGEX_MARKER = /\[0-9a-fA-F\]\{8\}|\[0-9a-f\]\{8\}/;

function relToRepo(abs: string): string {
	return relative(REPO_ROOT, abs).replaceAll('\\', '/');
}

/** dir 配下の *.ts / *.svelte を再帰列挙 (test/spec/stories は除外)。 */
function listSourceFiles(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir)) {
		const abs = resolve(dir, entry);
		if (statSync(abs).isDirectory()) {
			out.push(...listSourceFiles(abs));
			continue;
		}
		if (!/\.(ts|svelte)$/.test(entry)) continue;
		if (/\.(test|spec|stories)\./.test(entry)) continue;
		out.push(abs);
	}
	return out;
}

/** pattern の出現回数 (グローバル count)。 */
function countMatches(content: string, pattern: RegExp): number {
	return content.match(pattern)?.length ?? 0;
}

describe('DSQL uuid guard SSOT + observability fitness (#3581 ② / ADR-0061 / ADR-0063)', () => {
	it('[SSOT-1] hand-rolled uuid regex は pg-uuid.ts の 1 箇所のみ (単一強制点、別実装で observability を迂回させない)', () => {
		const offenders = listSourceFiles(SRC_DIR)
			.filter((f) => UUID_REGEX_MARKER.test(readFileSync(f, 'utf8')))
			.map(relToRepo)
			.sort();

		// uuid 形式判定は `isUuidFormat` (pg-uuid.ts) が唯一の実装。ここに別の module 名が
		// 現れたら、その module は正規化 (not-found 化) と warnInvalidUuidId observability を
		// 迂回する uuid 検証を独自実装している = 単一強制点違反。isUuidFormat を import して使う。
		expect(
			offenders,
			[
				'uuid 形式 regex を pg-uuid.ts 以外に実装した module を検出。',
				'trust 境界の id 検証は src/lib/server/db/dsql/pg-uuid.ts の isUuidFormat に集約する',
				'(ADR-0063 単一強制点)。別実装は warnInvalidUuidId observability と not-found 正規化契約を',
				`迂回するため禁止 (#3581 ②)。offenders=${JSON.stringify(offenders)}`,
			].join('\n'),
		).toEqual([relToRepo(UUID_SSOT_FILE)]);
	});

	it('[OBS-2] guard module は isUuidFormat guard と同数以上の warnInvalidUuidId を呼ぶ (silent guard 禁止)', () => {
		// trust 境界 guard modules = dsql repos (pg-uuid.ts 自体は定義元のため除外) +
		// child-cookie-guard (cookie 由来) + child-form-field-guard (form-field 由来、#3799)。
		const guardModules = [
			...listSourceFiles(DSQL_DIR).filter((f) => f !== UUID_SSOT_FILE),
			CHILD_COOKIE_GUARD,
			CHILD_FORM_FIELD_GUARD,
		];

		const violations: string[] = [];
		for (const file of guardModules) {
			const content = readFileSync(file, 'utf8');
			// `isUuidFormat(` の呼び出し回数 (import 行 `isUuidFormat, warn...` は paren を含まず除外)。
			const guardCalls = countMatches(content, /isUuidFormat\(/g);
			if (guardCalls === 0) continue; // guard を使わない module は対象外。
			const warnCalls = countMatches(content, /warnInvalidUuidId\(/g);
			if (warnCalls < guardCalls) {
				violations.push(
					`${relToRepo(file)}: isUuidFormat guard ${guardCalls} 箇所に対し warnInvalidUuidId ${warnCalls} 箇所 ` +
						'(guard trip が silent。各 guard の reject 分岐で warnInvalidUuidId を呼ぶこと)',
				);
			}
		}

		// guard を足すなら必ず observability を伴う。#3581 ② comment「guard 発火の観測点ゼロ」=
		// systematic な id 取り違え (stale cookie / legacy id) が可視化されず検出遅延する再発を防ぐ。
		expect(violations, `silent guard を検出 (#3581 ②):\n${violations.join('\n')}`).toEqual([]);
	});

	it('[self-guard] fitness の対象に既知の guard module が実際に含まれている (走査 dir の空振り検出)', () => {
		// listSourceFiles / dir パスが壊れて 0 件走査 → 常時 green の false-negative を防ぐ回帰ピン。
		const guardModules = listSourceFiles(DSQL_DIR).filter((f) => f !== UUID_SSOT_FILE);
		const withGuard = guardModules.filter((f) => /isUuidFormat\(/.test(readFileSync(f, 'utf8')));
		// #3709/#3792 時点で child/point/status/login-bonus/checklist/stamp-card/special-reward/message
		// の 8 repo が guard 済。走査が機能していれば最低 8 module を検出する。
		expect(withGuard.length).toBeGreaterThanOrEqual(8);
	});
});

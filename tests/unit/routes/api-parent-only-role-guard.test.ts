// tests/unit/routes/api-parent-only-role-guard.test.ts
//
// **親だけが触ってよい `/api/v1/**` の mutation が、role 検査を持っている**ことを固定する
// (QM 監査 security [S2] / PO 決裁 2026-09-09「明らかに親限定の 5 経路を先に閉じる」)。
//
// なぜ route ごとの責務なのか: `authorization.ts` の `ROUTE_RULES` は `/api/v1` を
// `['owner','parent','child']` に開けている (既存 test が固定している仕様)。つまり
// **child セッションは `/api/v1/**` に到達できる**ので、「ここは親だけ」は各 route が言う以外にない。
//
// 監査の実測: `/api/v1/**` (非 admin / 非 parent-gate) の mutation ハンドラ **31 本すべて**が
// `requireRole` も inline の role 判定も持っていなかった。子供が親の設定した活動の
// `basePoints` を書き換えたり、家族全体のポイント減少強度を `none` にできる状態で、
// **この製品の中核 (親が決め、子が記録する) が子供側から書き換えられる** (ADR-0012 の前提が崩れる)。
//
// 31 本すべてを親限定にするのは誤り (`POST /api/v1/activity-logs` は子供が記録する経路で
// child 可が正しい)。**明らかに親限定の 5 経路だけを先に閉じ、残りは製品判断として PO へ上げる。**
//
// 固定する不変条件:
//   [A1] 親限定と決めた 5 経路が、role 検査を持っている
//   [A2] 判定は `forbiddenForNonParent` (集約先) を通る — 現場ごとのアドホックに戻さない
//   [A3] 子供が記録する経路は**閉じない** (閉じすぎの回帰も見る)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '../../..');

/** 親限定と決めた経路と、その根拠 (監査の「子供にできること」)。 */
const PARENT_ONLY = [
	{
		file: 'src/routes/api/v1/activities/[id]/+server.ts',
		handlers: ['PATCH', 'DELETE'],
		why: '親が設定した活動の basePoints を書き換える / 活動を非表示にする',
	},
	{
		file: 'src/routes/api/v1/activities/+server.ts',
		handlers: ['POST'],
		why: '活動を新規作成する',
	},
	{
		file: 'src/routes/api/v1/settings/decay/+server.ts',
		handlers: ['PUT'],
		why: '家族全体のポイント減少強度を none に変更する',
	},
	{
		file: 'src/routes/api/v1/special-rewards/templates/+server.ts',
		handlers: ['PUT'],
		why: 'ごほうびテンプレートを書き換える',
	},
] as const;

/** 子供が触ってよい経路 (閉じすぎの回帰を見る)。 */
const CHILD_ALLOWED = ['src/routes/api/v1/activity-logs/+server.ts'];

function read(rel: string): string {
	return readFileSync(join(ROOT, rel), 'utf8');
}

describe('[A1][A2] 親限定 API が role 検査を持つ', () => {
	for (const entry of PARENT_ONLY) {
		it(`${entry.file} (${entry.handlers.join(' / ')}) — ${entry.why}`, () => {
			const src = read(entry.file);
			const guards = [...src.matchAll(/forbiddenForNonParent\(/g)].length;
			expect(
				guards,
				`${entry.file} に role 検査が無い。/api/v1 は child ロールが到達できるので、` +
					`この経路は「${entry.why}」を子供に許してしまう`,
			).toBeGreaterThanOrEqual(entry.handlers.length);
			expect(
				src.includes("from '$lib/server/errors'"),
				'判定を集約先 (forbiddenForNonParent) から import していない',
			).toBe(true);
		});
	}
});

describe('[A3] 子供が記録する経路は閉じない', () => {
	for (const file of CHILD_ALLOWED) {
		it(`${file} は親限定にしない`, () => {
			const src = read(file);
			expect(
				src.includes('forbiddenForNonParent'),
				`${file} を親限定にすると、子供が自分の記録をつけられなくなる ` +
					'(この製品の中核体験そのもの)',
			).toBe(false);
		});
	}
});

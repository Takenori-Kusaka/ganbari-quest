/**
 * tests/unit/architecture/graphify-artifacts-parseable.test.ts (#4442)
 *
 * git 追跡している Graphify のナレッジグラフ成果物が **JSON として読める**ことを固定する。
 *
 * ## 何が起きたか
 *
 * `.gitattributes` が `graphify-out/graph.json merge=union` を指定していた。git 組込みの
 * `union` は **行単位で両側の行を残す** driver で、JSON の構造を理解しない。両ブランチが
 * グラフの同じ領域を書き換えると、1 つのオブジェクト内に `id` / `community` /
 * `community_name` / `norm_label` が **2 回ずつ**並ぶ壊れ方をする。
 *
 * 結果、`origin/develop` の `graph.json` (26 MB) が `JSON.parse` できない状態で追跡され、
 * clone した全員が壊れたグラフを受け取っていた。`docs/CLAUDE.md` §graphify が AI セッションに
 * 使うよう指示している `graphify query` が引けない。
 *
 * ## なぜ人が気付かないか
 *
 * post-commit hook (`.husky/post-commit`) は `graphify update . || true` で、
 * `Cannot read graphify-out\graph.json for incremental merge` を出しても commit は通る。
 * 26 MB の生成物なので diff も誰も読まない。**壊れていることを知らせる経路が無い**ため、
 * 機械で止める (ADR-0061 same-class→guard)。
 *
 * ## 何を固定するか
 *
 * 1. 追跡している `graphify-out/*.json` が parse できる (結果)
 * 2. `.gitattributes` が JSON に行単位 `merge=union` を当てていない (原因)
 * 3. `merge=graphify` を宣言するなら driver 登録の bootstrap が存在する (silent gap)
 *
 * 3 が要る理由: `.gitattributes` に `merge=graphify` があっても、local git config に
 * driver が未登録なら **git は黙って既定 merge にフォールバックする**。設定されているように
 * 見えて効かない状態を作らないため、宣言と bootstrap の対応関係ごと検査する。
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

// #4085 repo 走査 test: 26 MB の JSON を実 parse するため既定 5s では足りない。
// 区分宣言は scripts/lib/ci/repo-scan-test-registry.mjs が SSOT。
vi.setConfig({ testTimeout: 60_000 });

const REPO_ROOT = join(__dirname, '../../..');

/**
 * 検査対象。git 追跡している Graphify の JSON 成果物 (`git ls-files graphify-out/`)。
 *
 * glob で集めず明示列挙する。母数が 0 件になったときに「違反 0」ではなく
 * 「検査していない」として落とすため (#4084 と同じ形)。
 */
const TRACKED_JSON_ARTIFACTS = ['graphify-out/graph.json', 'graphify-out/manifest.json'];

/** `.gitattributes` の 1 行から `path` と attribute 群を取り出す (コメント / 空行は null)。 */
function parseGitattributesLine(line: string): { path: string; attrs: string[] } | null {
	const trimmed = line.trim();
	if (trimmed === '' || trimmed.startsWith('#')) return null;
	const [path, ...attrs] = trimmed.split(/\s+/);
	if (!path || attrs.length === 0) return null;
	return { path, attrs };
}

function readGitattributes(): { path: string; attrs: string[] }[] {
	return readFileSync(join(REPO_ROOT, '.gitattributes'), 'utf8')
		.split(/\r?\n/)
		.map(parseGitattributesLine)
		.filter((v): v is { path: string; attrs: string[] } => v !== null);
}

describe('#4442 Graphify 成果物が JSON として読めること', () => {
	it('[母数] 追跡対象の JSON 成果物が存在する', () => {
		for (const rel of TRACKED_JSON_ARTIFACTS) {
			expect(
				() => readFileSync(join(REPO_ROOT, rel)),
				`${rel} が読めません。追跡から外れたなら TRACKED_JSON_ARTIFACTS も更新してください`,
			).not.toThrow();
		}
	});

	it.each(TRACKED_JSON_ARTIFACTS)('%s が JSON として parse できる', (rel) => {
		const raw = readFileSync(join(REPO_ROOT, rel), 'utf8');
		expect(
			() => JSON.parse(raw),
			`${rel} が壊れています。**行単位の merge で融合した可能性が高い** ` +
				'(同一オブジェクト内に同じキーが 2 回並ぶ)。\n' +
				'手で直さず `graphify update .` で再生成してください。\n' +
				'再発するなら .gitattributes の merge driver 設定を疑ってください (#4442)',
		).not.toThrow();
	});

	it('JSON に行単位 merge driver (union) を当てていない', () => {
		const offenders = readGitattributes()
			.filter((e) => e.path.endsWith('.json'))
			.filter((e) => e.attrs.includes('merge=union'))
			.map((e) => e.path);

		expect(
			offenders,
			'JSON に `merge=union` を当てています。git 組込みの union は行単位で両側の行を残すため、\n' +
				'**構造を壊した JSON を無言で commit させます** (#4442 の原因そのもの)。\n' +
				'graph.json は Graphify 同梱の semantic driver (`merge=graphify`)、\n' +
				'それ以外の生成 JSON は `-merge` (textual merge させず conflict にする) を使ってください',
		).toEqual([]);
	});

	it('merge=graphify を宣言する path には driver 登録の bootstrap がある', () => {
		const declared = readGitattributes()
			.filter((e) => e.attrs.includes('merge=graphify'))
			.map((e) => e.path);

		// 宣言が無い構成 (driver を使わない) 自体は許す。宣言があるのに bootstrap が無い
		// = 「設定されているように見えて効かない」状態だけを落とす。
		if (declared.length === 0) return;

		const prepare = readFileSync(join(REPO_ROOT, 'scripts/prepare.mjs'), 'utf8');
		expect(
			prepare.includes('hook install'),
			`.gitattributes が ${declared.join(' / ')} に merge=graphify を宣言していますが、\n` +
				'scripts/prepare.mjs に driver 登録 (`graphify hook install`) がありません。\n' +
				'driver 未登録の clone では **git が黙って既定 merge にフォールバック**し、\n' +
				'設定されているように見えて効きません (#4442)',
		).toBe(true);
	});
});

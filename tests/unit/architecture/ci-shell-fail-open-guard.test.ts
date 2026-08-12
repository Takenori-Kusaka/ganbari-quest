/**
 * tests/unit/architecture/ci-shell-fail-open-guard.test.ts (#4518)
 *
 * 「`$?` を見て fail-open するつもりの shell」が `bash -e` に殺されている class を封じる。
 *
 * ## 背景
 *
 * GitHub Actions の `run:` は既定 shell が `bash -e {0}`（composite step は
 * `bash --noprofile --norc -e -o pipefail`）。`-e` はコマンドラインで渡されるため、
 * run 冒頭の `set -uo pipefail`（`-e` を含まない）では**解除されない**。
 *
 * このため
 *
 *     out="$(some_command)"
 *     if [ $? -ne 0 ]; then   # ← ここへ来ない
 *
 * と書くと、`some_command` が非 0 で終了した瞬間に step ごと中断し、fail-open 分岐が
 * 死ぬ。`actions/pr-lane` で実際にこれが起き、PR #4492 の gate が API の一過性失敗で
 * hard-fail した（#4518）。
 *
 * ## 何を強制するか
 *
 * `$?` を参照する run ブロックは、同じブロック内で **`set +e` を明示している**こと。
 * `set +e` があれば `-e` は確実に無効化されており、`$?` 判定は意図どおり動く。
 * `set +e` を使わない場合は `if cmd; then ... else ...` 形（条件部は `-e` の対象外）で
 * 書けばよく、その形は `$?` を必要としない。
 *
 * ADR-0061 same-class-N→guard: 1 箇所直して同 class を残さない。
 */

import { globSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), '../../../..');

/** 検査対象: workflow と composite action の yml。 */
function targetFiles(): string[] {
	return globSync(['.github/workflows/*.yml', '.github/workflows/*.yaml', 'actions/*/action.yml'], {
		cwd: REPO_ROOT,
	}).map((rel) => path.join(REPO_ROOT, rel));
}

type RunBlock = { file: string; startLine: number; body: string };

/**
 * `run: |`（および `run: >`）のブロックを抽出する。
 * yml パーサ依存を増やさないため、既存の workflow 検査 test と同じくインデント走査で切り出す。
 */
function extractRunBlocks(file: string): RunBlock[] {
	const lines = readFileSync(file, 'utf8').split(/\r?\n/);
	const blocks: RunBlock[] = [];

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? '';
		if (!/^\s*run:\s*[|>]-?\s*$/.test(line)) continue;

		const headIndent = line.length - line.trimStart().length;
		const body: string[] = [];
		for (let j = i + 1; j < lines.length; j++) {
			const cur = lines[j] ?? '';
			if (cur.trim() === '') {
				body.push('');
				continue;
			}
			const lead = cur.length - cur.trimStart().length;
			if (lead <= headIndent) break;
			body.push(cur.trim());
		}
		// コメント行は除去する。本 guard は「実際に走る shell」を見るものであり、
		// 禁止パターンを説明した散文コメント (まさに本 guard が生まれた経緯の説明) を
		// violation と数えてはならない。
		const code = body.filter((l) => !l.startsWith('#')).join('\n');
		blocks.push({ file, startLine: i + 1, body: code });
	}

	return blocks;
}

describe('CI shell の fail-open が bash -e で死んでいないか (#4518)', () => {
	it('検査対象の yml を実際に読めている（母数 0 で緑にしない）', () => {
		const files = targetFiles();
		expect(files.length).toBeGreaterThan(0);
		expect(
			extractRunBlocks(files.find((f) => f.endsWith('ci.yml')) as string).length,
		).toBeGreaterThan(0);
	});

	it('`$?` を見る run ブロックは同ブロック内で `set +e` を明示している', () => {
		const violations: string[] = [];

		for (const file of targetFiles()) {
			for (const block of extractRunBlocks(file)) {
				// `$?` を参照しないブロックは対象外。
				if (!block.body.includes('$?')) continue;
				// `set +e` があれば -e は確実に無効化されている。
				if (/^\s*set\s+\+e\b/m.test(block.body)) continue;

				violations.push(
					`${path.relative(REPO_ROOT, file)}:${block.startLine} — ` +
						'`$?` で分岐しているが `set +e` が無い。bash -e により直前のコマンド失敗で ' +
						'step ごと中断し、この分岐へ到達しない。`if cmd; then ... else ...` 形に直すか `set +e` を明示すること。',
				);
			}
		}

		expect(violations, `\n${violations.join('\n')}\n`).toEqual([]);
	});
});

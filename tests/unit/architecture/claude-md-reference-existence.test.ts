// tests/unit/architecture/claude-md-reference-existence.test.ts
// CLAUDE.md 系 file が言及する script / workflow が実在することを機械で保証する fitness function。
//
// # なぜ必要か
//
// CLAUDE.md は**全セッションで自動ロードされる**。そこに書かれた「この検査は CI で hard-fail
// する」は読者 (AI セッション / 開発者) にとって安全網の保証として働き、Ready 化の判断根拠に
// なる。検査を撤去したときに CLAUDE.md 側の記述が残ると、**存在しない安全網を根拠に Ready 化
// される**。
//
// 本 test 導入時、CLAUDE.md 系 6 file に死んだ参照が 11 件あった。撤去済みの検査 5 本
// (hardcoded-strings / doc-code-references / terminology-coherence / add-path-coherence /
// internal-terms) と workflow 3 本 (lp-fallback-check / draft-on-ci-fail / issue-close-gate) が
// 「CI で hard-fail する」「自動で Draft に戻す」と書かれたまま残っていた。
//
// # 検査していること
//
// tracked な CLAUDE.md 全件から script / workflow への参照を抽出し、実在を assert する。
// 参照は markdown link (`[x](../scripts/y.mjs)`) と inline code / 地の文の両方から拾う。
//
// 「検査できなかった」を pass にしない (#4084 / #4400 と同 class):
//   - 走査対象 file が 0 件なら fail (glob が壊れたら黙って緑になる)
//   - 抽出した参照が 0 件なら fail (抽出正規表現が壊れたら黙って緑になる)
//   - 判定関数自体の生存確認を 1 ケース置く (不在 path を含む fixture で fail 側を返すこと)

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

/** 参照 path の起点として認める repo root 直下の名前。 */
const ROOTS = String.raw`scripts|\.github|tests|src|docs|infra|site`;

/**
 * repo root 起点の path 形式。先頭の `./` / `../` は落として root 起点として解決する
 * (`tests/CLAUDE.md` は `../scripts/x.mjs` の形で書く)。
 * 拡張子の後ろに `\w` が続くものは弾く (`a11y-baseline.json` を `.js` として拾わないため)。
 */
const PATH_RE = new RegExp(
	String.raw`(?:\.{1,2}/)*((?:${ROOTS})/[\w./-]+\.(?:mjs|cjs|js|ts|yml|yaml))(?![\w])`,
	'g',
);

/**
 * dir を伴わない bare な script 名 (`check-hardcoded-strings.mjs` の形)。
 * CLAUDE.md はこの書き方も多用するので、path 形式だけでは L53 / L72 の死んだ参照を拾えない。
 * 直前が `\w . * / -` のいずれかなら別 token の一部なので除外する。
 */
const BARE_SCRIPT_RE =
	/(?<![\w.*/-])((?:check|measure|capture|generate)-[a-z0-9-]+\.(?:mjs|cjs|js))(?![\w])/g;

/**
 * dir を伴わない bare な workflow 名 (`lp-fallback-check.yml` の形)。
 * 直前が `/` のものは path 形式側で解決されるので除外される
 * (dir 付きで書かれた yml や submodule 配下の yml を bare 扱いしないため)。
 */
const BARE_YML_RE = /(?<![\w.*/-])([a-z0-9][a-z0-9-]*\.ya?ml)(?![\w])/g;

/** 空セグメントを含む path は placeholder 由来 (`tests/e2e/<spec>.spec.ts`)。 */
const hasPlaceholderSegment = (p: string): boolean => p.includes('/.') || p.includes('//');

type Ref = { file: string; line: number; ref: string; kind: 'path' | 'script' | 'workflow' };

/** fenced code block は手順例・placeholder が混ざるので検査対象から外す。 */
const stripFencedBlocks = (src: string): string => src.replace(/```[\s\S]*?```/g, '');

/**
 * CLAUDE.md 本文から script / workflow 参照を抽出する。
 *
 * @param file  repo 相対パス (報告用)
 * @param body  file の中身
 */
function extractReferences(file: string, body: string): Ref[] {
	const refs: Ref[] = [];
	stripFencedBlocks(body)
		.split('\n')
		.forEach((line, idx) => {
			const at = idx + 1;
			for (const m of line.matchAll(PATH_RE)) {
				if (!hasPlaceholderSegment(m[1])) refs.push({ file, line: at, ref: m[1], kind: 'path' });
			}
			for (const m of line.matchAll(BARE_SCRIPT_RE)) {
				refs.push({ file, line: at, ref: m[1], kind: 'script' });
			}
			for (const m of line.matchAll(BARE_YML_RE)) {
				refs.push({ file, line: at, ref: m[1], kind: 'workflow' });
			}
		});
	return refs;
}

const trackedFiles = (): string[] =>
	execFileSync('git', ['ls-files'], { cwd: REPO_ROOT, encoding: 'utf8' })
		.split('\n')
		.filter(Boolean);

/**
 * 参照が解決できるか判定する。
 *
 * - `path`: repo root 起点で実在するか
 * - `script` / `workflow`: dir が書かれていないので tracked file の basename と突き合わせる
 */
function resolveMissing(refs: Ref[], tracked: string[]): Ref[] {
	const scriptBaseNames = new Set(
		tracked.filter((p) => p.startsWith('scripts/')).map((p) => p.split('/').pop()),
	);
	const allBaseNames = new Set(tracked.map((p) => p.split('/').pop()));
	return refs.filter((r) => {
		if (r.kind === 'path') return !existsSync(resolve(REPO_ROOT, r.ref));
		if (r.kind === 'script') return !scriptBaseNames.has(r.ref);
		return !allBaseNames.has(r.ref);
	});
}

describe('CLAUDE.md が言及する script / workflow は実在する', () => {
	const tracked = trackedFiles();
	const claudeMdFiles = tracked.filter((p) => p === 'CLAUDE.md' || p.endsWith('/CLAUDE.md'));

	it('走査対象の CLAUDE.md が 1 件以上ある (0 件を pass にしない)', () => {
		expect(claudeMdFiles.length).toBeGreaterThan(0);
	});

	const allRefs = claudeMdFiles.flatMap((f) =>
		extractReferences(f, readFileSync(resolve(REPO_ROOT, f), 'utf8')),
	);

	it('参照を 1 件以上抽出できている (正規表現が壊れたら fail させる)', () => {
		expect(allRefs.length).toBeGreaterThan(0);
	});

	it('死んだ参照が無い', () => {
		const missing = resolveMissing(allRefs, tracked);
		const report = missing.map((m) => `  ${m.file}:${m.line}  [${m.kind}] ${m.ref}`).join('\n');
		expect(
			missing,
			missing.length === 0
				? ''
				: `CLAUDE.md が実在しない script / workflow を参照している:\n${report}\n\n` +
						'撤去済みの検査なら「機械強制は無い (レビューで担保)」と書く。' +
						'行ごと消すとルール自体が無くなったように読まれる。',
		).toEqual([]);
	});

	it('判定ロジックが不在 path を検出できる (検出側の生存確認)', () => {
		const fixture = [
			'`scripts/check-no-plan-literals.mjs` は実在する',
			'`scripts/check-definitely-not-a-real-script.mjs` は実在しない',
			'`definitely-not-a-real-workflow.yml` も実在しない',
		].join('\n');
		const refs = extractReferences('FIXTURE.md', fixture);
		const missing = resolveMissing(refs, tracked).map((m) => m.ref);
		expect(refs.length).toBeGreaterThan(0);
		expect(missing).toContain('scripts/check-definitely-not-a-real-script.mjs');
		expect(missing).toContain('definitely-not-a-real-workflow.yml');
		expect(missing).not.toContain('scripts/check-no-plan-literals.mjs');
	});
});

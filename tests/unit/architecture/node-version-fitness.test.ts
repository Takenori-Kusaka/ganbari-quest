// tests/unit/architecture/node-version-fitness.test.ts
// Issue #4199 — Node の major 宣言がすべて `.nvmrc` と一致することを機械検証する。
//
// ## 背景
//
// 版の宣言がどこにも無く、local と CI が別 major になりうる状態だった (#4199)。
// `.nvmrc` を SSOT に据え、workflow の `node-version: 22` 52 箇所を
// `node-version-file: .nvmrc` に置き換えた。しかし **`.nvmrc` を読めない層**が残る:
//
//   - `Dockerfile*` の `FROM node:<major>`               (build 時の base image)
//   - `infra/lib/*.ts` の `lambda.Runtime.NODEJS_<major>_X` (本番 Lambda runtime)
//
// これらは `.nvmrc` を更新しても追随しない。版違いは明示的な install 失敗ではなく
// **分かりにくい native エラー** (`NODE_MODULE_VERSION` 不一致 / `ERR_DLOPEN_FAILED`)
// として出るため、気づくのが遅れる (#4199 の発端そのもの)。
//
// ## 検査対象を列挙しない (#4199 の指摘そのものを再生産しないため)
//
// 旧実装は Dockerfile 3 本 / stack 4 本を **file 名で手書き列挙**していた。
// これは #4199 本文が問題にした「**配る側の手書きリスト**」(#4191 と同型) と同じ構造で、
// **新しい Dockerfile や新しい stack を足したとき黙って検査対象から漏れる**。
// glob で拾い、**hit 0 件なら fail** させる (glob が空振りしても緑にならない)。
//
// ## major しか見ない
//
// `.nvmrc` は patch pin (`22.23.2`) だが、Docker の `node:22-alpine` も Lambda の
// `NODEJS_22_X` も major しか指定できない。patch を揃える意味は無く、
// **major の不一致だけが実害**なのでそこに絞る。
//
// 新規 script は作らない (#4199 AC5 明示 / チーム憲章 #4175 §4.5 装置 ratchet)。
//
// Canon TDD test list:
//   [NV1] .nvmrc から major を読み取れる
//   [NV2] package.json の engines.node の下限 major と packageManager
//   [NV3] Dockerfile* 全ての `FROM node:<major>` が .nvmrc と一致 (glob、hit 0 で fail)
//   [NV4] infra/lib/**/*.ts 全ての `NODEJS_<major>_X` が .nvmrc と一致 (glob、hit 0 で fail)
//   [NV5] workflow が node-version を直書きしていない (AC4 の 52 箇所置換の回帰検出)
//   [NV6] 検出ロジック自体の生存確認 (fixture で不一致を作れば拾えること)

import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { glob } from 'tinyglobby';
import { describe, expect, it } from 'vitest';

// 走査は 3 系統の glob に限定されるため registry の判定は `bounded` (tests/CLAUDE.md §repo 走査 test)。
// ただし `**/Dockerfile*` はツリーを歩くので、unit lane の並列実行で既定 5s を超えうる。
// bounded でも明示 timeout を置き、「負荷で落ちたのか回帰なのか」の切り分けを不要にする。
const TIMEOUT_MS = 60_000;

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..');

/** `.nvmrc` の major。SSOT はこの 1 箇所。 */
const NVMRC_MAJOR = (() => {
	const raw = readFileSync(join(REPO_ROOT, '.nvmrc'), 'utf8').trim();
	const major = raw.replace(/^v/, '').split('.')[0];
	if (!major || !/^\d+$/.test(major)) {
		throw new Error(`.nvmrc から major を読み取れません: ${JSON.stringify(raw)}`);
	}
	return major;
})();

interface Hit {
	file: string;
	line: number;
	text: string;
	major: string;
}

/** 指定 glob の各 file を行単位で走査し、pattern の capture group 1 を major として拾う。 */
async function collect(patterns: string[], re: RegExp): Promise<Hit[]> {
	const files = await glob(patterns, {
		cwd: REPO_ROOT,
		ignore: ['**/node_modules/**', '**/cdk.out/**', '**/.svelte-kit/**'],
		dot: false,
	});
	const hits: Hit[] = [];
	for (const file of files.sort()) {
		const content = await readFile(join(REPO_ROOT, file), 'utf8');
		for (const [i, line] of content.split(/\r?\n/).entries()) {
			const major = re.exec(line)?.[1];
			if (major) hits.push({ file, line: i + 1, text: line.trim(), major });
			re.lastIndex = 0;
		}
	}
	return hits;
}

function mismatches(hits: Hit[]): string[] {
	return hits
		.filter((h) => h.major !== NVMRC_MAJOR)
		.map((h) => `${h.file}:${h.line} → major ${h.major} (.nvmrc は ${NVMRC_MAJOR}) : ${h.text}`);
}

const DOCKERFILE_GLOB = ['Dockerfile*', '**/Dockerfile*'];
const DOCKERFILE_RE = /^\s*FROM\s+node:(\d+)/i;
const LAMBDA_GLOB = ['infra/lib/**/*.ts'];
const LAMBDA_RE = /lambda\.Runtime\.NODEJS_(\d+)_X/;

describe('Node の major 宣言は .nvmrc を SSOT とする (#4199)', () => {
	it('[NV1] .nvmrc から major を読み取れる', () => {
		expect(NVMRC_MAJOR).toMatch(/^\d+$/);
	});

	it('[NV2] package.json の engines.node 下限 major と packageManager', async () => {
		const pkg = JSON.parse(await readFile(join(REPO_ROOT, 'package.json'), 'utf8')) as {
			engines?: { node?: string };
			packageManager?: string;
		};
		const range = pkg.engines?.node;
		expect(
			range,
			'package.json に engines.node がありません (.npmrc の engine-strict=true が空振りします)',
		).toBeDefined();

		// `>=22.22.2 <23` の下限を取る。`toContain(major)` だと patch 側の数字にも当たるため、
		// **下限版の major を取り出して厳密比較**する。
		//
		// **最初の 1 件だけを見ない** (QM #4400 レビュー指摘): `^22.22.2 || ^24.15.0` のような
		// OR range だと先頭の 22 を拾って合格し、24 系を許してしまう。range 内に現れる
		// **全ての major を集めて全件一致**を要求する (SSOT が 1 つである以上、複数 major を
		// 許す range 自体が SSOT 違反)。
		const majors = [...(range ?? '').matchAll(/(\d+)\.\d+\.\d+/g)].map((m) => m[1]);
		expect(majors.length, `engines.node から下限版を読み取れません: ${range}`).toBeGreaterThan(0);
		expect(
			[...new Set(majors)],
			`engines.node (${range}) が .nvmrc (${NVMRC_MAJOR}) 以外の major を許しています`,
		).toEqual([NVMRC_MAJOR]);

		expect(pkg.packageManager, 'package.json に packageManager がありません').toBeDefined();
	});

	it(
		'[NV3] Dockerfile* の FROM node:<major> が .nvmrc と一致する',
		async () => {
			const hits = await collect(DOCKERFILE_GLOB, DOCKERFILE_RE);
			expect(
				hits.length,
				'Dockerfile の FROM node: 行が 1 つも見つかりません (glob 空振り)',
			).toBeGreaterThan(0);

			const bad = mismatches(hits);
			expect(
				bad,
				'Dockerfile の base image major が .nvmrc と違います。\n' +
					'.nvmrc を上げたら Dockerfile も同時に上げてください (base image は .nvmrc を読みません)。\n' +
					`該当:\n${bad.join('\n')}`,
			).toEqual([]);
		},
		TIMEOUT_MS,
	);

	it(
		'[NV4] Lambda runtime NODEJS_<major>_X が .nvmrc と一致する',
		async () => {
			const hits = await collect(LAMBDA_GLOB, LAMBDA_RE);
			expect(
				hits.length,
				'lambda.Runtime.NODEJS_*_X が 1 つも見つかりません (glob 空振り)',
			).toBeGreaterThan(0);

			const bad = mismatches(hits);
			expect(
				bad,
				'本番 Lambda runtime の major が .nvmrc と違います。\n' +
					'.nvmrc を上げたら infra/lib/*.ts の Runtime も同時に上げてください\n' +
					'(local / CI だけ新 major になり、本番だけ取り残される構造を防ぐため)。\n' +
					`該当:\n${bad.join('\n')}`,
			).toEqual([]);
		},
		TIMEOUT_MS,
	);

	it(
		'[NV5] workflow が node-version を直書きしていない (SSOT は .nvmrc)',
		async () => {
			// #4199 AC4 で `node-version: 22` 52 箇所を `node-version-file: .nvmrc` に置換した。
			// 直書きが 1 箇所でも戻ると版が混在するので、戻りを検出する。
			//
			// **走査対象を先に数える** (QM #4400 レビュー指摘): 本 assert は「直書きが 0 件」を
			// 見るため、glob が 1 file も match しなくても緑になる (空振りと合格が区別できない)。
			// NV3 / NV4 が `toBeGreaterThan(0)` で空振りを弾いているのと同じ anchor をここにも置く。
			// `.yaml` も拾う — 拡張子違いで走査から外れると、そこだけ直書きが復活しても気付けない。
			const WORKFLOW_GLOB = ['.github/workflows/*.yml', '.github/workflows/*.yaml'];
			const scanned = await glob(WORKFLOW_GLOB, { cwd: REPO_ROOT, dot: false });
			expect(
				scanned.length,
				`workflow が 1 file も見つかりません (glob 空振り: ${WORKFLOW_GLOB.join(' / ')})。` +
					'走査 0 件のまま「直書き 0 件」で緑になる状態を防ぐための anchor です',
			).toBeGreaterThan(0);

			const hits = await collect(WORKFLOW_GLOB, /^\s*node-version:\s*['"]?(\d+)/);
			const literal = hits.map((h) => `${h.file}:${h.line} : ${h.text}`);

			expect(
				literal,
				'workflow に node-version の直書きが戻っています。\n' +
					'`node-version-file: .nvmrc` を使ってください (#4199 AC4 — 1 箇所足し忘れれば版が混在します)。\n' +
					`該当:\n${literal.join('\n')}`,
			).toEqual([]);
		},
		TIMEOUT_MS,
	);

	it('[NV6] 不一致を検出できる (検出ロジックの生存確認)', () => {
		// 実 repo が一致している間も検出ロジックが生きていることを示す。
		// これが無いと、regex や比較を壊しても全 test が緑のままになりうる。
		const other = NVMRC_MAJOR === '22' ? '24' : '22';
		const fake: Hit[] = [
			{ file: 'Dockerfile.fake', line: 1, text: `FROM node:${other}-alpine`, major: other },
		];
		expect(mismatches(fake)).toHaveLength(1);
		expect(mismatches([{ ...fake[0]!, major: NVMRC_MAJOR }])).toEqual([]);

		// 正規表現が実際にその形を拾えることも固定する (regex を壊したら落ちる)。
		expect(DOCKERFILE_RE.exec(`FROM node:${other}-alpine`)?.[1]).toBe(other);
		expect(LAMBDA_RE.exec(`runtime: lambda.Runtime.NODEJS_${other}_X,`)?.[1]).toBe(other);
	});
});

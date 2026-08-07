// tests/unit/architecture/node-version-single-source.test.ts
// #4199 AC5: Node の major を宣言している箇所が `.nvmrc` と一致することを機械検証する。
//
// 背景:
//   #4199 で版の SSOT を `.nvmrc` に寄せ、workflow の `node-version: 22` 52 箇所を
//   `node-version-file: .nvmrc` に置き換えた。しかし **`.nvmrc` を読めない層**が残っている:
//
//     - `Dockerfile*` の `FROM node:<major>-alpine`   (build 時の base image)
//     - `infra/lib/*.ts` の `lambda.Runtime.NODEJS_<major>_X` (本番 Lambda runtime)
//
//   これらは `.nvmrc` を更新しても**追随しない**。放置すると「local と CI は 22、
//   本番 Lambda だけ別 major」という、#4199 が問題にした構造がそのまま残る。
//   版違いは明示的な install 失敗ではなく分かりにくい native エラーとして出るため、
//   気づくのが遅れる (#4199 の発端そのもの)。
//
// なぜ「一致」までしか見ないか:
//   patch まで揃える意味は無い。`.nvmrc` は patch pin (22.23.2) だが、Docker の
//   `node:22-alpine` も Lambda の `NODEJS_22_X` も major しか指定できない。
//   **major の不一致だけが実害**なので、そこに絞って検査する。
//
// 新規 script は作らない (#4199 AC5 明示 / チーム憲章 #4175 §4.5 装置 ratchet)。
//
// Canon TDD test list:
//   [NV1] .nvmrc が存在し major を読み取れる
//   [NV2] package.json の engines.node の下限 major が .nvmrc と一致する
//   [NV3] Dockerfile* 全ての `FROM node:<major>` が .nvmrc と一致する
//   [NV4] infra/lib/*.ts 全ての `lambda.Runtime.NODEJS_<major>_X` が .nvmrc と一致する
//   [NV5] 検査対象が 0 件なら fail する (glob が空振りしても緑にならない)

import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { glob } from 'tinyglobby';
import { describe, expect, it } from 'vitest';

// 走査は 3 系統の glob に限定されるため registry の判定は `bounded` (tests/CLAUDE.md §repo 走査 test)。
// ただし `**/Dockerfile*` はツリーを歩くので、unit lane の並列実行で既定 5s を超えうる。
// bounded でも明示 timeout を置いて「負荷で落ちたのか回帰なのか」の切り分けを不要にする。
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

function mismatchReport(hits: Hit[]): string[] {
	return hits
		.filter((h) => h.major !== NVMRC_MAJOR)
		.map((h) => `${h.file}:${h.line} → major ${h.major} (.nvmrc は ${NVMRC_MAJOR}) : ${h.text}`);
}

describe('#4199 Node の major 宣言は .nvmrc を SSOT とする', () => {
	it('[NV1] .nvmrc から major を読み取れる', () => {
		expect(NVMRC_MAJOR).toMatch(/^\d+$/);
	});

	it('[NV2] package.json の engines.node 下限が .nvmrc と同じ major', async () => {
		const pkg = JSON.parse(await readFile(join(REPO_ROOT, 'package.json'), 'utf8')) as {
			engines?: { node?: string };
		};
		const range = pkg.engines?.node;
		expect(
			range,
			'package.json に engines.node がありません (.npmrc の engine-strict=true が空振りします)',
		).toBeDefined();

		// `>=22.22.2 <23` のような range から下限 major を取る。
		const lower = /(\d+)\.\d+\.\d+/.exec(range ?? '');
		expect(lower, `engines.node から下限版を読み取れません: ${range}`).not.toBeNull();
		expect(
			lower?.[1],
			`engines.node (${range}) の下限 major が .nvmrc (${NVMRC_MAJOR}) と違います`,
		).toBe(NVMRC_MAJOR);
	});

	it(
		'[NV3] Dockerfile* の FROM node:<major> が .nvmrc と一致する',
		async () => {
			const hits = await collect(['Dockerfile*', '**/Dockerfile*'], /^\s*FROM\s+node:(\d+)/i);
			expect(
				hits.length,
				'Dockerfile の FROM node: 行が 1 つも見つかりません (glob 空振り)',
			).toBeGreaterThan(0);

			const bad = mismatchReport(hits);
			expect(
				bad,
				`Dockerfile の base image major が .nvmrc と違います。\n` +
					'.nvmrc を上げたら Dockerfile も同時に上げてください (build 時の base image は .nvmrc を読みません)。\n' +
					`該当:\n${bad.join('\n')}`,
			).toEqual([]);
		},
		TIMEOUT_MS,
	);

	it(
		'[NV4] Lambda runtime NODEJS_<major>_X が .nvmrc と一致する',
		async () => {
			const hits = await collect(['infra/lib/**/*.ts'], /lambda\.Runtime\.NODEJS_(\d+)_X/);
			expect(
				hits.length,
				'lambda.Runtime.NODEJS_*_X が 1 つも見つかりません (glob 空振り)',
			).toBeGreaterThan(0);

			const bad = mismatchReport(hits);
			expect(
				bad,
				`本番 Lambda runtime の major が .nvmrc と違います。\n` +
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
			const hits = await collect(['.github/workflows/*.yml'], /^\s*node-version:\s*['"]?(\d+)/);
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
});

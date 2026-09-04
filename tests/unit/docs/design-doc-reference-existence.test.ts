// tests/unit/docs/design-doc-reference-existence.test.ts
//
// 設計書が「現状の正解」であり続けることを機械で保証する fitness function。
//
// # なぜ必要か
//
// ADR-0001 は「書かれていない仕様は存在しない仕様」と定め、`docs/CLAUDE.md` は設計 docs に
// **現状の正解だけ**を書くと定める。だが設計書は実装が動いても静かにずれる。実測 (2026-09-04、
// develop) では:
//
//   - `07-API設計書.md`: 実装済み 11 endpoint が 1 文字も載らず、逆に未実装 6 endpoint
//     (`/api/v1/analytics` / `/api/v1/analytics/status` / `/api/v1/achievements/[childId]` /
//     `/api/v1/admin/plan-status` / `/api/v1/children` / `/api/v1/children/[id]`) が
//     現行仕様として載っていた
//   - `09-テスト設計書.md`: 名指しする E2E spec 9 本が **1 本も存在しなかった**
//     (git 履歴上 一度も作られていない = 願望をファイル名で書いていた)
//   - `parallel-implementations.md`: 「修正前必須」と根 CLAUDE.md が定める文書なのに、
//     撤去済みの DynamoDB backend (`src/lib/server/db/dynamodb/**`) を同期先として指していた
//
// いずれも「読んだ人が誤った前提で実装する」class であり、CI は 1 つも見ていなかった。
//
// # 検査していること
//
// 1. STRICT_DOCS が名指しするリポジトリ内パス (**ファイル + ディレクトリ**) がすべて実在する
// 2. `07-API設計書.md` が言及する `/api/**` の集合と、実装 (`src/routes/api/**/+server.ts`) の
//    集合が**両方向で一致**する (載っていない / 実装が無い のどちらも fail)
// 3. API_PHANTOM_DOCS (07 以外も含む) に、実装が無い endpoint が載っていない (横展開)
// 4. ASSERTED_ABSENT — 設計書が「存在しない / 新規追加禁止」と書く path は、**本当に不在である**
//    (判定を反転させる。skip ではない)
//
// # 検査していないこと (誇張しないための明示)
//
// **path 文字列が本文に現れることしか見ていない。** メソッド (GET/POST) / 認証 / リクエスト /
// レスポンス仕様は無検査で、fenced code block 内も対象外。したがって本 test の緑は
// 「ADR-0001 の Done 基準 (仕様が書かれていること) を満たした」ことを意味しない。
//
// # 対象を STRICT_DOCS に限る理由 (ratchet)
//
// `docs/**` 全体には dead 参照が 100 件超残っており、一括是正は本 test の目的 (drift の再発防止)
// を超える。**STRICT_DOCS を増やすことが ratchet の締め方**であり、減らすのは退行 —
// これはコメントではなく `STRICT_DOCS は縮まない (ratchet)` の test で機械強制する。
//
// 「検査できなかった」を pass にしない (#4084 と同 class):
//   - 抽出した参照 / endpoint が 0 件なら fail (正規表現や glob が壊れたら黙って緑になる)
//   - file / dir の両方を 1 件以上抽出できていること (片方の正規表現が壊れても気づく)
//   - 判定関数自体の生存確認を置く (不在 path / 不在 dir / 未実装 endpoint を含む fixture で
//     検出できること + ファイル path を dir として二重に拾わないこと)

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { findReasonDefect } from '../../../scripts/lib/ci/exclusion-reason.mjs';

// repo 走査 test (`scripts/lib/ci/repo-scan-test-registry.mjs` に scope='repo' で宣言済)。
// unit lane の並列実行で FS を奪い合うと既定 5s を超えうるため明示 timeout を置く (#4085)。
vi.setConfig({ testTimeout: 60_000 });

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

/**
 * dead 参照ゼロを要求する設計書。
 *
 * 増やす方向にだけ動かす (ratchet)。減らすと、その doc の drift が再び検出されなくなる。
 */
const STRICT_DOCS = [
	'docs/design/07-API設計書.md',
	'docs/design/09-テスト設計書.md',
	'docs/design/parallel-implementations.md',
] as const;

/** API 設計書 (endpoint 集合を**両方向**で突合する唯一の doc)。 */
const API_DOC = 'docs/design/07-API設計書.md';

/**
 * **phantom endpoint (実装が無いのに載っている)** を検出する doc。
 *
 * 07 から消した phantom が別の設計書に残る横展開漏れが実測で起きていた
 * (`37-パフォーマンス基準書.md` が実装の無い `GET /api/v1/children` を性能目標として掲載、
 * adversarial review should-3)。「実装にあって載っていない」は 07 だけの責務なので
 * 片方向 (doc → 実装) だけをここで見る。
 */
const API_PHANTOM_DOCS = [
	API_DOC,
	'docs/design/09-テスト設計書.md',
	'docs/design/37-パフォーマンス基準書.md',
] as const;

/**
 * **不在であることを設計書が主張している** path。
 *
 * 「このディレクトリを新設してはいけない」という禁止は、path 名を書かないと守れない
 * (「demo 専用の並行実装を作らない」だけでは、どこに作ってはいけないのかが伝わらない)。
 * かといって素通りさせると、実在検査を名前 1 つで無効化できる抜け道になる。
 *
 * そこで **判定を反転する**: ここに載せた path は「実在しないこと」を assert する。
 * 禁止が破られて実体が復活したら test が落ち、設計書の「0 file」という記述が
 * 嘘になっていることが分かる。skip ではなく逆向きの検査である。
 */
const ASSERTED_ABSENT: readonly { path: string; reason: string }[] = [
	{
		path: 'src/routes/demo/',
		reason:
			'#2097 PR-B3 (#2188) で全削除済み。demo Lambda は AUTH_MODE=anonymous + DATA_SOURCE=demo で本番 routes を直接 host する (ADR-0048) ため、demo 専用ルートの新設は本番との UI 並行実装を復活させる。設計書は「0 file」「新規追加禁止」と書いており、その主張の真偽をここで機械検証する',
	},
];

/** 参照 path の起点として認める repo root 直下の名前。 */
const ROOTS = String.raw`src|tests|scripts|site|docs|infra|static|drizzle|\.github|\.claude|\.storybook`;

/**
 * repo root 起点の **ファイル** path。先頭の `./` / `../` は落として root 起点で解決する。
 * 拡張子の後ろに `\w` が続くものは弾く (`a11y-baseline.json` を `.js` として拾わないため)。
 */
const FILE_RE = new RegExp(
	String.raw`(?:\.{1,2}/)*((?:${ROOTS})/[\w./*[\]-]*\.(?:ts|tsx|js|mjs|cjs|svelte|css|html|json|yml|yaml|md))(?![\w])`,
	'g',
);

/**
 * repo root 起点の **ディレクトリ** 参照 (末尾 `/`)。
 *
 * ファイルだけを見ていると、`src/lib/server/db/dynamodb/` のような**撤去済みディレクトリを
 * 「同期先」として指す記述が素通りする** — 本 test が塞ぐと宣言した drift そのものの形なのに
 * 検査していなかった (adversarial review must-1)。並行実装マップは backend / 層を
 * ディレクトリ単位で指すため、ここを見ないと宣言が実測より広くなる。
 *
 * 末尾 `/` の直後に `\w` / `.` が続くものは除外する (ファイル path の途中を
 * ディレクトリとして二重に拾わないため)。
 */
const DIR_RE = new RegExp(String.raw`(?:\.{1,2}/)*((?:${ROOTS})(?:/[\w.*[\]-]+)*/)(?![\w.])`, 'g');

/** fenced code block は設定サンプル / 手順例で、実在を要求すべき「参照」ではない。 */
const stripFencedBlocks = (src: string): string => src.replace(/```[\s\S]*?```/g, '');

type Ref = { file: string; line: number; ref: string; kind: 'file' | 'dir' };

/** doc 本文から repo 内 path 参照 (ファイル + ディレクトリ) を抽出する。 */
function extractPathRefs(file: string, body: string): Ref[] {
	const refs: Ref[] = [];
	stripFencedBlocks(body)
		.split('\n')
		.forEach((line, idx) => {
			const collect = (re: RegExp, kind: Ref['kind']) => {
				for (const m of line.matchAll(re)) {
					const ref = m[1];
					if (!ref) continue;
					refs.push({ file, line: idx + 1, ref, kind });
				}
			};
			collect(FILE_RE, 'file');
			collect(DIR_RE, 'dir');
		});
	return refs;
}

/**
 * glob (`*` を含む path) を depth 制限なしで解決する。1 件でも当たれば実在扱い。
 *
 * @param wantDir true ならディレクトリに当たったときだけ実在扱い (末尾 `/` の参照用)
 */
function globMatches(pattern: string, wantDir = false): boolean {
	const parts = pattern.replace(/\/$/, '').split('/');
	const isTarget = (p: string): boolean =>
		existsSync(p) && (wantDir ? statSync(p).isDirectory() : statSync(p).isFile());
	const isDir = (p: string): boolean => existsSync(p) && statSync(p).isDirectory();

	const walk = (dir: string, i: number): boolean => {
		if (i === parts.length) return isTarget(dir);
		const seg = parts[i];
		if (seg === undefined) return false;
		if (seg === '**') {
			// `**` は 0 段以上。現在位置と全サブディレクトリで残りを試す。
			if (walk(dir, i + 1)) return true;
			if (!isDir(dir)) return false;
			return readdirSync(dir).some((e) => isDir(join(dir, e)) && walk(join(dir, e), i));
		}
		if (!seg.includes('*')) return walk(join(dir, seg), i + 1);
		if (!isDir(dir)) return false;
		const re = new RegExp(`^${seg.split('*').map(escapeRe).join('[^/]*')}$`);
		return readdirSync(dir).some((e) => re.test(e) && walk(join(dir, e), i + 1));
	};
	return walk(REPO_ROOT, 0);
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const assertedAbsentPaths = new Set(ASSERTED_ABSENT.map((e) => e.path.replace(/\/$/, '')));

/**
 * 実在しない参照だけを返す。ディレクトリ参照は「ディレクトリとして」実在することを要求する。
 * `ASSERTED_ABSENT` の path は別 test が逆向き (不在であること) に assert するので除く。
 */
function missingRefs(refs: Ref[]): Ref[] {
	return refs.filter((r) => {
		if (assertedAbsentPaths.has(r.ref.replace(/\/$/, ''))) return false;
		const wantDir = r.kind === 'dir';
		if (r.ref.includes('*')) return !globMatches(r.ref, wantDir);
		const abs = resolve(REPO_ROOT, r.ref);
		if (!existsSync(abs)) return true;
		return wantDir ? !statSync(abs).isDirectory() : false;
	});
}

// ------------------------------------------------------------------
// API endpoint 集合
// ------------------------------------------------------------------

/**
 * `[id]` / `:id` / `{id}` と、テストケース表が使う**具体的な数値 id** (`/points/1` / `/status/999`)
 * を 1 つの placeholder に畳んで比較する。
 */
const normalizeApiPath = (p: string): string =>
	p
		.replace(/\[[^\]]+\]|:[A-Za-z][A-Za-z0-9_]*|\{[^}]+\}/g, ':P')
		.replace(/\/\d+(?=\/|$)/g, '/:P')
		.replace(/\/$/, '');

/** 実装されている API route path (`/api/...`) を FS 列挙する。 */
function implementedApiPaths(): string[] {
	const toPosix = (p: string): string => p.split('\\').join('/');
	const apiRoot = toPosix(join(REPO_ROOT, 'src/routes/api'));
	const out: string[] = [];
	const walk = (dir: string) => {
		for (const e of readdirSync(dir)) {
			const p = join(dir, e);
			if (statSync(p).isDirectory()) walk(p);
			else if (e === '+server.ts') {
				const rel = toPosix(p)
					.slice(apiRoot.length)
					.replace(/\/\+server\.ts$/, '');
				out.push(`/api${rel}`);
			}
		}
	};
	walk(apiRoot);
	return out.sort();
}

/**
 * doc 本文が言及する `/api/**` path を抽出する。
 *
 * 直後が `*` / `<` のものは prefix 表記 (`/api/v1/**` / `/api/cron/<name>` / `/api/v1/admin/*`)
 * なので endpoint ではない。`/api` 単体も除外する。
 */
function docApiPaths(body: string): string[] {
	const found = new Set<string>();
	const src = stripFencedBlocks(body);
	// 先頭の `/api/` が path の途中でないこと (`tests/integration/api/point-api.test.ts` の
	// 部分文字列を endpoint と誤認しない)。
	const re = /(?<![\w/.-])\/api\/[A-Za-z0-9_\-/[\]:{}.]+/g;
	for (const m of src.matchAll(re)) {
		const end = (m.index ?? 0) + m[0].length;
		const next = src[end];
		if (next === '*' || next === '<') continue;
		const path = m[0].replace(/[.,`)]+$/, '');
		if (path.split('/').filter(Boolean).length < 2) continue;
		found.add(normalizeApiPath(path));
	}
	return [...found].sort();
}

// ------------------------------------------------------------------

describe('設計書が名指しするリポジトリ内パスは実在する', () => {
	// 走査対象の doc がすべて読める (rename で黙って 0 件にならない)
	it('STRICT_DOCS がすべて実在する', () => {
		expect(STRICT_DOCS.length).toBeGreaterThan(0);
		for (const d of STRICT_DOCS) {
			expect(existsSync(resolve(REPO_ROOT, d)), `${d} が無い`).toBe(true);
		}
	});

	// ratchet を機械強制する。
	// これが無いと STRICT_DOCS を 1 本に縮めるだけで残り 2 本の drift 検査が黙って消える
	// (「減らすのは退行」はコメントに書いただけでは守られない、adversarial review should-2)。
	it('STRICT_DOCS は縮まない (ratchet)', () => {
		const REQUIRED = [
			'docs/design/07-API設計書.md',
			'docs/design/09-テスト設計書.md',
			'docs/design/parallel-implementations.md',
		];
		expect(
			REQUIRED.filter((d) => !STRICT_DOCS.includes(d as (typeof STRICT_DOCS)[number])),
			'STRICT_DOCS から doc を外すと、その doc の dead 参照が再び検出されなくなる。' +
				'増やすのは歓迎、減らすのは退行。',
		).toEqual([]);
		expect(STRICT_DOCS.length).toBeGreaterThanOrEqual(REQUIRED.length);
	});

	const allRefs = STRICT_DOCS.flatMap((d) =>
		extractPathRefs(d, readFileSync(resolve(REPO_ROOT, d), 'utf8')),
	);

	it('参照を 1 件以上抽出できている (正規表現が壊れたら fail させる)', () => {
		expect(allRefs.length).toBeGreaterThan(20);
		// file / dir の両方を拾えていること (片方の正規表現が壊れても気づけるように)
		expect(allRefs.filter((r) => r.kind === 'file').length).toBeGreaterThan(20);
		expect(allRefs.filter((r) => r.kind === 'dir').length).toBeGreaterThan(0);
	});

	it('死んだ参照が無い', () => {
		const missing = missingRefs(allRefs);
		const report = missing.map((m) => `  ${m.file}:${m.line}  [${m.kind}] ${m.ref}`).join('\n');
		expect(
			missing,
			missing.length === 0
				? ''
				: `設計書が実在しないファイル / ディレクトリを指している:\n${report}\n\n` +
						'撤去済みなら、その名前を書かずに「何が無くなったか」を書く ' +
						'(名前を残すと読者は探しに行く)。改名なら現在の名前に貼り替える。',
		).toEqual([]);
	});

	it('判定ロジックが不在 file を検出できる (検出側の生存確認)', () => {
		const fixture = [
			'`src/lib/domain/labels.ts` は実在する',
			'`src/lib/domain/definitely-not-a-real-module.ts` は実在しない',
			'`tests/e2e/*.spec.ts` は glob で当たる',
			'`tests/e2e/definitely-not-*.spec.ts` は glob でも当たらない',
		].join('\n');
		const refs = extractPathRefs('FIXTURE.md', fixture);
		expect(refs.filter((r) => r.kind === 'file').length).toBe(4);
		const missing = missingRefs(refs).map((m) => m.ref);
		expect(missing).toContain('src/lib/domain/definitely-not-a-real-module.ts');
		expect(missing).toContain('tests/e2e/definitely-not-*.spec.ts');
		expect(missing).not.toContain('src/lib/domain/labels.ts');
		expect(missing).not.toContain('tests/e2e/*.spec.ts');
	});

	it('判定ロジックが不在ディレクトリを検出できる (must-1 の再発防止)', () => {
		// 撤去済み backend を「同期先」として指す形。ファイル path 検査だけでは素通りしていた。
		const fixture = [
			'`src/lib/server/db/sqlite/` は実在する',
			'`src/lib/server/db/dynamodb/` は撤去済みで実在しない',
		].join('\n');
		const refs = extractPathRefs('FIXTURE.md', fixture);
		const dirs = refs.filter((r) => r.kind === 'dir').map((r) => r.ref);
		expect(dirs).toContain('src/lib/server/db/sqlite/');
		expect(dirs).toContain('src/lib/server/db/dynamodb/');

		const missing = missingRefs(refs).map((m) => m.ref);
		expect(missing).toContain('src/lib/server/db/dynamodb/');
		expect(missing).not.toContain('src/lib/server/db/sqlite/');
	});

	it('ファイルをディレクトリ参照として二重に拾わない (誤検出側の生存確認)', () => {
		const refs = extractPathRefs('FIXTURE.md', '`src/lib/domain/labels.ts` を参照する');
		expect(refs.filter((r) => r.kind === 'dir')).toEqual([]);
	});

	it('「存在しない」と設計書が主張する path は、本当に存在しない', () => {
		const revived = ASSERTED_ABSENT.filter((e) => existsSync(resolve(REPO_ROOT, e.path))).map(
			(e) => e.path,
		);
		expect(
			revived,
			revived.length === 0
				? ''
				: `設計書が「存在しない / 新規追加禁止」と書いている path が復活している:\n` +
						`${revived.map((p) => `  ${p}`).join('\n')}\n\n` +
						'実体を消すか、禁止が撤回されたなら設計書の記述と ASSERTED_ABSENT を同時に直す。',
		).toEqual([]);
	});

	it('ASSERTED_ABSENT の除外理由が stub でない', () => {
		const defects = ASSERTED_ABSENT.map((e) => ({
			path: e.path,
			defect: findReasonDefect(e.reason),
		}))
			.filter((r) => r.defect !== null)
			.map((r) => `${r.path}: ${r.defect}`);
		expect(
			defects,
			'不在主張の除外は「なぜ名前を書いてよいか」を人が書く (#4030 と同じ規律)',
		).toEqual([]);
	});
});

describe('07-API設計書 の endpoint 集合は実装と一致する', () => {
	const impl = implementedApiPaths();
	const doc = docApiPaths(readFileSync(resolve(REPO_ROOT, API_DOC), 'utf8'));

	it('実装 endpoint / 設計書 endpoint を 1 件以上抽出できている', () => {
		expect(impl.length).toBeGreaterThan(50);
		expect(doc.length).toBeGreaterThan(50);
	});

	it('実装されているのに設計書に無い endpoint が無い', () => {
		const docSet = new Set(doc);
		const missing = impl.filter((p) => !docSet.has(normalizeApiPath(p)));
		expect(
			missing,
			missing.length === 0
				? ''
				: `実装済みだが 07-API設計書.md に載っていない endpoint:\n${missing.map((m) => `  ${m}`).join('\n')}\n\n` +
						'ADR-0001: 書かれていない仕様は存在しない仕様。§2 の該当表に行を足す。',
		).toEqual([]);
	});

	it('設計書に載っているのに実装が無い endpoint が無い', () => {
		const implSet = new Set(impl.map(normalizeApiPath));
		const phantom = doc.filter((p) => !implSet.has(p));
		expect(
			phantom,
			phantom.length === 0
				? ''
				: `07-API設計書.md に載っているが実装が無い endpoint:\n${phantom.map((m) => `  ${m}`).join('\n')}\n\n` +
						'未実装 / 撤去済みを現行仕様として載せない (ADR-0013 の精神)。' +
						'記述ごと落とし、履歴は git に委ねる。',
		).toEqual([]);
	});

	it('判定ロジックが phantom / 未記載を検出できる (検出側の生存確認)', () => {
		const implSet = new Set(impl.map(normalizeApiPath));
		expect(implSet.has('/api/v1/activities')).toBe(true);
		expect(implSet.has('/api/v1/definitely-not-real')).toBe(false);

		const extracted = docApiPaths(
			[
				'| GET | /api/v1/activities | 活動一覧 | 全ロール |',
				'| GET | /api/v1/definitely-not-real | 存在しない | — |',
				'`src/routes/api/v1/**/+server.ts` で定義（prefix 表記は endpoint ではない）',
				'`/api/cron/<name>` の 2xx 応答時に記録（placeholder も endpoint ではない）',
			].join('\n'),
		);
		expect(extracted).toContain('/api/v1/activities');
		expect(extracted).toContain('/api/v1/definitely-not-real');
		expect(extracted).not.toContain('/api/v1');
		expect(extracted).not.toContain('/api/cron');

		// file path の途中にある `/api/` を endpoint と誤認しない
		const fromFilePath = docApiPaths('`tests/integration/api/point-api.test.ts` が検証する');
		expect(fromFilePath).toEqual([]);
	});
});

describe('他の設計書にも phantom endpoint が残っていない (横展開)', () => {
	const implSet = new Set(implementedApiPaths().map(normalizeApiPath));

	it('API_PHANTOM_DOCS は API_DOC を含み、縮まない (ratchet)', () => {
		expect(API_PHANTOM_DOCS).toContain(API_DOC);
		expect(API_PHANTOM_DOCS.length).toBeGreaterThanOrEqual(3);
	});

	it('実装が無い endpoint を載せている設計書が無い', () => {
		const phantom: string[] = [];
		let extracted = 0;
		for (const d of API_PHANTOM_DOCS) {
			const paths = docApiPaths(readFileSync(resolve(REPO_ROOT, d), 'utf8'));
			extracted += paths.length;
			for (const p of paths) if (!implSet.has(p)) phantom.push(`  ${d}: ${p}`);
		}
		// 抽出 0 件を pass にしない (正規表現が壊れたら黙って緑になる)
		expect(extracted).toBeGreaterThan(50);
		expect(
			phantom,
			phantom.length === 0
				? ''
				: `実装が無い endpoint を現行仕様として載せている設計書がある:\n${phantom.join('\n')}\n\n` +
						'07 から phantom を消しても、同じ endpoint が別の設計書に残ると読者は実在すると信じる。',
		).toEqual([]);
	});

	it('具体的な数値 id を placeholder として畳める (テストケース表の形)', () => {
		// 09 のテストケース表は `/api/v1/points/1` のように実 id を書く。
		// 畳めないと実在する endpoint を phantom と誤判定する。
		expect(normalizeApiPath('/api/v1/points/1/history')).toBe('/api/v1/points/:P/history');
		expect(normalizeApiPath('/api/v1/status/999')).toBe('/api/v1/status/:P');
		// 数値でないセグメントは畳まない (別 endpoint を同一視しない)
		expect(normalizeApiPath('/api/v1/points/convert')).toBe('/api/v1/points/convert');
	});
});

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
// 1. STRICT_DOCS が名指しするリポジトリ内パスがすべて実在する
// 2. `07-API設計書.md` が言及する `/api/**` の集合と、実装 (`src/routes/api/**/+server.ts`) の
//    集合が**両方向で一致**する (載っていない / 実装が無い のどちらも fail)
//
// # 対象を STRICT_DOCS に限る理由 (ratchet)
//
// `docs/**` 全体には dead 参照が 100 件超残っており、一括是正は本 test の目的 (drift の再発防止)
// を超える。**STRICT_DOCS を増やすことが ratchet の締め方**であり、減らすのは退行。
//
// 「検査できなかった」を pass にしない (#4084 と同 class):
//   - 抽出した参照 / endpoint が 0 件なら fail (正規表現や glob が壊れたら黙って緑になる)
//   - 判定関数自体の生存確認を置く (不在 path / 未実装 endpoint を含む fixture で検出できること)

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

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

/** API 設計書 (endpoint 集合の突合対象)。 */
const API_DOC = 'docs/design/07-API設計書.md';

/** 参照 path の起点として認める repo root 直下の名前。 */
const ROOTS = String.raw`src|tests|scripts|site|docs|infra|static|drizzle|\.github|\.claude|\.storybook`;

/**
 * repo root 起点の path 形式。先頭の `./` / `../` は落として root 起点で解決する。
 * 拡張子の後ろに `\w` が続くものは弾く (`a11y-baseline.json` を `.js` として拾わないため)。
 */
const PATH_RE = new RegExp(
	String.raw`(?:\.{1,2}/)*((?:${ROOTS})/[\w./*[\]-]*\.(?:ts|tsx|js|mjs|cjs|svelte|css|html|json|yml|yaml|md))(?![\w])`,
	'g',
);

/** fenced code block は設定サンプル / 手順例で、実在を要求すべき「参照」ではない。 */
const stripFencedBlocks = (src: string): string => src.replace(/```[\s\S]*?```/g, '');

type Ref = { file: string; line: number; ref: string };

/** doc 本文から repo 内 path 参照を抽出する。 */
function extractPathRefs(file: string, body: string): Ref[] {
	const refs: Ref[] = [];
	stripFencedBlocks(body)
		.split('\n')
		.forEach((line, idx) => {
			for (const m of line.matchAll(PATH_RE)) {
				const ref = m[1];
				if (!ref) continue;
				refs.push({ file, line: idx + 1, ref });
			}
		});
	return refs;
}

/** glob (`*` を含む path) を depth 制限なしで解決する。1 件でも当たれば実在扱い。 */
function globMatches(pattern: string): boolean {
	const parts = pattern.split('/');
	const walk = (dir: string, i: number): boolean => {
		if (i === parts.length) return existsSync(dir) && statSync(dir).isFile();
		const seg = parts[i];
		if (seg === undefined) return false;
		if (seg === '**') {
			// `**` は 0 段以上。現在位置と全サブディレクトリで残りを試す。
			if (walk(dir, i + 1)) return true;
			if (!existsSync(dir) || !statSync(dir).isDirectory()) return false;
			return readdirSync(dir).some((e) => {
				const p = join(dir, e);
				return statSync(p).isDirectory() && walk(p, i);
			});
		}
		if (!seg.includes('*')) return walk(join(dir, seg), i + 1);
		if (!existsSync(dir) || !statSync(dir).isDirectory()) return false;
		const re = new RegExp(`^${seg.split('*').map(escapeRe).join('[^/]*')}$`);
		return readdirSync(dir).some((e) => re.test(e) && walk(join(dir, e), i + 1));
	};
	return walk(REPO_ROOT, 0);
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 実在しない参照だけを返す。 */
function missingRefs(refs: Ref[]): Ref[] {
	return refs.filter((r) =>
		r.ref.includes('*') ? !globMatches(r.ref) : !existsSync(resolve(REPO_ROOT, r.ref)),
	);
}

// ------------------------------------------------------------------
// API endpoint 集合
// ------------------------------------------------------------------

/** `[id]` / `:id` / `{id}` を 1 つの placeholder に畳んで比較する。 */
const normalizeApiPath = (p: string): string =>
	p.replace(/\[[^\]]+\]|:[A-Za-z][A-Za-z0-9_]*|\{[^}]+\}/g, ':P').replace(/\/$/, '');

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
	const re = /\/api\/[A-Za-z0-9_\-/[\]:{}.]+/g;
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

	const allRefs = STRICT_DOCS.flatMap((d) =>
		extractPathRefs(d, readFileSync(resolve(REPO_ROOT, d), 'utf8')),
	);

	it('参照を 1 件以上抽出できている (正規表現が壊れたら fail させる)', () => {
		expect(allRefs.length).toBeGreaterThan(20);
	});

	it('死んだ参照が無い', () => {
		const missing = missingRefs(allRefs);
		const report = missing.map((m) => `  ${m.file}:${m.line}  ${m.ref}`).join('\n');
		expect(
			missing,
			missing.length === 0
				? ''
				: `設計書が実在しないファイルを指している:\n${report}\n\n` +
						'撤去済みなら、その file 名を書かずに「何が無くなったか」を書く ' +
						'(名前を残すと読者は探しに行く)。改名なら現在の名前に貼り替える。',
		).toEqual([]);
	});

	it('判定ロジックが不在 path を検出できる (検出側の生存確認)', () => {
		const fixture = [
			'`src/lib/domain/labels.ts` は実在する',
			'`src/lib/domain/definitely-not-a-real-module.ts` は実在しない',
			'`tests/e2e/*.spec.ts` は glob で当たる',
			'`tests/e2e/definitely-not-*.spec.ts` は glob でも当たらない',
		].join('\n');
		const refs = extractPathRefs('FIXTURE.md', fixture);
		expect(refs.length).toBe(4);
		const missing = missingRefs(refs).map((m) => m.ref);
		expect(missing).toContain('src/lib/domain/definitely-not-a-real-module.ts');
		expect(missing).toContain('tests/e2e/definitely-not-*.spec.ts');
		expect(missing).not.toContain('src/lib/domain/labels.ts');
		expect(missing).not.toContain('tests/e2e/*.spec.ts');
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
	});
});

/**
 * tests/unit/scripts/check-local-tz-date-getters.test.ts (#4015 → #4127)
 *
 * `scripts/check-local-tz-date-getters.mjs` の純関数を検証する。
 *
 * 実 repo 全走査 (`findAllOccurrences`) は CI / pre-ready の専用 step が authoritative で、
 * unit lane では行わない (#4000 / #4051 の判断に整合)。本 test が担うのは
 * **gate のロジックが意図どおり落ちること**の表明:
 *
 *   - #4127 で素通ししていた 3 つの書き方 (getHours / toISOString().slice / toLocale*) を検出する
 *   - 分類が `Date.prototype` を網羅している (将来メンバーが増えても黙って安全側に落ちない)
 *   - allowlist 未登録 file / max 超過 / stale entry を検出する (no-silent-gap + ratchet)
 *   - kind ごとの機械検査が効く (自由文の reason だけでは通らない、#4127 残存 3 の直対処)
 *   - UTC getter / 数値の桁区切り / timeZone 明示済の toLocale* は検出しない (誤検知しない)
 */

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
	ALLOWLIST,
	ALLOWLIST_KINDS,
	AMBIGUOUS_MEMBERS,
	classifyDateMembers,
	classifyLine,
	DATE_RECEIVER_AMBIGUOUS_CALL,
	EXCLUDED_ROOTS,
	evaluateOccurrences,
	findAllowlistEntry,
	findAllowlistIntegrityProblems,
	findAmbiguousDeclarationProblems,
	findOccurrencesInContent,
	findUnclassifiedDateMembers,
	groupByFile,
	isCommentLine,
	NON_RUNTIME_PATTERNS,
	SEARCH_ROOTS,
} from '../../../scripts/check-local-tz-date-getters.mjs';

/** 違反 1 件を作るヘルパ */
function occ(file: string, line = 1, snippet = 'x', kind = 'tz-dependent-member') {
	return { file, line, snippet, kind };
}

describe('check-local-tz-date-getters (#4015 / #4127)', () => {
	describe('欠陥クラスの検出 — #4127 で素通しした書き方', () => {
		it.each([
			// #4127 残存 1: 列挙に無かった getter
			['const hour = ctx.recordedAt.getHours();', 'tz-dependent-member'],
			['const min = d.getMinutes();', 'tz-dependent-member'],
			['const s = d.getSeconds();', 'tz-dependent-member'],
			['const label = d.toDateString();', 'tz-dependent-member'],
			// #4015 で見ていた 4 語 (回帰)
			['const y = now.getFullYear();', 'tz-dependent-member'],
			['const m = now.getMonth() + 1;', 'tz-dependent-member'],
			['d.setDate(d.getDate() - 1);', 'tz-dependent-member'],
			['const w = now.getDay();', 'tz-dependent-member'],
			// #4127 残存 2: getter を 1 つも使わずに UTC の暦日を作る
			['const today = new Date().toISOString().slice(0, 10);', 'utc-calendar-slice'],
			['const month = new Date().toISOString().substring(0, 7);', 'utc-calendar-slice'],
			["const d = new Date().toISOString().split('T')[0];", 'utc-calendar-slice'],
			['const j = d.toJSON().slice(0, 10);', 'utc-calendar-slice'],
			// 表示側: プロセス TZ (SSR は Lambda=UTC) で暦日が決まる
			["{new Date(log.recordedAt).toLocaleDateString('ja-JP')}", 'implicit-locale-tz'],
			["{new Date(kpi.fetchedAt).toLocaleString('ja-JP')}", 'implicit-locale-tz'],
			["unlockTime.toLocaleTimeString('ja-JP', { hour: '2-digit' })", 'implicit-locale-tz'],
			["const f = new Intl.DateTimeFormat('ja-JP', { dateStyle: 'short' });", 'implicit-locale-tz'],
		])('検出する: %s', (line, kind) => {
			expect(classifyLine(line)?.kind).toBe(kind);
		});

		it.each([
			// UTC getter は TZ 非依存
			'const y = now.getUTCFullYear();',
			'const d = now.getUTCDate();',
			'd.setUTCDate(d.getUTCDate() + 7);',
			'const t = now.getTime();',
			'const iso = now.toISOString();',
			// 数値 / Buffer の同名メソッド (曖昧メンバーの誤検知)
			"const p = points.toLocaleString('ja-JP');",
			'const yen = revenue.totalRevenue.toLocaleString();',
			"const token = randomBytes(32).toString('base64url');",
			// timeZone を明示していれば TZ 非依存
			"new Date(x).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' })",
			"new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo' })",
			// JST SSOT 経由
			'const today = todayDateJST();',
			'const s = toJSTDateString(now).slice(0, 7);',
		])('検出しない: %s', (line) => {
			expect(classifyLine(line)).toBeNull();
		});

		it('toLocale* の option object が複数行に割れていても timeZone を見つける', () => {
			const content = [
				"const s = new Date(x).toLocaleDateString('ja-JP', {",
				"\ttimeZone: 'Asia/Tokyo',",
				'});',
			].join('\n');
			expect(findOccurrencesInContent('src/x.svelte', content)).toEqual([]);
		});
	});

	describe('分類の網羅 — 記法の列挙ではなく Date.prototype から導出する', () => {
		it('Date.prototype に未分類のメンバーが無い', () => {
			expect(findUnclassifiedDateMembers()).toEqual([]);
		});

		it('safe / dependent の和が Date.prototype の全メンバーと一致する', () => {
			const { safe, dependent } = classifyDateMembers();
			expect([...safe, ...dependent].sort()).toEqual(
				Object.getOwnPropertyNames(Date.prototype).sort(),
			);
		});

		it('ローカル getter / setter は dependent 側に入る', () => {
			const { dependent } = classifyDateMembers();
			for (const name of ['getFullYear', 'getMonth', 'getDate', 'getDay', 'getHours', 'setDate']) {
				expect(dependent).toContain(name);
			}
		});

		it('UTC 系 / 瞬間系は safe 側に入る', () => {
			const { safe } = classifyDateMembers();
			for (const name of ['getUTCDate', 'setUTCDate', 'getTime', 'toISOString', 'toUTCString']) {
				expect(safe).toContain(name);
			}
		});
	});

	describe('曖昧メンバー宣言の自己検査 (#4127 — 宣言だけで検出を消させない)', () => {
		it('現在の AMBIGUOUS_MEMBERS 宣言は検査を全件通る', () => {
			expect(findAmbiguousDeclarationProblems()).toEqual([]);
		});

		it('宣言した全メンバーに補償検出 (DATE_RECEIVER_AMBIGUOUS_CALL) が存在する', () => {
			for (const member of Object.keys(AMBIGUOUS_MEMBERS)) {
				expect(DATE_RECEIVER_AMBIGUOUS_CALL.source).toContain(member);
			}
		});

		it.each([
			// 受け手の命名で Date と分かる形 (末尾修飾込み)
			"const s = expiresOn.toLocaleString('ja-JP');",
			"const s = createdAtIso.toLocaleString('ja-JP');",
			"const s = validUntil.toLocaleString('ja-JP');",
			// 命名で分からなくても日時整形オプションで分かる形
			"const s = x.toLocaleString('ja-JP', { dateStyle: 'short' });",
			"const s = v.toLocaleString('ja-JP', { hour: '2-digit' });",
		])('曖昧メンバーでも受け手が Date と分かる形は検出する: %s', (line) => {
			expect(classifyLine(line)?.kind).toBe('implicit-locale-tz');
		});

		it.each([
			"const p = points.toLocaleString('ja-JP');",
			'const yen = revenue.totalRevenue.toLocaleString();',
			"const n = count.toLocaleString('ja-JP');",
		])('数値の桁区切りは検出しない: %s', (line) => {
			expect(classifyLine(line)).toBeNull();
		});
	});

	describe('isCommentLine — 経緯コメントは許容', () => {
		it.each([
			'// 旧実装は now.getFullYear() を使っていた',
			' * `Date.getMonth()` はローカル TZ 依存',
			'/* getDate() の説明 */',
			'<!-- getDay() -->',
		])('コメント行と判定する: %s', (line) => {
			expect(isCommentLine(line)).toBe(true);
		});

		it('コード行はコメントと判定しない', () => {
			expect(isCommentLine('\tconst y = now.getFullYear(); // 説明')).toBe(false);
		});
	});

	describe('findOccurrencesInContent', () => {
		it('コード行のみを行番号 + kind 付きで返す', () => {
			const content = [
				'// getFullYear() の説明コメント',
				'const a = now.getUTCFullYear();',
				'const b = now.getFullYear();',
			].join('\n');
			const found = findOccurrencesInContent('src/x.ts', content);
			expect(found).toHaveLength(1);
			expect(found[0]?.line).toBe(3);
			expect(found[0]?.kind).toBe('tz-dependent-member');
		});

		it('Windows パスは / 区切りに正規化される', () => {
			const found = findOccurrencesInContent('src\\lib\\x.ts', 'const b = now.getFullYear();');
			expect(found[0]?.file).toBe('src/lib/x.ts');
		});
	});

	describe('evaluateOccurrences — no-silent-gap / ratchet', () => {
		it('allowlist 未登録 file の occurrence は not-allowlisted で違反になる', () => {
			const violations = evaluateOccurrences([occ('src/lib/server/services/brand-new-service.ts')]);
			expect(violations).toHaveLength(1);
			expect(violations[0]?.kind).toBe('not-allowlisted');
		});

		it('allowlist 済 file でも max を超えたら over-max で違反になる', () => {
			const file = 'src/lib/server/services/grace-period-service.ts';
			const entry = findAllowlistEntry(file);
			expect(entry).toBeDefined();
			const over = Array.from({ length: (entry?.max ?? 0) + 1 }, (_, i) => occ(file, i + 1));
			const violations = evaluateOccurrences(over);
			expect(violations).toHaveLength(1);
			expect(violations[0]?.kind).toBe('over-max');
		});

		it('allowlist 済 file が max 以内なら違反にならない', () => {
			expect(evaluateOccurrences([occ('src/lib/server/services/grace-period-service.ts')])).toEqual(
				[],
			);
		});

		it('occurrence 0 件なら違反 0 件', () => {
			expect(evaluateOccurrences([])).toEqual([]);
		});
	});

	describe('allowlist の kind 機械検査 (#4127 — 自由文の reason だけでは通さない)', () => {
		it('現在の allowlist は kind 検査を全件通る', () => {
			// occurrencesByFile を空にすると stale 検査が働かない設計 (第 2 引数の意味を固定する)
			expect(findAllowlistIntegrityProblems()).toEqual([]);
		});

		it('kind=instant-offset は「setX(getX() ± n)」以外の行を許さない', () => {
			const file = 'src/lib/server/services/grace-period-service.ts';
			const problems = findAllowlistIntegrityProblems(
				groupByFile([occ(file, 12, 'return d.toISOString().slice(0, 10);', 'utc-calendar-slice')]),
			);
			expect(problems.map((p) => p.file)).toContain(file);
			expect(problems.find((p) => p.file === file)?.problem).toMatch(/instant-offset/);
		});

		it('kind=instant-offset は「setX(getX() ± n)」構造なら通る', () => {
			const file = 'src/lib/server/services/grace-period-service.ts';
			const problems = findAllowlistIntegrityProblems(
				groupByFile([occ(file, 12, 'd.setDate(d.getDate() + GRACE_DAYS);')]),
			).filter((p) => p.file === file);
			expect(problems).toEqual([]);
		});

		it('違反が 0 件になった entry は stale として検出される', () => {
			// 別 file の occurrence だけを渡す = allowlist 済 file の違反が消えた状態
			const problems = findAllowlistIntegrityProblems(
				groupByFile([
					occ('src/lib/server/services/grace-period-service.ts', 12, 'd.setDate(d.getDate() + 1);'),
				]),
			);
			expect(problems.some((p) => p.problem.includes('stale allowlist'))).toBe(true);
		});

		it('allowlist entry は file / max / kind / reason を持ち、kind は既知の値である', () => {
			for (const e of ALLOWLIST) {
				expect(typeof e.file).toBe('string');
				expect(typeof e.max).toBe('number');
				expect(e.max).toBeGreaterThanOrEqual(0);
				expect(typeof e.reason).toBe('string');
				expect(e.reason.trim().length).toBeGreaterThan(0);
				expect(ALLOWLIST_KINDS).toContain(e.kind);
			}
		});

		it('kind=non-runtime は非 runtime path のみ (path で機械判定できる)', () => {
			for (const e of ALLOWLIST.filter((x) => x.kind === 'non-runtime')) {
				expect(NON_RUNTIME_PATTERNS.some((p) => p.test(e.file))).toBe(true);
			}
		});

		it('kind=tz-proof は proof (2 TZ 実測 case) の登録を要求する', () => {
			for (const e of ALLOWLIST.filter((x) => x.kind === 'tz-proof')) {
				expect(typeof e.proof).toBe('string');
			}
		});

		it('allowlist に file の重複がない (max の解釈が曖昧にならない)', () => {
			const files = ALLOWLIST.map((e) => e.file);
			expect(new Set(files).size).toBe(files.length);
		});
	});
	// #4120: 走査範囲そのものの網羅
	//
	// `SEARCH_ROOTS` 配下では「検出があったのに allowlist に無い file」を落とすが、
	// **どのディレクトリを走査するかは誰も見ていなかった**。`infra/lib` に日付から
	// schedule / 期限を組み立てるコードが後から入っても、guard は黙って素通りさせる。
	// EPIC #4120 の目的は根絶なので、**新しいコード置き場が増えたときに気付けること**まで
	// を guard の責務に含める。
	//
	// 走査は repo root と infra/ の直下 (depth 1) のみで、全 file walk はしない
	// (本 file 冒頭の「実 repo 全走査は unit lane では行わない」方針を維持する)。
	describe('#4120 走査範囲の網羅 (どの dir も宣言なしに guard の外に出られない)', () => {
		const repoRoot = join(__dirname, '../../..');

		/** 直下のディレクトリ名 (走査対象外の作業 dir は除く)。 */
		function subdirs(rel: string): string[] {
			const IGNORED = new Set(['node_modules', '.git', '.svelte-kit', '.claude', 'coverage']);
			return readdirSync(join(repoRoot, rel), { withFileTypes: true })
				.filter((e) => e.isDirectory() && !e.name.startsWith('.') && !IGNORED.has(e.name))
				.map((e) => e.name);
		}

		/** その path が SEARCH_ROOTS / EXCLUDED_ROOTS のいずれかで宣言済か。 */
		function declared(path: string): boolean {
			return (
				SEARCH_ROOTS.includes(path) ||
				EXCLUDED_ROOTS.some((e) => e.root === path) ||
				// 親が丸ごと宣言されていれば子も覆われる (例: 'src' が SEARCH_ROOTS)
				SEARCH_ROOTS.some((r) => path.startsWith(`${r}/`)) ||
				EXCLUDED_ROOTS.some((e) => path.startsWith(`${e.root}/`)) ||
				// 子が宣言されている = 部分的に覆われている (例: infra/lambda だけ走査)。
				// この場合は次の test が直下の全 dir の宣言を要求する
				SEARCH_ROOTS.some((r) => r.startsWith(`${path}/`)) ||
				EXCLUDED_ROOTS.some((e) => e.root.startsWith(`${path}/`))
			);
		}

		it('repo 直下の全ディレクトリが走査対象か除外宣言のどちらかに属する', () => {
			const undeclared = subdirs('.').filter((d) => !declared(d));
			expect(
				undeclared,
				'guard の走査範囲にも除外宣言にも無いディレクトリがあります。' +
					'走査するなら SEARCH_ROOTS に、しないなら EXCLUDED_ROOTS に理由付きで足してください',
			).toEqual([]);
		});

		it('部分的にしか走査していない infra/ は直下も全て宣言済', () => {
			const undeclared = subdirs('infra')
				.map((d) => `infra/${d}`)
				.filter((d) => !declared(d));
			expect(
				undeclared,
				'infra/ は infra/lambda だけを走査しているため、直下の各 dir を個別に宣言する必要があります',
			).toEqual([]);
		});

		it('除外理由が実質的である (空 / 定型 stub を許さない)', () => {
			for (const e of EXCLUDED_ROOTS) {
				expect(typeof e.reason, `${e.root}: reason が文字列ではありません`).toBe('string');
				const reason = e.reason.trim();
				expect(
					reason.length,
					`${e.root}: 除外理由が短すぎます (${reason.length} 字)`,
				).toBeGreaterThanOrEqual(8);
				expect(
					['todo', 'tbd', 'n/a', '-', 'なし'].includes(reason.toLowerCase()),
					`${e.root}: 除外理由が定型 stub です`,
				).toBe(false);
			}
		});

		it('除外宣言が stale でない (存在しない dir を除外し続けない)', () => {
			const stale = EXCLUDED_ROOTS.filter((e) => !existsSync(join(repoRoot, e.root)));
			expect(
				stale.map((e) => e.root),
				'存在しないディレクトリの除外宣言が残っています。消えた dir の除外は削除してください',
			).toEqual([]);
		});

		it('走査対象と除外が重複しない (どちらの意図か曖昧にならない)', () => {
			const overlap = EXCLUDED_ROOTS.filter((e) => SEARCH_ROOTS.includes(e.root));
			expect(overlap.map((e) => e.root)).toEqual([]);
		});
	});
});

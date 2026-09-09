// tests/unit/architecture/pin-redaction-sink-coverage.test.ts
//
// **「PIN を含みうる文字列を外へ出す口には redact を通す」という規則そのものに、
// 機械強制を置く** (#4867 adversarial round 6 / ADR-0061 same-class-N→guard)。
//
// なぜ必要か: この 1 件の欠陥は adversarial 6 ラウンドで **経路が 2 → 7 層に増えた**。
// service → repo → 退会 → build 失敗 → route catch 群 → 認証 (招待コード) →
// cron のレスポンス body。毎回「直したはずの層の隣」から出てきた。規則の適用を
// 人の注意力に委ねたまま閉じると、次に `s3Key` を触る人が同じ形で漏らす。
//
// **この検査の限界 (先に書く)**:
//   - source を正規表現で読むだけで、**振る舞いは見ていない**。別名 import / 変数経由 /
//     identity 関数での shadow は素通りする (実測済)。振る舞いは
//     `cloud-export-pin-not-logged` / `pin-not-logged-callsites` /
//     `cloud-export-build-failure-pin` の 3 本が固定している。
//   - ここが止めるのは「**次の人が新しい経路を足したとき**」という、この PR で
//     6 回起きた事象そのもの。形状検査の弱さは承知のうえで、その 1 点に絞っている。
//   - **registry に載るのは `s3Key` / `pinCode` / `CloudExportRecord` /
//     `fetchCloudExportByPin` の字面を持つ file だけ**。本 PR が同じ class として直した
//     cron 4 endpoint (age-recalc / grace-period-deletion / retention-cleanup /
//     trial-notifications) はどれも持たないので、ここでは見ていない
//     (PIN が届く経路が無いため。届く `export-build` だけが registry にある)。
//
// 規則:
//   [F1] `s3Key` / `pinCode` を扱う src の file は、必ず registry に現れる
//        (未登録 = 新しい経路が黙って増えた)
//   [F2] `guard: 'redacted'` の file では、外へ出す口の引数に生の例外・key を渡していない
//   [F3] `guard: 'no-sink'` は理由が要る (宣言だけで抜けられない)

import { globSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '../../..');

type Guard =
	/**
	 * 外へ出す口を持つ。redact を通していることを [F2] が検査する。
	 *
	 * `scope`:
	 *   - `'file'` (既定) … **file 内の catch を全部**見る。file 全体がクラウド共有 export の
	 *     経路である場合 (route / cloud-export-service など)。コメントを剥がすと `s3Key` の
	 *     字面が残らない file もあるので、近傍テキストでの scope 判定に頼らない。
	 *   - `'pin-catch'` … PIN が近傍にある catch だけを見る。無関係な catch を大量に持つ
	 *     file (`tenant-cleanup-service` は 30 個以上ある) 用。
	 */
	| { guard: 'redacted'; scope?: 'file' | 'pin-catch' }
	/** 外へ出す口を持たない (型定義 / schema / repo の CRUD / UI)。理由が要る。 */
	| { guard: 'no-sink'; why: string };

/**
 * `s3Key` / `pinCode` を扱う src file の全集合。**[F1] がこの表の網羅性を検査する**ので、
 * 新しい経路を足した人はここに 1 行足すまで CI が通らない。
 */
const REGISTRY: Record<string, Guard> = {
	// ── 外へ出す口を持つ (redact 必須) ──────────────────────────────
	'src/lib/server/services/cloud-export-service.ts': { guard: 'redacted' },
	'src/lib/server/services/replace-import-response.ts': { guard: 'redacted' },
	// 無関係な catch を大量に持つ file は PIN 近傍だけを見る
	'src/lib/server/services/tenant-cleanup-service.ts': { guard: 'redacted', scope: 'pin-catch' },
	'src/lib/server/services/replace-import-service.ts': { guard: 'redacted', scope: 'pin-catch' },
	'src/lib/server/db/s3/storage-repo.ts': { guard: 'redacted', scope: 'pin-catch' },
	'src/routes/api/cron/export-build/+server.ts': { guard: 'redacted' },
	'src/routes/api/v1/export/cloud/+server.ts': { guard: 'redacted' },
	'src/routes/api/v1/export/cloud/[id]/+server.ts': { guard: 'redacted' },
	'src/routes/api/v1/export/cloud/[id]/download/+server.ts': { guard: 'redacted' },
	'src/routes/api/v1/import/cloud/+server.ts': { guard: 'redacted' },

	// ── 外へ出す口を持たない ──────────────────────────────────────
	'src/lib/domain/storage-key-redaction.ts': {
		guard: 'no-sink',
		why: 'redact の実装そのもの (PIN の形を定義する側)',
	},
	'src/lib/domain/cloud-export-quota.ts': {
		guard: 'no-sink',
		why: '枠計算の純関数。log も response も持たない',
	},
	'src/lib/domain/labels.ts': {
		guard: 'no-sink',
		why: '表示文言の SSOT。値を受け取って組み立てるだけで、外へ出す口ではない',
	},
	'src/lib/server/db/demo/cloud-export-repo.ts': {
		guard: 'no-sink',
		why: 'demo backend の stub (findByTenant は空配列を返す)',
	},
	'src/lib/server/db/dsql/cloud-export-repo.ts': {
		guard: 'no-sink',
		why: 'CRUD のみ。例外は上位 (service / route) の catch が伏せる',
	},
	'src/lib/server/db/sqlite/cloud-export-repo.ts': {
		guard: 'no-sink',
		why: 'CRUD のみ。例外は上位 (service / route) の catch が伏せる',
	},
	'src/lib/server/db/dsql/schema.ts': {
		guard: 'no-sink',
		why: 'テーブル定義 (column 名として現れるだけ)',
	},
	'src/lib/server/db/schema.ts': {
		guard: 'no-sink',
		why: 'テーブル定義 (column 名として現れるだけ)',
	},
	'src/lib/server/db/interfaces/cloud-export-repo.interface.ts': {
		guard: 'no-sink',
		why: '型定義 (値を持たない)',
	},
	'src/lib/server/db/types/index.ts': { guard: 'no-sink', why: '型定義 (値を持たない)' },
	'src/lib/features/admin/components/CloudExportStoredList.svelte': {
		guard: 'no-sink',
		why: '自分のテナントの行だけを描く画面。閲覧者は自分の PIN を見る側なので伏せない',
	},
	'src/lib/features/admin/components/CloudExportStoredList.stories.svelte': {
		guard: 'no-sink',
		why: '上の component の story (見た目の検証のみ)',
	},
	'src/routes/(parent)/admin/settings/data/+page.svelte': {
		guard: 'no-sink',
		why: '同上 (自分のテナントの行だけを描く画面)',
	},
};

function readSource(rel: string): string {
	return readFileSync(join(ROOT, rel), 'utf8');
}

/** 位置 `i` がコメントの開始なら、その終端 (exclusive) を返す。コメントでなければ -1。 */
function endOfComment(src: string, i: number): number {
	if (src[i] !== '/') return -1;
	if (src[i + 1] === '/') {
		const end = src.indexOf('\n', i);
		return end < 0 ? src.length : end;
	}
	if (src[i + 1] === '*') {
		const end = src.indexOf('*/', i + 2);
		return end < 0 ? src.length : end + 2;
	}
	return -1;
}

/** `/` が正規表現の開始になりうる直前文字。 */
const REGEX_START_PREV = /[(,=:[!&|?{};+\-*%<>~^]/;

/** 引用符 `q` で開いた位置 `i` に対応する閉じ引用符の位置 (無ければ末尾)。 */
function endOfQuoted(src: string, i: number, q: string): number {
	let j = i + 1;
	while (j < src.length) {
		if (src[j] === '\\') j += 2;
		else if (src[j] === q) return j;
		else j++;
	}
	return src.length;
}

/** 位置 `i` の `/` から始まる正規表現リテラルの閉じ `/` の位置。無ければ -1。 */
function endOfRegex(src: string, i: number): number {
	let j = i + 1;
	let inClass = false;
	while (j < src.length && src[j] !== '\n') {
		if (src[j] === '\\') j += 2;
		else if (src[j] === '[') {
			inClass = true;
			j++;
		} else if (src[j] === ']') {
			inClass = false;
			j++;
		} else if (src[j] === '/' && !inClass) return j;
		else j++;
	}
	return -1;
}

/**
 * **コードでない場所 (文字列 / template / 正規表現 / コメント) を空白で潰す** (#4867 round 9)。
 *
 * 括弧や引用符を数える検査は、コードでない場所の記号に必ず引っかかる。round 8 で
 * 「文字列の中の括弧を数えない」を足したところ、**正規表現リテラルの中の `'`**
 * (`id.replace(/['"]/g, '')`) と **行末コメントの中の `'`** (`// don't put …`) で
 * quote モードに入り、round 8 では赤くなっていた変異が緑になる**回帰**を作った。
 * 場当たりに条件を足すのをやめ、**先に一度だけ字句を潰す**。
 *
 * `pin-sink-ok:` の marker はコメントに書くので、**その行のコメントだけは残す**。
 * 長さは変えない (位置が保たれるので、行番号や近傍の切り出しがずれない)。
 */
function maskNonCode(src: string): string {
	const out = src.split('');
	/** 直前の意味のある文字 — `/` が正規表現の開始か除算かの判定に使う。 */
	let prev = '';
	let i = 0;
	const blank = (from: number, to: number, keep: boolean) => {
		if (keep) return;
		for (let k = from; k < to; k++) if (out[k] !== '\n') out[k] = ' ';
	};
	while (i < src.length) {
		const ch = src[i] as string;
		const commentEnd = endOfComment(src, i);
		if (commentEnd >= 0) {
			// `pin-sink-ok:` の marker はコメントに書くので、その 1 件だけ残す
			blank(i, commentEnd, src.slice(i, commentEnd).includes('pin-sink-ok:'));
			i = commentEnd;
			continue;
		}
		if (ch === "'" || ch === '"' || ch === '`') {
			const end = endOfQuoted(src, i, ch);
			blank(i, Math.min(end + 1, src.length), false);
			i = end + 1;
			prev = ch;
			continue;
		}
		// 正規表現リテラルは「値が来る位置の `/`」でしか始まらない
		if (ch === '/' && REGEX_START_PREV.test(prev)) {
			const end = endOfRegex(src, i);
			if (end >= 0) {
				blank(i, end + 1, false);
				i = end + 1;
				prev = '/';
				continue;
			}
		}
		if (!/\s/.test(ch)) prev = ch;
		i++;
	}
	return out.join('');
}

/**
 * `redactStorageKey(…)` / `redactStorageKeysInText(…)` の**引数の中身を丸ごと取り除く**。
 *
 * 括弧の対応を数えて消すので、改行を跨いだ書き方にも効く。残った部分に生の例外・key が
 * 現れたら「伏せずに外へ出している」と判定する。
 */
function stripRedacted(src: string): string {
	const CALL = /redactStorageKey(?:sInText)?\(/;
	let out = '';
	let rest = src;
	for (;;) {
		const m = CALL.exec(rest);
		if (!m) {
			out += rest;
			return out;
		}
		out += rest.slice(0, m.index);
		rest = rest.slice(scanToCallEnd(rest, m.index + m[0].length));
	}
}

/**
 * 外へ出す口の呼び出し (`logger.*` / `json(` / `apiError(` / `error(`) の**引数全体**を返す。
 *
 * 前版は `{ error: … }` のような**キー名 7 語**を手で選んで見ていた。adversarial round 7 が
 * `context: { key: record.s3Key, rawDetail: String(err) }` のように**別のキー名**を使う変異と、
 * `` logger.error(`… ${record.s3Key}`) `` のような template literal に混ぜる変異を通してみせた
 * (どちらも 13 passed で生存)。キー名で拾うのをやめ、**呼び出しの引数に何が入っているか**を見る。
 */
/**
 * 開き括弧の直後 `from` から、対応する閉じ括弧の**次**の位置まで進む。
 *
 * **文字列 / template literal の中の括弧は数えない** (#4867 adversarial round 8 実測)。
 * ログ文言の閉じ括弧を 1 つ打ち忘れただけで引数が EOF まで伸び、その巨大な blob に
 * `pin-sink-ok` が 1 つでもあると **file の残り全部の sink が skip** される。
 */
function scanToCallEnd(src: string, from: number): number {
	let depth = 1;
	let quote: string | null = null;
	let j = from;
	while (j < src.length && depth > 0) {
		const ch = src[j] as string;
		if (quote) {
			if (ch === '\\') j++;
			else if (ch === quote) quote = null;
		} else if (ch === "'" || ch === '"' || ch === '`') {
			quote = ch;
		} else if (ch === '(') depth++;
		else if (ch === ')') depth--;
		j++;
	}
	return j;
}

const SINK_CALL_GLOBAL =
	/\b(?:logger\.(?:error|warn|info|debug)|json|apiError|validationError|error)\s*\(/g;

type SinkCall = { args: string; before: string; terminated: boolean };

function sinkCallArguments(code: string): SinkCall[] {
	const CALL = /\b(?:logger\.(?:error|warn|info|debug)|json|apiError|validationError|error)\s*\(/;
	/** opt-out marker はふつう**直前の行**に書くので、呼び出しの手前も一緒に見る。 */
	const LOOKBEHIND_CHARS = 300;
	const out: SinkCall[] = [];
	let rest = code;
	for (;;) {
		const m = CALL.exec(rest);
		if (!m) return out;
		const start = m.index + m[0].length;
		const j = scanToCallEnd(rest, start);
		out.push({
			args: rest.slice(start, Math.max(start, j - 1)),
			before: rest.slice(Math.max(0, m.index - LOOKBEHIND_CHARS), m.index),
			// 対応する `)` に届かず末尾まで行った = **この呼び出しを読めていない**。
			// 読めていないものを「安全」と数えない (#4867 round 8/9)。
			terminated: j <= rest.length && rest.slice(start, j).endsWith(')'),
		});
		rest = rest.slice(j);
	}
}

/**
 * 伏せていない値の**字面**。`stripRedacted` で redact 済みの中身を消したあとに
 * これが残っていれば、伏せずに外へ出していると判定する。
 */
const RAW_VALUE_TOKENS: readonly RegExp[] = [
	/\bString\((?:err|e)\b/,
	/\b(?:err|e)\.(?:message|stack)\b/,
	// `s3Key:` / `pinCode:` は**キー名**であって値ではない。`s3Key: redactStorageKey(s3Key)` は
	// `stripRedacted` が中身を消したあとキー名だけが残るので、`:` が続く形は除く。
	/\bs3Key\b(?!\s*:)/,
	/\bpinCode\b(?!\s*:)/,
];

/**
 * 明示的な opt-out。**理由を 12 文字以上つけて、その場に書く**。
 *
 * 型付きドメインエラーの `message` は顧客向けに用意された文言であって生の例外ではない
 * (`AtomicReplaceError` / `ReplaceRestoreFailedError` など、#4752 が文言と HTTP 種別を
 * 対応づけている)。そこまで一律に禁じると正しい書き方が落ちるので逃げ道を置く。
 * ただし**宣言だけで抜けられないように理由を要求する** ([F3] と同じ規律)。
 */
const OPT_OUT = /pin-sink-ok:\s*(\S[^*\n]{11,})/;

/**
 * `msg` を「伏せ済みの変数」として扱うかは file ごとに決める — `const msg =
 * redactStorageKeysInText(...)` と書いてあれば安全、素の例外から組み立てていれば危険。
 */
function msgIsRedactedIn(code: string): boolean {
	return /const\s+msg\s*=\s*redactStorageKey(?:sInText)?\(/.test(code);
}

/** 与えられたコード片から、伏せていない sink を全部拾う。 */
function rawSinks(block: string, msgIsRedacted: boolean): string[] {
	const hits: string[] = [];
	for (const { args: rawArgs, before } of sinkCallArguments(block)) {
		// その場 (引数の中、または直前の数行) に理由つきの opt-out があれば飛ばす
		if (OPT_OUT.test(rawArgs) || OPT_OUT.test(before)) continue;
		// redact を通した部分は取り除いてから、残りに生の字面が居るかを見る
		const remaining = stripRedacted(rawArgs);
		for (const token of RAW_VALUE_TOKENS) {
			const m = token.exec(remaining);
			if (m) hits.push(`${m[0]} in ${rawArgs.replace(/\s+/g, ' ').slice(0, 80)}`);
		}
		if (!msgIsRedacted && /\bmsg\b/.test(remaining)) {
			hits.push(`msg in ${rawArgs.replace(/\s+/g, ' ').slice(0, 80)}`);
		}
	}
	return hits;
}

/**
 * 検査対象のコードだけにする。
 *
 * 前版は「`//` で始まる**行**を落とす」だけで、行末コメントも正規表現リテラルも
 * 残っていた。字句を一度だけ潰す形に置き換えた ({@link maskNonCode})。
 */
function codeOnly(src: string): string {
	return maskNonCode(src);
}

/** PIN を含みうる値が scope にあることを示す識別子。 */
const PIN_SCOPE = /\bs3Key\b|\bpinCode\b|\bcloudExport\b|exports\//;
/** catch の直前どこまでを「同じ scope」と見なすか (行数)。 */
const SCOPE_LOOKBACK_LINES = 40;

/**
 * `catch` block を 1 つずつ取り出し、**PIN が scope にある block だけ**を検査対象にする。
 *
 * file 全体を一律に見ると、`tenant-cleanup-service` のように 30 個以上の無関係な
 * `catch` を抱える file が全部引っかかって、検査が使い物にならない。方針
 * (「`record` / `pinCode` / `s3Key` が scope にある catch は機械的に全部通す」) を
 * そのまま形にする。
 *
 * **判定は近傍のテキスト**なので、scope 解析としては粗い。粗いほうへ倒してある
 * (関係ない block を拾って赤くなるほうが、拾い漏らして緑になるより安全)。
 */
/** `catch` の開始行から、対応する閉じ括弧までの本文を返す。 */
function catchBodyFrom(lines: readonly string[], start: number): string {
	let depth = 0;
	let started = false;
	const body: string[] = [];
	for (let j = start; j < lines.length; j++) {
		const line = lines[j] ?? '';
		body.push(line);
		for (const ch of line) {
			if (ch === '{') {
				depth++;
				started = true;
			} else if (ch === '}') depth--;
		}
		if (started && depth <= 0) break;
	}
	return body.join('\n');
}

function pinScopedCatchBlocks(src: string): string[] {
	const lines = src.split('\n');
	const blocks: string[] = [];
	for (let i = 0; i < lines.length; i++) {
		if (!/\bcatch\b\s*\(/.test(lines[i] ?? '')) continue;
		const lookback = lines.slice(Math.max(0, i - SCOPE_LOOKBACK_LINES), i).join('\n');
		const bodyText = catchBodyFrom(lines, i);
		if (PIN_SCOPE.test(lookback) || PIN_SCOPE.test(bodyText)) blocks.push(bodyText);
	}
	return blocks;
}

describe('[F1] s3Key / pinCode を扱う file は registry に現れる', () => {
	it('未登録 / stale が無い (新しい経路が黙って増えていない)', () => {
		const files = [
			...globSync('src/**/*.ts', { cwd: ROOT }),
			...globSync('src/**/*.svelte', { cwd: ROOT }),
		]
			.map((f) => f.replace(/\\/g, '/'))
			.filter((f) => {
				const src = readSource(f);
				return /\bs3Key\b/.test(src) || /\bpinCode\b/.test(src);
			});

		const missing = files.filter((f) => !(f in REGISTRY));
		expect(
			missing,
			'`s3Key` / `pinCode` を扱う file が registry に無い。外へ出す口があるなら ' +
				"`guard: 'redacted'` を、無いなら理由つきで `guard: 'no-sink'` を足すこと:\n" +
				missing.join('\n'),
		).toEqual([]);

		const stale = Object.keys(REGISTRY).filter((f) => !files.includes(f));
		expect(stale, `registry に残っているが対象でなくなった file:\n${stale.join('\n')}`).toEqual([]);
	}, 60_000);
});

describe('[F2] 外へ出す口は redact を通す', () => {
	const redactedFiles = Object.entries(REGISTRY).filter(
		(e): e is [string, { guard: 'redacted'; scope?: 'file' | 'pin-catch' }] =>
			e[1].guard === 'redacted',
	);

	for (const [file, g] of redactedFiles) {
		it(`${file} — 生の例外 / key を外へ出していない (${g.scope ?? 'file'})`, () => {
			// opt-out marker (`pin-sink-ok:`) を読むため、その marker を含む行だけコメントを残す
			const code = codeOnly(readSource(file));
			const blocks = g.scope === 'pin-catch' ? pinScopedCatchBlocks(code) : [code];
			const redactedMsg = msgIsRedactedIn(code);
			const hits = blocks.flatMap((b) => rawSinks(stripRedacted(b), redactedMsg));
			expect(
				hits,
				`${file} に redact を通していない sink がある。` +
					'`record` / `pinCode` / `s3Key` が scope にある catch は機械的に全部通す方針 ' +
					`(#4867)。検出:\n${hits.join('\n')}`,
			).toEqual([]);
		});
	}

	it('redacted 宣言の file は実際に redact を import している', () => {
		for (const [file] of redactedFiles) {
			expect(
				/from '\$lib\/domain\/storage-key-redaction'/.test(readSource(file)),
				`${file} が redact を import していないのに 'redacted' と宣言している`,
			).toBe(true);
		}
	});

	// #4867 adversarial round 8/9: **「読めなかった」を「安全」と数えない**。
	// parser は正規表現で呼び出しを見つけて括弧を数えるだけなので、書き方次第で
	// 範囲がずれる。ずれると sink を 1 つも見ないまま緑になる — round 8/9 で
	// 実際に 3 通りの形が見つかった。**読めた本数と、素朴に数えた本数が合うこと**を
	// 別の検査として置き、合わなければ落とす (パーサを直す合図になる)。
	it('すべての sink 呼び出しを最後まで読めている', () => {
		for (const [file] of redactedFiles) {
			const code = codeOnly(readSource(file));
			const calls = sinkCallArguments(code);
			const unterminated = calls.filter((c) => !c.terminated).length;
			expect(
				unterminated,
				`${file} に、対応する ) まで読めなかった呼び出しがある = その範囲の検査が成立していない`,
			).toBe(0);

			const naive = (code.match(SINK_CALL_GLOBAL) ?? []).length;
			expect(
				calls.length,
				`${file} の呼び出し本数が素朴な数え方と一致しない (parser=${calls.length} / naive=${naive})。` +
					'範囲決定がずれている = 検査が一部の sink を見ていない',
			).toBe(naive);
		}
	});
});

describe('[F3] no-sink は宣言だけで取れない', () => {
	it('空文字・stub の理由を受理しない', () => {
		for (const [file, g] of Object.entries(REGISTRY)) {
			if (g.guard !== 'no-sink') continue;
			expect(g.why.length, `${file} の理由が短すぎる (12 文字以上)`).toBeGreaterThanOrEqual(12);
			expect(/^(todo|n\/a|なし|-)$/i.test(g.why.trim()), `${file} の理由が stub`).toBe(false);
		}
	});

	it('外へ出す口を実際に持つ file は no-sink に格下げできない', () => {
		// #4867 adversarial round 7 実測: `export-build` の registry 1 行を
		// `no-sink` + もっともらしい理由 (実際にその file のコメントに書いてある文とほぼ同じ)
		// に付け替えるだけで、**直したばかりの 2 つの sink を両方生に戻しても 12 passed** だった。
		// [F3] が `why` の文字数しか見ていなかったため。**理由文ではなく実物を見る。**
		const offenders: string[] = [];
		for (const [file, g] of Object.entries(REGISTRY)) {
			if (g.guard !== 'no-sink') continue;
			const code = codeOnly(readSource(file));
			if (/\blogger\.(?:error|warn|info|debug)\s*\(/.test(code) || /\bapiError\s*\(/.test(code)) {
				offenders.push(file);
			}
		}
		expect(
			offenders,
			'`no-sink` と宣言しているのに logger / apiError の呼び出しを持つ file がある。' +
				`外へ出す口があるなら 'redacted' で宣言すること:\n${offenders.join('\n')}`,
		).toEqual([]);
	});

	it('redacted 宣言の数が黙って減らない (registry 編集で赤を消せない)', () => {
		// 同上。per-file の test が 13 → 12 に減ることを誰も見ていなかったので、下限を置く。
		// **経路を減らしたときは、この数を下げる commit が必ず要る** (= 判断が記録に残る)。
		const redactedCount = Object.values(REGISTRY).filter((g) => g.guard === 'redacted').length;
		expect(
			redactedCount,
			'redact 必須と宣言している file が減っている。経路を本当に減らしたのなら ' +
				'この期待値も同じ commit で下げること (黙って減らせないようにしてある)',
		).toBeGreaterThanOrEqual(10);
	});
});

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
		let depth = 1;
		let j = m.index + m[0].length;
		while (j < rest.length && depth > 0) {
			const ch = rest[j];
			if (ch === '(') depth++;
			else if (ch === ')') depth--;
			j++;
		}
		rest = rest.slice(j);
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

function sinkCallArguments(code: string): { args: string; before: string }[] {
	const CALL = /\b(?:logger\.(?:error|warn|info|debug)|json|apiError|validationError|error)\s*\(/;
	/** opt-out marker はふつう**直前の行**に書くので、呼び出しの手前も一緒に見る。 */
	const LOOKBEHIND_CHARS = 300;
	const out: { args: string; before: string }[] = [];
	let rest = code;
	for (;;) {
		const m = CALL.exec(rest);
		if (!m) return out;
		const start = m.index + m[0].length;
		const j = scanToCallEnd(rest, start);
		out.push({
			args: rest.slice(start, Math.max(start, j - 1)),
			before: rest.slice(Math.max(0, m.index - LOOKBEHIND_CHARS), m.index),
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
 * 説明用にコード片を書けるよう、行コメントは検査対象から外す。
 *
 * `keep` に一致する行だけは残す — `pin-sink-ok:` の opt-out marker を読むため。
 */
function codeOnly(src: string, opts: { keep?: RegExp } = {}): string {
	return src
		.split('\n')
		.filter((l) => {
			if (opts.keep?.test(l)) return true;
			const t = l.trim();
			return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
		})
		.join('\n');
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
			const code = codeOnly(readSource(file), { keep: /pin-sink-ok:/ });
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

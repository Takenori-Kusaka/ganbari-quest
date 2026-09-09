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
 * `{ error: … }` / `{ stack: … }` のような**外へ出す口のフィールド**を列挙する。
 *
 * key の直前に `{` `,` 行頭 のいずれかを要求する — そうしないと
 * `e instanceof Error ? e.message : String(e)` の**三項演算子のコロン**を
 * 「message というキー」と読んでしまう (実測で踏んだ)。
 */
const SINK_FIELD =
	/(?:^|[{,])[ \t]*(?:error|stack|message|reason|failureReason|cause|originalError)[ \t]*:[ \t]*([^,}\n]+)/gm;

/** そのフィールドに載っている値が「伏せていない例外・key」か。 */
function isRawValue(value: string, msgIsRedacted: boolean): boolean {
	const v = value.trim();
	if (/^String\((?:err|e)\b/.test(v)) return true;
	if (/^(?:err|e)\.(?:message|stack)\b/.test(v)) return true;
	if (/^(?:record\.|exp\.)?s3Key\b/.test(v)) return true;
	if (!msgIsRedacted && /^msg\b/.test(v)) return true;
	return false;
}

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
	for (const m of block.matchAll(SINK_FIELD)) {
		const value = m[1] ?? '';
		if (isRawValue(value, msgIsRedacted)) hits.push(m[0].trim());
	}
	// template literal でログ本文に混ぜる形も拾う
	for (const m of block.matchAll(/\$\{String\((?:err|e)[^}]*\)\}/g)) hits.push(m[0]);
	if (!msgIsRedacted) for (const m of block.matchAll(/\$\{msg\}/g)) hits.push(m[0]);
	return hits;
}

/** 説明用にコード片を書けるよう、行コメントは検査対象から外す。 */
function codeOnly(src: string): string {
	return src
		.split('\n')
		.filter((l) => {
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
});

describe('[F3] no-sink は理由が要る', () => {
	it('空文字・stub の理由を受理しない', () => {
		for (const [file, g] of Object.entries(REGISTRY)) {
			if (g.guard !== 'no-sink') continue;
			expect(g.why.length, `${file} の理由が短すぎる (12 文字以上)`).toBeGreaterThanOrEqual(12);
			expect(/^(todo|n\/a|なし|-)$/i.test(g.why.trim()), `${file} の理由が stub`).toBe(false);
		}
	});
});

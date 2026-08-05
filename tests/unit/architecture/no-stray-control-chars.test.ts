// cspell:ignore ackups
//   `ackups` = 0x08 に食われた `backups` の残骸。**実際に file に入っていた壊れた綴り**を
//   そのまま引用しないと「何が起きたか」が伝わらないため、綴りを直さず file scope で ignore する
//   (global words に足すと他 file の typo が素通りする、tests/CLAUDE.md §負例 fixture と cspell)。
// tests/unit/architecture/no-stray-control-chars.test.ts
// #4119 — テキスト資産に紛れ込んだ C0 制御文字を止める。
//
// ## 何が起きたか
//
// `docs/runbooks/pglite-restore-drill.md` の復元 drill 手順に **0x08 (backspace)** が
// 2 箇所紛れ込み、既定バックアップ先が
//
//     C:\Docker\ganbari-quest\data\backups   (正)
//     C:\Docker\ganbari-quest\data<BS>ackups (実際に file に入っていたもの)
//
// になっていた。**片方は operator がそのまま貼り付けて実行する PowerShell コマンド**
// (`Get-ChildItem '...'`) で、貼り付けても控えが見つからない。
//
// `\b` を含む path を shell 経由で書いたときに escape が解釈されると起きる。
//
// ## なぜ人のレビューで止まらないか
//
// **画面に出ない。** diff でも通常の表示でも `data\backups` と区別が付かず、
// `cat -A` 等でバイトを見ない限り気付けない。人の注意力では原理的に落ちる class なので
// 機械で止める (ADR-0061)。
//
// ## 何を許すか
//
// 制御文字を **意図して** 置いている箇所が 2 つある。どちらも「制御文字であること」自体が
// 仕様なので、綴りを直すと意味が壊れる (`tests/CLAUDE.md` §負例 fixture と同じ形)。
// 許可は file 単位で、**理由を機械検証する** (空 / 定型 stub / 極端な短文は弾く、#4237 と同型)。

import { globSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// repo 走査 test (#4085): 実行時間が repo の file 数に比例するため明示 timeout を置く。
vi.setConfig({ testTimeout: 60_000 });

const REPO_ROOT = join(__dirname, '../../..');

/** 走査対象。人が読む / operator が貼り付けるテキスト資産。 */
const GLOBS = [
	'docs/**/*.md',
	'*.md',
	'src/**/*.{ts,svelte}',
	'scripts/**/*.{mjs,cjs,js}',
	'tests/**/*.ts',
	'.env.example',
	'docker-compose.yml',
	'.github/workflows/*.yml',
];

/**
 * C0 制御文字のうち、テキストとして正当なもの。
 * tab (0x09) / LF (0x0a) / CR (0x0d) 以外は「紛れ込み」として扱う (deny by default)。
 */
const ALLOWED_CODES = new Set([0x09, 0x0a, 0x0d]);

/** 制御文字を意図して置いている file。**理由は機械検証される**。 */
const INTENTIONAL_CONTROL_CHARS: Record<string, string> = {
	'src/lib/domain/export-migrations.ts':
		'NUL (0x00) を childRef と loginDate の複合キー区切りに使う。両者に現れ得ない文字であることが分離の根拠',
	'tests/unit/ui/error-notify.test.ts':
		'sanitizeServerMessage が制御文字を空白化することの負例 fixture。実バイトで書かないと検査にならない',
};

const STUB_REASONS = ['todo', 'tbd', 'n/a', 'na', '-', '—', '未定', 'なし', '?', '??'];

/** 理由として成立しているか。成立しない場合は理由文字列を返す。 */
function findReasonDefect(reason: unknown): string | null {
	if (typeof reason !== 'string') return `文字列ではありません (${typeof reason})`;
	const trimmed = reason.trim();
	if (trimmed.length === 0) return '空です';
	if (STUB_REASONS.includes(trimmed.toLowerCase())) return `定型 stub です (「${trimmed}」)`;
	if (trimmed.length < 8) return `短すぎます (${trimmed.length} 字)`;
	return null;
}

function collectFiles(): string[] {
	const seen = new Set<string>();
	for (const g of GLOBS) {
		for (const f of globSync(g, {
			cwd: REPO_ROOT,
			exclude: (p) => p.includes('node_modules') || p.includes('.svelte-kit'),
		})) {
			seen.add(f.replace(/\\/g, '/'));
		}
	}
	return [...seen];
}

/** file 内の制御文字を `path:line (0xNN)` 形式で返す。 */
function findControlChars(relPath: string): string[] {
	let buf: Buffer;
	try {
		buf = readFileSync(join(REPO_ROOT, relPath));
	} catch {
		return [];
	}
	const out: string[] = [];
	let line = 1;
	for (const byte of buf) {
		if (byte === 0x0a) {
			line++;
			continue;
		}
		if (byte < 0x20 && !ALLOWED_CODES.has(byte)) {
			out.push(`${relPath}:${line} (0x${byte.toString(16).padStart(2, '0')})`);
		}
	}
	return out;
}

describe('#4119 テキスト資産に C0 制御文字が紛れ込んでいないこと', () => {
	const files = collectFiles();

	// 母数が空なら「違反 0」ではなく「検査していない」(#4084 と同じ形)。
	it('[母数] 走査対象が十分に集まっている', () => {
		expect(files.length, 'glob が壊れて走査対象が集まっていません').toBeGreaterThan(100);
	});

	it('許可していない file に制御文字が無い', () => {
		const violations: string[] = [];
		for (const f of files) {
			if (f in INTENTIONAL_CONTROL_CHARS) continue;
			violations.push(...findControlChars(f));
		}

		expect(
			violations,
			'制御文字が紛れ込んでいます。**画面では通常の文字と区別が付きません**。\n' +
				'`cat -A <file>` でバイトを確認してください。\n' +
				'意図して置いているなら INTENTIONAL_CONTROL_CHARS に理由付きで登録してください',
		).toEqual([]);
	});

	it('許可 entry の理由が空でも stub でもない', () => {
		const entries = Object.entries(INTENTIONAL_CONTROL_CHARS);
		expect(entries.length, '母数が空です').toBeGreaterThan(0);

		const defects = entries
			.map(([file, reason]) => {
				const defect = findReasonDefect(reason);
				return defect ? `${file}: ${defect}` : null;
			})
			.filter((v): v is string => v !== null);

		expect(defects, '許可理由が実質空です。**なぜ制御文字が必要なのか**を書いてください').toEqual(
			[],
		);
	});

	it('許可 entry が stale でない (実際に制御文字を含んでいる)', () => {
		// 制御文字が消えた file が許可に残り続けると、次に紛れ込んだとき素通りする。
		const stale = Object.keys(INTENTIONAL_CONTROL_CHARS).filter(
			(f) => findControlChars(f).length === 0,
		);
		expect(
			stale,
			'許可 entry の file に制御文字がありません。撤去済なら INTENTIONAL_CONTROL_CHARS から外してください',
		).toEqual([]);
	});
});

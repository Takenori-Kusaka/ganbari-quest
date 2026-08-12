// tests/unit/architecture/external-ai-client-boundary.test.ts
// #4397: 「運営者の環境の外にある生成 AI」へ出ていける口を 1 箇所に固定する fitness function。
//
// # なぜこの test が要るか
//
// アバターの AI 生成は、子供のニックネームと年齢をそのまま prompt に埋めて Google (Gemini) へ
// 送る配線だった。これは site/privacy.html 第 10 条「子供の識別情報 (ニックネーム等) は運営者の
// 環境の外にある生成 AI サービスには送信しません」/ 第 3 条「利用者識別子を含まないリクエスト
// のみ送信します」と正面から食い違う。
//
// 見過ごされた root cause は「**顧客への約束をコード側で表明している場所が 1 つも無かった**」
// こと (#4397 5 Whys の 2〜3)。約束が法務文書にだけ書かれ、実装から参照されていなければ、
// 誰かが新しい呼び出し口を足しても誰も落ちない。
//
// そこで機能撤去 (#4397) と同時に、**外部 AI client を構築してよい file を allowlist で固定**
// する。新しい file が `@google/generative-ai` を掴んだ時点で本 test が落ち、「その payload に
// 子供の識別情報が入っていないか」を人間が判断する契機になる。payload そのものの規律 (何を
// 送ってよいか) は Bedrock 経由のテキスト補助を対象に #4367 側で担保する。
//
// 新規ツール導入ゼロ (既存 vitest + node fs)。ADR-0010 Pre-PMF / ADR-0061 same-class→guard 整合。

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

// #4085: repo 走査 test。区分は scripts/lib/ci/repo-scan-test-registry.mjs が SSOT。
vi.setConfig({ testTimeout: 60_000 });

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const SRC_DIR = resolve(REPO_ROOT, 'src');

/**
 * 運営者の環境の外にある生成 AI SDK。ここに載っている package を掴んでよいのは
 * `EXTERNAL_AI_CLIENT_ALLOWLIST` の file だけ。
 *
 * Bedrock (`@aws-sdk/client-bedrock-runtime`) は運営者が管理する AWS 環境内の処理であり
 * privacy.html 第 3 条でも AWS 側として開示しているため、本 allowlist の対象外。
 */
const EXTERNAL_AI_SDK_PATTERN = /['"]@google\/generative-ai['"]/;

/**
 * 外部 AI SDK を import してよい file (repo root からの POSIX 相対パス)。
 *
 * - `gemini-provider.ts` — NUC (セルフホスト) のテキスト補助。送る payload の規律は #4367。
 *
 * **拡大は不可**。増やしたくなったら、その file が外部へ何を送るのかを PR で明示し、
 * privacy.html の開示と突き合わせてから allowlist を触ること。
 */
const EXTERNAL_AI_CLIENT_ALLOWLIST = new Set(['src/lib/server/ai/gemini-provider.ts']);

function walk(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		const full = resolve(dir, entry);
		if (statSync(full).isDirectory()) {
			walk(full, out);
		} else if (/\.(ts|svelte)$/.test(entry)) {
			out.push(full);
		}
	}
	return out;
}

const SRC_FILES = walk(SRC_DIR);
const toRepoPath = (abs: string) => relative(REPO_ROOT, abs).split('\\').join('/');

describe('外部 AI client の口は allowlist の file だけ (#4397)', () => {
	it('@google/generative-ai を import する src の file は allowlist と一致する', () => {
		const importers = SRC_FILES.filter((file) =>
			EXTERNAL_AI_SDK_PATTERN.test(readFileSync(file, 'utf-8')),
		).map(toRepoPath);

		expect(
			[...importers].sort(),
			'外部の生成 AI SDK を新しい file が掴んでいる。その payload に子供の識別情報 ' +
				'(ニックネーム / 年齢 / 活動内容) が含まれていないかを確認し、privacy.html の開示と ' +
				'突き合わせてから allowlist を更新すること',
		).toEqual([...EXTERNAL_AI_CLIENT_ALLOWLIST].sort());
	});
});

describe('アバターの AI 生成経路は存在しない (#4397)', () => {
	it('子供の nickname / age を外部 AI の prompt に埋める module が無い', () => {
		const residue = SRC_FILES.filter((file) => {
			const source = readFileSync(file, 'utf-8');
			return /buildAvatarPrompt|buildFaviconPrompt|image-prompt/.test(source);
		}).map(toRepoPath);

		expect(
			residue,
			'アバター画像生成 prompt は #4397 で撤去済み。復活させる場合、子供の識別情報を ' +
				'運営者の環境外へ出さない設計であることを privacy.html と併せて示すこと',
		).toEqual([]);
	});

	it('POST /api/v1/images (画像生成 endpoint) が存在しない', () => {
		const endpoint = resolve(REPO_ROOT, 'src/routes/api/v1/images/+server.ts');
		const source = readFileSync(endpoint, 'utf-8');

		expect(
			/export\s+const\s+POST/.test(source),
			'/api/v1/images は favicon パスの参照 (GET) のみ。生成 POST は #4397 で撤去済み',
		).toBe(false);
	});
});

// tests/unit/architecture/placeholder-avatar-offline.test.ts
// #4413: 仮アバターの生成が「運営者の環境の外」へ何も出さないことを機械で表明する。
//
// # なぜこの test が要るか
//
// #4397 / PR #4404 で撤去したのは「子供のニックネームと年齢を Google (Gemini) へ送って
// アバター画像を作る」配線だった。本 Issue (#4413) はその撤去を尊重したうえで、同じ経路に
// 同居していただけの**外部通信ゼロのローカル生成**を、子供の登録フローの一次機能として
// 復帰させる。
//
// ここで一番危険なのは「仮アバターの生成」という同じ名前の機能が、将来また外部 API
// (ui-avatars.com / DiceBear / 生成 AI 等) を掴むことである。#4397 の root cause は
// 「顧客への約束をコード側で表明している場所が 1 つも無かった」ことなので、復帰させる側にも
// 同じ表明を置く。
//
// 表明の仕方は「**generator を import ゼロの純粋関数に固定する**」。import が 0 本であれば、
// HTTP client も SDK も storage も掴みようがなく、外部送信は構文的に不可能になる。
// これは実行時の spy より強い（到達しなかっただけ、が起こり得ない）。
//
// #4404 が新設した tests/unit/architecture/external-ai-client-boundary.test.ts とは補完関係:
// 向こうは「外部 AI SDK を掴んでよい file の allowlist」、本 test は「仮アバター生成器が
// 何も掴んでいないこと」を固定する。
//
// 新規ツール導入ゼロ (既存 vitest + node fs)。ADR-0010 Pre-PMF / ADR-0061 same-class→guard 整合。

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { buildPlaceholderAvatarSvg } from '$lib/domain/placeholder-avatar';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const GENERATOR = resolve(REPO_ROOT, 'src/lib/domain/placeholder-avatar.ts');

/** 行頭の import / 動的 import / require を拾う（コメント内の語は拾わない） */
const IMPORT_PATTERN =
	/^\s*(?:import\s|export\s+\*\s+from|export\s+\{[^}]*\}\s+from)|[^.\w]import\s*\(|[^.\w]require\s*\(/gm;

describe('仮アバター生成器は外部へ出る口を持ち得ない (#4413)', () => {
	const source = readFileSync(GENERATOR, 'utf-8');

	it('import / require を 1 本も持たない純粋モジュールである', () => {
		const found = source.match(IMPORT_PATTERN) ?? [];

		expect(
			found,
			'仮アバターの生成器に依存を足そうとしている。ここは「子供のニックネームを一切外へ出さない」' +
				'ことを import ゼロで表明している module であり、HTTP client / SDK / storage を掴んだ時点で ' +
				'その表明が崩れる。永続化や I/O が要るなら呼び出し側 (child-service) に置くこと',
		).toEqual([]);
	});

	it('外部ホストの URL / fetch を含まない', () => {
		expect(/https?:\/\/(?!www\.w3\.org)/.test(source), '外部ホストへの URL が混入している').toBe(
			false,
		);
		expect(/\bfetch\s*\(/.test(source), 'fetch 呼び出しが混入している').toBe(false);
	});

	it('#4404 の外部 AI guard に抵触する語を含まない', () => {
		// external-ai-client-boundary.test.ts が禁じている識別子。rebase 後も両 guard が
		// 同時に green であることを、こちら側からも固定する。
		expect(/@google\/generative-ai/.test(source)).toBe(false);
		expect(/buildAvatarPrompt|buildFaviconPrompt|image-prompt/.test(source)).toBe(false);
	});

	it('実行しても fetch を呼ばない', () => {
		const fetchSpy = vi.fn();
		const original = globalThis.fetch;
		globalThis.fetch = fetchSpy as unknown as typeof fetch;

		try {
			buildPlaceholderAvatarSvg('まさと', 'blue');
		} finally {
			globalThis.fetch = original;
		}

		expect(fetchSpy).not.toHaveBeenCalled();
	});
});

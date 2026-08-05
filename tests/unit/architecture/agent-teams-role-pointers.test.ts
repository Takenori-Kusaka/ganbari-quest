// tests/unit/architecture/agent-teams-role-pointers.test.ts
// #4227 — 一般規約を各ロールファイルに写すと、更新が届かなくなる。
//
// ## 何を守るか
//
// `agent-teams.md` §7 が明記している原則:
//
// > **本ファイルが唯一の SSOT** であり、各ロールのファイルには
// > 「そのロール固有の使いどころ」だけを書く（**一般規約を写すと更新が届かなくなる**）
//
// #4227 で「read-only の分担調査」類型と**使ってよい 5 条件**を追加した。
// 5 条件は全ロール共通なので `agent-teams.md` にだけ置き、各ロールには
// **pointer だけ**を書いた。ここが崩れる形は 2 つある:
//
//   (a) 5 条件を各ロールに写す → 片方だけ直って drift する（#4158 で実害を見た形）
//   (b) 新類型を SSOT に足したのに、ロール側が知らないまま → 経路が開かない（#4180 と同型）
//
// **(a) と (b) は逆向きなので、両方を assert する。**

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SSOT = 'docs/sessions/agent-teams.md';

/** 本類型を使いうるロールのファイル。増えたらここに足す。 */
const ROLE_FILES = [
	'docs/sessions/dev-session.md',
	'docs/sessions/po-session.md',
	'docs/sessions/qm-session.md',
	'docs/sessions/platform-session.md',
];

describe('#4227 read-only の分担調査 — SSOT と各ロールの書き分け', () => {
	const ssot = readFileSync(SSOT, 'utf8');

	it('類型と 5 条件が SSOT にある', () => {
		expect(ssot).toContain('read-only の分担調査');
		expect(ssot, '使ってよい条件の節が見つかりません').toContain('使ってよい 5 条件');
		// 条件の実体（見出しだけ残して中身が消える形を防ぐ）
		expect(ssot, '条件 1 (read-only 限定)').toMatch(/read-only.{0,20}に限る/);
		expect(ssot, '条件 2 (出力先ファイル)').toContain('出力先ファイルを指定');
		expect(ssot, '条件 3 (lead が突き合わせる)').toContain('突き合わせる');
		expect(ssot, '条件 4 (件数と出力量の下限)').toContain('10 件以上');
		expect(ssot, '条件 5 (トークン逼迫時は使わない)').toContain('週間リミット');
	});

	// (b) SSOT に足したのにロールが知らない、を検出
	it.each(ROLE_FILES)('%s が本類型を知っている', (path) => {
		expect(readFileSync(path, 'utf8')).toContain('read-only の分担調査');
	});

	// (a) 一般規約をロールに写した、を検出（§7 の原則違反）
	it.each(ROLE_FILES)('%s が 5 条件そのものを写していない', (path) => {
		const src = readFileSync(path, 'utf8');
		// 条件の中身に固有の文字列。ロール側に現れたら「写した」と判断する。
		for (const generalRule of ['10 件以上', '週間リミット', '出力先ファイルを指定']) {
			expect(
				src,
				`一般規約「${generalRule}」がロールファイルに写されています。SSOT (${SSOT}) を参照させてください（agent-teams.md §7）`,
			).not.toContain(generalRule);
		}
		// pointer は必須（「知っている」だけで参照先が無いと、条件を読まずに使う）
		expect(src, 'SSOT への pointer がありません').toContain('agent-teams.md');
	});
});

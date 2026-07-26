// tests/unit/routes/settings-hub-coverage.test.ts
// #3954: 「settings の子 route が hub のカードから辿れない」class を機械 gate 化する。
//
// 背景: #3339 で実装した「ごほうび交換の承認要否」は `/admin/settings/rules` にあるが、
// hub (`/admin/settings`) のカード一覧に rules が無く、**実オーナーが機能に到達できなかった**
// (「以前この機能について設定変更できるようにしましょうと話していたと思いますが、
// どこから変更可能ですか？」)。実装は存在するのに顧客には存在しないのと同じ状態だった。
//
// なぜ guard にするか: hub のカード配列は手書きの静的配列であり、子 route を新設しても
// 追記を忘れると**何も壊れない**まま到達不能な画面が増える (#2905 ページガイドと同 class)。
// 母数を実 FS (routes ディレクトリ) から導出し、「hub カードにある」か「明示除外」の
// いずれかで全子 route が説明されることを assert する
// (`admin-resource-model-registry.ts` の no-silent-gap パターン #3134 / #3164 / #3171 を踏襲)。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const SETTINGS_DIR = path.join(REPO_ROOT, 'src/routes/(parent)/admin/settings');
const HUB_PAGE = path.join(SETTINGS_DIR, '+page.svelte');

/**
 * hub のカードに載せない子 route と、その理由。
 * **除外は必ず理由付きでここに書く** — 空の除外リストは「検討した結果の除外」と
 * 「書き忘れ」を区別できないため、理由の記述自体を必須にする。
 */
const EXCLUDED_FROM_HUB: Record<string, string> = {
	// 現時点で除外に該当する子 route は無い。
	// 追加する場合は「なぜ hub から辿れなくてよいか」を 1 行で書くこと。
};

/** `src/routes/(parent)/admin/settings/<name>/+page.svelte` を持つ子 route 名を実 FS から集める。 */
function listSettingsChildRoutes(): string[] {
	return fs
		.readdirSync(SETTINGS_DIR, { withFileTypes: true })
		.filter((e) => e.isDirectory())
		.map((e) => e.name)
		.filter((name) => fs.existsSync(path.join(SETTINGS_DIR, name, '+page.svelte')))
		.sort();
}

/** hub の `groupCards` が持つ `/admin/settings/<name>` の <name> を集める。 */
function listHubLinkedRoutes(): string[] {
	const source = fs.readFileSync(HUB_PAGE, 'utf8');
	const found = new Set<string>();
	for (const m of source.matchAll(/href:\s*'\/admin\/settings\/([a-z0-9-]+)'/g)) {
		if (m[1] !== undefined) found.add(m[1]);
	}
	return [...found].sort();
}

describe('#3954 settings hub は全ての子 route を説明する (no-silent-gap)', () => {
	it('[S0] 子 route を 1 件以上発見する (0 件マッチの素通りを防ぐ)', () => {
		expect(listSettingsChildRoutes().length).toBeGreaterThan(0);
	});

	it('[S1] 全ての子 route が hub カードにあるか、理由付きで明示除外されている', () => {
		const unexplained = listSettingsChildRoutes().filter(
			(name) => !listHubLinkedRoutes().includes(name) && !(name in EXCLUDED_FROM_HUB),
		);
		expect(
			unexplained,
			`hub (/admin/settings) から辿れない子 route を検出:\n` +
				`${unexplained.map((n) => `  /admin/settings/${n}`).join('\n')}\n` +
				`→ ${path.relative(REPO_ROOT, HUB_PAGE)} の groupCards にカードを足すか、` +
				`本 test の EXCLUDED_FROM_HUB に理由付きで登録する`,
		).toEqual([]);
	});

	it('[S2] hub のリンク先が実在する (typo / 撤去済 route への死にリンクを防ぐ)', () => {
		const dangling = listHubLinkedRoutes().filter(
			(name) => !listSettingsChildRoutes().includes(name),
		);
		expect(dangling, `実在しない子 route へのリンク: ${dangling.join(', ')}`).toEqual([]);
	});

	it('[S3] 除外リストに載る route は実在する (役目を終えた除外が残り続けるのを防ぐ)', () => {
		const stale = Object.keys(EXCLUDED_FROM_HUB).filter(
			(name) => !listSettingsChildRoutes().includes(name),
		);
		expect(stale, `実在しない route の除外エントリ: ${stale.join(', ')}`).toEqual([]);
	});

	// #3954 の当該 route を実名で固定する。上の [S1] は将来 EXCLUDED_FROM_HUB に
	// rules を足せば通ってしまうため、「今回の顧客報告そのもの」は独立に固定しておく。
	it('[S4] ごほうび交換の承認要否 (/admin/settings/rules) は hub から辿れる', () => {
		expect(listHubLinkedRoutes()).toContain('rules');
		expect(fs.readFileSync(HUB_PAGE, 'utf8')).toContain('settings-hub-card-rules');
	});
});

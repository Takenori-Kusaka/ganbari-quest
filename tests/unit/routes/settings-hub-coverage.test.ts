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
import { ADMIN_RULES_PAGE_LABELS, PAGE_GUIDE_LABELS } from '$lib/domain/labels';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const SETTINGS_DIR = path.join(REPO_ROOT, 'src/routes/(parent)/admin/settings');
const HUB_PAGE = path.join(SETTINGS_DIR, '+page.svelte');
const SUBNAV_LAYOUT = path.join(SETTINGS_DIR, '+layout.svelte');
const RULES_PAGE = path.join(SETTINGS_DIR, 'rules/+page.svelte');
const RULES_GUIDE_DEF = path.join(SETTINGS_DIR, 'rules/_guide.ts');

/**
 * 到達導線は hub カード (`+page.svelte`) と サブナビ (`+layout.svelte`) の **2 箇所**にあり、
 * どちらも手書きの静的配列。片方だけ追記すると
 * 「hub からは行けるがサブナビでは選択状態にならない」「サブナビにはあるが hub に無い」
 * といった非対称が生まれる (parallel-implementations.md のナビ並行実装と同 class)。
 * #3954 の実装中、実際に hub だけ直してサブナビを取り落としかけたため両方を母数にする。
 */
const NAV_SOURCES = [
	{ label: 'hub カード (+page.svelte)', file: HUB_PAGE },
	{ label: 'サブナビ (+layout.svelte)', file: SUBNAV_LAYOUT },
] as const;

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

/** 指定ファイルの配列が持つ `/admin/settings/<name>` の <name> を集める。 */
function listLinkedRoutes(file: string): string[] {
	const source = fs.readFileSync(file, 'utf8');
	const found = new Set<string>();
	for (const m of source.matchAll(/href:\s*'\/admin\/settings\/([a-z0-9-]+)'/g)) {
		if (m[1] !== undefined) found.add(m[1]);
	}
	return [...found].sort();
}

const listHubLinkedRoutes = () => listLinkedRoutes(HUB_PAGE);

describe('#3954 settings hub は全ての子 route を説明する (no-silent-gap)', () => {
	it('[S0] 子 route を 1 件以上発見する (0 件マッチの素通りを防ぐ)', () => {
		expect(listSettingsChildRoutes().length).toBeGreaterThan(0);
	});

	it.each(NAV_SOURCES)('[S1] 全ての子 route が $label にあるか、理由付きで明示除外されている', ({
		file,
	}) => {
		const linked = listLinkedRoutes(file);
		const unexplained = listSettingsChildRoutes().filter(
			(name) => !linked.includes(name) && !(name in EXCLUDED_FROM_HUB),
		);
		expect(
			unexplained,
			`${path.relative(REPO_ROOT, file)} から辿れない子 route を検出:\n` +
				`${unexplained.map((n) => `  /admin/settings/${n}`).join('\n')}\n` +
				`→ 同ファイルの導線配列に追加するか、本 test の EXCLUDED_FROM_HUB に理由付きで登録する`,
		).toEqual([]);
	});

	// hub とサブナビが両方 route を持っていても、**並び順が食い違う**と
	// 「さっき下から 3 番目にあったのに」が通じなくなる (NN/G #4 consistency)。
	it('[S1b] hub カードとサブナビの settings 子 route の並び順が一致する', () => {
		const order = (file: string) =>
			[...fs.readFileSync(file, 'utf8').matchAll(/href:\s*'\/admin\/settings\/([a-z0-9-]+)'/g)]
				.map((m) => m[1])
				.filter((n): n is string => n !== undefined);
		expect(order(SUBNAV_LAYOUT), 'サブナビと hub カードで子 route の並び順が異なる').toEqual(
			order(HUB_PAGE),
		);
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

/**
 * #3954 (QM 指摘 2026-07-26 22:46): カードとサブナビに導線を足しても、**ページガイドが
 * 「6つのカードに分かれます」と言い続けていたら保護者は到達できない**。
 * これは #3954 が class 1 件目に挙げた #2905 (ページガイドと実態の乖離) そのものなので、
 * 「導線 3 箇所のうちガイドだけ手で直し忘れる」経路を [S1] / [S1b] と同じ強さで塞ぐ。
 *
 * 件数だけを assert する理由: 文言そのもの (順番・説明) の妥当性は機械判定できないが、
 * **枚数のずれは今回実際に起きた drift そのもの**で、カードを 1 枚増やせば必ず踏む。
 * 名前の一致まで縛ると hub カード名 (`サポート・アプリ情報`) とガイド表記 (`サポート`) の
 * 正当な差分まで fail させてしまうため、ここでは件数に絞る。
 */
describe('#3954 settings hub のページガイドがカード枚数と一致する', () => {
	const HUB_GUIDE = PAGE_GUIDE_LABELS.adminSettings.steps['settings-hub'];

	/** hub の全カード枚数 (plan deep link を含む。`testid` は 1 カード 1 個)。 */
	function countHubCards(): number {
		return [...fs.readFileSync(HUB_PAGE, 'utf8').matchAll(/testid:\s*'settings-hub-card-/g)].length;
	}

	/** 文中の「N つ」「N枚」等の算用数字を集める (`${...}` 参照は含まれない前提)。 */
	function numbersIn(text: string): number[] {
		return [...text.matchAll(/(\d+)\s*つ/g)].map((m) => Number(m[1]));
	}

	it('[S5] ガイドの「上から順に」の列挙件数が hub のカード枚数と一致する', () => {
		const enumerated = [...HUB_GUIDE.how.matchAll(/^\d+\.\s/gm)].length;
		expect(
			enumerated,
			`ページガイド (PAGE_GUIDE_LABELS.adminSettings.steps['settings-hub'].how) の列挙が ` +
				`${enumerated} 件、hub のカードが ${countHubCards()} 枚で食い違っている。\n` +
				'→ カードを増減したらガイドの列挙も同じ順序で更新すること (ガイドが古いと導線があっても辿れない)',
		).toBe(countHubCards());
	});

	it('[S6] ガイドの title / what が書いている件数が hub のカード枚数と一致する', () => {
		const declared = [...numbersIn(HUB_GUIDE.title), ...numbersIn(HUB_GUIDE.what)];
		expect(declared.length, 'title / what のどちらにも件数の記載が無い').toBeGreaterThan(0);
		for (const n of declared) {
			expect(
				n,
				`ガイドの文言が「${n}つ」と書いているが、hub のカードは ${countHubCards()} 枚`,
			).toBe(countHubCards());
		}
	});
});

/**
 * #3954: 到達先 (`/admin/settings/rules`) 側のガイドも同じ class で古くなっていた。
 * ページには「ごほうび交換の承認要否」(`rules-reward-approval-section`) と
 * 「取り込んだボーナスルール」の 2 セクションがあるのに、ガイドは後者しか案内しておらず、
 * **ガイドに従う保護者は #3954 が到達させたい当の機能を素通りしていた**。
 * 加えてガイド title (`とくべつルール`) がページ title と食い違っていた。
 *
 * 限界を明記する: [S8] は「anchor を張ったのにガイドから案内しない」非対称を塞ぐが、
 * **anchor を張り忘れた新規セクション**は母数に入らないため検出できない。
 * セクションの重要度は機械判定できないので、そこは手のレビューに残す。
 */
describe('#3954 rules ページのガイドが画面の実態と一致する', () => {
	const RULES_GUIDE = PAGE_GUIDE_LABELS.adminSettingsRules;

	/** `data-tutorial="X"` の X を集める (ページ側 = ガイドが指せる anchor の母数)。 */
	function anchorsInPage(): string[] {
		const found = [...fs.readFileSync(RULES_PAGE, 'utf8').matchAll(/data-tutorial="([a-z0-9-]+)"/g)]
			.map((m) => m[1])
			.filter((n): n is string => n !== undefined);
		return [...new Set(found)].sort();
	}

	/** `_guide.ts` の step が指す `[data-tutorial="X"]` の X を集める。 */
	function anchorsInGuide(): string[] {
		const found = [
			...fs.readFileSync(RULES_GUIDE_DEF, 'utf8').matchAll(/\[data-tutorial="([a-z0-9-]+)"\]/g),
		]
			.map((m) => m[1])
			.filter((n): n is string => n !== undefined);
		return [...new Set(found)].sort();
	}

	it('[S7] ガイドの title がページの title と一致する (同じ画面が 2 つの名前を持たない)', () => {
		expect(
			RULES_GUIDE.title,
			'PAGE_GUIDE_LABELS.adminSettingsRules.title と ADMIN_RULES_PAGE_LABELS.pageTitle が食い違っている',
		).toBe(ADMIN_RULES_PAGE_LABELS.pageTitle);
	});

	it('[S8] ページの data-tutorial anchor とガイドの selector が過不足なく対応する', () => {
		const page = anchorsInPage();
		expect(page.length, 'rules ページに data-tutorial anchor が 1 件も無い').toBeGreaterThan(0);
		expect(
			anchorsInGuide(),
			'ガイドが案内していない anchor、または実在しない anchor を指す step がある\n' +
				`  ページ側: ${page.join(', ')}\n` +
				`  ガイド側: ${anchorsInGuide().join(', ')}`,
		).toEqual(page);
	});

	// #3954 の当該機能を実名で固定する ([S8] は anchor ごと消せば通ってしまうため)。
	it('[S9] ごほうび交換の承認要否セクションがガイドで案内されている', () => {
		expect(fs.readFileSync(RULES_PAGE, 'utf8')).toContain('data-tutorial="rules-reward-approval"');
		expect(anchorsInGuide()).toContain('rules-reward-approval');
	});
});

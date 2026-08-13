// tests/unit/architecture/ai-suggest-gate-derivation.test.ts
//
// #4506 (EPIC #4495) AC5 — AI 提案パネルの `isFamily` 導出を機械で 1 本に固定する
// fitness function (ADR-0061 原則 2: same-class N 回目は instance 修正をやめて guard に畳む)。
//
// ## なぜ機械 guard にしたか
//
// 「導出式が call site ごとに手書きされている」ことが原因の混乱が 3 回起きている。
//
// - #2902: activities の `data.planTier === 'family'` を「load が planTier を返さないので常に
//   false」と読んで `data.isPremium` に変えた。**この読みは誤りだった** —
//   `(parent)/admin/+layout.server.ts` が planTier を返しており、`data` は layout の戻り値を
//   マージするため解決していた。結果、**動いていた式を壊し** standard に解放表示を出す状態
//   (有利誤認 / legal) を作った。
// - #4506 GAMMA2-ADM1-01: checklists について同じ誤読が再演された (「常にロック」と報告されたが、
//   premium account の実機で非ロックを実測。false positive)。
// - #4506 GAMMA2-ADM1-02: #2902 が作った activities の実欠陥が改めて検出された。
//
// つまり「式を人が読んで正しさを判定する」運用が 3 回連続で失敗している。判定を人手から外し、
// **callSite が共有述語を経由していること** と **参照 field が load 連鎖で供給されていること**
// を機械が見る。特に検査 2 は #2902 / #4506 の誤読そのものを機械化しないよう、
// layout の寄与を必ず数える (`loadFilesFor` の doc)。
//
// ## 何を検査するか
//
// 1. `src/routes/**/+page.svelte` の `<AiSuggest*Panel ... isFamily={...} />` 全 call site が
//    `isAiSuggestUnlocked(` を経由していること。経由しない callSite は
//    `DEFERRED_DERIVATIONS` に **理由付きで** 登録されていなければ fail する。
//    「あとで直す」を無言で置けないようにするための登録であって、免除の入口ではない。
// 2. call site が読む `data.<field>` を、**load 連鎖 (`+page.server.ts` + 祖先の
//    `+layout(.server).ts`) のどこかが実際に返している**こと。SvelteKit の `data` は layout の
//    戻り値がマージされたものなので、page load だけを見ると誤読する (#4506 の Issue 本文が
//    その誤読だった。詳細は loadFilesFor の doc)。
//
// ## 2 が要る理由 (型では守れないため)
//
// 「参照先の無い `data.<field>` が静かに undefined になる」class は **型検査では捕まらない**。
// SvelteKit が生成する `PageData` は `OutputDataShape` 経由で `Record<string, any>` を含むため、
// `data.<存在しない field>` は `any` に解決され、svelte-check / tsc は error を出さない
// (PR #4523 で存在しない field を参照する mutation を当てて 0 errors を実測確認済)。
//
// したがって「述語を関数にしたから型で守られる」とは **言えない**。型で守られるのは
// `+page.server.ts` 側 (`isAiSuggestUnlocked(tier)` の引数が `PlanTier`) までで、
// page ↔ load の対応は本 file が機械で見る。

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findReasonDefect } from '../../../scripts/lib/ci/exclusion-reason.mjs';

const repoRoot = resolve(__dirname, '../../..');

/** 導出の SSOT。callSite はこれを経由しなければならない。 */
const SHARED_PREDICATE = 'isAiSuggestUnlocked(';

/** AI 提案パネルの call site。`isFamily={...}` の中身を捕まえる。 */
const CALLSITE_PATTERN = /<AiSuggest(\w*)Panel\b[^>]*?isFamily=\{([^}]*)\}/gs;

/**
 * 共有述語へ未移行のまま許容する callSite。
 *
 * key は repo root からの POSIX 相対パス。**理由には追跡先 Issue 番号を必ず含める**
 * (`findReasonDefect` が空 / stub を弾き、本 file が `#\d+` を追加で要求する)。
 */
const DEFERRED_DERIVATIONS: Record<string, string> = {
	'src/routes/(parent)/admin/activities/+page.svelte':
		'#4506 では checklists の SSOT 統一のみ先行させた。activities を共有述語に移すと standard 加入者の表示が解放 → ロックに変わる (= 実欠陥 GAMMA2-ADM1-02 の是正そのもの) が、この引き締めは PO の順序制約により #4501 (プレミアムのトライアル化) と同 wave か後に実施する。LP が「全機能お試し」を約束している間に先に締めると、見込み客に対する新たな誤認を作るため',
};

/**
 * 共有述語 `isAiSuggestUnlocked` の呼び出し元 pin (#4556)。
 *
 * この述語は **UI のロック表示**と **server 側 enforcement** の両方から呼ばれている。名前と配置
 * (domain 層 / 「利用可能か」) からはそれが読み取れないため、「トライアル中は見た目だけ解放したい」
 * のような **表示都合の要件**で条件を緩めると、同じ条件が enforcement にも効いて**認可が黙って
 * 緩む**。
 *
 * ここで call site の集合を固定し、増減したら CI で気づけるようにする (述語の doc を読まずに
 * 触れない状態を作る)。role は「その call site が何を決めているか」:
 * - `enforcement`: 実行を止める (server)
 * - `display`: 見た目を出し分ける (UI)
 *
 * **どちらの role も 1 件以上必要**。片方が 0 件になったら、それは「兼務でなくなった」か
 * 「検査が空振りしている」かのどちらかで、いずれも本 pin の前提が崩れている。
 */
const PREDICATE_CALLSITES: Record<string, 'enforcement' | 'display'> = {
	'src/lib/server/api/suggest-plan-gate.ts': 'enforcement',
	'src/routes/(parent)/admin/checklists/+page.svelte': 'display',
	'src/routes/(parent)/admin/rewards/+page.svelte': 'display',
};

/** 述語の定義 file 自身 (呼び出し元ではないので集合から除く)。 */
const PREDICATE_DEFINITION = 'src/lib/domain/ai-suggest-gate.ts';

function listSourceFiles(dir: string): string[] {
	const found: string[] = [];
	const walk = (current: string): void => {
		for (const entry of readdirSync(current)) {
			const full = join(current, entry);
			if (statSync(full).isDirectory()) {
				if (entry === 'node_modules' || entry === '.svelte-kit') continue;
				walk(full);
				continue;
			}
			if (/\.(ts|svelte)$/.test(entry)) found.push(full);
		}
	};
	walk(dir);
	return found;
}

function listPageSvelte(dir: string): string[] {
	const found: string[] = [];
	const walk = (current: string): void => {
		for (const entry of readdirSync(current)) {
			const full = join(current, entry);
			if (statSync(full).isDirectory()) {
				if (entry === 'node_modules' || entry === '.svelte-kit') continue;
				walk(full);
				continue;
			}
			if (entry === '+page.svelte') found.push(full);
		}
	};
	walk(dir);
	return found;
}

interface CallSite {
	path: string;
	panel: string;
	expression: string;
}

const callSites: CallSite[] = listPageSvelte(join(repoRoot, 'src', 'routes')).flatMap((path) => {
	const source = readFileSync(path, 'utf-8');
	const rel = relative(repoRoot, path).replace(/\\/g, '/');
	return [...source.matchAll(CALLSITE_PATTERN)].map((m) => ({
		path: rel,
		panel: `AiSuggest${m[1]}Panel`,
		expression: (m[2] ?? '').trim(),
	}));
});

/**
 * コメントを落とした本文を返す。
 *
 * `admin/activities/+page.svelte` は HTML コメント内で `isAiSuggestUnlocked(...)` に言及して
 * いる (未移行の理由説明)。**言及を呼び出しと数えると pin が嘘になる**ため、比較前に落とす。
 */
function stripComments(source: string): string {
	return source
		.replace(/<!--[\s\S]*?-->/g, '')
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.replace(/^[ \t]*\/\/.*$/gm, '');
}

/** 述語を実際に呼び出している file (repo root からの POSIX 相対パス)。 */
const predicateCallers: string[] = listSourceFiles(join(repoRoot, 'src'))
	.filter((path) => stripComments(readFileSync(path, 'utf-8')).includes(SHARED_PREDICATE))
	.map((path) => relative(repoRoot, path).replace(/\\/g, '/'))
	.filter((rel) => rel !== PREDICATE_DEFINITION)
	.sort();

/**
 * ある `+page.svelte` の `data` に寄与しうる load file を、**祖先 layout まで遡って**列挙する。
 *
 * SvelteKit の `data` は `+page.server.ts` の戻り値だけではなく、**祖先の `+layout(.server).ts`
 * の戻り値がマージされたもの**である。この事実を落とすと「page load が返していない = 常に
 * undefined」と誤読する。#4506 の Issue 本文がまさにその誤読で、`data.planTier` は
 * `src/routes/(parent)/admin/+layout.server.ts` が返しているため実際には解決していた
 * (premium account の実機で `data-plan-locked="false"` = 非ロックを実測)。
 * 本検査が同じ誤読を機械化しないよう、layout も provider として数える。
 */
function loadFilesFor(pageSveltePath: string): Array<{ rel: string; absolute: string }> {
	const out: Array<{ rel: string; absolute: string }> = [];
	const segments = pageSveltePath.split('/');
	segments.pop(); // '+page.svelte'
	// 自分の dir → 祖先 dir へ遡る (src/routes = 深さ 2 まで)
	for (let depth = segments.length; depth >= 2; depth--) {
		const dir = segments.slice(0, depth).join('/');
		const candidates =
			depth === segments.length
				? ['+page.server.ts', '+page.ts', '+layout.server.ts', '+layout.ts']
				: ['+layout.server.ts', '+layout.ts'];
		for (const candidate of candidates) {
			const rel = `${dir}/${candidate}`;
			const absolute = join(repoRoot, rel);
			if (existsSync(absolute)) out.push({ rel, absolute });
		}
	}
	return out;
}

// repo 走査 test の区分宣言 (#4085、SSOT = scripts/lib/ci/repo-scan-test-registry.mjs)。
// src/routes 全体を walk するため、並列 worker との CPU / FS 競合で既定 5s を超えうる。
describe('AI 提案パネル isFamily 導出の単一実装 (#4506 AC5)', { timeout: 30000 }, () => {
	it('call site を検出できている (検査が空振りしていない)', () => {
		// 0 件で PASS すると「call site が無い」ことを健全と見なしてしまう。
		// panel の rename / prop 名変更で pattern が外れた場合もここで落ちる。
		expect(callSites.length).toBeGreaterThanOrEqual(3);
	});

	it('すべての call site が共有述語 isAiSuggestUnlocked() を経由する (除外登録を除く)', () => {
		const violations = callSites
			.filter((c) => !c.expression.includes(SHARED_PREDICATE))
			.filter((c) => !(c.path in DEFERRED_DERIVATIONS))
			.map((c) => `${c.path} (${c.panel}): isFamily={${c.expression}}`);

		expect(
			violations,
			`isFamily の導出を手書きしている call site があります。$lib/domain/ai-suggest-gate の ` +
				`isAiSuggestUnlocked() を使ってください (#4506)。意図的な未移行なら ` +
				`DEFERRED_DERIVATIONS に理由付きで登録してください:\n${violations.join('\n')}`,
		).toEqual([]);
	});

	it('除外登録は実在の call site を指し、かつ現に未移行である (腐った除外を残さない)', () => {
		for (const path of Object.keys(DEFERRED_DERIVATIONS)) {
			const matching = callSites.filter((c) => c.path === path);
			expect(matching.length, `${path} に AI 提案パネルの call site がありません`).toBeGreaterThan(
				0,
			);
			// 共有述語へ移行済みなのに除外が残っている = 除外の目的が消えている。消させる。
			const stillDeferred = matching.some((c) => !c.expression.includes(SHARED_PREDICATE));
			expect(
				stillDeferred,
				`${path} は共有述語へ移行済みです。DEFERRED_DERIVATIONS から削除してください`,
			).toBe(true);
		}
	});

	it('call site が読む data.<field> を load 連鎖のどこかが実際に返している (silent undefined の排除)', () => {
		const missing: string[] = [];

		for (const callSite of callSites) {
			// `isAiSuggestUnlocked(data.planTier)` / `data.isPremium` 等から参照 field を取り出す
			const fields = [...callSite.expression.matchAll(/\bdata\.(\w+)/g)].map((m) => m[1] ?? '');
			if (fields.length === 0) continue;

			const providers = loadFilesFor(callSite.path);
			if (providers.length === 0) {
				missing.push(`${callSite.path}: load file が 1 つも見つかりません`);
				continue;
			}

			for (const field of fields) {
				// load の返却 object literal での出現。`field,` (shorthand) / `field: expr` の双方を見る。
				const pattern = new RegExp(`(^|[\\s{,])${field}\\s*[,:]`, 'm');
				const provided = providers.some((f) => pattern.test(readFileSync(f.absolute, 'utf-8')));
				if (!provided) {
					missing.push(
						`${callSite.path} が data.${field} を読んでいますが、load 連鎖 ` +
							`(${providers.map((f) => f.rel).join(' / ')}) のどこも ${field} を返していません ` +
							`(常に undefined = 静かに false になります)`,
					);
				}
			}
		}

		expect(missing, missing.join('\n')).toEqual([]);
	});

	it('共有述語の呼び出し元が enforcement と表示の両方である (#4556、緩めると認可が緩むことの pin)', () => {
		expect(
			predicateCallers,
			`isAiSuggestUnlocked の呼び出し元が変わりました。この述語は UI 表示と server 側 ` +
				`enforcement を兼ねているため、call site の増減は「表示都合の変更が認可に波及する」` +
				`範囲が変わったことを意味します。$lib/domain/ai-suggest-gate の JSDoc を読んだうえで ` +
				`PREDICATE_CALLSITES を更新してください`,
		).toEqual(Object.keys(PREDICATE_CALLSITES).sort());

		const roles = Object.values(PREDICATE_CALLSITES);
		// 片方が 0 件 = 兼務でなくなったか、検査が空振りしている。どちらも本 pin の前提が崩れている。
		expect(roles, 'enforcement 側の呼び出し元が消えています').toContain('enforcement');
		expect(roles, '表示側の呼び出し元が消えています').toContain('display');
	});

	it('除外登録の理由が成立している (空 / stub / Issue 番号なしを弾く)', () => {
		for (const [path, reason] of Object.entries(DEFERRED_DERIVATIONS)) {
			const defect = findReasonDefect(reason);
			expect(defect, `${path} の除外理由: ${defect}`).toBeNull();
			expect(reason, `${path} の除外理由に追跡先 Issue 番号がありません`).toMatch(/#\d{3,}/);
		}
	});
});

// tests/unit/features/admin/downgrade-dialog-reachability.test.ts (#4530)
//
// ダウングレード確認ダイアログ (`DowngradeResourceSelector`) の分岐が、実際にダイアログを
// 開く caller (`SaasLicensePanel.requestPortal()`) から **到達可能**であることを機械検証する。
//
// # なぜ「到達可能性」を検査するのか
//
// #4530 の欠陥は「分岐の中身が間違っていた」のではなく「分岐が一度も実行されなかった」こと
// だった。component 側は `hasExcess`（リソース超過）と `willLoseHistory`（保持期間短縮）を
// 独立 2 条件として書いていたのに、開く側の判定が `hasExcess` だけを見ていたため、
// 「超過は無いが保持期間は縮む」顧客は警告を 1 つも見ないまま不可逆な確定に進み、
// `retention-cleanup-service` が記録を物理削除していた。
//
// 新しく繋いだ経路だけを test しても、**次に孤立する分岐**は捕まらない。そこで
// component の分岐条件を source から取り出し、その条件を満たす preview で
// `shouldOpenDowngradeSelector` が真になるか（= その分岐に到達しうるか）を全件検査する。
// 到達不能な分岐を足したら、その分岐自身が本 test を落とす。
//
// # 走査範囲
//
// 2 file (component / caller) を名指しで読むだけで、ディレクトリツリーは歩かない
// (`tests/CLAUDE.md` §「repo 走査 test」の bounded 側)。

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { DowngradePreview } from '../../../../src/lib/domain/downgrade-types';
import { shouldOpenDowngradeSelector } from '../../../../src/lib/features/admin/downgrade-dialog-policy';

// vitest の cwd は repo root (vite.config.ts)。2 file を名指しで読むだけで tree は歩かない。
const COMPONENT_PATH = resolve(
	'src/lib/features/admin/components/DowngradeResourceSelector.svelte',
);
const CALLER_PATH = resolve('src/lib/features/admin/components/SaasLicensePanel.svelte');

/** component 側が分岐に使う 2 条件。source 上の式 → 述語の変数名。 */
const CONDITION_TOKENS = [
	{ source: 'preview.retentionChange.willLoseHistory', variable: 'willLoseHistory' },
	{ source: 'preview.hasExcess', variable: 'hasExcess' },
] as const;

/** `hasExcess` × `willLoseHistory` の全組み合わせ (AC5)。 */
const COMBINATIONS = [
	{ hasExcess: false, willLoseHistory: false },
	{ hasExcess: false, willLoseHistory: true },
	{ hasExcess: true, willLoseHistory: false },
	{ hasExcess: true, willLoseHistory: true },
] as const;

/**
 * `/api/v1/admin/downgrade-preview` の戻り値と同型の最小 preview。
 * 到達可能性の判定に効くのは 2 つの boolean だけなので、他は空で足りる。
 */
function previewOf({
	hasExcess,
	willLoseHistory,
}: {
	hasExcess: boolean;
	willLoseHistory: boolean;
}): DowngradePreview {
	return {
		targetTier: 'free',
		children: { current: [], max: 2, excess: hasExcess ? 1 : 0 },
		activities: { current: [], max: 3, excess: 0 },
		checklistTemplates: { current: [], maxPerChild: 3, excessByChild: [] },
		retentionChange: {
			currentDays: willLoseHistory ? 365 : 90,
			targetDays: 90,
			willLoseHistory,
		},
		hasExcess,
	};
}

/**
 * component source から `{#if …}` の条件式を取り出す。
 *
 * `{#if` の直後から対応する `}` までを、括弧の深さを数えて切り出す
 * (条件式が `(a && b)` のように括弧を含んでも壊れないようにする)。
 */
function extractIfConditions(source: string): string[] {
	const conditions: string[] = [];
	const marker = '{#if ';
	let cursor = source.indexOf(marker);
	while (cursor !== -1) {
		let depth = 1;
		let index = cursor + marker.length;
		const start = index;
		while (index < source.length && depth > 0) {
			const char = source[index];
			if (char === '{') depth += 1;
			else if (char === '}') depth -= 1;
			if (depth > 0) index += 1;
		}
		expect(depth, `\`{#if\` が閉じていない (offset ${cursor})`).toBe(0);
		conditions.push(source.slice(start, index).trim());
		cursor = source.indexOf(marker, index);
	}
	return conditions;
}

/**
 * 条件式を `(hasExcess, willLoseHistory)` の述語へ変換する。
 *
 * 2 条件以外の識別子が混ざっている式は **評価せず fail させる**。
 * 「知らない形だから見なかったことにする」を許すと、検査を無効化する書き方が生まれる
 * (宣言が検査を無効化しない、`tests/CLAUDE.md` §repo 走査 test と同じ原則)。
 */
function toPredicate(
	condition: string,
): (combo: { hasExcess: boolean; willLoseHistory: boolean }) => boolean {
	let normalized = condition;
	for (const { source, variable } of CONDITION_TOKENS) {
		normalized = normalized.split(source).join(variable);
	}
	const residue = normalized.replace(/hasExcess|willLoseHistory|[!&|()\s]/g, '');
	expect(
		residue,
		[
			`ダイアログの分岐条件 \`${condition}\` に hasExcess / willLoseHistory 以外の要素が含まれている。`,
			'本 test は 2 条件の組み合わせで到達可能性を検査するので、条件を 2 条件だけで書くか、',
			'新しい条件を CONDITION_TOKENS / COMBINATIONS に足して検査範囲を広げること',
			'(検査対象から外して通すのは不可)。',
		].join('\n'),
	).toBe('');
	// 上の residue 検査で式が 2 変数と論理演算子だけであることを確認済 (repo の source 由来、外部入力なし)
	const evaluate = new Function(
		'hasExcess',
		'willLoseHistory',
		`return Boolean(${normalized});`,
	) as (hasExcess: boolean, willLoseHistory: boolean) => boolean;
	return ({ hasExcess, willLoseHistory }) => evaluate(hasExcess, willLoseHistory);
}

const componentSource = readFileSync(COMPONENT_PATH, 'utf8');
const callerSource = readFileSync(CALLER_PATH, 'utf8');

/** 2 条件のいずれかに言及する分岐 = 到達可能性を検査する対象。 */
const guardedConditions = extractIfConditions(componentSource).filter((condition) =>
	CONDITION_TOKENS.some(({ source }) => condition.includes(source)),
);

describe('ダウングレード確認ダイアログを開く判定 (#4530)', () => {
	it.each(COMBINATIONS)('hasExcess=$hasExcess / willLoseHistory=$willLoseHistory', ({
		hasExcess,
		willLoseHistory,
	}) => {
		// 失うものが 1 つでもあるなら開く。何も失わないなら開かない (AC1 / AC3 / AC4)
		expect(shouldOpenDowngradeSelector(previewOf({ hasExcess, willLoseHistory }))).toBe(
			hasExcess || willLoseHistory,
		);
	});

	it('preview の取得に失敗したら開かない', () => {
		expect(shouldOpenDowngradeSelector(null)).toBe(false);
	});
});

describe('ダイアログ内の分岐は caller から到達可能である (#4530 AC5)', () => {
	it('検査対象の分岐が見つかる (source の形が変わって空振りしていない)', () => {
		// 保持期間警告 (!hasExcess 側 / hasExcess 側) + 超過ブロック + 確認ボタンの出し分け
		expect(guardedConditions.length).toBeGreaterThanOrEqual(3);
	});

	it.each(guardedConditions)('分岐 `%s` を満たす preview でダイアログが開く', (condition) => {
		const predicate = toPredicate(condition);
		const satisfying = COMBINATIONS.filter(predicate);
		expect(
			satisfying.length,
			`分岐条件 \`${condition}\` は hasExcess / willLoseHistory のどの組み合わせでも成立しない`,
		).toBeGreaterThan(0);

		const reachable = satisfying.filter((combo) => shouldOpenDowngradeSelector(previewOf(combo)));
		expect(
			reachable,
			[
				`分岐条件 \`${condition}\` は caller から到達不能。`,
				'この条件が成立する状態ではダイアログが開かれないため、書いた表示は顧客に一度も出ない',
				'(#4530 の欠陥そのもの)。開く判定 shouldOpenDowngradeSelector を広げるか、',
				'到達不能な分岐を撤去すること。',
			].join('\n'),
		).not.toEqual([]);
	});

	it('caller は開く判定を policy 関数に委ねている (hasExcess 直接分岐への差し戻しを止める)', () => {
		expect(callerSource).toContain(
			"import { shouldOpenDowngradeSelector } from '$lib/features/admin/downgrade-dialog-policy'",
		);
		// `showDowngradeSelector = true` の直前の guard が policy 関数であること
		const openSite =
			/if \(shouldOpenDowngradeSelector\(preview\)\) \{[^}]*showDowngradeSelector = true;/s;
		expect(
			openSite.test(callerSource),
			[
				'ダイアログを開く判定が shouldOpenDowngradeSelector を経由していない。',
				'`preview?.hasExcess` のような直接分岐に戻すと、保持期間だけが縮む顧客への警告が',
				'再び到達不能になる (#4530)。',
			].join('\n'),
		).toBe(true);
	});
});

// tests/unit/architecture/plan-limits-field-enforcement.test.ts (#4584 / ADR-0061 same-class-N→guard)
//
// **`PlanLimits` の全フィールドが production code から実際に読まれていること**を機械検証する。
//
// # なぜ必要か
//
// 「有料の根拠として売っている機能フラグが、誰にも参照されていない」が 2 件出た:
//
//   | # | flag | 状態 |
//   |---|---|---|
//   | #4504 | `canFreeTextMessage` | 定義のみ・参照ゼロ |
//   | #4584 | `canCustomReward`    | 定義のみ・参照ゼロ (拒否は別途 `isPaidTier` 直呼びで実装) |
//
// フラグは値としては正しく、既存 test も `getPlanLimits()` が正しい真偽値を返すことを
// assert していた。**しかしその値によって何かが制限されることは 1 本も検証していなかった。**
// 値の正しさと、値が効いていることは別物である。
//
// 2 件目が出た時点でこれは個別バグではなく class なので、3 件目を機械で止める。
//
// # 何を fail させるか
//
// `PlanLimits` にフィールドを足したのに production code のどこからも読まない状態。
// 意図的に未配線で残すなら `UNWIRED_FIELDS` に**理由と追跡 Issue を書いて**通す
// (黙って除外しない — 除外そのものが記録として残る)。

// cspell:ignore UNWIRED — 「未配線」を表す定数名 (unwired の大文字表記)

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { globSync } from 'tinyglobby';
import { describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 60_000 });

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../../../');

/** 型定義と既定値を持つ SSOT 自身。ここでの出現は「参照」に数えない。 */
const DEFINITION_FILE = 'src/lib/server/services/plan-limit-service.ts';

/**
 * 未配線のまま残すフィールド。**理由と追跡 Issue が必須**。
 *
 * 空にできるのが理想だが、空を強制すると「とりあえずどこかで参照する」だけの
 * 死んだ参照を書いて通す動機になる。除外は残すが、理由ごと可視化する。
 */
const UNWIRED_FIELDS: Record<string, string> = {
	canFreeTextMessage:
		'#4504 で配線中 (PR #4579)。マージ後に本エントリを削除する。値は isFreeTextMessageUnlocked から導出される予定',
	// 本 gate を書いて初めて見つかった 3 件目。招待の上限は plan-limit-service に値があるだけで、
	// invite-service にも admin/members にも上限チェックが無い (grep で 0 件)。
	maxFamilyMembers:
		'#4577 で family-member-limit.ts に集約中。強制の有無は同 PR の scope。マージ後に本エントリを見直す',
};

/**
 * **述語経由**で効いているフィールド。
 *
 * フラグ名を直接読む代わりに、共有述語を 1 つ置いて「値の導出」と「拒否」の両方がそれを読む形。
 * この場合フィールド名は production に現れないので、代わりに **述語が導出と拒否の両方から
 * 参照されていること**を検査する (名前が出ないことを口実に検査を消さない)。
 */
const PREDICATE_BACKED_FIELDS: Record<string, { predicate: string; enforcedIn: string[] }> = {
	canCustomReward: {
		predicate: 'isCustomRewardUnlocked',
		enforcedIn: ['src/routes/(parent)/admin/rewards/+page.server.ts'],
	},
};

/** `PlanLimits` インターフェースのフィールド名を型定義から読む (手書きの列挙を作らない)。 */
function planLimitsFields(): string[] {
	const src = readFileSync(join(REPO_ROOT, DEFINITION_FILE), 'utf-8');
	const block = src.match(/export interface PlanLimits \{([\s\S]*?)\n\}/);
	const body = block?.[1];
	if (!body) throw new Error('PlanLimits インターフェースを型定義から読めませんでした');
	const fields = [...body.matchAll(/^\t([a-zA-Z][a-zA-Z0-9]*)[?]?:/gm)]
		.map((m) => m[1])
		.filter((f): f is string => typeof f === 'string');
	if (fields.length === 0) throw new Error('PlanLimits のフィールドを 1 つも抽出できませんでした');
	return fields;
}

/**
 * コメントを落とす。**コメント内の言及を「参照」と数えない**ため。
 *
 * これが無いと「フラグ名を doc コメントに書いただけ」で本 gate を通せてしまい、
 * 検査が空振りする (実際、本 test の初版は述語 module の doc コメントを拾って
 * 未配線状態でも緑になっていた)。
 */
function stripComments(text: string): string {
	return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/** production code (src 配下、定義 file を除く) を全て読む。 */
function productionSources(): { path: string; text: string }[] {
	return globSync(['src/**/*.ts', 'src/**/*.svelte'], {
		cwd: REPO_ROOT,
		ignore: ['**/*.test.ts', '**/*.stories.svelte', DEFINITION_FILE],
	}).map((p) => ({ path: p, text: stripComments(readFileSync(join(REPO_ROOT, p), 'utf-8')) }));
}

describe('#4584 PlanLimits の全フィールドが実際に効いている', () => {
	const fields = planLimitsFields();
	const sources = productionSources();

	it('フィールドを型定義から抽出できる (この test 自体が空振りしない)', () => {
		expect(fields.length).toBeGreaterThanOrEqual(8);
		expect(fields).toContain('canCustomReward');
		expect(sources.length).toBeGreaterThan(100);
	});

	it.each(fields)('%s が production code から参照されている', (field) => {
		if (field in UNWIRED_FIELDS) return; // 別 it で理由を検証する
		if (field in PREDICATE_BACKED_FIELDS) return; // 別 it で述語経由を検証する

		const refs = sources.filter((s) => s.text.includes(field)).map((s) => s.path);
		expect(
			refs.length,
			`PlanLimits.${field} が production code から一度も参照されていません。` +
				`「有料プランの機能として売っているのにゲートが掛かっていない」状態です (#4504 / #4584 と同 class)。` +
				`実際に制限を掛けるか、意図的に未配線なら UNWIRED_FIELDS に理由と追跡 Issue を書いてください。`,
		).toBeGreaterThan(0);
	});

	it('未配線フィールドの除外には理由と追跡 Issue がある', () => {
		for (const [field, reason] of Object.entries(UNWIRED_FIELDS)) {
			expect(fields, `UNWIRED_FIELDS の ${field} は PlanLimits に存在しない (stale)`).toContain(
				field,
			);
			expect(reason.length, `${field} の除外理由が短すぎる`).toBeGreaterThan(20);
			expect(reason, `${field} の除外に追跡 Issue 番号がない`).toMatch(/#\d{3,}/);
		}
	});

	it.each(
		Object.keys(PREDICATE_BACKED_FIELDS),
	)('%s は述語から導出され、拒否も同じ述語を読む (#4584 本丸)', (field) => {
		const entry = PREDICATE_BACKED_FIELDS[field];
		if (!entry) throw new Error(`PREDICATE_BACKED_FIELDS に ${field} がありません`);
		const { predicate, enforcedIn } = entry;
		const def = readFileSync(join(REPO_ROOT, DEFINITION_FILE), 'utf-8');

		// 真偽値の直書きに戻したら落ちる (フラグと実装が再び別々の真実になる)
		for (const tier of ['free', 'standard', 'family']) {
			expect(def, `${field} の ${tier} が述語から導出されていません`).toContain(
				`${field}: ${predicate}('${tier}')`,
			);
		}

		// 拒否側が述語を読んでいること
		for (const path of enforcedIn) {
			const text = readFileSync(join(REPO_ROOT, path), 'utf-8');
			expect(text, `${path} が ${predicate} を読んでいません`).toContain(predicate);
			// 述語を経由せず isPaidTier 直呼びに戻ったら落ちる
			expect(text, `${path} の拒否が述語を経由していません`).not.toContain(
				'if (!isPaidTier(tier))',
			);
		}
	});
});

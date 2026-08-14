// #4622: プラン上限メッセージに null が出うる型の穴の回帰ロック。
//
// 旧実装は上限チェック 4 関数が `{ allowed: boolean; current: number; max: number | null }` を
// 返しており、「allowed:false なら max は必ず具体値」という不変条件を型が持っていなかった。
// そのため `if (!check.allowed)` の内側でも max は `number | null` のままで、
// `カスタム活動は最大${check.max}個まで作成できます` が型検査を通り、
// 顧客の画面に「最大 null 個」と出しうる状態だった (routes 13 箇所)。
//
// 本 test が守るのは以下の 3 点:
//   1. PlanLimitCheck が discriminated union で、allowed:false + max:null が**型として作れない**
//   2. 上限メッセージのラベル関数が `max: number` を要求し、null を渡すと型エラーになる
//   3. メッセージ本文が routes に再び直書きされない (SSOT = labels.ts、ADR-0045)
//
// 1 と 2 は `@ts-expect-error` で固定しているため、型が緩められると
// 「未使用の @ts-expect-error」として svelte-check (pre-ready Step 2 / CI) が落ちる。

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PLAN_GATE_LABELS } from '$lib/domain/labels';
import type { PlanLimitCheck } from '$lib/server/services/plan-limit-service';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const ROUTES_DIR = path.join(REPO_ROOT, 'src', 'routes');

function collectTsFiles(dir: string, acc: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		const full = path.join(dir, entry);
		if (statSync(full).isDirectory()) {
			collectTsFiles(full, acc);
		} else if (full.endsWith('.ts') || full.endsWith('.svelte')) {
			acc.push(full);
		}
	}
	return acc;
}

describe('#4622 PlanLimitCheck — 不正な状態 (allowed:false + max:null) を型で表現不能にする', () => {
	it('allowed:false のとき max は number しか代入できない', () => {
		const reached: PlanLimitCheck = { allowed: false, current: 3, max: 3 };
		expect(reached.allowed).toBe(false);

		// 上限到達なのに「上限は無制限」という矛盾した状態は型として作れない。
		// この @ts-expect-error が不要になる = 型が緩んだ、ということなので tsc が落ちる。
		// @ts-expect-error allowed:false のとき max:null は不正な状態 (#4622)
		const broken: PlanLimitCheck = { allowed: false, current: 3, max: null };
		expect(broken).toBeDefined();
	});

	it('allowed:true のときだけ max:null (= 無制限) を表現できる', () => {
		const unlimited: PlanLimitCheck = { allowed: true, current: 0, max: null };
		expect(unlimited.max).toBeNull();
	});

	it('!allowed で narrowing すると max が number に確定する', () => {
		const check: PlanLimitCheck = { allowed: false, current: 3, max: 3 };
		if (!check.allowed) {
			// narrowing 後は null 許容ではないので、number を要求する関数にそのまま渡せる。
			const message: string = PLAN_GATE_LABELS.activityLimitReached(check.max);
			expect(message).not.toContain('null');
		}
	});
});

describe('#4622 上限メッセージのラベル関数は null を受け取れない', () => {
	it('null を渡すと型エラーになる', () => {
		// @ts-expect-error 上限到達メッセージに null は渡せない (#4622)
		expect(PLAN_GATE_LABELS.activityLimitReached(null)).toBeTypeOf('string');
		// @ts-expect-error 上限到達メッセージに null は渡せない (#4622)
		expect(PLAN_GATE_LABELS.childLimitReached(null)).toBeTypeOf('string');
		// @ts-expect-error 上限到達メッセージに null は渡せない (#4622)
		expect(PLAN_GATE_LABELS.checklistTemplateLimitReached(null)).toBeTypeOf('string');
		// @ts-expect-error 上限到達メッセージに null は渡せない (#4622)
		expect(PLAN_GATE_LABELS.checklistTemplateLimitReachedWithUpgrade(null)).toBeTypeOf('string');
		// @ts-expect-error メンバー上限メッセージに null は渡せない (#4622)
		expect(PLAN_GATE_LABELS.memberLimitReached(null)).toBeTypeOf('string');
	});

	it('文言は移設前とバイト一致で不変', () => {
		expect(PLAN_GATE_LABELS.activityLimitReached(3)).toBe(
			'カスタム活動は最大3個まで作成できます。プランをアップグレードしてください。',
		);
		expect(PLAN_GATE_LABELS.childLimitReached(2)).toBe(
			'子供は最大2人まで登録できます。プランをアップグレードしてください。',
		);
		expect(PLAN_GATE_LABELS.checklistTemplateLimitReached(3)).toBe(
			'フリープランではお子さま1人あたり 3 個までです。',
		);
		expect(PLAN_GATE_LABELS.checklistTemplateLimitReachedWithUpgrade(3)).toBe(
			'フリープランではお子さま1人あたり 3 個までです。スタンダード以上にアップグレードすると無制限に作成できます。',
		);
		expect(PLAN_GATE_LABELS.memberLimitReached(4)).toBe(
			'メンバー上限（4人）に達しています。プランをアップグレードしてください。',
		);
	});
});

describe('#4622 fitness — 上限メッセージ本文を routes に直書きし戻さない', () => {
	// labels.ts を経由しない直書きに戻すと `max: number` の関門が消え、
	// 再び `${check.max}` に null を埋められるようになる。文面の断片で検出する。
	const FORBIDDEN_FRAGMENTS = [
		'個まで作成できます',
		'人まで登録できます',
		'個までです。',
		'人）に達しています',
	];

	it('src/routes 配下に上限メッセージの直書きが無い', () => {
		const offenders: string[] = [];
		for (const file of collectTsFiles(ROUTES_DIR)) {
			const source = readFileSync(file, 'utf8');
			for (const fragment of FORBIDDEN_FRAGMENTS) {
				if (source.includes(fragment)) {
					offenders.push(`${path.relative(REPO_ROOT, file)}: "${fragment}"`);
				}
			}
		}
		expect(offenders).toEqual([]);
	});
});

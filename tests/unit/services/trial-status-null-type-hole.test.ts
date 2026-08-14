// #4628: トライアル期限表示に null が出うる型の穴の回帰ロック (#4622 と同一 class)。
//
// 旧実装の `TrialStatus` は `{ isTrialActive: boolean; trialEndDate: string | null; ... }` で、
// 「トライアル中なら期限は必ず具体値」という不変条件を型が持っていなかった。そのため
// `{#if trialStatus.isTrialActive}` の内側でも trialEndDate は `string | null` のままで、
// 期限表示ラベルが `${date ?? ''} まで` という band-aid を抱え、null のときは日付の無い
// 「 まで」だけを顧客に出しうる状態だった。
//
// 本 test が守るのは以下の 4 点:
//   1. TrialStatus が discriminated union で、isTrialActive:true + trialEndDate:null が**作れない**
//   2. 期限表示ラベルが `date: string` を要求し、null を渡すと型エラーになる
//   3. client への射影 (toTrialStatusView) が相関を保つ = UI 側で narrowing が効く
//   4. route が射影を手で組み直さない (組み直すと相関が推論から消え、穴が復活する)
//
// 1〜3 は `@ts-expect-error` / 代入で固定しているため、型が緩められると
// 「未使用の @ts-expect-error」として svelte-check (pre-ready Step 2 / CI) が落ちる。

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { SUBSCRIPTION_PAGE_LABELS } from '$lib/domain/labels';
import {
	type TrialStatus,
	type TrialStatusView,
	toTrialStatusView,
} from '$lib/server/services/trial-service';

// #4085: 本 file は src/routes ツリーを walk する repo 走査 test (registry に scope:'repo' で宣言済)。
// unit lane の並列実行では既定 5s を超えうるため明示 timeout を置く。
vi.setConfig({ testTimeout: 60_000 });

const REPO_ROOT = path.resolve(__dirname, '../../..');
const ROUTES_DIR = path.join(REPO_ROOT, 'src', 'routes');

function collectSourceFiles(dir: string, acc: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		const full = path.join(dir, entry);
		if (statSync(full).isDirectory()) {
			collectSourceFiles(full, acc);
		} else if (full.endsWith('.ts') || full.endsWith('.svelte')) {
			acc.push(full);
		}
	}
	return acc;
}

const ACTIVE: TrialStatus = {
	isTrialActive: true,
	trialUsed: true,
	trialStartDate: '2026-08-01',
	trialEndDate: '2026-08-08',
	trialTier: 'standard',
	daysRemaining: 3,
	source: 'user_initiated',
};

describe('#4628 TrialStatus — 不正な状態 (isTrialActive:true + trialEndDate:null) を型で表現不能にする', () => {
	it('トライアル中は期限・ティアが具体値でしか構成できない', () => {
		// エラー位置が整形 (biome) で動かないよう、literal は素の const に取り、
		// TrialStatus への代入行に @ts-expect-error を置く。
		// この @ts-expect-error が不要になる = 型が緩んだ、ということなので tsc が落ちる。
		const endMissing = {
			isTrialActive: true,
			trialUsed: true,
			trialStartDate: '2026-08-01',
			trialEndDate: null,
			trialTier: 'standard',
			daysRemaining: 3,
			source: 'user_initiated',
		} as const;
		const tierMissing = {
			isTrialActive: true,
			trialUsed: true,
			trialStartDate: '2026-08-01',
			trialEndDate: '2026-08-08',
			trialTier: null,
			daysRemaining: 3,
			source: 'user_initiated',
		} as const;

		// @ts-expect-error isTrialActive:true のとき trialEndDate:null は不正な状態 (#4628)
		const brokenEnd: TrialStatus = endMissing;
		// @ts-expect-error isTrialActive:true のとき trialTier:null は不正な状態 (#4628)
		const brokenTier: TrialStatus = tierMissing;
		expect(brokenEnd).toBeDefined();
		expect(brokenTier).toBeDefined();
	});

	it('トライアル中でないときだけ期限 null (= 未開始 / 終了済) を表現できる', () => {
		const notStarted: TrialStatus = {
			isTrialActive: false,
			trialUsed: false,
			trialStartDate: null,
			trialEndDate: null,
			trialTier: null,
			daysRemaining: 0,
			source: null,
		};
		expect(notStarted.trialEndDate).toBeNull();
	});

	it('isTrialActive で narrowing すると trialEndDate / trialTier が確定する', () => {
		const status: TrialStatus = ACTIVE;
		if (status.isTrialActive) {
			// narrowing 後は null 許容ではないので、string を要求する関数にそのまま渡せる。
			const message: string = SUBSCRIPTION_PAGE_LABELS.trialActiveUntil(status.trialEndDate);
			const tier: 'standard' | 'family' = status.trialTier;
			expect(message).not.toContain('null');
			expect(tier).toBe('standard');
		} else {
			throw new Error('narrowing 前提が崩れている');
		}
	});
});

describe('#4628 期限表示ラベルは null を受け取れない', () => {
	it('null を渡すと型エラーになる', () => {
		// @ts-expect-error トライアル期限表示に null は渡せない (#4628)
		expect(SUBSCRIPTION_PAGE_LABELS.trialActiveUntil(null)).toBeTypeOf('string');
	});

	it('文言は band-aid 撤去前とバイト一致で不変', () => {
		expect(SUBSCRIPTION_PAGE_LABELS.trialActiveUntil('2026-08-08')).toBe('2026-08-08 まで');
	});
});

describe('#4628 client への射影は相関を保つ', () => {
	it('toTrialStatusView 経由なら UI 側で narrowing が効く', () => {
		const view: TrialStatusView = toTrialStatusView(ACTIVE);
		if (view.isTrialActive) {
			const message: string = SUBSCRIPTION_PAGE_LABELS.trialActiveUntil(view.trialEndDate);
			expect(message).toBe('2026-08-08 まで');
		} else {
			throw new Error('射影が active 状態を落としている');
		}
	});

	it('非 active はそのまま非 active として射影される', () => {
		const view = toTrialStatusView({
			isTrialActive: false,
			trialUsed: true,
			trialStartDate: '2026-07-01',
			trialEndDate: '2026-07-08',
			trialTier: 'family',
			daysRemaining: 0,
			source: 'campaign',
		});
		expect(view).toEqual({
			isTrialActive: false,
			trialUsed: true,
			daysRemaining: 0,
			trialEndDate: '2026-07-08',
			trialTier: 'family',
		});
	});

	it('view には UI が読まない値 (trialStartDate / source) を含めない', () => {
		expect(Object.keys(toTrialStatusView(ACTIVE)).sort()).toEqual([
			'daysRemaining',
			'isTrialActive',
			'trialEndDate',
			'trialTier',
			'trialUsed',
		]);
	});
});

describe('#4628 fitness — route で trial 状態を手で組み直さない', () => {
	// `{ isTrialActive: s.isTrialActive, trialEndDate: s.trialEndDate }` と手で組み直すと
	// 推論が `{ isTrialActive: boolean; trialEndDate: string | null }` に落ち、
	// 画面側の narrowing が消えて穴が復活する。射影は toTrialStatusView に集約する。
	//
	// 検出するのは「flag (isTrialActive) と nullable な値 (trialEndDate / trialTier) を
	// 同一 object literal に手で並べ直す」形。flag だけ / 値だけの参照は相関を壊さないので許す
	// (admin +layout は残日数と flag しか配らない)。
	const FLAG_PROJECTION = /isTrialActive\s*:\s*\w+\.isTrialActive/;
	const VALUE_PROJECTION = /(trialEndDate|trialTier)\s*:\s*\w+\.(trialEndDate|trialTier)/;

	it('src/routes 配下に trial 状態の手組み射影が無い', () => {
		const offenders: string[] = [];
		for (const file of collectSourceFiles(ROUTES_DIR)) {
			const source = readFileSync(file, 'utf8');
			const value = source.match(VALUE_PROJECTION);
			if (FLAG_PROJECTION.test(source) && value) {
				offenders.push(`${path.relative(REPO_ROOT, file)}: "${value[0]}"`);
			}
		}
		expect(offenders).toEqual([]);
	});
});

// @ts-nocheck — .mjs file dynamic import + 実 SDK 型 (V3Options) 厳格すぎ。
// 動作検証は vitest runtime で担保 (createStagehand error path + Stagehand construction)
/**
 * Stagehand v3 SDK construction structural smoke test (PR #2695 Day 3 fatal class 防止)
 *
 * 目的: 実 init() (Chrome 起動 + LLM call) せず、SDK の constructor / public API surface の
 * structural sanity を assert する。これで「v3 SDK install 済 + v2 API で実装」class の bug
 * (本回 fatal) を CI で即検出できる。
 *
 * 範囲:
 *   - new Stagehand({...}) で instance 構築可能 (init() は呼ばない、cost $0)
 *   - instance に init / close / act / observe / extract / context getter が存在
 *   - context getter は init 前は throw する可能性があるが、構造的 invariant は確認
 *
 * Anti framing-bias: API surface assertion は **`.d.ts` から read** し、推測しない
 * (memory feedback_research_framing_bias.md 整合)
 */

import { describe, expect, it } from 'vitest';

describe('Stagehand v3 SDK construction (cost $0、init/Chrome 起動なし)', () => {
	it('new Stagehand({ env: LOCAL, ... }) で instance 構築可能 (v3 V3Options 整合)', async () => {
		const { Stagehand } = await import('@browserbasehq/stagehand');
		// 実 init() は呼ばない (Chrome 起動 + ANTHROPIC API call が発生するため)
		// v3 V3Options (options.d.ts §38): model / localBrowserLaunchOptions / domSettleTimeout
		const sh = new Stagehand({
			env: 'LOCAL',
			model: {
				modelName: 'anthropic/claude-sonnet-4-5-20250929',
				apiKey: 'dummy-test-key-not-used',
			},
			localBrowserLaunchOptions: { headless: true },
			verbose: 0,
			domSettleTimeout: 3000,
		});

		// constructor 完了時点で以下が定義済 (init 不要)
		expect(typeof sh.init).toBe('function');
		expect(typeof sh.close).toBe('function');
		expect(typeof sh.act).toBe('function');
		expect(typeof sh.observe).toBe('function');
		expect(typeof sh.extract).toBe('function');

		// v3 では `.page` プロパティは存在しない (v2 fatal 防止)
		expect((sh as unknown as { page?: unknown }).page).toBeUndefined();

		// context は init 後にのみ valid だが、getter 自体は定義済
		const ctxDesc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(sh), 'context');
		expect(ctxDesc?.get).toBeDefined();
	});

	it('Stagehand instance に bus (EventEmitter) が定義済 (構造的 invariant)', async () => {
		const { Stagehand } = await import('@browserbasehq/stagehand');
		const sh = new Stagehand({
			env: 'LOCAL',
			model: {
				modelName: 'anthropic/claude-sonnet-4-5-20250929',
				apiKey: 'dummy',
			},
			localBrowserLaunchOptions: { headless: true },
			verbose: 0,
		});
		// bus は v3.d.ts §44 で readonly property として定義
		expect(sh.bus).toBeDefined();
		expect(typeof sh.bus.on).toBe('function');
	});

	it('createStagehand({ mock: false, apiKey: undefined }) は明示エラーを投げる (silent fail 禁止)', async () => {
		const mod = (await import(
			'../../../scripts/ai-evaluation/lib/stagehand-runner.mjs'
		)) as unknown as { createStagehand: (opts: Record<string, unknown>) => Promise<unknown> };
		const { createStagehand } = mod;
		// apiKey 欠落時は明示エラー (本回の Day 3 fatal とは異なるが、env 設定漏れ検出)
		await expect(
			createStagehand({ baseUrl: 'http://localhost:5180', mock: false, apiKey: '' }),
		).rejects.toThrow(/apiKey 必須/);
	});

	it('createStagehand({ baseUrl: undefined }) は明示エラーを投げる', async () => {
		const mod = (await import(
			'../../../scripts/ai-evaluation/lib/stagehand-runner.mjs'
		)) as unknown as { createStagehand: (opts: Record<string, unknown>) => Promise<unknown> };
		const { createStagehand } = mod;
		await expect(createStagehand({ mock: true })).rejects.toThrow(/baseUrl 必須/);
	});
});

/**
 * Stagehand v4 SDK construction structural smoke test (#4618 dependabot v3→v4 migration、
 * 旧 PR #2695 Day 3 fatal class 防止の後継)
 *
 * 目的: 実 browser 起動 (Chrome 起動 + LLM call) せず、SDK の static factory / public API surface
 * の structural sanity を assert する。これで「v4 SDK install 済 + 旧 API (`new Stagehand(...)`)
 * で実装」class の bug (v3 世代の fatal と同 class) を CI で即検出できる。
 *
 * 範囲:
 *   - `new Stagehand({...})` は private constructor のため呼べない (TS コンパイルエラー)
 *   - `Stagehand.create({ browser, ... })` が唯一の public 生成経路
 *   - browser 起動 (`localBrowser.launch()`) は Stagehand 生成と分離している
 *   - instance に close / act / observe / extract / browser getter が存在
 *
 * Anti framing-bias: API surface assertion は **`.d.ts` から read** し、推測しない
 * (memory feedback_research_framing_bias.md 整合)
 */

import { describe, expect, it } from 'vitest';

// #3661: @browserbasehq/stagehand の dynamic import (初回 module cache cold) が高負荷環境で
// vitest 既定 5s を超える (実測 5-8s、--testTimeout=30000 で PASS)。hooks-integration.test.ts と
// 同型の describe-level timeout で吸収する (assertion 内容は不変、ADR-0061 same-class 対処)。
describe('Stagehand v4 SDK construction (cost $0、init/Chrome 起動なし)', {
	timeout: 30_000,
}, () => {
	it('Stagehand.create は静的 factory として定義されている (v4 StagehandCreateOptions 整合)', async () => {
		const { Stagehand } = await import('@browserbasehq/stagehand');
		// v4 breaking change: constructor が private 化されたため `new Stagehand(...)` は
		// コンパイルエラーになる。唯一の public 生成経路が static create() であることを assert する
		// (実 create() は browser 起動 + RPC handshake を伴うため呼ばない、cost $0 維持)。
		expect(typeof Stagehand.create).toBe('function');
		expect(Stagehand.create.length).toBe(1); // create(input: StagehandCreateOptions)
	});

	it('Stagehand instance に act / observe / extract / browser getter が prototype 定義済 (構造的 invariant)', async () => {
		const { Stagehand } = await import('@browserbasehq/stagehand');
		const proto = Stagehand.prototype;

		// constructor 完了を待たず、prototype レベルで API surface が存在することを確認
		// (実 init は browser 起動 + ANTHROPIC API call が発生するため呼ばない)
		expect(typeof proto.act).toBe('function');
		expect(typeof proto.observe).toBe('function');
		expect(typeof proto.extract).toBe('function');
		expect(typeof proto.close).toBe('function');
		expect(typeof proto.metrics).toBe('function');

		// v4 では `.page` プロパティは存在しない (v2 fatal 防止、v3 から不変)
		expect((proto as unknown as { page?: unknown }).page).toBeUndefined();

		// v4 では `.context` getter も Stagehand instance に存在しない
		// (BrowserContext は `.browser.context` 経由、src/stagehand.d.ts)
		const ctxDesc = Object.getOwnPropertyDescriptor(proto, 'context');
		expect(ctxDesc).toBeUndefined();

		// `.browser` getter は定義済 (StagehandBrowser を返す、内部に .context を持つ)
		const browserDesc = Object.getOwnPropertyDescriptor(proto, 'browser');
		expect(browserDesc?.get).toBeDefined();
	});

	it('localBrowser factory に launch / connect が定義されている (browser 起動は Stagehand と分離)', async () => {
		const { localBrowser } = await import('@browserbasehq/stagehand');
		// v4 breaking change: browser 起動は `localBrowser.launch(options)` で Stagehand.create() より
		// 前に行う (旧 v3 の `localBrowserLaunchOptions` ネストは廃止)。実 launch は Chrome 起動を
		// 伴うため呼ばない (cost $0 維持)、構造的 invariant のみ確認。
		expect(typeof localBrowser.launch).toBe('function');
		expect(typeof localBrowser.connect).toBe('function');
	});

	it('createStagehand({ mock: false, apiKey: undefined }) は明示エラーを投げる (silent fail 禁止)', async () => {
		const mod = (await import(
			'../../../scripts/ai-evaluation/lib/stagehand-runner.mjs'
		)) as unknown as { createStagehand: (opts: Record<string, unknown>) => Promise<unknown> };
		const { createStagehand } = mod;
		// apiKey 欠落時は明示エラー (env 設定漏れ検出。v3/v4 を通じて不変の contract)
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

// tests/unit/infra/staging-dsql-lane-always-on.test.ts
// #4224 — staging deploy の「手動実行だけが落ちる」を構造的に消す。
//
// ## 何が壊れていたか
//
// `deploy-aws-staging.yml` の `workflow_dispatch` input `dsqlEnabled` は default `false` だった。
// 一方 #3438 で **DSQL が唯一の DB backend** になり、`ComputeStack` は `dsqlEndpoint` context を
// **無条件に必須**（未注入なら `addError` で synth 停止）にしている。
//
// その結果、既定値のまま手動実行すると DSQL cluster を作る step 群が skip され、context が空のまま
// synth に入って **必ず落ちる**（2026-08-02 run 30733193167 で実測）。
//
// ## なぜ気づけなかったか
//
// `pull_request` 経由なら `DSQL_LANE` が常時 true になるため通る。**手動実行だけが落ちる**ので、
// 統合 PR の自動実行は緑のままだった。#4189 / #4174 と同じ「配線が silent に死んでいる」class。
//
// ## なぜ default を true にするのではなく input を消したか
//
// **選べる値が 1 つしかない選択肢は、選択肢ではない。** default を true にしても
// 「false にすると必ず落ちる」という不正な状態は表現可能なまま残る。
// `compute-stack.ts` のコメント自身が「deploy-aws-staging.yml は PR trigger でも DSQL lane を
// **常時実行**し endpoint を注入するため fallback は不要」と書いており、**コードの前提と
// workflow の実挙動が食い違っていた**。前提の側に合わせて不正状態を表現できなくする。

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const WORKFLOW = '.github/workflows/deploy-aws-staging.yml';
const COMPUTE_STACK = 'infra/lib/compute-stack.ts';

describe('#4224 staging の DSQL lane は常時 on', () => {
	const yml = readFileSync(WORKFLOW, 'utf8');

	it('lane を off にできる入口が無い (dsqlEnabled input / DSQL_LANE 分岐)', () => {
		// input が残っていると「false を選ぶと必ず落ちる」不正状態が表現可能なまま
		expect(yml, 'dsqlEnabled input が残っています').not.toContain('dsqlEnabled:');
		// lane 分岐が残っていると skip 経路が生き、同じ食い違いが再発する
		expect(yml, 'DSQL_LANE 分岐が残っています').not.toContain('DSQL_LANE');
	});

	it('DSQL の context を常に渡している (deploy と diff の両方)', () => {
		// 「lane が on のときだけ渡す」形に戻っていないこと。
		// 条件付きにすると ComputeStack の無条件必須と再びズレる。
		const occurrences = yml.split('-c dsqlEndpoint=').length - 1;
		expect(
			occurrences,
			'cdk diff と cdk deploy の両方で dsqlEndpoint を渡す必要があります',
		).toBeGreaterThanOrEqual(2);
	});

	it('ComputeStack が dsqlEndpoint を無条件必須にしている (workflow 側の前提)', () => {
		// workflow の「常時 on」は、ここが無条件必須であることを前提にしている。
		// ここが条件付きに緩められたら、workflow 側の前提も見直す必要がある。
		const src = readFileSync(COMPUTE_STACK, 'utf8');
		expect(src).toContain('dsqlEndpoint context が空です');
	});
});

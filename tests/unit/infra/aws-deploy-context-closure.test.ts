// #4174 — AWS deploy が **CDK の読む口に対して context を配り落とさない**ことを機械で固定する。
//
// ## 塞ぐ穴
//
// CDK は設定値を `this.node.tryGetContext('key') ?? ''` で受け、compute-stack.ts は空値のとき
// **env ごと Lambda から落とす** (`...(x ? { KEY: x } : {})`)。したがって:
//
//   - workflow が `-c key=...` を渡し忘れると、その env は Lambda に存在しない
//   - それでも **synth も deploy も成功する** (型エラーにも diff にも出ない)
//   - アプリ側の宛先解決は `A ?? B` で、どちらも無ければ静かに no-op になる
//
// 実害: `discordWebhookIncident` は compute-stack.ts が読む口を持ちながら deploy.yml が一度も
// 渡していなかった。結果として **本番 Lambda で incident 通知が 1 通も飛んでいなかった**。
// #4119 (NUC で 18 晩バックアップ失敗しても alert 0 通) と同型の failure mode で、NUC 側は
// #4167 / PR #4168 が `nuc-deploy-env-closure.test.ts` で塞いだ。本 test はその **AWS 側の対**。
//
// 人の注意ではなく機械で閉じる (ADR-0061 fitness function / ADR-0024 ENV silent skip 禁止)。
//
// ## 何を固定するか
//
//   [AD1] CDK が読む context key が、どれかの workflow から実際に渡されている
//         (渡されないものは「なぜ渡さないか」を CONTEXT_KEYS_NOT_DISTRIBUTED に明示する)
//   [AD2] 宣言が stale でない (渡すようになった key が免除リストに残り続けない)
//   [AD3] 本番 compute を触る cdk 呼び出し (diff / deploy) の context 集合が一致している
//         (diff だけに渡して deploy に渡し忘れる = 差分が出ないまま env が落ちる、を検出)
//   [AD4] incident 通知先が本番 compute の全 cdk 呼び出しに渡っている
//   [AD5] secret が空のとき deploy は止めないが必ず警告する
//   [AD6] deploy 後に **実 Lambda env** を読んで検証し、配線不良なら hard-fail する
//         (synth の diff では「渡し忘れ」を検出できないため、実 env を見る step が要る)

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// #4085: 走査 API + repo root を参照するため gate は scope='repo' と静的判定する。
// 実測は数十 ms だが、判定を緩めず明示 timeout で合わせる (tests/CLAUDE.md §repo 走査 test)。
vi.setConfig({ testTimeout: 60_000 });

const ROOT = process.cwd();
const DEPLOY_WORKFLOW = join(ROOT, '.github', 'workflows', 'deploy.yml');
const STAGING_WORKFLOW = join(ROOT, '.github', 'workflows', 'deploy-aws-staging.yml');
const CDK_APP = join(ROOT, 'infra', 'bin', 'app.ts');
const CDK_LIB_DIR = join(ROOT, 'infra', 'lib');

/**
 * GitHub Actions の式 `${{ ... }}` を組み立てる。
 *
 * リテラルで書くと biome の `noTemplateCurlyInString` に引っかかる (JS の template literal と
 * 見分けが付かないため)。式であることを明示して組み立てる。
 */
function ghaExpr(expression: string): string {
	return `\${{ ${expression} }}`;
}

const deployWorkflow = readFileSync(DEPLOY_WORKFLOW, 'utf-8');
const stagingWorkflow = readFileSync(STAGING_WORKFLOW, 'utf-8');

/**
 * CDK 側が `tryGetContext` で読む context key の全集合。
 *
 * **CDK が SSOT** であり、本 test はそこから要求を読む (workflow 側の一覧を手で写さない)。
 * `infra/lib` は単一 dir の走査で、stack file を足したら自動で対象に入る。
 */
function contextKeysReadByCdk(): Set<string> {
	const sources = [CDK_APP];
	for (const name of readdirSync(CDK_LIB_DIR)) {
		if (name.endsWith('.ts')) sources.push(join(CDK_LIB_DIR, name));
	}
	const keys = new Set<string>();
	for (const path of sources) {
		const src = readFileSync(path, 'utf-8');
		for (const m of src.matchAll(/tryGetContext\(\s*['"]([A-Za-z0-9_]+)['"]\s*\)/g)) {
			const key = m[1];
			if (typeof key === 'string') keys.add(key);
		}
	}
	return keys;
}

/** workflow が `-c key=` の形で実際に渡している context key。 */
function contextKeysPassedBy(workflow: string): Set<string> {
	const keys = new Set<string>();
	for (const m of workflow.matchAll(/-c\s+([A-Za-z0-9_]+)=/g)) {
		const key = m[1];
		if (typeof key === 'string') keys.add(key);
	}
	// `${{ secrets.X && format('-c googleClientId={0}', ...) }}` 形式の条件付き注入も拾う。
	for (const m of workflow.matchAll(/format\(\s*'-c\s+([A-Za-z0-9_]+)=/g)) {
		const key = m[1];
		if (typeof key === 'string') keys.add(key);
	}
	return keys;
}

/**
 * **渡していないことが正しい** context key と、その理由。
 *
 * ここに載せるのは「渡さなくても壊れない」ものだけ。壊れるものは follow-up Issue 番号を
 * 添えて `followUp` に書き、放置されないようにする (理由なき免除を作らない)。
 */
const CONTEXT_KEYS_NOT_DISTRIBUTED: Array<{
	key: string;
	why: string;
	followUp?: string;
}> = [
	{
		key: 'demoDomainName',
		why: 'default が `demo.<domainName>` (infra/bin/app.ts)。上書きしたいときだけ渡す任意 override で、未指定が正常系',
	},
	{
		key: 'demoCertificateArn',
		why: 'default が本番 `certificateArn` (infra/bin/app.ts)。wildcard 証明書を共用するため未指定が正常系',
	},
	{
		key: 'opsEmail',
		why: '未指定だと OpsStack の SNS topic に subscription が 1 件も付かず、全 CloudWatch alarm が宛先なしになる。配布すべき値 (通知先アドレス) が未決のため本 PR では塞げない',
		followUp: '#4189',
	},
];

describe('#4174 AWS deploy の context 配布 closure', () => {
	const readByCdk = contextKeysReadByCdk();
	const passed = new Set([
		...contextKeysPassedBy(deployWorkflow),
		...contextKeysPassedBy(stagingWorkflow),
	]);
	const exempt = new Map(CONTEXT_KEYS_NOT_DISTRIBUTED.map((e) => [e.key, e]));

	it('[AD1] CDK が読む context key はいずれかの workflow から渡されている', () => {
		// 「読む口はあるが誰も渡さない」= その env は Lambda に存在しない。
		// deploy は成功するので、この test 以外に検出手段がない。
		const unaccounted = [...readByCdk].filter((k) => !passed.has(k) && !exempt.has(k));
		expect(
			unaccounted,
			`CDK が tryGetContext で読んでいるのに、どの workflow も -c で渡していない context key があります: ${unaccounted.join(', ')}。` +
				`workflow に \`-c <key>=${ghaExpr('secrets.X')}\` を足すか、渡さなくてよい理由を CONTEXT_KEYS_NOT_DISTRIBUTED に明示してください。`,
		).toEqual([]);
	});

	it('[AD2] 免除リストが stale でない (渡すようになった key が残り続けない)', () => {
		const stale = CONTEXT_KEYS_NOT_DISTRIBUTED.filter((e) => passed.has(e.key)).map((e) => e.key);
		expect(
			stale,
			`免除リストにあるのに実際は workflow から渡されている key があります: ${stale.join(', ')}。CONTEXT_KEYS_NOT_DISTRIBUTED から削除してください。`,
		).toEqual([]);

		const unknown = CONTEXT_KEYS_NOT_DISTRIBUTED.filter((e) => !readByCdk.has(e.key)).map(
			(e) => e.key,
		);
		expect(
			unknown,
			`免除リストにあるのに CDK が読んでいない key があります: ${unknown.join(', ')}。CDK 側の撤去に合わせて削除してください。`,
		).toEqual([]);

		for (const entry of CONTEXT_KEYS_NOT_DISTRIBUTED) {
			expect(entry.why.length, `${entry.key} の免除理由が短すぎます`).toBeGreaterThan(20);
			if (entry.followUp !== undefined) {
				// 「壊れているが今は塞げない」ものは追跡先を必ず持つ。理由の非強制を作らない。
				expect(
					entry.followUp,
					`${entry.key} の followUp は Issue 番号 (#NNNN) で書いてください`,
				).toMatch(/^#\d+$/);
			}
		}
	});

	it('[AD3] 本番 compute を触る cdk diff / deploy の context 集合が一致している', () => {
		// diff にだけ渡して deploy に渡し忘れると、**diff には差分が出ないのに実 env が落ちる**。
		// 逆方向 (deploy だけ) も replacement check が実構成とずれるので不可。
		const steps = productionComputeCdkSteps();
		expect(steps.length, '本番 compute を触る cdk 呼び出しが見つかりません').toBeGreaterThanOrEqual(
			2,
		);
		const [first, ...rest] = steps;
		if (!first) throw new Error('unreachable');
		const baseline = [...contextKeysPassedBy(first.body)].sort();
		for (const step of rest) {
			expect(
				[...contextKeysPassedBy(step.body)].sort(),
				`cdk 呼び出し間で渡す context が食い違っています ("${first.name}" vs "${step.name}")`,
			).toEqual(baseline);
		}
	});

	it('[AD4] incident 通知先が本番 compute の全 cdk 呼び出しに渡っている', () => {
		for (const step of productionComputeCdkSteps()) {
			expect(
				step.body,
				`"${step.name}" が discordWebhookIncident を渡していません。本番 Lambda から DISCORD_WEBHOOK_INCIDENT が落ち、障害通知が 0 通になります (#4174)`,
			).toContain(`-c discordWebhookIncident=${ghaExpr('secrets.DISCORD_WEBHOOK_INCIDENT')}`);
		}
	});

	it('[AD5] incident 通知先の secret が空なら警告を出す (黙って進めない)', () => {
		// 通知先の欠落で deploy を止めるのは過剰 (アプリ本体は動く) だが、
		// **黙って進むと「障害が起きても誰にも届かない」状態が可視化されない** (ADR-0024)。
		const step = workflowStep(deployWorkflow, 'Incident webhook secret presence');
		expect(step).toContain('secrets.DISCORD_WEBHOOK_INCIDENT');
		expect(step).toContain('::warning::');
		expect(step).toContain('INCIDENT_WEBHOOK_CONFIGURED');
	});

	it('[AD6] deploy 後に実 Lambda env を読んで検証し、配線不良なら fail する', () => {
		// synth の diff では「渡し忘れ」を検出できない (渡し忘れた状態が現状なので差分が出ない)。
		// deploy 済みの実 env を読む step だけが、配線が生きていることを示せる。
		const step = workflowStep(deployWorkflow, 'Incident webhook env verification');
		expect(step).toContain('aws lambda get-function-configuration');
		expect(step).toContain('Environment.Variables');
		expect(step).toContain('DISCORD_WEBHOOK_INCIDENT');
		expect(step, '配線不良を検出しても exit しないなら gate にならない').toContain('exit 1');
		expect(step).toContain('::error::');
	});
});

/** `- name: X` 単位で workflow を切り出し、name に `needle` を含む step の本文を返す。 */
function workflowStep(workflow: string, needle: string): string {
	const step = splitWorkflowSteps(workflow).find((s) => s.name.includes(needle));
	if (!step) throw new Error(`workflow に "${needle}" を含む step が見つかりません`);
	return step.body;
}

function splitWorkflowSteps(workflow: string): Array<{ name: string; body: string }> {
	const steps: Array<{ name: string; body: string }> = [];
	const starts = [...workflow.matchAll(/^ {6}- name: (.+)$/gm)];
	for (const [i, m] of starts.entries()) {
		const name = m[1];
		if (typeof name !== 'string' || m.index === undefined) continue;
		const end = starts[i + 1]?.index ?? workflow.length;
		steps.push({ name: name.trim(), body: workflow.slice(m.index, end) });
	}
	return steps;
}

/**
 * 本番 compute stack を触る cdk 呼び出し step (diff / deploy)。
 *
 * compute stack を含む呼び出しは DSQL endpoint を必ず渡す (compute-stack.ts が未注入で synth error に
 * する) ため、`-c dsqlEndpoint=` の有無で判別する。Storage 単独 deploy はここに入らない。
 */
function productionComputeCdkSteps(): Array<{ name: string; body: string }> {
	return splitWorkflowSteps(deployWorkflow).filter(
		(s) => s.body.includes('npx cdk') && s.body.includes('-c dsqlEndpoint='),
	);
}

// tests/unit/infra/playwright-shard-split.test.ts
// #4004: 「実行対象の宣言」と「実際に実行される集合」の乖離を機械検知する。
//
// 背景: `mobile` project は `dependencies: ['tablet']` を持つ。Playwright 公式 docs
// (test-projects §Dependencies) は以下を明記している:
//
//   "All test filtering options, such as --grep/--grep-invert, --shard, filtering directly
//    by location in the command line, or using test.only(), directly select the primary tests
//    to be run. If those tests belong to a project with dependencies, all tests from those
//    dependencies will also run."
//
// つまり `--shard` を付けても dependency (tablet 全 904 test) が **全 shard で実行される**。
// 実測: 各 shard 1196 test (= tablet 904 + mobile 292)。3 shard 合計で tablet を 3 回走らせ、
// かつ tablet が fail した時点で mobile は 1 件も走らない (= mobile の e2e カバレッジが実質ゼロ)。
// 同じ理由で a11y job は spec 1 本を指定しても 912 test を実行し、**a11y と無関係の spec の
// fail で red になっていた** (gate の red/green が a11y について何も言わない状態、ADR-0061)。
//
// 対処は公式が用意している `--no-deps`。本 test は「CI が実際に --no-deps を渡しているか」を
// workflow の実文字列で固定する。**設定を直しても、CI 側の呼び出しが元に戻れば実害は復活する**
// ため、検証対象は config ではなく **CI の起動コマンド**に置く。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const CI_WORKFLOW = path.join(REPO_ROOT, '.github/workflows/ci.yml');
const PW_CONFIG = path.join(REPO_ROOT, 'playwright.config.ts');

/** ci.yml から `npx playwright test ...` の起動行を全て抜き出す。 */
function playwrightInvocations(): string[] {
	return fs
		.readFileSync(CI_WORKFLOW, 'utf8')
		.split('\n')
		.map((l) => l.trim())
		.filter((l) => l.includes('npx playwright test'));
}

/** dependencies を持つ project 名を playwright.config.ts から抽出する。 */
function projectsWithDependencies(): string[] {
	const source = fs.readFileSync(PW_CONFIG, 'utf8');
	const names: string[] = [];
	// `name: 'x',` … `dependencies: [...]` が同一 project literal 内にある形を素朴に走査する。
	for (const block of source.split(/\n\t\t\{\n/)) {
		const name = block.match(/name:\s*'([a-z0-9-]+)'/)?.[1];
		if (name && /dependencies:\s*\[/.test(block)) names.push(name);
	}
	return names;
}

describe('#4004 Playwright の実行対象宣言と実行集合の乖離を防ぐ', () => {
	it('[P0] ci.yml に playwright 起動行が 1 本以上ある (0 件マッチの素通りを防ぐ)', () => {
		expect(playwrightInvocations().length).toBeGreaterThan(0);
	});

	// 本 test の前提そのもの。dependencies が無くなれば --no-deps は不要になるので、
	// 「前提が消えたのに test だけ残る」状態を検出できるようにしておく。
	it('[P1] dependencies を持つ project が存在する (--no-deps が必要な前提の確認)', () => {
		expect(
			projectsWithDependencies(),
			'dependencies を持つ project が無くなったなら、--no-deps 要求 ([P2]) は不要になる。' +
				'本 test ごと見直すこと',
		).not.toEqual([]);
	});

	// **spec を絞り込む起動**だけを対象にする。絞り込んだのに dependency 全量が走ると
	// 「その job の red/green が、絞り込んだ対象について何も言わない」状態になり、gate が
	// 実効を失う (ADR-0061)。a11y job が 912 test を走らせて無関係な spec の fail で red に
	// なっていたのがこれ。
	//
	// shard 起動 (`--shard=N/3`) は **意図的に対象外**。--no-deps を付けると分割は正しくなるが、
	// 同時にこれまで走っていなかった mobile 876 test が走り出し 40 件 fail する (実測)。
	// mobile でどの spec を走らせるかを決めるまでは切り替えない (#4004 follow-up、ci.yml 該当箇所
	// のコメントが SSOT)。ここで shard も要求すると、決定前に切り替えを強制してしまう。
	it('[P2] spec を絞り込む playwright 起動は --no-deps を渡す', () => {
		// 別 config (cognito-dev 等) は project 構成が異なるため対象外。
		const targets = playwrightInvocations()
			.filter((l) => !l.includes('--config'))
			.filter((l) => /tests[/\\]e2e[/\\]\S+\.spec\.ts/.test(l));
		const offenders = targets.filter((l) => !l.includes('--no-deps'));
		expect(
			offenders,
			`spec 絞り込みなのに --no-deps 無しの playwright 起動を検出:\n` +
				`${offenders.map((l) => `  ${l}`).join('\n')}\n` +
				'→ dependency project (tablet) が全量実行され、job の red/green が絞り込み対象について ' +
				'何も言わなくなる。公式 docs test-projects §Dependencies 参照',
		).toEqual([]);
	});

	it('[P2b] spec 絞り込みの起動が 1 本以上ある ([P2] が空集合を検査して素通りしない)', () => {
		const specTargets = playwrightInvocations()
			.filter((l) => !l.includes('--config'))
			.filter((l) => /tests[/\\]e2e[/\\]\S+\.spec\.ts/.test(l));
		expect(specTargets.length).toBeGreaterThan(0);
	});

	// 抽出ロジック自体の検証。規約に従う行だけを並べた fixture では
	// 「違反を検出できないこと」を検出できないため、**規約から外れた形**を混ぜる。
	it('[P3] 抽出ロジックが --no-deps 有無を読み分ける', () => {
		const hasNoDeps = (line: string) =>
			line.includes('npx playwright test') && line.includes('--no-deps');
		expect(hasNoDeps('run: npx playwright test --shard=1/3 --no-deps')).toBe(true);
		expect(hasNoDeps('run: npx playwright test --shard=1/3')).toBe(false);
		expect(hasNoDeps('run: npx playwright test tests/e2e/a11y-critical-cuj.spec.ts')).toBe(false);
		// コメント行に --no-deps が出てくるだけの行を「起動行」と誤認しない
		expect(playwrightInvocations().every((l) => !l.startsWith('#'))).toBe(true);
	});
});

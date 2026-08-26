// tests/unit/docs/ci-hard-fail-check-list-ssot.test.ts
// #4605: ルート CLAUDE.md の「CI で hard-fail する検査」列挙を、`.github/workflows/ci.yml` の実測と突合する。
//
// 背景 (なぜ手書きの列挙では駄目だったか):
//   CLAUDE.md は #4121 (pre-ready を 6 step に絞った時点) の一覧を「以下がその全部である」
//   「ここに挙がっていない検査は CI にも無い」と断定したまま置かれていた。その後 ci.yml には
//   #3877 (lint:typed) / #3878 (lint:svelte) / #3969 / #3978 / #4015 / #4085 … と hard-fail step が
//   足され続けたが、doc は一度も追随していない。ci.yml を触る PR は CLAUDE.md を開かないので、
//   列挙は step が増えるたびに静かに古くなる。
//
//   実害 (PR #4603): 担当は CLAUDE.md の断定から「eslint svelte は CI に無い」と判断して Ready 化し、
//   `lint-and-test` が `svelte/no-useless-children-snippet` で fail → 1 往復。
//   **doc の誤りがそのまま PR 往復のコストになる**。人の注意では追随しないので機械に持たせる
//   (ADR-0061 same-class-N→guard)。形は tests/unit/docs/stripe-webhook-subscribed-events-ssot.test.ts
//   (doc の marker block ⇄ 実装 case の突合 + 未登録の silent gap 検出) と同型。
//
// 本 gate が検出するもの / しないもの:
//   検出する: (1) ci.yml にあるが doc の marker block に無い hard-fail step (列挙漏れ)
//             (2) doc にあるが ci.yml に無い step (陳腐化)
//             (3) ci.yml の job が doc にも除外リストにも無い (job 新設の silent gap)
//             (4) 除外リストの理由が理由になっていない (exclusion-reason.mjs の判定)
//             (5) marker block の欠落 / 0 件マッチ (検査の空振り)
//   検出しない: ci.yml 以外の workflow (lp-metrics.yml 等)。doc 側でも「対象外」と明記している。
//               step の中身 (script が実際に何を検査するか) の正しさ。

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { findReasonDefect } from '../../../scripts/lib/ci/exclusion-reason.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');
const CLAUDE_MD = 'CLAUDE.md';
const CI_YML = '.github/workflows/ci.yml';

/** step 単位で列挙する job。ここだけは「全 hard-fail step が doc に並ぶ」ことを要求する。 */
const STEP_ENUMERATED_JOB = 'lint-and-test';

/**
 * `lint-and-test` の hard-fail step のうち、doc に列挙しないもの (+ その理由)。
 *
 * key は ci.yml の `run` を正規化した文字列 (= doc の列挙 key と同じ形)。
 * 理由は `scripts/lib/ci/exclusion-reason.mjs` の判定を通すため、stub / 機械生成文言では通らない。
 */
const EXCLUDED_STEPS: Record<string, string> = {
	'npm ci':
		'依存 install であって検査ではない。落ちても「検査に引っかかった」ではなく環境の失敗であり、読み手が Ready 化前に回すコマンドでもない',
	'cd infra && npm ci': '同上 (infra 側の依存 install)。検査ではない',
};

/**
 * doc に列挙しない ci.yml の job (+ その理由)。
 *
 * 「新しい gate job を足したのに doc も除外リストも触っていない」を fail させるための no-silent-gap
 * 用リスト。検査 job をここに逃がすのは不可 (理由が成立しなくなる)。
 */
const EXCLUDED_JOBS: Record<string, string> = {
	changes:
		'paths-filter で後続 job の実行要否を出力するだけの分岐 job。落ちる検査を 1 つも持たない',
	'lint-and-test':
		'step 単位で列挙する job なので、job 名の列挙対象からは外す (上のブロックが担う)',
	'e2e-merge-reports': 'blob report を HTML に結合するだけの後処理。合否判定は e2e-test 側が持つ',
	'ci-gate': '他 job の結果を集約して 1 つの required context にするゲート。固有の検査を持たない',
	'integration-evidence':
		'統合 PR (release/* → main) 専用の証跡生成 job。個別 PR の Ready 化判断で読む対象ではない',
};

type Step = { name?: string; run?: string; 'continue-on-error'?: boolean };
type Job = { steps?: Step[]; 'continue-on-error'?: boolean };

function read(relPath: string): string {
	return readFileSync(path.join(REPO_ROOT, relPath), 'utf-8');
}

/** doc / ci.yml のどちらから来ても同じ形になるようコマンド文字列を正規化する。 */
function normalizeCommand(raw: string): string {
	return raw.trim().replace(/\s+/g, ' ');
}

/**
 * step が hard-fail か判定する。
 *
 * `continue-on-error: true` だけでなく **末尾 `|| true`** も soft と見なす
 * (`Color usage report` が実際にこの形。exit code を握り潰す step を「hard-fail」と数えると、
 * doc が「落ちる」と言っているのに落ちない嘘になる)。
 */
function isHardFail(step: Step): boolean {
	if (typeof step.run !== 'string') return false; // `uses:` (checkout / cache / upload) は対象外
	if (step['continue-on-error'] === true) return false;
	return !/\|\|\s*true\s*$/.test(step.run.trim());
}

function ciJobs(): Record<string, Job> {
	const parsed = parse(read(CI_YML)) as { jobs?: Record<string, Job> };
	if (!parsed.jobs) throw new Error(`${CI_YML} から jobs を読めません (構造が変わった?)`);
	return parsed.jobs;
}

/** `lint-and-test` の hard-fail step を「正規化コマンド → step 名」で返す。 */
function hardFailStepsOfLintAndTest(): Map<string, string> {
	const job = ciJobs()[STEP_ENUMERATED_JOB];
	if (!job) throw new Error(`${CI_YML} に job ${STEP_ENUMERATED_JOB} がありません`);
	if (job['continue-on-error'] === true) {
		throw new Error(
			`${STEP_ENUMERATED_JOB} が job 単位で continue-on-error になっています。` +
				'本 gate は step 単位の判定しかしないため、doc の記述ごと見直すこと',
		);
	}
	const out = new Map<string, string>();
	for (const step of job.steps ?? []) {
		if (!isHardFail(step)) continue;
		const command = normalizeCommand((step.run as string).split('\n')[0] ?? '');
		out.set(command, step.name ?? '(name なし)');
	}
	return out;
}

/** ci.yml の全 job 名 (job 単位 continue-on-error のものは hard-fail ではないので除く)。 */
function hardFailJobNames(): string[] {
	return Object.entries(ciJobs())
		.filter(([, job]) => job['continue-on-error'] !== true)
		.map(([name]) => name)
		.sort();
}

/**
 * CLAUDE.md の marker block 内の箇条書きから、バッククォート囲みの key を取り出す。
 *
 * `firstPerLine` は block ごとの書式差を吸収する:
 *   - step block: 1 行 = 1 コマンド + 説明文。説明文中のコード span (`eslint-suppressions.json` 等) を
 *     key と誤認しないよう **行頭の最初の span だけ**を key にする
 *   - job block: 1 行に複数 job を並べる (`e2e-test` / `e2e-matrix` …) ので全 span を key にする
 */
function declaredKeys(marker: string, { firstPerLine = false } = {}): string[] {
	const content = read(CLAUDE_MD);
	const start = content.indexOf(`<!-- ${marker}:start -->`);
	const end = content.indexOf(`<!-- ${marker}:end -->`);
	if (start < 0 || end < 0 || end < start) {
		throw new Error(
			`${CLAUDE_MD} に marker block (<!-- ${marker}:start --> 〜 <!-- ${marker}:end -->) がありません。` +
				'列挙は marker で囲むこと (囲まないと機械突合できない)',
		);
	}
	const block = content.slice(start + `<!-- ${marker}:start -->`.length, end);
	return [...block.matchAll(/^\s*-\s+(.*)$/gm)].flatMap((line) => {
		const spans = [...(line[1] ?? '').matchAll(/`([^`]+)`/g)]
			.map((m) => m[1])
			.filter((v): v is string => v !== undefined)
			.map(normalizeCommand);
		return firstPerLine ? spans.slice(0, 1) : spans;
	});
}

describe('#4605: CLAUDE.md の CI hard-fail 検査一覧 ↔ ci.yml の実測', () => {
	const ciSteps = hardFailStepsOfLintAndTest();
	const docSteps = declaredKeys('ci-hard-fail-steps', { firstPerLine: true });

	it('[C0] ci.yml / CLAUDE.md の双方から 1 件以上抽出できる (0 件マッチの素通りを防ぐ)', () => {
		expect(ciSteps.size).toBeGreaterThan(0);
		expect(docSteps.length).toBeGreaterThan(0);
	});

	it('[C1] lint-and-test の hard-fail step が全て CLAUDE.md に列挙されている', () => {
		const missing = [...ciSteps.entries()]
			.filter(([command]) => !docSteps.includes(command) && !(command in EXCLUDED_STEPS))
			.map(([command, name]) => `${command}   (step: ${name})`);
		expect(
			missing,
			`ci.yml ${STEP_ENUMERATED_JOB} の hard-fail step が CLAUDE.md の ci-hard-fail-steps ブロックにありません。\n` +
				'列挙するか、検査でないなら本 test の EXCLUDED_STEPS に理由付きで登録すること:\n' +
				missing.map((m) => `  - ${m}`).join('\n'),
		).toEqual([]);
	});

	it('[C2] CLAUDE.md の列挙に ci.yml から消えた step が残っていない', () => {
		const stale = docSteps.filter((command) => !ciSteps.has(command));
		expect(
			stale,
			'CLAUDE.md が「CI で hard-fail する」と書いている検査が ci.yml にありません ' +
				'(step の削除 / コマンド変更に doc が追随していない):\n' +
				stale.map((m) => `  - ${m}`).join('\n'),
		).toEqual([]);
	});

	it('[C3] CLAUDE.md の列挙に重複がない (数を水増ししない)', () => {
		const duplicated = docSteps.filter((command, i) => docSteps.indexOf(command) !== i);
		expect(duplicated).toEqual([]);
	});

	it('[C4] EXCLUDED_STEPS の理由が理由として成立している', () => {
		const defects = Object.entries(EXCLUDED_STEPS)
			.map(([entry, reason]) => ({ entry, defect: findReasonDefect(reason) }))
			.filter((d) => d.defect !== null);
		expect(defects).toEqual([]);
	});

	it('[C5] EXCLUDED_STEPS に ci.yml から消えた step が残っていない', () => {
		const stale = Object.keys(EXCLUDED_STEPS).filter((command) => !ciSteps.has(command));
		expect(stale).toEqual([]);
	});
});

describe('#4605: ci.yml の job が CLAUDE.md か除外リストのどちらかに現れる (no-silent-gap)', () => {
	const jobs = hardFailJobNames();
	const docJobs = declaredKeys('ci-hard-fail-jobs');

	it('[J0] ci.yml から job を 1 件以上抽出できる', () => {
		expect(jobs.length).toBeGreaterThan(0);
		expect(docJobs.length).toBeGreaterThan(0);
	});

	it('[J1] 全 job が CLAUDE.md の列挙か EXCLUDED_JOBS に現れる', () => {
		const missing = jobs.filter((name) => !docJobs.includes(name) && !(name in EXCLUDED_JOBS));
		expect(
			missing,
			'ci.yml の job が CLAUDE.md の ci-hard-fail-jobs ブロックにも EXCLUDED_JOBS にもありません。\n' +
				'新設した gate job は doc に列挙し、検査を持たない job は理由付きで除外すること:\n' +
				missing.map((m) => `  - ${m}`).join('\n'),
		).toEqual([]);
	});

	it('[J2] CLAUDE.md / EXCLUDED_JOBS に ci.yml から消えた job が残っていない', () => {
		const stale = [...docJobs, ...Object.keys(EXCLUDED_JOBS)].filter(
			(name) => !jobs.includes(name),
		);
		expect(stale).toEqual([]);
	});

	it('[J3] EXCLUDED_JOBS の理由が理由として成立している', () => {
		const defects = Object.entries(EXCLUDED_JOBS)
			.map(([entry, reason]) => ({ entry, defect: findReasonDefect(reason) }))
			.filter((d) => d.defect !== null);
		expect(defects).toEqual([]);
	});
});

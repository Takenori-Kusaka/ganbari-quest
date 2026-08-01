/**
 * tests/unit/architecture/pr-commitless-trigger-guard.test.ts (#4171)
 *
 * 「新しい commit を伴わない PR イベントで重量レーンが再実行されない」を機械で固定する
 * fitness function。宣言 SSOT は `scripts/lib/ci/pr-commitless-trigger-registry.mjs`。
 *
 * ## なぜ test で、なぜ今か
 *
 * #4171 は「統合 PR の本文を直すたびに重量レーンが回る」という前提で起票されたが、実測すると
 * `ci.yml` は `edited` を購読しておらず、**本文編集で CI は 1 度も回っていなかった**
 * (実測値は registry 冒頭のコメント参照)。つまり足すべきは paths filter ではなく、
 * **既に成立している性質が偶然のままであることを終わらせる guard** だった。
 *
 * `ci.yml` の `types:` に `edited` を 1 語足すだけで、本文を直すたびに 16〜20 分の重量レーンが
 * 回る状態へ静かに退行する。逆に「速くしたい」と body gate から `edited` を外せば、本文の
 * 検査が黙って止まる (#4119 = 検査があるように見えて走っていない、と同 class の逆向き)。
 * どちらも人の注意では止まらないので機械に持たせる (ADR-0061 same-class-N→guard)。
 */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';

import {
	COMMITLESS_PR_ACTIVITY_TYPES,
	DEFAULT_PR_ACTIVITY_TYPES,
	HEAVY_STEP_RUN_PATTERNS,
	HEAVY_STEP_USES_PREFIXES,
	PR_COMMITLESS_TRIGGER_REGISTRY,
	REVIEW_READY_ACTIVITY_TYPE,
} from '../../../scripts/lib/ci/pr-commitless-trigger-registry.mjs';

// #4085: repo 走査 test (実行時間が入力サイズに比例する)。既定 5s のままだと unit lane の
// 並列実行の負荷で落ち、「本物の回帰か負荷か」の切り分けが毎回発生するため file 単位で明示する。
// 区分は scripts/lib/ci/repo-scan-test-registry.mjs が SSOT (未宣言 / timeout 欠落は CI が fail)。
vi.setConfig({ testTimeout: 60_000 });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');
const WORKFLOW_DIR = path.join(REPO_ROOT, '.github', 'workflows');

type WorkflowFacts = {
	/** repo root 相対 (POSIX) */
	readonly file: string;
	/** `on.pull_request` / `on.pull_request_target` を持つか */
	readonly isPrTriggered: boolean;
	/** 購読している活動 type (両 trigger の和集合。`types:` 省略時は既定 3 種) */
	readonly activityTypes: readonly string[];
	/** step の run / uses から静的に「重量」と判定したか */
	readonly heavy: boolean;
	/** 重量と判定した根拠 (エラーメッセージ用) */
	readonly heavyReasons: readonly string[];
	/** どこかの job に Draft skip 条件があるか */
	readonly hasDraftSkip: boolean;
};

function listWorkflowFiles(): string[] {
	return readdirSync(WORKFLOW_DIR)
		.filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
		.map((name) => `.github/workflows/${name}`)
		.sort();
}

/** `on:` の 1 trigger 定義から活動 type を取り出す。`types:` 省略時は GitHub の既定 3 種。 */
function activityTypesOf(trigger: unknown): string[] {
	if (trigger === null || trigger === undefined) return [...DEFAULT_PR_ACTIVITY_TYPES];
	if (typeof trigger !== 'object') return [...DEFAULT_PR_ACTIVITY_TYPES];
	const types = (trigger as { types?: unknown }).types;
	if (!Array.isArray(types)) return [...DEFAULT_PR_ACTIVITY_TYPES];
	return types.map(String);
}

/**
 * 1 step が「重量」に当たる根拠を返す。
 *
 * 判定は **parse 済み YAML の `run` / `uses` にだけ**当てる。workflow 全文 grep だと
 * コメントや通知メッセージ本文の "Playwright" / "Docker" を拾って誤判定する
 * (実例: `pr-quality-gate.yml` の SS 添付案内、`pr-author-guard.yml` の背景コメント)。
 */
function heavyReasonsOfStep(jobId: string, rawStep: unknown): string[] {
	if (rawStep === null || typeof rawStep !== 'object') return [];
	const step = rawStep as { run?: unknown; uses?: unknown };
	const reasons: string[] = [];

	if (typeof step.run === 'string') {
		const run = step.run;
		reasons.push(
			...HEAVY_STEP_RUN_PATTERNS.filter((p) => p.test(run)).map((p) => `${jobId}: run が ${p}`),
		);
	}
	if (typeof step.uses === 'string') {
		const uses = step.uses;
		reasons.push(
			...HEAVY_STEP_USES_PREFIXES.filter((p) => uses.startsWith(p)).map(
				() => `${jobId}: uses ${uses}`,
			),
		);
	}
	return reasons;
}

/**
 * 1 job が「重量」に当たる根拠を返す。
 *
 * job が reusable workflow (`jobs.<id>.uses`) の場合は中身を追わないので **保守的に重量**と
 * みなす (「軽いと言い張って `edited` を足す」逃げ道を作らない)。
 */
function heavyReasonsOfJob(jobId: string, job: Record<string, unknown>): string[] {
	const reasons: string[] = [];
	if (typeof job.uses === 'string') {
		reasons.push(`${jobId}: reusable workflow (${job.uses}) — 中身を追えないため重量扱い`);
	}
	if (Array.isArray(job.steps)) {
		for (const step of job.steps) reasons.push(...heavyReasonsOfStep(jobId, step));
	}
	return reasons;
}

function inspectJobs(doc: Record<string, unknown>): {
	heavy: boolean;
	heavyReasons: string[];
	hasDraftSkip: boolean;
} {
	const heavyReasons: string[] = [];
	let hasDraftSkip = false;

	const jobs = doc.jobs;
	if (jobs === null || typeof jobs !== 'object') {
		return { heavy: false, heavyReasons, hasDraftSkip };
	}

	for (const [jobId, rawJob] of Object.entries(jobs as Record<string, unknown>)) {
		if (rawJob === null || typeof rawJob !== 'object') continue;
		const job = rawJob as Record<string, unknown>;

		if (typeof job.if === 'string' && /pull_request\.draft\s*==\s*false/.test(job.if)) {
			hasDraftSkip = true;
		}
		heavyReasons.push(...heavyReasonsOfJob(jobId, job));
	}

	return { heavy: heavyReasons.length > 0, heavyReasons, hasDraftSkip };
}

function readWorkflowFacts(file: string): WorkflowFacts {
	const raw = readFileSync(path.join(REPO_ROOT, file), 'utf8');
	const doc = (parse(raw) ?? {}) as Record<string, unknown>;

	// `on` は YAML 1.1 で boolean true に解決されうる (`yaml` は 1.2 なので文字列 'on' のまま)。
	// どちらでも拾えるようにする。
	const on = (doc.on ?? (doc as Record<string, unknown>).true) as unknown;

	const triggers: unknown[] = [];
	let isPrTriggered = false;
	if (typeof on === 'string') {
		if (on === 'pull_request' || on === 'pull_request_target') {
			isPrTriggered = true;
			triggers.push(null);
		}
	} else if (Array.isArray(on)) {
		for (const key of on) {
			if (key === 'pull_request' || key === 'pull_request_target') {
				isPrTriggered = true;
				triggers.push(null);
			}
		}
	} else if (on !== null && typeof on === 'object') {
		for (const key of ['pull_request', 'pull_request_target'] as const) {
			if (key in (on as Record<string, unknown>)) {
				isPrTriggered = true;
				triggers.push((on as Record<string, unknown>)[key]);
			}
		}
	}

	const activityTypes = [...new Set(triggers.flatMap(activityTypesOf))];
	const { heavy, heavyReasons, hasDraftSkip } = inspectJobs(doc);

	return { file, isPrTriggered, activityTypes, heavy, heavyReasons, hasDraftSkip };
}

const ALL_FACTS = listWorkflowFiles().map(readWorkflowFacts);
const PR_FACTS = ALL_FACTS.filter((f) => f.isPrTriggered);

describe('PR commit-less trigger guard (#4171)', () => {
	it('scanner が PR 起動 workflow を実際に拾っている (走査自体の空振りを通さない)', () => {
		expect(ALL_FACTS.length).toBeGreaterThan(10);
		expect(PR_FACTS.length).toBeGreaterThan(5);
		// 主目的の対象が視野に入っていること
		expect(PR_FACTS.map((f) => f.file)).toContain('.github/workflows/ci.yml');
	});

	it('PR 起動 workflow は全数が registry に宣言されている (no-silent-gap)', () => {
		const undeclared = PR_FACTS.filter((f) => !(f.file in PR_COMMITLESS_TRIGGER_REGISTRY)).map(
			(f) => f.file,
		);
		expect(
			undeclared,
			[
				'on.pull_request(_target) を持つ workflow が registry に未宣言です。',
				'scripts/lib/ci/pr-commitless-trigger-registry.mjs に bodyGate (true/false) と理由を足してください。',
				'  bodyGate: true  = PR 本文が入力の軽量 gate (edited 購読が必須)',
				'  bodyGate: false = commit-less な活動 type を購読しない',
			].join('\n'),
		).toEqual([]);
	});

	it('registry に stale 宣言が無い (file 削除 / PR trigger 撤去に追随している)', () => {
		const prFiles = new Set(PR_FACTS.map((f) => f.file));
		const stale = Object.keys(PR_COMMITLESS_TRIGGER_REGISTRY).filter((f) => !prFiles.has(f));
		expect(
			stale,
			'registry にあるが on.pull_request(_target) を持たない workflow です。エントリを削除してください。',
		).toEqual([]);
	});

	it('bodyGate:false の workflow は commit を伴わない活動 type を購読しない', () => {
		const violations: string[] = [];
		for (const facts of PR_FACTS) {
			const entry = PR_COMMITLESS_TRIGGER_REGISTRY[facts.file];
			if (!entry || entry.bodyGate) continue;
			const offending = facts.activityTypes.filter((t) =>
				(COMMITLESS_PR_ACTIVITY_TYPES as readonly string[]).includes(t),
			);
			if (offending.length > 0) {
				violations.push(`${facts.file}: types に ${offending.join(' / ')} が入っています`);
			}
		}
		expect(
			violations,
			[
				'commit を伴わない PR イベント (本文編集 / label 付与 等) で再実行される設定です。',
				'同一 SHA を再検査するだけなので結果は変わらず、重量レーンなら 16〜20 分を捨てます (#4171 実測)。',
				'本文を入力に取る軽量 gate なら registry の bodyGate を true にしてください。',
			].join('\n'),
		).toEqual([]);
	});

	it('bodyGate:true の workflow は edited を購読している (本文検査を黙って止めない)', () => {
		const violations: string[] = [];
		for (const [file, entry] of Object.entries(PR_COMMITLESS_TRIGGER_REGISTRY)) {
			if (!entry.bodyGate) continue;
			const facts = PR_FACTS.find((f) => f.file === file);
			if (!facts) continue; // stale は別 test が報告する
			if (!facts.activityTypes.includes('edited')) {
				violations.push(`${file}: types に edited がありません`);
			}
		}
		expect(
			violations,
			[
				'PR 本文を入力に取る gate が edited を購読していません。',
				'本文を直しても再判定されないので、直した／直していないに関わらず前回の結果が残ります',
				'(= 検査があるように見えて実際には効いていない状態、#4119 と同 class)。',
			].join('\n'),
		).toEqual([]);
	});

	it('bodyGate:true の workflow は静的に軽量 (重い job に edited を足す逃げ道を塞ぐ)', () => {
		const violations: string[] = [];
		for (const [file, entry] of Object.entries(PR_COMMITLESS_TRIGGER_REGISTRY)) {
			if (!entry.bodyGate) continue;
			const facts = PR_FACTS.find((f) => f.file === file);
			if (!facts) continue;
			if (facts.heavy) {
				violations.push(`${file}: ${facts.heavyReasons.join(' / ')}`);
			}
		}
		expect(
			violations,
			[
				'bodyGate:true (本文編集のたびに再実行される) なのに重量 step を含んでいます。',
				'本文検査は PR 本文だけを入力にする軽量 job に閉じてください。',
				'重い検査が本当に必要なら、それは commit に紐づく別 workflow の仕事です。',
			].join('\n'),
		).toEqual([]);
	});

	it('重量 workflow が ready_for_review を購読するなら Draft skip を持つ', () => {
		const violations: string[] = [];
		for (const facts of PR_FACTS) {
			if (!facts.heavy) continue;
			if (!facts.activityTypes.includes(REVIEW_READY_ACTIVITY_TYPE)) continue;
			if (!facts.hasDraftSkip) {
				violations.push(`${facts.file}: ready_for_review を購読するが draft == false 条件が無い`);
			}
		}
		expect(
			violations,
			[
				'ready_for_review も commit を伴わないイベントです。',
				'Draft 中も走る workflow がこれを購読すると、同一 SHA を Ready 化のたびに再実行します (#1218)。',
				'Draft skip があるなら初回発火に必要なので購読は正当です。無いなら types から外してください。',
			].join('\n'),
		).toEqual([]);
	});
});

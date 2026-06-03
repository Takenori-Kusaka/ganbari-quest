// tests/e2e/helpers/a11y.ts
// CX-DoR #10 Accessibility — axe-core E2E helper (WCAG 2.2 AA 機械検証)
//
// 背景 (tmp/round18-dor-audit-integrated-2026-06-03.md §A-5):
//   `axe-core@4.11.4` 導入済 + AI evaluation 専用 inline runner
//   (`scripts/ai-evaluation/lib/axe-runner.mjs`) はあるが、通常 E2E (`tests/e2e/`) からの
//   axe-core 呼出ゼロ + CI gate ゼロ。本 helper で critical CUJ の WCAG 2.2 AA 違反
//   (critical / serious) を機械検出する。
//
// OSS 採用 (#1350 / ADR-0014 整合):
//   `@axe-core/playwright` (`AxeBuilder`) が業界標準。axe-runner.mjs が axe-core 単体の
//   inline inject を採用しているのは Stagehand v3 (understudy/Page, CDP 直接接続) が
//   Playwright `Page` 型を満たさないための回避策であり、通常 Playwright E2E では
//   `AxeBuilder` が `playwright-core` の Page 型をそのまま受け取れるため問題なく動作する。
//   - npm: https://www.npmjs.com/package/@axe-core/playwright (Deque 公式、週 100 万 DL 超)
//   - bundle: dev dependency のみ (本番 build 非搭載、ADR-0010 Pre-PMF コスト ゼロ)
//
// WCAG 2.2 AA tag SSOT:
//   axe-core の tag namespace で 2.2 AA まで網羅: wcag2a / wcag2aa / wcag21a / wcag21aa / wcag22aa。
//   (https://github.com/dequelabs/axe-core/blob/develop/doc/API.md#axe-core-tags)
//
// baseline pin 機構 (Pre-PMF 段階導入、silent cap 禁止):
//   PR-A11Y-1 (#2787) で alt / svg aria / contrast token は是正済だが、残違反が検出された場合に
//   gate を立てつつ既知違反を可視化するため `tests/e2e/a11y-baseline.json` に rule id 単位で pin する。
//   pin した違反は log で件数・rule id を明示し、新規違反 1 件で fail させる (ADR-0006 §3 — assertion 弱体化禁止)。

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AxeBuilder } from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

const currentDir = dirname(fileURLToPath(import.meta.url));

/**
 * WCAG 2.2 AA まで網羅する axe-core tag セット。
 * level A / AA を 2.0 → 2.1 → 2.2 まで積み上げる (level AAA は対象外、Material 3 default 整合)。
 */
export const WCAG_22_AA_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] as const;

/** critical CUJ で 0 件 assert する impact レベル。moderate / minor は記録のみ。 */
const BLOCKING_IMPACTS = new Set(['critical', 'serious']);

interface A11yBaseline {
	/** rule id → 許容理由。pin した rule の critical/serious 違反は fail させない (件数のみ log)。 */
	knownViolations: Record<string, string>;
}

let cachedBaseline: A11yBaseline | null = null;

function loadBaseline(): A11yBaseline {
	if (cachedBaseline) return cachedBaseline;
	const baselinePath = resolve(currentDir, '..', 'a11y-baseline.json');
	try {
		const raw = readFileSync(baselinePath, 'utf-8');
		const parsed = JSON.parse(raw) as A11yBaseline;
		cachedBaseline = {
			knownViolations: parsed.knownViolations ?? {},
		};
	} catch {
		// baseline 不在なら空 (= 全 critical/serious を fail させる、是正完了の理想状態)
		cachedBaseline = { knownViolations: {} };
	}
	return cachedBaseline;
}

export interface ExpectNoA11yOptions {
	/**
	 * 一時的に無効化する axe rule id (例: ['color-contrast'])。
	 * baseline.json への pin と異なり、spec ローカルで明示的に skip したい場合のみ使う。
	 * 使用時は spec コメントで理由 + 追跡 Issue を必ず残すこと (ADR-0006 §3)。
	 */
	disableRules?: string[];
	/** scan 対象を CSS selector に限定する (省略時は document 全体)。 */
	include?: string;
}

/**
 * 指定 page を axe-core で WCAG 2.2 AA scan し、critical / serious 違反 0 件を assert する。
 *
 * - baseline.json に pin された rule id の違反は fail させず件数を log する (段階導入)。
 * - moderate / minor は fail させず、件数を log するのみ。
 * - 何を scan し何を skip したか必ず log する (silent cap 禁止)。
 *
 * @param page  Playwright Page (local AUTH_MODE で対象 route 到達済であること)
 * @param label scan 対象の人間可読ラベル (log / 失敗メッセージ用、例 '/marketplace')
 */
export async function expectNoA11yViolations(
	page: Page,
	label: string,
	options: ExpectNoA11yOptions = {},
): Promise<void> {
	const { disableRules = [], include } = options;
	const baseline = loadBaseline();

	let builder = new AxeBuilder({ page }).withTags([...WCAG_22_AA_TAGS]);
	if (disableRules.length > 0) builder = builder.disableRules(disableRules);
	if (include) builder = builder.include(include);

	const results = await builder.analyze();

	const blocking = results.violations.filter((v) => BLOCKING_IMPACTS.has(v.impact ?? ''));
	const moderateMinor = results.violations.filter((v) => !BLOCKING_IMPACTS.has(v.impact ?? ''));

	// baseline pin を分離 (新規 = fail 対象 / pinned = log のみ)
	const pinnedIds = new Set(Object.keys(baseline.knownViolations));
	const newBlocking = blocking.filter((v) => !pinnedIds.has(v.id));
	const pinnedBlocking = blocking.filter((v) => pinnedIds.has(v.id));

	// 何を scan / skip したか必ず log (silent cap 禁止)
	const scanned = `[a11y] ${label}: scanned ${results.passes.length} passes`;
	const moderateLog =
		moderateMinor.length > 0
			? ` | moderate/minor(non-blocking): ${moderateMinor.map((v) => `${v.id}(${v.impact})`).join(', ')}`
			: '';
	const pinnedLog =
		pinnedBlocking.length > 0
			? ` | baseline-pinned(known): ${pinnedBlocking.map((v) => `${v.id}×${v.nodes.length}`).join(', ')}`
			: '';
	const disabledLog = disableRules.length > 0 ? ` | disabledRules: ${disableRules.join(', ')}` : '';
	console.log(`${scanned}${moderateLog}${pinnedLog}${disabledLog}`);

	if (newBlocking.length > 0) {
		const detail = newBlocking
			.map((v) => {
				const targets = v.nodes
					.slice(0, 3)
					.map((n) => n.target.join(' '))
					.join(' ; ');
				return `  - [${v.impact}] ${v.id}: ${v.help}\n    nodes(${v.nodes.length}): ${targets}\n    help: ${v.helpUrl}`;
			})
			.join('\n');
		throw new Error(
			`[a11y] ${label}: ${newBlocking.length} 件の WCAG 2.2 AA critical/serious 違反 (baseline 未 pin)\n${detail}`,
		);
	}

	// 明示 assert で 0 件を pass 表現 (newBlocking が 0 のときのみ到達)
	expect(newBlocking.length, `${label}: new critical/serious a11y violations`).toBe(0);
}

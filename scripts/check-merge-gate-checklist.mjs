// @ts-check
/**
 * scripts/check-merge-gate-checklist.mjs — Issue #2945 (Phase A/A-3、親 #2942 / EPIC #2861)
 *
 * `.github/workflows/pr-merge-gate.yml`（required context `PR チェックリスト完了確認`）の
 * 検証ロジックを lane-aware な純粋関数として切り出した SSOT（unit test 可能化、Issue #2945 実装方針）。
 *
 * ## 背景（#2942 / #2945）
 *
 * 旧 workflow は base/head（レーン）を見ず、per-PR の「Ready for Review チェックリスト」/
 * 「完了チェックリスト」の `- [ ]` 全消化を全レーンに一律要求していた。統合 PR
 * （develop→main、複数 PR の束ね）はこの per-PR チェックリスト前提に構造的に適合せず、
 * 検証単位（バッチ）と gate の前提（per-PR）が不整合だった。
 *
 * ## lane 別の対象 section（Issue #2945 AC5 が SSOT）
 *
 * - **feature / hotfix lane**: 現行 2 section（`## Ready for Review チェックリスト` /
 *   `## 完了チェックリスト`）の `- [ ]` 全消化を検証（AC4 回帰ゼロ）。
 * - **integration lane**: 統合 PR 用 section の `- [ ]` 全消化を検証。
 *   section 名は **Phase B template で確定する**ため、本 phase では「lane=integration なら
 *   統合用 section を対象にする」分岐ロジックまでを実装し、section 名は **設定値（env / 定数）で
 *   差替可能**にする（targetSections をハードコードで統合用に置換しない、#2945 no-go）。
 * - **dependabot lane**: 呼び出し側（job-level if）で従来どおり skip 相当（AC6）。
 *   本関数では `shouldSkip()` が dependencies ラベルを判定する。
 *
 * ## integration lane の最小要件（統合 PR template 未導入の暫定期間、#2945）
 *
 * 統合 PR template（Phase B #2871）が未導入のため、暫定 section 名を既定とする。
 * 必須セクションが本文に存在しない場合は **fail**（warning で素通りさせない、#2945 no-go）。
 *
 * ## SSOT / 関連
 *
 * - lane 判定: scripts/pr-lane.mjs（A-1、actions/pr-lane composite action 経由で workflow から呼ぶ）
 * - 統合 PR チェックリスト確定: Phase B #2871（本 phase は分岐 + section 名設定可能化まで）
 * - 関連 ADR: ADR-0056（self-report 物理強制）/ ADR-0022（役割分離）
 * - 関連 Issue: #2945 / #2942 / #1481（merge gate 原典）/ #1808（Dependabot exempt）
 *
 * exit: 0 = PASS / 1 = 検証失敗 / 2 = 引数不足
 */

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** feature / hotfix lane の対象 section（現行 2 section、AC5 で不変）。 */
export const LIGHT_LANE_SECTIONS = ['## Ready for Review チェックリスト', '## 完了チェックリスト'];

/**
 * integration lane の対象 section（暫定既定。Phase B #2871 で確定するため設定値で差替可能、AC5）。
 * env `MERGE_GATE_INTEGRATION_SECTIONS`（カンマ区切り）で上書きできる。
 */
export const DEFAULT_INTEGRATION_LANE_SECTIONS = ['## 統合 PR チェックリスト'];

/**
 * env / 引数から integration lane の対象 section を解決する（設定値で差替可能、AC5）。
 *
 * @param {string|undefined} override カンマ区切りの section 見出し（`## ` 付き）。空なら既定。
 * @returns {string[]}
 */
export function resolveIntegrationSections(override) {
	if (!override?.trim()) return DEFAULT_INTEGRATION_LANE_SECTIONS;
	return override
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);
}

/**
 * skip 判定（dependencies ラベルは全 lane 共通の skip 条件、Dependabot exempt 二重防御）。
 *
 * @param {{ labels: string[] }} input
 * @returns {{ skip: boolean; reason?: string }}
 */
export function shouldSkip({ labels }) {
	if (labels.some((l) => l.includes('dependencies'))) {
		return { skip: true, reason: 'dependencies ラベル（Dependabot exempt）' };
	}
	return { skip: false };
}

/**
 * @typedef {object} ChecklistResult
 * @property {boolean} ok 検証 PASS か
 * @property {'feature'|'integration'|'hotfix'|'dependabot'} lane
 * @property {string[]} targetSections 検証対象にした section
 * @property {string} [reason] PASS / skip 理由
 * @property {string} [error] FAIL メッセージ
 * @property {string[]} [info] 補助ログ行
 * @property {string[]} [warnings] section 不在 warning（feature/hotfix のみ。integration は fail）
 */

/**
 * 1 section の未チェック `- [ ]` 件数を数える。
 *
 * @param {string} body PR 本文
 * @param {string} section section 見出し（`## ` 付き）
 * @returns {{ found: boolean; unchecked: number }}
 */
function countUnchecked(body, section) {
	const idx = body.indexOf(section);
	if (idx === -1) return { found: false, unchecked: 0 };
	const nextSection = body.indexOf('\n## ', idx + 1);
	const sectionBody = nextSection === -1 ? body.slice(idx) : body.slice(idx, nextSection);
	const unchecked = (sectionBody.match(/^\s*- \[ \]/gm) || []).length;
	return { found: true, unchecked };
}

/**
 * lane に応じてチェックリスト対象 section を切替え検証する（job は全 lane で実行）。
 *
 * feature / hotfix lane: section 不在は warning（現行挙動を維持、AC4）。未チェックがあれば fail。
 * integration lane: 必須 section が **不在なら fail**（warning で素通りさせない、#2945 no-go）。
 *
 * @param {{
 *   body: string;
 *   labels: string[];
 *   lane: 'feature'|'integration'|'hotfix'|'dependabot';
 *   integrationSectionsOverride?: string;
 * }} input
 * @returns {ChecklistResult}
 */
export function checkMergeGateChecklist({ body, labels, lane, integrationSectionsOverride }) {
	const skip = shouldSkip({ labels });
	if (skip.skip) {
		return { ok: true, lane, targetSections: [], reason: `skip: ${skip.reason}` };
	}

	const isIntegration = lane === 'integration';
	const targetSections = isIntegration
		? resolveIntegrationSections(integrationSectionsOverride)
		: LIGHT_LANE_SECTIONS;

	const info = [];
	const warnings = [];
	const failures = [];
	const missingRequired = [];

	for (const section of targetSections) {
		const { found, unchecked } = countUnchecked(body, section);
		const label = section.replace('## ', '');
		if (!found) {
			if (isIntegration) {
				// integration lane: 必須 section 不在は fail（#2945 no-go: warning で素通りさせない）
				missingRequired.push(label);
			} else {
				warnings.push(
					`セクション「${label}」が PR 本文に見つかりません。PR テンプレートを使用しているか確認してください。`,
				);
			}
			continue;
		}
		if (unchecked > 0) {
			failures.push(`「${label}」に未チェック項目が ${unchecked} 件残っています。`);
		} else {
			info.push(`✅ ${label}: 全項目チェック済み`);
		}
	}

	if (missingRequired.length > 0) {
		return {
			ok: false,
			lane,
			targetSections,
			info,
			error:
				`❌ 統合 PR (lane=integration) に必須 section が ${missingRequired.length} 件ありません: ` +
				`${missingRequired.join(' / ')} (#2945 AC5)\n\n` +
				'統合 PR 用チェックリスト（最重厚レーン全 job 緑 / エビデンス表完備 / adversarial evidence 解消）を\n' +
				'記載してください。section 名は env `MERGE_GATE_INTEGRATION_SECTIONS` で差替可能です（Phase B #2871 で確定）。',
		};
	}

	if (failures.length > 0) {
		return {
			ok: false,
			lane,
			targetSections,
			info,
			warnings,
			error:
				`❌ ${failures.join('\n')}\n` +
				'すべてのチェックボックスを確認してから Ready for Review にしてください。',
		};
	}

	return {
		ok: true,
		lane,
		targetSections,
		info,
		warnings,
		reason: 'PR チェックリスト: 全必須項目チェック済み',
	};
}

// --- CLI（ローカル検証用）---

const isMain = (() => {
	try {
		return resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1] || '');
	} catch {
		return false;
	}
})();

if (isMain) {
	const argv = process.argv.slice(2);
	/** @type {Record<string, string>} */
	const opt = {};
	for (let i = 0; i < argv.length; i += 1) {
		const a = argv[i];
		if (a?.startsWith('--')) {
			const eq = a.indexOf('=');
			if (eq !== -1) opt[a.slice(2, eq)] = a.slice(eq + 1);
			else {
				opt[a.slice(2)] = argv[i + 1] ?? '';
				i += 1;
			}
		}
	}
	const body = opt.body ?? process.env.PR_BODY ?? '';
	const lane = /** @type {any} */ (opt.lane ?? process.env.PR_LANE ?? 'feature');
	const labels = (opt.labels ?? process.env.PR_LABELS_CSV ?? '')
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);
	const integrationSectionsOverride =
		opt['integration-sections'] ?? process.env.MERGE_GATE_INTEGRATION_SECTIONS;

	if (!body && !opt.lane && !process.env.PR_LANE) {
		console.error(
			'[check-merge-gate-checklist] Usage: node scripts/check-merge-gate-checklist.mjs --lane <lane> --body <body> [--labels a,b] [--integration-sections "## X,## Y"]',
		);
		process.exit(2);
	}

	const result = checkMergeGateChecklist({ body, labels, lane, integrationSectionsOverride });
	for (const w of result.warnings ?? []) console.warn(`⚠️ ${w}`);
	for (const line of result.info ?? []) console.log(line);
	if (result.ok) {
		console.log(`✅ ${result.reason ?? 'PASS'} (lane=${result.lane})`);
		process.exit(0);
	}
	console.error(result.error ?? '❌ FAIL');
	process.exit(1);
}

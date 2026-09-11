#!/usr/bin/env node
/**
 * scripts/check-cdk-replacement.mjs
 *
 * CDK diff の stdout を解析して Replacement / Destroy が必要なリソースを検出し、
 * 承認マーカーがない場合は exit 1 でデプロイを止める。
 *
 * Usage (deploy.yml から呼び出す):
 *   cdk diff ... 2>&1 | COMMIT_MSG="$(git log -1 --pretty=%B)" node scripts/check-cdk-replacement.mjs
 *
 * Approval (PR 本文またはコミットメッセージに記載):
 *   replacement-approved: LogicalId1,LogicalId2
 *
 * Ref: docs/decisions/0019-cdk-replacement-detection-gate.md (#1400)
 */

import * as readline from 'node:readline';
import { isMain as isMainModule } from './lib/is-main.mjs';

// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI エスケープコード検出に ESC 文字が必要
const ANSI_ESCAPE = /\x1b\[[0-9;]*[mGKHF]/g;

/**
 * CDK diff 出力行から ANSI エスケープコードを除去する
 * @param {string} str
 * @returns {string}
 */
export function stripAnsi(str) {
	return str.replace(ANSI_ESCAPE, '');
}

// 旧 `extractLogicalId` は削除した (#4623)。export されていたが呼び出し元が 1 つも無く
// (test すら import していなかった)、論理 ID の抽出は `parseDiff` 内の
// `resourceMatch[3]` が唯一の生きた経路である。同じ抽出を 2 通り持つと、行形式が変わった
// ときに片方だけ直す事故を作る。

/**
 * gate の検出対象から恒久的に外すリソース (#4904)。
 *
 * `s3deploy.BucketDeployment` は custom resource handler Lambda に `AwsCliLayer`
 * (`AWS::Lambda::LayerVersion`) を**無条件で**付ける。中身は `@aws-cdk/asset-awscli-v1`
 * が配る AWS CLI v1 の zip だけで、プロパティは `Content` と固定 `Description` の 2 つのみ。
 *
 * この置換は **真正**である (LayerVersion は全プロパティが CFN 上 Update requires:
 * Replacement) が、**失うものが無い**:
 *   - CFN は「新規作成 → 参照張替え → 旧削除」の順で行い、Lambda は削除済み layer version を
 *     参照する関数はそのまま動き続けると明記している
 *   - layer は handler の `Layers` からしか参照されず `Custom::CDKBucketDeployment` の
 *     Properties に含まれないため、配信済み S3 オブジェクトは触られない
 *
 * そして **回避できない**: `BucketDeploymentProps` に layer を差し替える prop は無く、
 * `AwsCliLayer` は `(scope, id)` しか取らない。CDK CLI にリソース除外機能も無い
 * (aws-cdk-cli#903 は open)。`cdk diff --method=change-set` でも消えない (既定 `auto` が
 * 既に change set を使っており、change set でも `Always` 判定になる)。
 *
 * 結果、`@aws-cdk/asset-awscli-v1` の pin が動くたびに `BucketDeployment` の数だけ
 * BLOCK が起き、そのたびに承認 commit を main に積む運用になっていた。承認は main HEAD の
 * 1 commit にしか紐づかないため、承認後に別 commit を積むと失効して再び止まる
 * (第22回統合 2026-09-11 で実際に 2 度止まった)。
 *
 * → **型と construct path の両方が一致するものだけ**を除外する。除外は握り潰しではなく
 *    main() が exempt として必ず出力する (silent skip を作らない)。
 *
 * 詳細と一次情報: docs/decisions/0019-cdk-replacement-detection-gate.md
 */
const EXEMPT_RULES = [
	{
		resourceType: 'AWS::Lambda::LayerVersion',
		idSuffix: '/AwsCliLayer',
		reason: 'CDK 生成の AWS CLI layer (資源を持たず回避不能、ADR-0019)',
	},
];

/**
 * 除外対象かどうか。**型と construct path の両方**が一致したときだけ true。
 *
 * @param {string} resourceType 例: 'AWS::Lambda::LayerVersion'
 * @param {string} id           CDK construct path 例: 'ErrorPagesDeploy/AwsCliLayer'
 * @returns {{ reason: string } | null}
 */
export function findExemption(resourceType, id) {
	for (const rule of EXEMPT_RULES) {
		if (resourceType === rule.resourceType && id.endsWith(rule.idSuffix)) {
			return { reason: rule.reason };
		}
	}
	return null;
}

/**
 * リソース行の末尾に付く impact 語 → reason。
 *
 * 実際の CLI 出力は括弧なしの ` replace` / ` destroy` / ` may be replaced`
 * (aws-cdk の `formatImpact` 実測)。旧実装は `(replace)` という**存在しない形**を
 * 探していたため、リソース行単独の検出が死んでいた (#4904)。
 *
 * `orphan` (stack から外れるが実体は残る) は破壊ではないので対象にしない。
 */
const RESOURCE_IMPACT = [
	{ pattern: /\sdestroy$/, reason: 'destroy' },
	{ pattern: /\smay be replaced$/, reason: 'may-be-replaced' },
	{ pattern: /\sreplace$/, reason: 'replace' },
];

/**
 * プロパティ行の注記 → reason。**実際の文言をそのまま reason にする**。
 *
 * 旧実装は `requires replacement` でも reason を `'may-cause-replacement'` に
 * ハードコードしていたため、真正な置換が「may = 悲観判定だろう」と誤読される事故を
 * 起こした (第22回統合で実際に起きた)。深刻度を軽く見せない (#4904)。
 */
const PROPERTY_IMPACT = [
	{ pattern: /\(requires replacement\)/i, reason: 'requires-replacement' },
	{ pattern: /\(may cause replacement\)/i, reason: 'may-cause-replacement' },
	{ pattern: /REPLACEMENT/, reason: 'requires-replacement' },
];

/**
 * CDK diff の stdout 行リストを解析する。
 *
 * @param {string[]} lines
 * @returns {{ replacements: Map<string, string>, exempted: Map<string, string> }}
 *   replacements: 承認が要る logicalId → reason / exempted: 除外した logicalId → 除外理由
 */
export function parseDiff(lines) {
	/** @type {Map<string, string>} */
	const replacements = new Map();
	/** @type {Map<string, string>} */
	const exempted = new Map();
	/** @type {string | null} */
	let currentResourceId = null;
	let currentExempt = false;

	for (const rawLine of lines) {
		const line = stripAnsi(rawLine).trimEnd();
		const trimmed = line.trim();

		if (!trimmed) {
			currentResourceId = null;
			currentExempt = false;
			continue;
		}

		// リソース行: [+|-|~] AWS::Type ConstructPath PhysicalId [impact]
		const resourceMatch = /^\[([+\-~])\]\s+(AWS::\S+)\s+(\S+)/.exec(trimmed);
		if (resourceMatch) {
			const marker = resourceMatch[1];
			const resourceType = resourceMatch[2];
			const logicalId = resourceMatch[3];

			currentResourceId = logicalId;
			const exemption = findExemption(resourceType, logicalId);
			currentExempt = exemption !== null;
			if (currentExempt && exemption) {
				exempted.set(logicalId, exemption.reason);
				continue;
			}

			if (marker === '-') {
				// [-] = リソース削除
				replacements.set(logicalId, 'destroy');
				continue;
			}
			if (marker === '~') {
				for (const { pattern, reason } of RESOURCE_IMPACT) {
					if (pattern.test(trimmed)) {
						replacements.set(logicalId, reason);
						break;
					}
				}
			}
			// [+] = 追加 (新規リソース。単独では Replacement 扱いしない)
			continue;
		}

		// プロパティ行の注記
		if (currentResourceId === null || currentExempt || replacements.has(currentResourceId)) {
			continue;
		}
		for (const { pattern, reason } of PROPERTY_IMPACT) {
			if (pattern.test(trimmed)) {
				replacements.set(currentResourceId, reason);
				break;
			}
		}
	}

	return { replacements, exempted };
}

/**
 * PR 本文またはコミットメッセージから承認済み論理 ID 一覧を抽出する
 *
 * 形式: replacement-approved: LogicalId1,LogicalId2
 *
 * @param {string} prBody
 * @param {string} commitMsg
 * @returns {Set<string>}
 */
export function parseApprovedIds(prBody = '', commitMsg = '') {
	const approved = new Set();

	for (const source of [prBody, commitMsg]) {
		const pattern = /replacement-approved:\s*([^\n\r]+)/gi;
		let match = pattern.exec(source);
		while (match !== null) {
			const ids = match[1]
				.split(/[,\s]+/)
				.map((s) => s.trim())
				.filter(Boolean);
			for (const id of ids) {
				approved.add(id);
			}
			match = pattern.exec(source);
		}
	}

	return approved;
}

/**
 * stdin から CDK diff 出力を読み込んで Replacement を検証するメイン処理
 */
async function main() {
	const rl = readline.createInterface({ input: process.stdin, terminal: false });
	const lines = [];
	for await (const line of rl) {
		lines.push(line);
	}

	const { replacements, exempted } = parseDiff(lines);

	// 除外は握り潰しではない。必ず見える形で出す (silent skip を作らない、#4904)。
	if (exempted.size > 0) {
		console.log(`
gate から除外したリソース (${exempted.size} 件、ADR-0019 §制約・注意事項):`);
		for (const [logicalId, reason] of exempted) {
			console.log(`  [exempt] ${logicalId} — ${reason}`);
		}
	}

	if (replacements.size === 0) {
		console.log('check-cdk-replacement: no replacements or destroys detected. OK.');
		process.exit(0);
	}

	const prBody = process.env.PR_BODY ?? '';
	const commitMsg = process.env.COMMIT_MSG ?? '';
	const approved = parseApprovedIds(prBody, commitMsg);

	const unapproved = [];
	console.log(`\nCDK Replacement / Destroy detected (${replacements.size} resource(s)):`);
	for (const [logicalId, reason] of replacements) {
		const isApproved = approved.has(logicalId);
		console.log(`  [${reason}] ${logicalId} — ${isApproved ? 'APPROVED' : 'NOT APPROVED'}`);
		if (!isApproved) {
			unapproved.push({ logicalId, reason });
		}
	}

	if (unapproved.length === 0) {
		console.log('\nAll replacements are approved. Proceeding with deploy.');
		process.exit(0);
	}

	console.error(`\nDEPLOY BLOCKED: ${unapproved.length} unapproved replacement(s) detected.`);
	console.error('Add the following line to the PR body (squash merge commit message) to approve:');
	console.error(`  replacement-approved: ${unapproved.map((u) => u.logicalId).join(',')}`);
	console.error('\nRef: docs/decisions/0019-cdk-replacement-detection-gate.md');
	process.exit(1);
}

// ESM: import.meta.url で直接実行を判定
if (isMainModule(import.meta.url)) {
	main().catch((err) => {
		console.error('check-cdk-replacement.mjs fatal error:', err.message);
		process.exit(1);
	});
}

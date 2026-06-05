/**
 * scripts/audit/evidence-schema.mjs (EPIC #2861 / B4 = #2867)
 *
 * 監査 run の structured JSON evidence (`tmp/audit-evidence/<run-id>.json`) を
 * 検証する pure function 群。`.claude/agents/audit-manager.md` §B の evidence schema
 * (最小 field) に **SARIF 2.1.0 互換 field (ruleId / level / partialFingerprints /
 * locations)** を加えたものを SSOT とする (EPIC 設計原則 4 — dedup 安定化)。
 *
 * 設計判断 (OSS 先調査 ADR-0014):
 *   SARIF 互換は「full SARIF report file を吐く」ことではなく「finding に dedup 用の
 *   少数 field を持たせる」ことが目的。`node-sarif-builder` は full report builder の
 *   ため本段では過剰。schema 整合のみを pure function で検証し、C/E phase で SARIF
 *   emitter を導入する際に `node-sarif-builder` 採用を再評価する (PR body に記録)。
 *
 * 本 module は副作用を持たない (I/O は run-pipeline.mjs / verify-audit-evidence.mjs 側)。
 * vitest unit test: tests/unit/audit/evidence-schema.test.ts
 *
 * 関連:
 *   - .claude/agents/audit-manager.md §B (evidence schema SSOT)
 *   - docs/sessions/audit-team.md §3.1 / §3.6 (チーム構成 / 棄却 flow)
 *   - scripts/verify-adversarial-output.mjs (verify CLI の既存パターン)
 */

/** evidence の `team` に許容される値 (audit-manager.md §B) */
export const VALID_TEAMS = Object.freeze([
	'competitive',
	'tech',
	'product',
	'usability-a11y',
	'security',
	'performance',
	'test-quality',
	'issue-draft',
	'policy-compliance',
	'audit-manager-cuj',
]);

/** SARIF 2.1.0 `level` に揃える finding level (severity とは別軸の表示用) */
export const VALID_SARIF_LEVELS = Object.freeze(['none', 'note', 'warning', 'error']);

/** 一次情報 URL を必須とする team (URL 欠落 finding は自動棄却、audit-manager.md §B / §D) */
export const URL_REQUIRED_TEAMS = Object.freeze(['competitive', 'audit-manager-cuj']);

const SEVERITY_MIN = 1;
const SEVERITY_MAX = 4;

/** @param {unknown} v */
function isNonEmptyString(v) {
	return typeof v === 'string' && v.trim().length > 0;
}

/**
 * location 文字列を dedup 用に正規化する。
 * - 前後空白除去 / 連続空白を 1 つに / Windows 区切り `\` を `/` に統一
 * - 末尾の行番号 `:123` や `:12:5` を除去 (同一箇所の行ズレを同一視するため)
 * - 小文字化 (path の大文字小文字差を吸収)
 *
 * 文字列一致でなく「ルール + 正規化位置」で重複を測るための前処理 (EPIC 設計原則 4)。
 * @param {any} location
 * @returns {string}
 */
export function normalizeLocation(location) {
	if (!isNonEmptyString(location)) return '';
	return location
		.trim()
		.replace(/\\/g, '/')
		.replace(/:\d+(:\d+)?\s*$/, '')
		.replace(/\s+/g, ' ')
		.toLowerCase();
}

/**
 * finding の dedup fingerprint を算出する。
 * SARIF partialFingerprints の思想を踏襲し「ruleId + 正規化 location」を結合する。
 * finding が `partialFingerprints.primary` を明示していればそれを優先採用する
 * (subagent 側が安定 fingerprint を持っている場合の尊重)。
 *
 * @param {any} finding 未検証の外部 JSON finding
 * @returns {string} 重複統合のキー
 */
export function computeFingerprint(finding) {
	if (
		finding &&
		typeof finding === 'object' &&
		finding.partialFingerprints &&
		typeof finding.partialFingerprints === 'object' &&
		isNonEmptyString(finding.partialFingerprints.primary)
	) {
		return finding.partialFingerprints.primary.trim().toLowerCase();
	}
	const ruleId = isNonEmptyString(finding?.ruleId) ? finding.ruleId.trim().toLowerCase() : '';
	const loc = normalizeLocation(finding?.location);
	return `${ruleId}::${loc}`;
}

/**
 * 1 件の finding を schema 検証する。
 * @param {any} finding 未検証の外部 JSON finding
 * @param {string} team 親 evidence の team (URL 必須判定に使う)
 * @returns {string[]} 違反メッセージ配列 (空 = 適合)
 */
export function validateFinding(finding, team) {
	const errors = [];
	if (finding === null || typeof finding !== 'object' || Array.isArray(finding)) {
		return ['finding はオブジェクトである必要があります'];
	}

	// --- 最小 field (audit-manager.md §B) ---
	if (!isNonEmptyString(finding.id)) errors.push('id が必須 (重複統合のキー)');
	if (!isNonEmptyString(finding.title)) errors.push('title が必須');
	if (!isNonEmptyString(finding.location)) errors.push('location が必須');
	if (!isNonEmptyString(finding.detail)) errors.push('detail が必須');

	if (
		!Number.isInteger(finding.severity) ||
		finding.severity < SEVERITY_MIN ||
		finding.severity > SEVERITY_MAX
	) {
		errors.push(
			`severity は ${SEVERITY_MIN}-${SEVERITY_MAX} の整数 (受領: ${JSON.stringify(finding.severity)})`,
		);
	}

	if (typeof finding.policy_candidate !== 'boolean') {
		errors.push('policy_candidate は boolean が必須');
	}

	// --- SARIF 2.1.0 互換 field (EPIC 設計原則 4) ---
	if (!isNonEmptyString(finding.ruleId)) {
		errors.push('ruleId が必須 (SARIF 互換 — dedup 安定化)');
	}
	if (!VALID_SARIF_LEVELS.includes(finding.level)) {
		errors.push(`level は ${VALID_SARIF_LEVELS.join(' / ')} のいずれか (SARIF 互換)`);
	}
	if (finding.partialFingerprints !== undefined) {
		if (
			finding.partialFingerprints === null ||
			typeof finding.partialFingerprints !== 'object' ||
			Array.isArray(finding.partialFingerprints)
		) {
			errors.push('partialFingerprints は object (省略可、指定時は { primary: string } 形式)');
		} else if (
			finding.partialFingerprints.primary !== undefined &&
			!isNonEmptyString(finding.partialFingerprints.primary)
		) {
			errors.push('partialFingerprints.primary は非空文字列');
		}
	}
	if (!Array.isArray(finding.locations) || finding.locations.length === 0) {
		errors.push('locations は 1 件以上の配列 (SARIF 互換 — physical location)');
	}

	// --- 一次情報 URL (competitive / cuj は必須) ---
	const urls = finding.evidence_urls;
	if (urls !== undefined && !Array.isArray(urls)) {
		errors.push('evidence_urls は配列');
	}
	if (URL_REQUIRED_TEAMS.includes(team)) {
		if (!Array.isArray(urls) || urls.filter(isNonEmptyString).length === 0) {
			errors.push(
				`team=${team} は evidence_urls に一次情報 URL が 1 件以上必須 (URL 欠落は自動棄却)`,
			);
		}
	}

	return errors;
}

/**
 * evidence file 全体 (1 領域分) を schema 検証する。
 * @param {any} evidence parse 済みの未検証 JSON
 * @returns {{ ok: boolean, errors: string[], findingCount: number }}
 */
export function validateEvidence(evidence) {
	const errors = [];
	if (evidence === null || typeof evidence !== 'object' || Array.isArray(evidence)) {
		return {
			ok: false,
			errors: ['evidence は JSON オブジェクトである必要があります'],
			findingCount: 0,
		};
	}

	if (!isNonEmptyString(evidence.run_id)) errors.push('run_id が必須');
	if (!Number.isInteger(evidence.integration_pr) || evidence.integration_pr < 0) {
		errors.push('integration_pr は 0 以上の整数 (baseline run は 0 可)');
	}
	if (!VALID_TEAMS.includes(evidence.team)) {
		errors.push(
			`team は許容値のいずれか: ${VALID_TEAMS.join(' / ')} (受領: ${JSON.stringify(evidence.team)})`,
		);
	}

	const findings = evidence.findings;
	if (!Array.isArray(findings)) {
		errors.push('findings は配列が必須');
		return { ok: errors.length === 0, errors, findingCount: 0 };
	}

	findings.forEach((f, i) => {
		for (const e of validateFinding(f, evidence.team)) {
			errors.push(`findings[${i}] (${f?.id ?? 'no-id'}): ${e}`);
		}
	});

	return { ok: errors.length === 0, errors, findingCount: findings.length };
}

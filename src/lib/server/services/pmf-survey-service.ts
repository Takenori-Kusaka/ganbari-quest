// src/lib/server/services/pmf-survey-service.ts
// #1598 (ADR-0023 §3.6 §5 I7): PMF 判定アンケート (Sean Ellis Test)。
//
// 半年に 1 度 (年 2 回) 親宛に配信し、PMF 達成度を測定する。
// 「とても残念」が 40% を超えれば PMF 達成と判定する (Sean Ellis Score, ADR-0023 §3.6)。
//
// 配信制約 (Anti-engagement / ADR-0012):
//   - 親オーナー (role='owner') の email にのみ送信
//   - #1601 lifecycle-emails と共有の年 6 回上限カウンタを消費
//   - List-Unsubscribe ヘッダ必須 (RFC 8058 / 特定電子メール法)
//   - 契約 14 日超のテナントのみ対象
//   - 同一 round 内で重複送信しない
//
// データ保存:
//   - 送信履歴: settings KV (`pmf_survey_sent_<round>` → ISO timestamp)
//   - 回答: settings KV (`pmf_survey_response_<round>` → JSON)
//
// ops 集計 (ops/pmf-survey/+page.server.ts) はテナント全件走査で取得。
// Pre-PMF 規模 (~100 テナント) では DynamoDB Scan でも問題ない。

import type { PmfSurveyQ1, PmfSurveyQ3 } from '$lib/domain/labels';
import { getEnv } from '$lib/runtime/env';
import { getRepos } from '$lib/server/db/factory';
import { logger } from '$lib/server/logger';
import { sendPmfSurveyEmail } from './email-service';
import { canSendMarketingEmail, incrementMarketingEmailCount } from './marketing-email-counter';
import { generateSurveyToken } from './survey-token';

// ============================================================
// 定数
// ============================================================

const MS_PER_DAY = 86_400_000;

/** 契約からこの日数以上経過したテナントのみ送信対象 (ADR-0023 §5 I7)。 */
export const PMF_SURVEY_MIN_TENURE_DAYS = 14;

/** 送信履歴の settings KV キー prefix。round (YYYY-H1/YYYY-H2) を suffix にする。 */
const SENT_KEY_PREFIX = 'pmf_survey_sent_';

/** 回答の settings KV キー prefix。 */
const RESPONSE_KEY_PREFIX = 'pmf_survey_response_';

/** Sean Ellis 達成判定の閾値 (ADR-0023 §3.6: 「Very disappointed」40% 超)。 */
export const PMF_THRESHOLD = 0.4;

// ============================================================
// 型
// ============================================================

export interface PmfSurveyResponse {
	tenantId: string;
	round: string;
	q1: PmfSurveyQ1;
	q2: string;
	q3: PmfSurveyQ3;
	q4: string;
	answeredAt: string;
}

export interface PmfSurveyAggregation {
	round: string;
	totalResponses: number;
	q1Counts: Record<PmfSurveyQ1, number>;
	q1Percentages: Record<PmfSurveyQ1, number>;
	seanEllisScore: number; // 'very' の比率 (N/A 除外後)
	pmfAchieved: boolean;
	q3Counts: Record<PmfSurveyQ3, number>;
	q2Texts: Array<{ tenantId: string; text: string; answeredAt: string }>;
	q4Texts: Array<{ tenantId: string; text: string; answeredAt: string }>;
}

export interface PmfSurveyRunOptions {
	now?: Date;
	dryRun?: boolean;
	/** 強制的に round を指定 (テスト用)。未指定なら getCurrentRound(now)。 */
	round?: string;
}

export interface PmfSurveyRunResult {
	round: string;
	scanned: number;
	sent: number;
	skippedTenure: number;
	skippedAlreadySent: number;
	skippedRateLimit: number;
	skippedNoOwner: number;
	errors: number;
	dryRun: boolean;
}

// ============================================================
// Helpers
// ============================================================

/**
 * 現在の round を YYYY-H1 / YYYY-H2 形式で返す。
 *
 * - 1〜6 月: H1
 * - 7〜12 月: H2
 *
 * 配信タイミングは EventBridge cron (6/1 09:00 JST + 12/1 09:00 JST) で制御するが、
 * 手動 invoke 時の round 推定もこの関数を SSOT とする。
 */
export function getCurrentRound(now: Date = new Date()): string {
	const year = now.getFullYear();
	const month = now.getMonth() + 1; // 1-12
	const half = month <= 6 ? 'H1' : 'H2';
	return `${year}-${half}`;
}

/** 契約からの経過日数を返す (createdAt を起点)。 */
export function daysSinceCreated(createdAt: string, now: Date): number {
	const diffMs = now.getTime() - new Date(createdAt).getTime();
	return Math.floor(diffMs / MS_PER_DAY);
}

/** survey の URL を組み立てる。 */
function buildSurveyUrl(tenantId: string, round: string): string {
	const env = getEnv();
	const baseUrl = env.APP_BASE_URL ?? 'https://ganbari-quest.com';
	const token = generateSurveyToken({ tenantId, round });
	return `${baseUrl}/survey/sean-ellis/${token}`;
}

// ============================================================
// Public API — 配信 (cron)
// ============================================================

/** 全テナントを走査して PMF 判定アンケートメールを送信する。 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: cron スキャン処理は分岐が多いが線形。
export async function runPmfSurveyDistribution(
	options: PmfSurveyRunOptions = {},
): Promise<PmfSurveyRunResult> {
	const now = options.now ?? new Date();
	const dryRun = options.dryRun ?? false;
	const round = options.round ?? getCurrentRound(now);

	const result: PmfSurveyRunResult = {
		round,
		scanned: 0,
		sent: 0,
		skippedTenure: 0,
		skippedAlreadySent: 0,
		skippedRateLimit: 0,
		skippedNoOwner: 0,
		errors: 0,
		dryRun,
	};

	const repos = getRepos();
	const tenants = await repos.auth.listAllTenants();
	const sentKey = `${SENT_KEY_PREFIX}${round}`;

	for (const tenant of tenants) {
		result.scanned++;
		try {
			// 1) 契約 14 日経過判定
			const tenure = daysSinceCreated(tenant.createdAt, now);
			if (tenure < PMF_SURVEY_MIN_TENURE_DAYS) {
				result.skippedTenure++;
				continue;
			}

			// 2) 同一 round 内重複送信ガード
			const sentAt = await repos.settings.getSetting(sentKey, tenant.tenantId);
			if (sentAt) {
				result.skippedAlreadySent++;
				continue;
			}

			// 3) オーナー email 取得
			const members = await repos.auth.findTenantMembers(tenant.tenantId);
			const owner = members.find((m) => m.role === 'owner');
			if (!owner) {
				result.skippedNoOwner++;
				continue;
			}
			const user = await repos.auth.findUserById(owner.userId);
			if (!user?.email) {
				result.skippedNoOwner++;
				continue;
			}

			// 4) 年 6 回上限チェック (lifecycle-emails と共有)
			const canSend = await canSendMarketingEmail(tenant.tenantId);
			if (!canSend) {
				result.skippedRateLimit++;
				continue;
			}

			if (dryRun) {
				logger.info('[pmf-survey] dryRun would send', {
					context: { tenantId: tenant.tenantId, round, tenure },
				});
				result.sent++;
				continue;
			}

			// 5) 送信実行
			const surveyUrl = buildSurveyUrl(tenant.tenantId, round);
			const ok = await sendPmfSurveyEmail({
				email: user.email,
				tenantId: tenant.tenantId,
				ownerName: user.displayName || tenant.name,
				round,
				surveyUrl,
			});
			if (!ok) {
				result.errors++;
				continue;
			}

			await incrementMarketingEmailCount(tenant.tenantId);
			await repos.settings.setSetting(sentKey, now.toISOString(), tenant.tenantId);
			result.sent++;
		} catch (err) {
			logger.error('[pmf-survey] tenant processing failed', {
				context: {
					tenantId: tenant.tenantId,
					error: err instanceof Error ? err.message : String(err),
				},
			});
			result.errors++;
		}
	}

	return result;
}

// ============================================================
// Public API — 回答保存 / 重複チェック
// ============================================================

/** 既に同じ round に回答済みか確認。 */
export async function hasAnsweredSurvey(tenantId: string, round: string): Promise<boolean> {
	const repos = getRepos();
	const key = `${RESPONSE_KEY_PREFIX}${round}`;
	const value = await repos.settings.getSetting(key, tenantId);
	return !!value;
}

/** 回答を保存する。1 (tenantId × round) につき 1 回限り。 */
export async function saveSurveyResponse(response: PmfSurveyResponse): Promise<void> {
	const repos = getRepos();
	const key = `${RESPONSE_KEY_PREFIX}${response.round}`;
	await repos.settings.setSetting(key, JSON.stringify(response), response.tenantId);
}

// ============================================================
// Public API — ops 集計
// ============================================================

interface AggregationAccumulator {
	q1Counts: Record<PmfSurveyQ1, number>;
	q3Counts: Record<PmfSurveyQ3, number>;
	q2Texts: PmfSurveyAggregation['q2Texts'];
	q4Texts: PmfSurveyAggregation['q4Texts'];
}

function createAccumulator(): AggregationAccumulator {
	return {
		q1Counts: { very: 0, somewhat: 0, not: 0, na: 0 },
		q3Counts: { lp: 0, media: 0, friend: 0, google: 0, sns: 0, other: 0 },
		q2Texts: [],
		q4Texts: [],
	};
}

/** 1 件の回答 raw を accumulator に加算する。 */
function applyResponse(acc: AggregationAccumulator, parsed: PmfSurveyResponse): void {
	if (parsed.q1 in acc.q1Counts) acc.q1Counts[parsed.q1]++;
	if (parsed.q3 in acc.q3Counts) acc.q3Counts[parsed.q3]++;
	if (parsed.q2?.trim()) {
		acc.q2Texts.push({
			tenantId: parsed.tenantId,
			text: parsed.q2,
			answeredAt: parsed.answeredAt,
		});
	}
	if (parsed.q4?.trim()) {
		acc.q4Texts.push({
			tenantId: parsed.tenantId,
			text: parsed.q4,
			answeredAt: parsed.answeredAt,
		});
	}
}

function buildAggregation(round: string, acc: AggregationAccumulator): PmfSurveyAggregation {
	const { q1Counts, q3Counts, q2Texts, q4Texts } = acc;
	const totalResponses = q1Counts.very + q1Counts.somewhat + q1Counts.not + q1Counts.na;
	const totalNonNa = q1Counts.very + q1Counts.somewhat + q1Counts.not;

	const q1Percentages: Record<PmfSurveyQ1, number> = {
		very: totalResponses > 0 ? q1Counts.very / totalResponses : 0,
		somewhat: totalResponses > 0 ? q1Counts.somewhat / totalResponses : 0,
		not: totalResponses > 0 ? q1Counts.not / totalResponses : 0,
		na: totalResponses > 0 ? q1Counts.na / totalResponses : 0,
	};

	// Sean Ellis Score は N/A を除外した母数 (Sean Ellis 本人の定義に従う)。
	const seanEllisScore = totalNonNa > 0 ? q1Counts.very / totalNonNa : 0;
	const pmfAchieved = seanEllisScore >= PMF_THRESHOLD && totalNonNa >= 1;

	return {
		round,
		totalResponses,
		q1Counts,
		q1Percentages,
		seanEllisScore,
		pmfAchieved,
		q3Counts,
		q2Texts,
		q4Texts,
	};
}

/**
 * 自由記述リスト (Q2 / Q4) を query 文字列で絞り込む。
 *
 * - 大文字小文字を区別しない部分一致 (substring match)
 * - 空文字 / 空白のみ → 元のリストをそのまま返す
 * - text / tenantId 両方を検索対象 (ops が tenantId 先頭 8 文字で当たりをつけられるようにする)
 *
 * AC12 (Issue #1598, PO 承認 2026-04-29): Q2-Q4 自由記述の検索機能。
 */
export function filterFreeTextByQuery<
	T extends { tenantId: string; text: string; answeredAt: string },
>(items: T[], query: string): T[] {
	const trimmed = query.trim();
	if (trimmed.length === 0) return items;
	const needle = trimmed.toLowerCase();
	return items.filter((item) => {
		if (item.text.toLowerCase().includes(needle)) return true;
		if (item.tenantId.toLowerCase().includes(needle)) return true;
		return false;
	});
}

/**
 * 指定 round の集計結果を返す。
 *
 * Pre-PMF 規模 (~100 テナント) では全件 Scan でも数百ms。
 * 規模拡大時は GSI で round 横断検索を作る (TODO: post-PMF)。
 */
export async function aggregateSurveyResponses(round: string): Promise<PmfSurveyAggregation> {
	const repos = getRepos();
	const key = `${RESPONSE_KEY_PREFIX}${round}`;
	const tenants = await repos.auth.listAllTenants();
	const acc = createAccumulator();

	for (const tenant of tenants) {
		const raw = await repos.settings.getSetting(key, tenant.tenantId);
		if (!raw) continue;
		try {
			const parsed = JSON.parse(raw) as PmfSurveyResponse;
			applyResponse(acc, parsed);
		} catch (err) {
			logger.warn('[pmf-survey] invalid response JSON', {
				context: {
					tenantId: tenant.tenantId,
					round,
					error: err instanceof Error ? err.message : String(err),
				},
			});
		}
	}

	return buildAggregation(round, acc);
}

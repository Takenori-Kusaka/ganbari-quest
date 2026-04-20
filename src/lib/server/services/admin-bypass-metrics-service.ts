// src/lib/server/services/admin-bypass-metrics-service.ts
// #1201 / ADR-0044: admin bypass merge の月次メトリクス集計サービス。
//
// GitHub REST API から直近 N ヶ月の merged PR を取得し、reviewDecision が空の
// admin bypass merge を月次で集計する。GH_TOKEN が未設定 / API 失敗時は
// 空データを返す（dashboard 側で "データ取得できず" と表示する前提）。

import { env } from '$env/dynamic/private';
import { MS_PER_DAY } from '$lib/domain/constants/time';
import { logger } from '$lib/server/logger';

const REPO = 'Takenori-Kusaka/ganbari-quest';
const GITHUB_API = 'https://api.github.com';

export interface MonthlyAdminBypassMetric {
	month: string; // YYYY-MM
	mergedCount: number;
	adminBypassCount: number;
	evidenceMissingCount: number;
}

export interface AdminBypassMetricsReport {
	fetchedAt: string;
	lookbackMonths: number;
	available: boolean;
	reason?: string;
	monthly: MonthlyAdminBypassMetric[];
	totalAdminBypass: number;
	totalEvidenceMissing: number;
}

const EVIDENCE_MARKERS = [/^##\s*Self-Review 証跡/m, /^##\s*Self-Review\s*\(admin bypass\)/m];
const CACHE_TTL_MS = MS_PER_DAY;
let _cache: { at: number; data: AdminBypassMetricsReport } | null = null;

function getToken(): string | undefined {
	return env.GITHUB_TOKEN || env.GH_TOKEN;
}

interface GitHubPr {
	number: number;
	title: string;
	merged_at: string | null;
	user: { login: string } | null;
	body: string | null;
	labels: Array<{ name: string }>;
}

interface GitHubPrDetail extends GitHubPr {
	review_decision?: string | null; // GraphQL only, not REST
}

function monthKey(iso: string): string {
	return iso.slice(0, 7); // YYYY-MM
}

function hasEvidence(body: string | null): boolean {
	if (!body) return false;
	return EVIDENCE_MARKERS.some((re) => re.test(body));
}

async function ghFetch(path: string, token: string): Promise<Response> {
	return fetch(`${GITHUB_API}${path}`, {
		headers: {
			Authorization: `Bearer ${token}`,
			Accept: 'application/vnd.github+json',
			'X-GitHub-Api-Version': '2022-11-28',
			'User-Agent': 'ganbari-quest-ops-dashboard',
		},
	});
}

async function fetchReviewDecision(prNumber: number, token: string): Promise<string | null> {
	// GraphQL is needed for review_decision; use REST reviews endpoint as proxy:
	// - If there's any APPROVED review → not admin bypass
	// - If none → admin bypass
	try {
		const res = await ghFetch(`/repos/${REPO}/pulls/${prNumber}/reviews?per_page=100`, token);
		if (!res.ok) return null;
		const reviews = (await res.json()) as Array<{ state: string }>;
		const approved = reviews.some((r) => r.state === 'APPROVED');
		return approved ? 'APPROVED' : '';
	} catch {
		return null;
	}
}

export async function getAdminBypassMetrics(lookbackMonths = 3): Promise<AdminBypassMetricsReport> {
	if (
		_cache &&
		Date.now() - _cache.at < CACHE_TTL_MS &&
		_cache.data.lookbackMonths === lookbackMonths
	) {
		return _cache.data;
	}

	const token = getToken();
	if (!token) {
		return buildEmpty(lookbackMonths, 'GITHUB_TOKEN 未設定');
	}

	const since = new Date(Date.now() - lookbackMonths * 31 * MS_PER_DAY);
	const sinceIso = since.toISOString();

	try {
		// Fetch recent merged PRs (single page — Pre-PMF で月次頻度は十分低い)
		const listRes = await ghFetch(
			`/repos/${REPO}/pulls?state=closed&sort=updated&direction=desc&per_page=100`,
			token,
		);
		if (!listRes.ok) {
			return buildEmpty(lookbackMonths, `GitHub API ${listRes.status}`);
		}
		const prs = (await listRes.json()) as GitHubPrDetail[];
		const mergedInRange = prs.filter((pr) => pr.merged_at && pr.merged_at >= sinceIso);

		const monthBuckets = new Map<string, MonthlyAdminBypassMetric>();
		let totalBypass = 0;
		let totalMissing = 0;

		for (const pr of mergedInRange) {
			const m = monthKey(pr.merged_at || '');
			if (!monthBuckets.has(m)) {
				monthBuckets.set(m, {
					month: m,
					mergedCount: 0,
					adminBypassCount: 0,
					evidenceMissingCount: 0,
				});
			}
			const bucket = monthBuckets.get(m) as MonthlyAdminBypassMetric;
			bucket.mergedCount++;

			const decision = await fetchReviewDecision(pr.number, token);
			if (decision === '') {
				bucket.adminBypassCount++;
				totalBypass++;
				if (!hasEvidence(pr.body)) {
					bucket.evidenceMissingCount++;
					totalMissing++;
				}
			}
		}

		const monthly = [...monthBuckets.values()].sort((a, b) => a.month.localeCompare(b.month));

		const report: AdminBypassMetricsReport = {
			fetchedAt: new Date().toISOString(),
			lookbackMonths,
			available: true,
			monthly,
			totalAdminBypass: totalBypass,
			totalEvidenceMissing: totalMissing,
		};

		_cache = { at: Date.now(), data: report };
		return report;
	} catch (e) {
		logger.error('[admin-bypass-metrics] Failed to fetch', {
			context: { error: e instanceof Error ? e.message : String(e) },
		});
		return buildEmpty(lookbackMonths, 'GitHub API エラー');
	}
}

function buildEmpty(lookbackMonths: number, reason: string): AdminBypassMetricsReport {
	return {
		fetchedAt: new Date().toISOString(),
		lookbackMonths,
		available: false,
		reason,
		monthly: [],
		totalAdminBypass: 0,
		totalEvidenceMissing: 0,
	};
}

// src/lib/server/services/challenge-set-import-service.ts
// challenge-set 一括インポートサービス (#2369 / EPIC #2362 P3 / EPIC #2294 ③)
//
// challenge-set type は本 Issue で新規実装。activity-pack / event-checklist / reward-set /
// rule-preset 4 type と同等の preview / import 関数を提供する。
//
// 設計上の差異 (他 4 type との対比):
//   - `sibling_challenges` テーブルに `source_preset_id` column が存在しないため、
//     重複検知は **同一 title** で行う (#2369 Issue 制約: schema 拡張禁止)
//   - `monthDay` (MM-DD) → 当該年実日付に展開するロジックを本 service 内に集約
//     (旧 `+page.server.ts` の `_expandChallengeSetDates` を内部 helper として吸収)
//   - 全 challenge を `createSiblingChallenge` 経由で挿入することで全子供を自動エンロール
//
// 関連:
//   - ADR-0052 (MarketplaceTypeRegistry + ImportStrategy)
//   - $lib/marketplace/strategies/challenge-set-strategy (本 service を内部 callee として参照)
//   - EPIC #2294 案 B-γ (日本ローカライズ wedge): 日本年間行事パック配信経路
//   - $lib/server/services/sibling-challenge-service (createSiblingChallenge 既存実装)

import type { ChallengeSetPayload } from '$lib/domain/marketplace-item';
import { findAllChallenges } from '$lib/server/db/sibling-challenge-repo';
import { logger } from '$lib/server/logger';
import { createSiblingChallenge } from '$lib/server/services/sibling-challenge-service';

/**
 * monthDay (MM-DD) と durationDays を当該年の実日付に展開する。
 *
 * monthDay が「今日より過去」なら来年の同月日とする
 * (例: 2026/05/19 時点で「03-03 ひな祭り」を import すると 2027/03/03 になる)。
 *
 * @param monthDay 'MM-DD' 形式 (例: '03-03')
 * @param durationDays 期間 (日数)。startDate = endDate の (durationDays - 1) 日前
 * @param today 現在日時 (テスト時に注入可)
 * @returns { startDate, endDate } いずれも 'YYYY-MM-DD' 形式
 * @throws Error monthDay が MM-DD 形式でない場合
 *
 * @internal export は unit test 用
 */
export function expandChallengeSetDates(
	monthDay: string,
	durationDays: number,
	today: Date = new Date(),
): { startDate: string; endDate: string } {
	const [mm, dd] = monthDay.split('-').map(Number);
	if (!mm || !dd) {
		throw new Error(`Invalid monthDay format: ${monthDay} (expected MM-DD)`);
	}
	const year = today.getFullYear();
	let endDate = new Date(Date.UTC(year, mm - 1, dd));
	const todayUTC = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
	if (endDate.getTime() < todayUTC.getTime()) {
		endDate = new Date(Date.UTC(year + 1, mm - 1, dd));
	}
	const startDate = new Date(endDate.getTime());
	startDate.setUTCDate(startDate.getUTCDate() - durationDays + 1);
	const fmt = (d: Date) => d.toISOString().slice(0, 10);
	return { startDate: fmt(startDate), endDate: fmt(endDate) };
}

export interface ChallengeSetImportPreview {
	total: number;
	newChallenges: number;
	duplicates: number;
	duplicateNames: string[];
	byCategory: Record<string, number>;
}

export interface ChallengeSetImportResult {
	imported: number;
	skipped: number;
	errors: string[];
}

/** カテゴリ ID → コード (preview 集計表示用) */
const CATEGORY_ID_TO_CODE: Record<number, string> = {
	1: 'undou',
	2: 'benkyou',
	3: 'seikatsu',
	4: 'kouryuu',
	5: 'souzou',
};

/**
 * インポート対象の challenge-set をプレビュー (DB write 禁止)
 *
 * 重複判定: 同一テナント内に**同一 title** の sibling_challenges が既に存在する場合は
 * 「重複」としてカウント。
 */
export async function previewChallengeSetImport(
	challenges: ChallengeSetPayload['challenges'],
	tenantId: string,
): Promise<ChallengeSetImportPreview> {
	const existing = await findAllChallenges(tenantId);
	const existingTitles = new Set(existing.map((c) => c.title));

	const duplicateNames: string[] = [];
	const byCategory: Record<string, number> = {};
	let newCount = 0;

	for (const ch of challenges) {
		const catCode = CATEGORY_ID_TO_CODE[ch.categoryId] ?? `category_${ch.categoryId}`;
		byCategory[catCode] = (byCategory[catCode] ?? 0) + 1;

		if (existingTitles.has(ch.title)) {
			duplicateNames.push(ch.title);
		} else {
			newCount++;
		}
	}

	return {
		total: challenges.length,
		newChallenges: newCount,
		duplicates: duplicateNames.length,
		duplicateNames,
		byCategory,
	};
}

/**
 * challenge-set をインポート (merge モード: 同一 title は skip)
 *
 * 各 challenge は `monthDay` + `durationDays` から当該年の実日付に展開し、
 * `createSiblingChallenge` 経由で挿入することで全子供を自動エンロールする。
 *
 * @param challenges インポート対象の challenge 配列 (marketplace challenge-set の payload.challenges)
 * @param tenantId   テナント ID
 * @param options    presetId (audit log 用)、today (テスト時に注入)
 */
export interface ImportChallengeSetOptions {
	presetId?: string;
	/** 日付展開の基準日。テスト時に固定値を注入する */
	today?: Date;
}

export async function importChallengeSet(
	challenges: ChallengeSetPayload['challenges'],
	tenantId: string,
	options: ImportChallengeSetOptions = {},
): Promise<ChallengeSetImportResult> {
	const presetId = options.presetId;
	const today = options.today ?? new Date();

	const existing = await findAllChallenges(tenantId);
	const existingTitles = new Set(existing.map((c) => c.title));
	const errors: string[] = [];
	let imported = 0;
	let skipped = 0;

	for (const ch of challenges) {
		if (existingTitles.has(ch.title)) {
			skipped++;
			continue;
		}

		try {
			const { startDate, endDate } = expandChallengeSetDates(ch.monthDay, ch.durationDays, today);
			const targetConfig = JSON.stringify({
				metric: 'count',
				baseTarget: ch.baseTarget,
				categoryId: ch.categoryId,
			});
			const rewardConfig = JSON.stringify({ points: ch.rewardPoints });

			await createSiblingChallenge(
				{
					title: ch.title,
					description: ch.description,
					// #2296 (EPIC #2294 ②): cooperative 固定 (Research §3.2)
					challengeType: 'cooperative',
					periodType: 'custom',
					startDate,
					endDate,
					targetConfig,
					rewardConfig,
				},
				tenantId,
			);
			imported++;
			existingTitles.add(ch.title);
		} catch (e) {
			errors.push(`「${ch.title}」: ${e instanceof Error ? e.message : String(e)}`);
		}
	}

	logger.info('[challenge-set-import] インポート完了', {
		context: {
			tenantId,
			imported,
			skipped,
			errors: errors.length,
			presetId: presetId ?? null,
		},
	});

	return { imported, skipped, errors };
}

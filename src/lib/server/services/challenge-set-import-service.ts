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

import { toJSTDateString } from '$lib/domain/date-utils';
import type { ChallengeSetPayload } from '$lib/domain/marketplace-item';
import { findAllChallenges } from '$lib/server/db/sibling-challenge-repo';
import { logger } from '$lib/server/logger';
import {
	buildPerChildTargets,
	createChildChallengesBulk,
} from '$lib/server/services/child-challenge-service';
import { createSiblingChallenge } from '$lib/server/services/sibling-challenge-service';

/**
 * monthDay (MM-DD) と durationDays を当該年の実日付に展開する。
 *
 * monthDay が「今日より過去」なら来年の同月日とする
 * (例: 2026/05/19 時点で「03-03 ひな祭り」を import すると 2027/03/03 になる)。
 *
 * 日付計算は **JST 基準で統一** する (#966 / date-utils.ts SSOT)。
 * Lambda は UTC で稼働するため、`Date.getFullYear()` / `Date.getMonth()` /
 * `Date.toISOString()` をそのまま使うと、0:00〜9:00 JST (= 15:00〜24:00 UTC 前日)
 * の境界で年判定がずれる。例: 2025-12-31 23:30 UTC = 2026-01-01 08:30 JST のとき、
 * UTC 基準の `getFullYear()` は 2025 を返してしまう。toJSTDateString() 経由で
 * JST の YYYY-MM-DD 文字列を取得し、そこから年を抽出することで境界を正しく扱う。
 *
 * @param monthDay 'MM-DD' 形式 (例: '03-03')
 * @param durationDays 期間 (日数)。startDate = endDate の (durationDays - 1) 日前
 * @param today 現在日時 (テスト時に注入可)
 * @returns { startDate, endDate } いずれも 'YYYY-MM-DD' 形式 (JST 基準)
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
	// JST 基準の今日 (YYYY-MM-DD) から年を抽出 (Lambda UTC 環境の境界バグ回避、#966)
	const todayJST = toJSTDateString(today);
	const [todayYearStr, todayMonthStr, todayDayStr] = todayJST.split('-');
	const todayYear = Number(todayYearStr);
	const todayMonth = Number(todayMonthStr);
	const todayDay = Number(todayDayStr);

	// monthDay の MM-DD が JST 今日より過去なら来年、それ以外は今年に展開
	const isPast = mm < todayMonth || (mm === todayMonth && dd < todayDay);
	const targetYear = isPast ? todayYear + 1 : todayYear;

	// endDate / startDate は UTC で計算 (年月日のみの算術なので tz の影響を受けない) して
	// toJSTDateString() で JST 文字列化する。Date.UTC(targetYear, mm-1, dd) は
	// UTC の 00:00:00 を意味し、JST だと同日の 09:00:00 になるため日付ロールバック懸念なし。
	const endDateObj = new Date(Date.UTC(targetYear, mm - 1, dd));
	const startDateObj = new Date(endDateObj.getTime());
	startDateObj.setUTCDate(startDateObj.getUTCDate() - durationDays + 1);

	return {
		startDate: toJSTDateString(startDateObj),
		endDate: toJSTDateString(endDateObj),
	};
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
	/**
	 * #2362 PR-7 (User §6): per-child instance 配信先 child ID 配列。
	 * 指定時は `createChildChallengesBulk` (per-child instance) 経由で挿入し
	 * sourceTemplateId に `challenge-set:<presetId>:<title>` を付与する。
	 * 未指定時は legacy 互換で `createSiblingChallenge` (family-wide) を呼ぶ。
	 */
	childIds?: readonly number[];
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: per-child / legacy 2 path 分岐 + try-catch + ループで複雑度 23、path 分岐は 1 関数内が SSOT として明示的
export async function importChallengeSet(
	challenges: ChallengeSetPayload['challenges'],
	tenantId: string,
	options: ImportChallengeSetOptions = {},
): Promise<ChallengeSetImportResult> {
	const presetId = options.presetId;
	const today = options.today ?? new Date();
	const childIds = options.childIds;

	// per-child path: childIds 指定時は新 per-child instance service 経由
	if (childIds && childIds.length > 0) {
		const errors: string[] = [];
		let imported = 0;
		const skipped = 0;
		for (const ch of challenges) {
			try {
				const { startDate, endDate } = expandChallengeSetDates(ch.monthDay, ch.durationDays, today);
				const targetConfig = JSON.stringify({
					metric: 'count',
					baseTarget: ch.baseTarget,
					categoryId: ch.categoryId,
				});
				const rewardConfig = JSON.stringify({ points: ch.rewardPoints });
				const sourceTemplateId = `challenge-set:${presetId ?? 'manual'}:${ch.title}`;
				const perChildTargets = await buildPerChildTargets(
					ch.baseTarget,
					undefined,
					childIds,
					tenantId,
				);
				const created = await createChildChallengesBulk(
					{
						title: ch.title,
						description: ch.description,
						challengeType: 'cooperative',
						periodType: 'custom',
						startDate,
						endDate,
						targetConfig,
						rewardConfig,
						sourceTemplateId,
						perChildTargets,
					},
					childIds,
					tenantId,
				);
				imported += created.length;
			} catch (e) {
				errors.push(`「${ch.title}」: ${e instanceof Error ? e.message : String(e)}`);
			}
		}
		logger.info('[challenge-set-import] per-child インポート完了', {
			context: {
				tenantId,
				imported,
				skipped,
				errors: errors.length,
				presetId: presetId ?? null,
				childCount: childIds.length,
			},
		});
		return { imported, skipped, errors };
	}

	// legacy family-wide path (childIds 未指定時、後方互換): 既存 sibling_challenges に挿入
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

	logger.info('[challenge-set-import] family-wide (legacy) インポート完了', {
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

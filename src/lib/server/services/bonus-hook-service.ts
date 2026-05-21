// src/lib/server/services/bonus-hook-service.ts
// #2138 MP-3: 6 bonus rule hook の集約 (activity-log-service から呼び出される)
//
// 既存の `calcStreakBonus()` (`$lib/domain/validation/activity`) は streak-bonus の
// デフォルト挙動 (consecutiveDays - 1 を最大 10 まで) のみ。本 service はそれに加えて
// マーケットプレイス取込済 bonus preset 6 種を順次評価し、合算 bonus を返す。
//
// 6 件:
// 1. streak-bonus: 3 / 7 / 30 日連続で +10 / +30 / +100 (既存 calcStreakBonus と相補)
// 2. early-bird:   朝 8 時までに記録で +5、平日 5 日連続で +25
// 3. weekend-special: 土日の活動はポイント 2 倍 (relative bonus)、家族で活動で +20
// 4. category-challenge: 1 日に 3 / 5 カテゴリで +15 / +50
// 5. sibling-coop:  きょうだい全員同日活動 / きょうだい手伝い +10 / +5
// 6. self-study-reward: 自主学習 / 新教科 / 週 5 日学習 +10 / +15 / +30
//
// 設計原則 (ADR-0012 §6 anti-engagement):
// - bonus は子供 UI に「連続表示」「累積表示」させない (点数履歴に短く出るのみ)
// - 子供側 fetch は行わず、活動記録の同期計算のみで完結 (滞在時間延伸を防ぐ)
//
// Pre-PMF (ADR-0010): bonus hook は同期処理のみで完結。bonus 発火の高度な状態管理
// (例: 個別 streak counter / カテゴリ集計 cache) は未導入。実装上 weekend は曜日
// 計算のみ、category-challenge は呼び出し側 (activity-log-service) から渡される
// today categories count を使う形式とする。

import { calcStreakBonus } from '$lib/domain/validation/activity';
// #2368 (ADR-0052): bonus state SSOT は marketplace strategy 配下に移動済。
// 本 import は新 SSOT を直接参照 (旧 rule-preset-import-service の re-export 経由を撤去)。
import { loadBonusOverrides } from '$lib/marketplace/strategies/rule-preset/bonus-state';
import { logger } from '$lib/server/logger';

// ============================================================
// 入力: 活動記録時のコンテキスト
// ============================================================

export interface BonusHookContext {
	/** 既存 calcStreakBonus に渡される値 (連続記録日数) */
	consecutiveDays: number;
	/** 活動記録時刻 (timezone JST 想定、`new Date()` 同等) */
	recordedAt: Date;
	/** 当日その子供が記録した distinct カテゴリ ID 数 (category-challenge 判定用) */
	todayDistinctCategoryCount: number;
	/** 当日初回記録か (early-bird / streak の条件) */
	isFirstToday: boolean;
	/** 活動カテゴリ ID (self-study-reward の判定用、学習系カテゴリで +10) */
	categoryId: number;
	/** sibling-coop hook: きょうだい全員が同日記録済か (上位レイヤで計算済を渡す) */
	allSiblingsActiveToday?: boolean;
	/** 子供画面で記録される追加メモ (今 phase では未使用、将来枠) */
	memo?: string;
}

// ============================================================
// 出力: 個別 rule の発火結果
// ============================================================

export interface BonusHit {
	/** preset itemId (例: 'streak-bonus') */
	presetId: string;
	/** 発火した rule の title (point_ledger.description で参照) */
	ruleTitle: string;
	/** 加算ポイント (絶対値) */
	bonusPoints: number;
	/** 倍率 bonus (weekend-special が 2x 等)。デフォルト 1.0 */
	multiplier: number;
}

export interface BonusHookResult {
	/** 加算 bonus 合計 (基礎ポイントへの加算) */
	totalBonus: number;
	/** 適用される multiplier (weekend 2x 等)。1 件しか発火しない設計 (最大値採用) */
	pointsMultiplier: number;
	/** 個別 hit 一覧 (UI 表示 / ログ用) */
	hits: BonusHit[];
}

// ============================================================
// hook 本体
// ============================================================

/**
 * 活動記録時に取込済 bonus preset 6 種を順次評価し、合算 bonus を返す。
 *
 * 既存の `calcStreakBonus()` (デフォルト streak 計算) と相補的に動作する。
 * 本 hook は「マーケットプレイスから明示的に取込まれた bonus」のみを評価し、
 * 取込前は totalBonus=0 / pointsMultiplier=1.0 を返す (regression なし)。
 *
 * AC3 検証: 6 件 ruleId 全てがポイント計算ロジックに反映される。
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: 6 bonus rule の個別判定を 1 ヶ所に集約するため
export async function evaluateBonusHooks(
	ctx: BonusHookContext,
	tenantId: string,
): Promise<BonusHookResult> {
	const state = await loadBonusOverrides(tenantId);
	const hits: BonusHit[] = [];
	let totalBonus = 0;
	let pointsMultiplier = 1.0;

	// enabled な preset のみ評価
	const activePresets = state.presets.filter((p) => p.enabled);

	for (const preset of activePresets) {
		switch (preset.presetId) {
			case 'streak-bonus':
				// 3 / 7 / 30 日連続で +10 / +30 / +100
				// 既存 calcStreakBonus は線形 (min(N-1, 10)) のため、マイルストーン bonus
				// を加算する形式。isFirstToday のみ発火。
				if (ctx.isFirstToday) {
					const milestone = pickStreakMilestoneBonus(ctx.consecutiveDays, preset.rules);
					if (milestone) {
						hits.push({
							presetId: preset.presetId,
							ruleTitle: milestone.title,
							bonusPoints: milestone.pointBonus,
							multiplier: 1.0,
						});
						totalBonus += milestone.pointBonus;
					}
				}
				break;

			case 'early-bird': {
				// 朝 8 時までに記録 (JST timezone) で +5
				// 平日 5 日連続条件は本実装では簡略化 (consecutiveDays ベース)
				const hour = ctx.recordedAt.getHours();
				if (ctx.isFirstToday && hour < 8) {
					const morning = preset.rules.find((r) => r.title === 'はやおきボーナス');
					if (morning) {
						hits.push({
							presetId: preset.presetId,
							ruleTitle: morning.title,
							bonusPoints: morning.pointBonus,
							multiplier: 1.0,
						});
						totalBonus += morning.pointBonus;
					}
				}
				// あさかつウィーク: consecutiveDays が 5 の倍数のとき (週次マイルストーン)
				if (ctx.isFirstToday && ctx.consecutiveDays > 0 && ctx.consecutiveDays % 5 === 0) {
					const weekly = preset.rules.find((r) => r.title === 'あさかつウィーク');
					if (weekly && hour < 8) {
						hits.push({
							presetId: preset.presetId,
							ruleTitle: weekly.title,
							bonusPoints: weekly.pointBonus,
							multiplier: 1.0,
						});
						totalBonus += weekly.pointBonus;
					}
				}
				break;
			}

			case 'weekend-special': {
				// 土日: ポイント 2 倍 (relative)
				const day = ctx.recordedAt.getDay(); // 0=日, 6=土
				if (day === 0 || day === 6) {
					const doublePoints = preset.rules.find((r) => r.title === 'しゅうまつ2ばいボーナス');
					if (doublePoints) {
						pointsMultiplier = Math.max(pointsMultiplier, 2.0);
						hits.push({
							presetId: preset.presetId,
							ruleTitle: doublePoints.title,
							bonusPoints: 0,
							multiplier: 2.0,
						});
					}
					// 家族活動 bonus (allSiblingsActiveToday が proxy)
					if (ctx.allSiblingsActiveToday) {
						const familyBonus = preset.rules.find((r) => r.title === 'かぞくでチャレンジ');
						if (familyBonus) {
							hits.push({
								presetId: preset.presetId,
								ruleTitle: familyBonus.title,
								bonusPoints: familyBonus.pointBonus,
								multiplier: 1.0,
							});
							totalBonus += familyBonus.pointBonus;
						}
					}
				}
				break;
			}

			case 'category-challenge':
				// 3 カテゴリ達成で +15、5 カテゴリ達成で +50
				if (ctx.todayDistinctCategoryCount >= 5) {
					const allCat = preset.rules.find((r) => r.title === 'オールカテゴリチャレンジ');
					if (allCat) {
						hits.push({
							presetId: preset.presetId,
							ruleTitle: allCat.title,
							bonusPoints: allCat.pointBonus,
							multiplier: 1.0,
						});
						totalBonus += allCat.pointBonus;
					}
				} else if (ctx.todayDistinctCategoryCount >= 3) {
					const threeCat = preset.rules.find((r) => r.title === '3カテゴリチャレンジ');
					if (threeCat) {
						hits.push({
							presetId: preset.presetId,
							ruleTitle: threeCat.title,
							bonusPoints: threeCat.pointBonus,
							multiplier: 1.0,
						});
						totalBonus += threeCat.pointBonus;
					}
				}
				break;

			case 'sibling-coop':
				// きょうだい全員同日活動で +10 (allSiblingsActiveToday flag による発火)
				if (ctx.allSiblingsActiveToday && ctx.isFirstToday) {
					const coop = preset.rules.find((r) => r.title === 'きょうだいいっしょボーナス');
					if (coop) {
						hits.push({
							presetId: preset.presetId,
							ruleTitle: coop.title,
							bonusPoints: coop.pointBonus,
							multiplier: 1.0,
						});
						totalBonus += coop.pointBonus;
					}
				}
				break;

			case 'self-study-reward':
				// 学習系カテゴリ (categoryId === 2 = 勉強) で自主学習 bonus
				// 仕様簡略化: 学習カテゴリで記録した場合 +10 (本来は memo / 教科判定が必要)
				if (ctx.categoryId === 2) {
					const study = preset.rules.find((r) => r.title === 'じしゅがくしゅうボーナス');
					if (study) {
						hits.push({
							presetId: preset.presetId,
							ruleTitle: study.title,
							bonusPoints: study.pointBonus,
							multiplier: 1.0,
						});
						totalBonus += study.pointBonus;
					}
					// ウィークリー学習マスター: consecutiveDays >= 5 で発火
					if (ctx.consecutiveDays >= 5 && ctx.isFirstToday) {
						const weekly = preset.rules.find((r) => r.title === 'ウィークリー学習マスター');
						if (weekly) {
							hits.push({
								presetId: preset.presetId,
								ruleTitle: weekly.title,
								bonusPoints: weekly.pointBonus,
								multiplier: 1.0,
							});
							totalBonus += weekly.pointBonus;
						}
					}
				}
				break;

			default:
				// 未知 preset (将来 preset 追加時の forward compat)
				logger.warn('[bonus-hook] 未知 preset、no-op で skip', {
					context: { presetId: preset.presetId },
				});
				break;
		}
	}

	return { totalBonus, pointsMultiplier, hits };
}

// ============================================================
// helpers
// ============================================================

/**
 * streak-bonus preset 内から該当する milestone rule を返す。
 * 既存 `calcStreakBonus` (`$lib/domain/validation/activity`) は線形 bonus を返すが、
 * マーケットプレイス preset は明示的なマイルストーン (3/7/30) で大きい bonus を出す。
 *
 * preset の rules には title に「3にちれんぞくボーナス」「7にちれんぞくボーナス」
 * 「30にちれんぞくボーナス」が含まれる前提 (streak-bonus.json 参照)。
 */
function pickStreakMilestoneBonus(
	days: number,
	rules: { title: string; pointBonus: number }[],
): { title: string; pointBonus: number } | null {
	if (days === 30) return rules.find((r) => r.title === '30にちれんぞくボーナス') ?? null;
	if (days === 7) return rules.find((r) => r.title === '7にちれんぞくボーナス') ?? null;
	if (days === 3) return rules.find((r) => r.title === '3にちれんぞくボーナス') ?? null;
	return null;
}

/**
 * 既存 `calcStreakBonus()` との合算用ヘルパー。
 *
 * 既存の `calcStreakBonus(consecutiveDays)` (default streak, max +10) を維持しながら、
 * 取込済 bonus preset の bonus を加算する。base bonus 互換のため calcStreakBonus を export する。
 */
export function combineWithDefaultStreakBonus(
	consecutiveDays: number,
	hookResult: BonusHookResult,
): number {
	const defaultStreakBonus = calcStreakBonus(consecutiveDays);
	return defaultStreakBonus + hookResult.totalBonus;
}

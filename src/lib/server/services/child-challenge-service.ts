// src/lib/server/services/child-challenge-service.ts
// per-child チャレンジ サービス層 (#2362 PR-7、ADR-0055、User §6)
//
// 旧 sibling-challenge-service.ts (family-wide + 全員自動 enroll) の per-child 後継。
// 並存維持 (旧 service は cleanup #2458 まで残す)。
//
// 設計原則:
//   - 1 challenge instance = 1 child binding (per-child instance)
//   - 兄弟連動表示は sourceTemplateId / (title + startDate + endDate) で group
//   - Anti-engagement (ADR-0012): 全員完了で簡素な祝福のみ (admin 画面で表示)、
//     子供画面で兄弟比較を煽らない

import {
	CATEGORIES,
	CATEGORY_CODE_TO_ID,
	CATEGORY_CODES,
	CATEGORY_NUMERIC_IDS,
} from '$lib/domain/categories';
import { addDaysJST, jstDateToInstant, todayDateJST, weekStartJST } from '$lib/domain/date-utils';
import type { ActivityId, CategoryId, ChildId } from '$lib/domain/ids';
import { asCategoryId } from '$lib/domain/ids';
import {
	formatChallengeTitle,
	getCategoryDisplayName,
	getChallengeReason,
} from '$lib/domain/labels';
import { findAllChildren } from '$lib/server/db/child-repo';
import { getRepos } from '$lib/server/db/factory';
import type {
	ChildChallenge,
	ChildChallengeGroup,
	ChildChallengeWithSiblings,
	InsertChildChallengeInput,
} from '$lib/server/db/types';
import { aggregateActivityLogsByCategory } from '$lib/server/services/activity-log-aggregation';
import type { RetentionRange } from '$lib/server/services/plan-limit-service';

// ============================================================
// 週次チャレンジ生成アルゴリズム (#3194 / #3213、旧 auto-challenge-service より移設)
// 苦手中心＋時々得意の週次チャレンジを、行動科学・教育心理学ベースの
// ヒューリスティック＋調整可能定数で生成する純粋関数群。
// auto_challenges テーブル廃止 (#3213) に伴い child_challenges 一本化側へ移設した。
// 設計: docs/design/44-チャレンジ設計書.md §3.4 / docs/rationale/12-auto-challenge-generation-rationale.md
// ============================================================

/** Category IDs from the categories master table (#3607: SSOT 派生) */
const ALL_CATEGORY_IDS: readonly CategoryId[] = CATEGORY_NUMERIC_IDS.map(asCategoryId);

/** Category names for display (生成 challenge の view 整形でも再利用、#3607: SSOT 派生) */
export const CATEGORY_NAMES: Record<string, string> = Object.fromEntries(
	CATEGORY_CODES.map((code) => [String(CATEGORIES[code].legacyNumericId), CATEGORIES[code].name]),
);

/** 生成モード。weakness=苦手, strength=得意深掘り週, rescue-strength=連続未達レスキュー, explore=データ不足 (#3194) */
export type ChallengeProposalMode = 'weakness' | 'strength' | 'rescue-strength' | 'explore';

// ------------------------------------------------------------
// 調整可能定数 (§3.4)。1 箇所に集約し「ルールエンジン化しない」境界を物理的に示す。
// ------------------------------------------------------------
/** 実測週平均 + これ = base target */
const TARGET_DELTA = 1;
/** target 下限 (Fogg "make it tiny" で 3→2)。週1回ペースを下回らせない最小の前進 */
const MIN_TARGET = 2;
/** target 上限 (青天井で難度を煽らない) */
const MAX_TARGET = 7;
/** 苦手カテゴリ優先の重み (rank 0 の苦手に WEAK_BIAS_BASE、以降 -1) */
const WEAK_BIAS_BASE = 5;
/** 「得意深掘り週」を入れる周期 */
const EVERY_N_WEEKS_STRONG = 4;
/** 達成時の昇圧 (ジャスト達成) */
const BUMP_NORMAL = 1;
/** 達成時の昇圧 (大幅超過) */
const BUMP_OVERSHOOT = 2;
/** 連続未達がこの数に達したらレスキュー (target 最小 + 得意週) に切替える */
const MISS_RESCUE_AFTER = 2;
/** Minimum records to analyze (if below this, use explore challenge) */
const MIN_RECORDS_FOR_ANALYSIS = 3;

/**
 * computeProposal が前週情報として必要とする最小 shape (#3213)。
 * 旧 `AutoChallenge` (auto_challenges 行型) から本 standalone 型へ置換した。
 * 前週 child_challenge を `toProposalPrev` でこの形に写像して渡す。
 */
export interface ChallengePrev {
	/** 前週の達成状態。'completed' なら連続未達カウントをリセットする */
	status: string;
	/** 前週生成時点での連続未達週数 */
	consecutiveMissCount: number;
	/** 前週のカテゴリ ID (同一カテゴリ回避 / target 据置判定に使う) */
	categoryId: CategoryId;
	/** 前週の目標回数 (翌週適応の Flow 分岐に使う) */
	targetCount: number;
	/** 前週の実績回数 (overshoot / reach ratio 計算に使う) */
	currentCount: number;
}

export interface ChallengeProposal {
	categoryId: CategoryId;
	categoryName: string;
	targetCount: number;
	mode: ChallengeProposalMode;
	consecutiveMissCount: number;
	reason: string;
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

/**
 * その週の月曜 (YYYY-MM-DD) を **JST 基準**で返す。
 *
 * #4003: 旧実装は `new Date()` のローカル日付要素 (`getDay` / `getFullYear` / `getMonth` /
 * `getDate`) で週頭を算出しており、doc comment は "Uses local date components to avoid
 * timezone issues" と書いていたが、**ローカル日付要素を使うことが timezone issue の原因
 * そのもの**だった。
 *
 * 本関数の戻り値は `child_challenges.start_date` に書かれる一方、active 判定は
 * `todayDateJST()` (JST 固定) で行われる。プロセス TZ が UTC (CI runner / Lambda) のとき、
 * UTC 日曜 15:00〜24:00 = JST 月曜 00:00〜09:00 の 9 時間だけ両者の週がずれ、
 * `endDate >= today` が false になって**週次チャレンジのバッジが全カテゴリで消えていた**。
 *
 * 算出は `weekStartJST()` に委譲する (ローカル TZ getter を使わない実装は SSOT 側に置く)。
 */
export function getWeekStart(date: Date = new Date()): string {
	return weekStartJST(date);
}

/** weekStart (YYYY-MM-DD, Monday) の 1 週間前の Monday を返す。 */
export function getLastWeekStart(weekStart: string): string {
	return addDaysJST(weekStart, -7);
}

/** weekStart を epoch からの週インデックスに変換する (得意週の周期判定用、決定的)。 */
function weekIndexOf(weekStart: string): number {
	return Math.floor(jstDateToInstant(weekStart).getTime() / (7 * 24 * 60 * 60 * 1000));
}

/** 2 つの weekStart (Monday) 間の週数。連続週なら 1、1 週 skip なら 2 (#3203 item1)。 */
function weeksBetween(earlier: string, later: string): number {
	return weekIndexOf(later) - weekIndexOf(earlier);
}

/** 直近 2 週間のカテゴリ別記録数を集計する。週次自動生成の苦手判定入力に使う。 */
export async function aggregateCategoryCounts(
	childId: ChildId,
	tenantId: string,
): Promise<Record<string, number>> {
	const toDate = todayDateJST();
	const fromDate = addDaysJST(toDate, -14);

	const { summary } = await aggregateActivityLogsByCategory(childId, tenantId, {
		from: fromDate,
		to: toDate,
	});

	const counts: Record<string, number> = {};
	for (const catId of ALL_CATEGORY_IDS) {
		counts[catId] = summary.byCategory[catId]?.count ?? 0;
	}
	return counts;
}

/** 最多記録カテゴリ (得意) を返す。同数は最小 id を優先 (決定的)。 */
function strongestCategory(counts: Record<string, number>): CategoryId {
	let best = ALL_CATEGORY_IDS[0] ?? asCategoryId(CATEGORY_CODE_TO_ID.undou);
	let max = -1;
	for (const catId of ALL_CATEGORY_IDS) {
		const n = counts[catId] ?? 0;
		if (n > max) {
			max = n;
			best = catId;
		}
	}
	return best;
}

/**
 * 苦手バイアスの重み付き抽選。記録が少ないカテゴリほど重みが高い (rank 0 = WEAK_BIAS_BASE)。
 * excludeId を渡すと連続週の同一カテゴリを避ける。
 */
// #3203 item2: カテゴリ抽選を childId + weekStart で seed 化し決定的にする。
// 生成時 1 回 persist されるため以後 flip-flop しないが、week-boundary/race で初回 insert 前に
// flip し得た。seed 化で (a) 決定性 (同 child・同週は常に同結果) (b) 親への説明性 (c) test 容易性
// を得る。childId 未指定時 (既存 test 等) は Math.random にフォールバックし後方互換を保つ。
export function hashSeed(childId: ChildId, weekStart: string): number {
	// FNV-1a (文字列イテレーション)。string id 化 (#3575) に伴い `${childId}:${weekStart}` を hash する。
	// 決定性 (同一入力 → 同一出力) のみが要件で、旧 number 版との分布互換は不要 (§12.2 で id 非保全)。
	let h = 2166136261;
	for (const ch of `${childId}:${weekStart}`) {
		h ^= ch.codePointAt(0) ?? 0;
		h = Math.imul(h, 16777619);
	}
	return h >>> 0;
}

/** mulberry32: seed から決定的な [0,1) 乱数を返す PRNG を作る。 */
function makeSeededRand(childId: ChildId, weekStart: string): () => number {
	let a = hashSeed(childId, weekStart);
	return () => {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function weightedWeakPick(
	counts: Record<string, number>,
	rand: () => number,
	excludeId?: CategoryId,
): CategoryId {
	const cats = ALL_CATEGORY_IDS.filter((c) => c !== excludeId);
	const sorted = [...cats].sort((a, b) => (counts[a] ?? 0) - (counts[b] ?? 0));
	const weighted = sorted.map((c, rank) => ({ c, w: Math.max(1, WEAK_BIAS_BASE - rank) }));
	const total = weighted.reduce((s, x) => s + x.w, 0);
	let r = rand() * total;
	for (const x of weighted) {
		r -= x.w;
		if (r <= 0) return x.c;
	}
	return sorted[0] ?? ALL_CATEGORY_IDS[0] ?? asCategoryId(CATEGORY_CODE_TO_ID.undou);
}

/** カテゴリ選択 (weighted interleaving §3.4)。explore / rescue-strength / strength / weakness を返す。 */
function selectCategory(
	counts: Record<string, number>,
	prev: ChallengePrev | undefined,
	weekStart: string,
	consecutiveMissCount: number,
	rand: () => number,
): { categoryId: CategoryId; mode: ChallengeProposalMode } {
	const totalRecords = Object.values(counts).reduce((a, b) => a + b, 0);
	if (totalRecords < MIN_RECORDS_FOR_ANALYSIS) {
		return {
			categoryId:
				ALL_CATEGORY_IDS[Math.floor(rand() * ALL_CATEGORY_IDS.length)] ??
				asCategoryId(CATEGORY_CODE_TO_ID.undou),
			mode: 'explore',
		};
	}
	if (consecutiveMissCount >= MISS_RESCUE_AFTER) {
		return { categoryId: strongestCategory(counts), mode: 'rescue-strength' };
	}
	if (weekIndexOf(weekStart) % EVERY_N_WEEKS_STRONG === 0) {
		return { categoryId: strongestCategory(counts), mode: 'strength' };
	}
	let categoryId = weightedWeakPick(counts, rand);
	// 直前週と同一カテゴリは原則回避 (interleaving の連続ブロック防止)
	if (prev != null && categoryId === prev.categoryId) {
		categoryId = weightedWeakPick(counts, rand, prev.categoryId);
	}
	return { categoryId, mode: 'weakness' };
}

/** target 決定 (ability ベース + Flow 3 分岐適応 §3.4)。 */
function decideTarget(
	counts: Record<string, number>,
	prev: ChallengePrev | undefined,
	categoryId: CategoryId,
	mode: ChallengeProposalMode,
): number {
	if (mode === 'rescue-strength') return MIN_TARGET; // 必ず達成できる最小目標

	const avg = (counts[categoryId] ?? 0) / 2; // 直近 2 週の週平均
	const base = clamp(Math.round(avg) + TARGET_DELTA, MIN_TARGET, MAX_TARGET);

	if (prev == null || prev.categoryId !== categoryId) return base; // 別カテゴリは base 基準
	if (prev.status === 'completed') {
		const overshoot = prev.currentCount - prev.targetCount;
		const bump = overshoot >= 2 ? BUMP_OVERSHOOT : BUMP_NORMAL;
		return clamp(Math.max(base, prev.targetCount + bump), MIN_TARGET, MAX_TARGET);
	}
	// 同カテゴリ未達: 半分以上できていれば据置 (折らない)、半分未満は下げる (anxiety 脱出)
	const ratio = prev.targetCount > 0 ? prev.currentCount / prev.targetCount : 0;
	return ratio >= 0.5
		? Math.max(MIN_TARGET, prev.targetCount)
		: Math.max(MIN_TARGET, prev.targetCount - 1);
}

/**
 * カテゴリ別記録数と前週チャレンジから今週のチャレンジ提案を決める (§3.4)。
 * カテゴリ選択 (weighted interleaving) + target (ability ベース + 前週結果の Flow 適応) を統合する。
 */
export function computeProposal(
	counts: Record<string, number>,
	prev: ChallengePrev | undefined,
	weekStart: string,
	opts?: { childId?: ChildId; skippedWeeks?: number },
): ChallengeProposal {
	// #3203 item2: childId 指定時は seed 化した決定的 RNG、未指定 (既存 test) は Math.random。
	const rand = opts?.childId != null ? makeSeededRand(opts.childId, weekStart) : Math.random;
	// #3203 item1: skippedWeeks = 直近生成週から今週までに challenge を生成しなかった (skip した) 週数。
	// 週を skip する child = disengaging であり rescue (易しい得意 challenge で成功体験を積ませる) の本来対象。
	// skip 週を miss として streak に加算し、跨いでも rescue を発火させる。
	// #3472 item2 (skip≠vacation の判断・記録): 旅行/帰省で離れた優良家庭も skip-as-disengagement で
	// rescue 対象になり得るが、(a) rescue は「易しい得意 challenge」で penalty も催促もなく benign、
	// (b) vacation 検出 (カレンダー連携/不在判定) は Pre-PMF (ADR-0010) で過剰投資のため、現状は
	// skip=disengagement の単純モデルを採用する。誤分類時の害が小さく ADR-0012 anti-engagement とも整合。
	const skippedWeeks = Math.max(0, opts?.skippedWeeks ?? 0);
	// 生成時点での「連続未達週数」(前週が未達なら前週の streak + 1、達成ならリセット) + skip 週 (disengagement)。
	const prevMissed = prev != null && prev.status !== 'completed';
	const consecutiveMissCount =
		(prevMissed ? (prev?.consecutiveMissCount ?? 0) + 1 : 0) + skippedWeeks;

	const { categoryId, mode } = selectCategory(counts, prev, weekStart, consecutiveMissCount, rand);
	const targetCount = decideTarget(counts, prev, categoryId, mode);

	const categoryName = CATEGORY_NAMES[categoryId] ?? '';
	return {
		categoryId,
		categoryName,
		targetCount,
		mode,
		consecutiveMissCount,
		// #4690 F2: 保存する文言は保護者の管理画面にも出るため漢字表記 (elementary 変種)。
		// 子供画面はこの行を使わず、view 整形時に uiMode で解決し直す。
		reason: getChallengeReason(mode, categoryName, 'elementary'),
	};
}

/**
 * group key 解決 (ADR-0055 §4.7 整合)。`getActiveChildChallengesWithSiblings` 用のベース key。
 *
 * #3513 QM BLOCK fix: admin 側 `getChallengeGroupsForAdmin` は本関数と同一規約ではなく、
 * sourceTemplateId 有無に関わらず常に startDate + endDate を key に含める (tenant 全体・全期間を
 * 横断集計するため)。本関数は呼び出し側 (`getActiveChildChallengesWithSiblings`) が group 化した
 * 後に同一 childId の active instance に限定して period filter するため、sourceTemplateId 単体
 * key のままで安全 (siblings は取得後に startDate/endDate 一致でさらに絞り込む)。
 */
function resolveGroupKey(
	c: Pick<ChildChallenge, 'sourceTemplateId' | 'title' | 'startDate' | 'endDate'>,
): string {
	// #4689: **内容 (title) を必ず key に含める**。
	// 週次自動生成は子供ごとに別内容 (「うんどうを4回」「そうぞうを2回」) なのに
	// `sourceTemplateId` が全員 `auto:weekly` で共通のため、旧 key では別内容の instance が
	// 同一 group に混ざっていた。その結果 `allCompleted` が兄弟全員の達成に依存し、
	// 達成した子に祝福が出なかった (多子家庭で毎週劣化)。
	// 同一テンプレート配信 (同 sourceTemplateId + 同 title) は従来どおり 1 group = 「みんなクリア」。
	return `${c.sourceTemplateId ?? 'manual'}::${c.title}::${c.startDate}::${c.endDate}`;
}

interface TargetConfig {
	metric: 'count' | 'xp';
	categoryId?: CategoryId;
	activityId?: ActivityId;
	baseTarget: number;
	ageAdjustments?: Record<string, number>;
}

interface RewardConfig {
	points: number;
	message?: string;
}

/** 年齢に応じたターゲット値を計算 (旧 sibling-challenge-service の同等関数を再利用) */
export function calcAgeAdjustedTarget(
	baseTarget: number,
	ageAdjustments: Record<string, number> | undefined,
	childAge: number,
): number {
	if (!ageAdjustments) return baseTarget;
	const exact = ageAdjustments[String(childAge)];
	if (exact !== undefined) return exact;
	const ages = Object.keys(ageAdjustments)
		.map(Number)
		.filter((n) => !Number.isNaN(n))
		.sort((a, b) => a - b);
	if (ages.length === 0) return baseTarget;
	let closest = baseTarget;
	for (const age of ages) {
		if (age <= childAge) closest = ageAdjustments[String(age)] ?? baseTarget;
	}
	if (ages[0] !== undefined && childAge < ages[0]) return baseTarget;
	return closest;
}

/**
 * 1 child に 1 challenge instance 作成。
 * 親管理画面の「作成 (個別)」action から呼ばれる。
 */
export async function createChildChallenge(
	input: InsertChildChallengeInput,
	tenantId: string,
): Promise<ChildChallenge> {
	const repos = getRepos();
	return repos.childChallenge.insert(input, tenantId);
}

/**
 * 同じ challenge spec を複数 child に同時 instance 化 (一括追加 / ChildSelectionDialog の「全員に追加」)。
 * sourceTemplateId を共有することで admin/challenges で兄弟連動表示される。
 */
export async function createChildChallengesBulk(
	spec: Omit<InsertChildChallengeInput, 'childId' | 'targetValue'> & {
		sourceTemplateId?: string | null;
		/** 子供別 target value (age-adjusted)。childId → targetValue マップ */
		perChildTargets: Record<string, number>;
	},
	childIds: readonly ChildId[],
	tenantId: string,
): Promise<ChildChallenge[]> {
	const repos = getRepos();
	const inputs: InsertChildChallengeInput[] = childIds.map((childId) => ({
		childId,
		title: spec.title,
		description: spec.description ?? null,
		challengeType: spec.challengeType ?? 'cooperative',
		periodType: spec.periodType ?? 'weekly',
		startDate: spec.startDate,
		endDate: spec.endDate,
		targetConfig: spec.targetConfig,
		rewardConfig: spec.rewardConfig,
		sourceTemplateId: spec.sourceTemplateId ?? null,
		targetValue: spec.perChildTargets[childId] ?? 1,
	}));
	return repos.childChallenge.insertBulk(inputs, tenantId);
}

/**
 * admin/challenges 画面: tenant 全体の challenge instance を sourceTemplateId / (title + 期間) で
 * group 化して返す。SiblingChallengeComparison.svelte で兄弟連動比較表示するため。
 *
 * groupKey は `resolveGroupKey` (子供画面と共通) を使う。sourceTemplateId + **内容 (title)** +
 * 期間の 3 点一致で「同じチャレンジ」とみなす。
 *   - 期間を含める (#3513): `auto:weekly` のような tenant 共有の固定 id でも、週が違えば別 group
 *   - 内容を含める (#4689): 週次自動生成は子供ごとに別内容なので、title が違えば別 group。
 *     旧実装は先頭の子のタイトルで全員の進捗を束ねて表示していた
 */
export async function getChallengeGroupsForAdmin(tenantId: string): Promise<ChildChallengeGroup[]> {
	const repos = getRepos();
	const all = await repos.childChallenge.findAllByTenant(tenantId);

	const groupMap = new Map<string, ChildChallenge[]>();
	for (const c of all) {
		// #4689: 子供画面と同一規約 (`resolveGroupKey`) を使う。内容 (title) を含めないと
		// 週次自動生成 (`auto:weekly` 共有) の別内容 instance が 1 group に束ねられ、
		// 見出しが先頭の子のタイトルのまま全員の進捗を並べてしまう。
		const key = resolveGroupKey(c);
		const arr = groupMap.get(key) ?? [];
		arr.push(c);
		groupMap.set(key, arr);
	}

	const groups: ChildChallengeGroup[] = [];
	for (const [groupKey, instances] of groupMap) {
		const first = instances[0];
		if (!first) continue;
		groups.push({
			groupKey,
			title: first.title,
			description: first.description,
			startDate: first.startDate,
			endDate: first.endDate,
			periodType: first.periodType,
			sourceTemplateId: first.sourceTemplateId,
			instances,
			allCompleted: instances.length > 0 && instances.every((i) => i.completed === 1),
		});
	}

	// 開始日降順 (新しい順) で表示
	groups.sort((a, b) => b.startDate.localeCompare(a.startDate));
	return groups;
}

// ============================================================
// アプリ週次自動生成 (#3195、EPIC #3193 child_challenges 一本化)
// 親手動作成に代わり、アプリが毎週 child_challenges を自動生成する。
// 生成アルゴリズム (苦手中心＋時々得意＋翌週適応) は本ファイル冒頭の computeProposal
// (#3213 で auto-challenge-service より移設) を使う。child_challenges に書くことで既存の進捗フック
// (updateChildChallengeProgress) / 完了 / ごほうび受取 / バナー / 達成演出が
// そのまま生きる。生成メタ (mode / 連続未達) は targetConfig JSON に内包し
// child_challenges のスキーマ変更を不要にする。
// ============================================================

/** 自動生成 instance を識別する sourceTemplateId 値 */
const AUTO_WEEKLY_SOURCE = 'auto:weekly';
/** 自動生成チャレンジ達成時の既定ごほうびポイント (PO 確認対象、控えめな既定値) */
const AUTO_WEEKLY_REWARD_POINTS = 30;

/** weekStart (Monday, YYYY-MM-DD) の週末 (Sunday) を返す。 */
function weekEndOf(weekStart: string): string {
	return addDaysJST(weekStart, 6);
}

/** 前週の自動生成 child_challenge を computeProposal の prev 入力 (ChallengePrev 形) に写像する。 */
function toProposalPrev(row: ChildChallenge): ChallengePrev {
	let categoryId = asCategoryId(CATEGORY_CODE_TO_ID.undou);
	let genMissStreak = 0;
	try {
		// 旧行の targetConfig は number categoryId (legacy)。asCategoryId で正規化する。
		const cfg = JSON.parse(row.targetConfig) as {
			categoryId?: number | string;
			genMissStreak?: number;
		};
		categoryId =
			cfg.categoryId != null
				? asCategoryId(cfg.categoryId)
				: asCategoryId(CATEGORY_CODE_TO_ID.undou);
		genMissStreak = cfg.genMissStreak ?? 0;
	} catch {
		// 破損 JSON は既定値で続行
	}
	return {
		categoryId,
		targetCount: row.targetValue,
		currentCount: row.currentValue,
		status: row.completed === 1 ? 'completed' : 'expired',
		consecutiveMissCount: genMissStreak,
	};
}

/**
 * 当週のアプリ自動生成 child_challenge を取得 (なければ生成)。子供 home / challenges の
 * load で呼び、バナー等に流す。冪等 (当週分が既にあれば再生成しない)。
 */
export async function getOrCreateWeeklyChildChallenge(
	childId: ChildId,
	tenantId: string,
): Promise<ChildChallenge> {
	const repos = getRepos();
	const weekStart = getWeekStart();

	const all = await repos.childChallenge.findByChildId(childId, tenantId);
	const existing = all.find(
		(c) => c.sourceTemplateId === AUTO_WEEKLY_SOURCE && c.startDate === weekStart,
	);
	if (existing) return existing;

	// #3203 item1: 直近の生成済 auto challenge (lastWeekStart に限らず最新の prior 週) を prev に使い、
	// その週から今週までの skip 週数を disengagement signal として rescue に反映する。
	const priorAuto = all
		.filter((c) => c.sourceTemplateId === AUTO_WEEKLY_SOURCE && c.startDate < weekStart)
		.sort((a, b) => (a.startDate < b.startDate ? 1 : -1)); // 新しい順
	const prevRow = priorAuto[0];
	// prevRow が lastWeekStart なら skip 0。さらに過去なら間の週数を skip として数える。
	const skippedWeeks = prevRow ? weeksBetween(prevRow.startDate, weekStart) - 1 : 0;
	const counts = await aggregateCategoryCounts(childId, tenantId);
	const proposal = computeProposal(
		counts,
		prevRow ? toProposalPrev(prevRow) : undefined,
		weekStart,
		{
			childId,
			skippedWeeks,
		},
	);

	const targetConfig = JSON.stringify({
		metric: 'count',
		categoryId: proposal.categoryId,
		baseTarget: proposal.targetCount,
		genMode: proposal.mode,
		genMissStreak: proposal.consecutiveMissCount,
	});
	const rewardConfig = JSON.stringify({
		points: AUTO_WEEKLY_REWARD_POINTS,
		message: proposal.reason,
	});

	// #3245: insert ではなく atomic getOrCreateWeeklyAuto を使う。
	// 上の existing 事前チェックは最適化に過ぎず、concurrent race (両者が「無し」と判定) でも
	// DB の一意制約 + 条件付き書込で 1 行に収束させ、ポイント二重付与を不可能化する。
	return repos.childChallenge.getOrCreateWeeklyAuto(
		{
			childId,
			title: formatChallengeTitle(proposal.categoryName, proposal.targetCount),
			description: proposal.reason,
			challengeType: 'cooperative',
			periodType: 'weekly',
			startDate: weekStart,
			endDate: weekEndOf(weekStart),
			targetConfig,
			rewardConfig,
			sourceTemplateId: AUTO_WEEKLY_SOURCE,
			targetValue: proposal.targetCount,
		},
		tenantId,
	);
}

/** 子供画面: 子供自身のアクティブ challenge 一覧 */
export async function getActiveChildChallenges(
	childId: ChildId,
	tenantId: string,
): Promise<ChildChallenge[]> {
	const repos = getRepos();
	const today = todayDateJST();
	return repos.childChallenge.findActiveByChildId(childId, today, tenantId);
}

/**
 * #3195: 子供 challenges ページ表示用の view 整形型。
 * 旧 auto-challenge-service の `ActiveChallengeInfo` を child_challenges 一本化に合わせて再現する
 * (home が child_challenges を生成し、challenges ページもこれを読むことで二重生成を防ぐ)。
 */
export interface ChildChallengeView {
	id: string;
	categoryName: string;
	targetCount: number;
	currentCount: number;
	weekStart: string;
	status: 'active' | 'completed' | 'expired';
	progressPercent: number;
	description: string;
}

/** child_challenge row → 子供画面 view (categoryName は targetConfig.categoryId から解決)。 */
function toChildChallengeView(row: ChildChallenge, uiMode: string): ChildChallengeView {
	let categoryId: CategoryId | undefined;
	let genMode: ChallengeProposalMode | undefined;
	try {
		// 旧行の targetConfig は number categoryId (legacy)。asCategoryId で正規化する。
		const cfg = JSON.parse(row.targetConfig) as {
			categoryId?: number | string;
			genMode?: ChallengeProposalMode;
		};
		categoryId = cfg.categoryId != null ? asCategoryId(cfg.categoryId) : undefined;
		genMode = cfg.genMode;
	} catch {
		// 破損 JSON は categoryName 空で続行
	}
	// #4690 F2: 表示名も理由文も **保存値ではなく targetConfig から uiMode で解決し直す**。
	// row.description は生成時の 1 表記しか持てず、既存行も 3〜5 歳に漢字文を出し続けるため。
	// genMode が無い破損 / 旧行だけ、保存済み description に fallback する。
	const categoryName = categoryId ? getCategoryDisplayName(categoryId, uiMode) : '';
	const target = row.targetValue > 0 ? row.targetValue : 1;
	const current = row.currentValue;
	const status: ChildChallengeView['status'] =
		row.completed === 1
			? 'completed'
			: row.startDate <= todayDateJST() && row.endDate >= todayDateJST()
				? 'active'
				: 'expired';
	return {
		id: row.id,
		categoryName,
		targetCount: row.targetValue,
		currentCount: current,
		weekStart: row.startDate,
		status,
		progressPercent: Math.min(100, Math.round((current / target) * 100)),
		description: genMode
			? getChallengeReason(genMode, categoryName, uiMode)
			: (row.description ?? ''),
	};
}

/**
 * #3195: 子供 challenges ページの当週アクティブ challenge を view 形で取得 (なければ自動生成)。
 * home の `getOrCreateWeeklyChildChallenge` と同一の生成入口を共有するため、challenges ページと
 * home は常に同一の週次 child_challenge を表示する (一本化、二重生成なし)。
 */
export async function getOrCreateWeeklyChildChallengeView(
	childId: ChildId,
	tenantId: string,
	uiMode: string,
): Promise<ChildChallengeView> {
	const row = await getOrCreateWeeklyChildChallenge(childId, tenantId);
	return toChildChallengeView(row, uiMode);
}

/** #3195: 子供 challenges ページの履歴 (新しい順、上限 limit)。 */
export async function getChildChallengeHistory(
	childId: ChildId,
	tenantId: string,
	uiMode: string,
	limit = 10,
): Promise<ChildChallengeView[]> {
	const repos = getRepos();
	const all = await repos.childChallenge.findByChildId(childId, tenantId);
	return all
		.slice()
		.sort((a, b) => b.startDate.localeCompare(a.startDate))
		.slice(0, limit)
		.map((row) => toChildChallengeView(row, uiMode));
}

/**
 * #4688: 「記録 > 達成」タブ用の**達成履歴**。受取済み (rewardClaimed=1) も含めて新しい順に返す。
 *
 * 旧実装は `getActiveChildChallengesWithSiblings` (active + 未請求のみ) を達成タブに流用していたため、
 * ほうしゅうを受け取った瞬間にタブから消え「まだ達成がないよ」になっていた (challenges 画面の
 * 「これまでのチャレンジ」には出るので画面間で矛盾していた)。**履歴は履歴のクエリで引く**。
 *
 * 返す集合は 2 つの条件で絞る:
 *
 * 1. **保持期間 (`range`、ADR-0049 表示フィルタ層)**。チャレンジは点ではなく期間を持つので、
 *    `range.from` より前に**期間が終わった**もの / `range.to` より後に**期間が始まった**ものを
 *    落とす。cutoff をまたぐ期間は保持内に一部が入るため残す (`startDate` で比較すると
 *    またぎ分を切り過ぎる)。`range` を必須にしているのは、省略可能にすると渡し忘れが
 *    「全期間を返す」として静かに成立するため (#4763 で実際に起きた)。
 * 2. **達成タブの意味論**。返すのは「達成済み」または「まだ期間中」のもの。期間が終わった
 *    未達成は達成でも挑戦中でもないが、画面は `completed` の 2 値でしか描き分けないため
 *    (`history/+page.svelte`)、そのまま返すと終わったチャレンジが「がんばってるよ」と
 *    表示され続ける。全チャレンジの通し一覧は challenges 画面の
 *    `getChildChallengeHistory` が担う (そちらは限定件数の「これまでの」一覧が本務)。
 *
 * 件数の上限は設けない。保持期間で母数が閉じるため、活動 / 交換タブと同じく
 * 「期間で絞る、件数では切らない」に揃える (旧 `limit = 30` は 1 年保持の週次チャレンジ
 * 約 52 件を無告知に切り捨てていた)。
 */
export async function getChildChallengeRecords(
	childId: ChildId,
	tenantId: string,
	range: RetentionRange,
): Promise<
	Array<{
		id: string;
		title: string;
		challengeType: string;
		startDate: string;
		endDate: string;
		completed: boolean;
		currentValue: number;
		targetValue: number;
		rewardClaimed: boolean;
	}>
> {
	const repos = getRepos();
	const today = todayDateJST();
	const all = await repos.childChallenge.findByChildId(childId, tenantId);
	return all
		.filter((c) => {
			if (range.from && c.endDate < range.from) return false;
			if (range.to && c.startDate > range.to) return false;
			return c.completed === 1 || c.endDate >= today;
		})
		.sort((a, b) => b.startDate.localeCompare(a.startDate))
		.map((c) => ({
			id: c.id,
			title: c.title,
			challengeType: c.challengeType,
			startDate: c.startDate,
			endDate: c.endDate,
			completed: c.completed === 1,
			currentValue: c.currentValue,
			targetValue: c.targetValue,
			rewardClaimed: c.rewardClaimed === 1,
		}));
}

/**
 * #2458-B (caller migration): 子供画面 (home / history) 向け per-child instance 配列 +
 * 兄弟連動情報の付与。
 *
 * 旧 `sibling-challenge-service.getActiveChallengesForChild` の後継。
 *
 * 自身の active instance を主軸に、同じ group key (sourceTemplateId or `title::start::end`) を
 * 共有する兄弟 instance を `siblings` フィールドに格納。CategorySection のチャレンジ対象バッジ
 * (#3333 で旧 ChallengeBanner から移行) と `SiblingCelebration` の UX 互換性を維持する。
 *
 * #2488 (must-1 fix): `findActiveOrUnclaimedByChildId` 経由で「完成済だが未請求」instance も
 * 含めるよう変更 (status='completed' AND rewardClaimed=0)。これにより `markCompleted` 直後に
 * instance が active 一覧から消えて claim ボタンが render されない regression を防ぐ。
 *
 * #2488 (must-2 fix): `siblings[]` は **同一 startDate + endDate** (同一期間) の instance に
 * 限定する。過去 expired instance や 別期間 (例: 先週分) の completed instance が
 * `sourceTemplateId` 共有経由で leak し `allCompleted=true` 誤判定 (= celebration 誤発火) を
 * 引き起こすため。
 *
 * IDOR / tenant 境界: `findActiveOrUnclaimedByChildId` / `findAllByTenant` ともに `tenantId`
 * 必須化済。自身の childId 以外の child instance は同一 tenant 内のみ含まれる。
 */
export async function getActiveChildChallengesWithSiblings(
	childId: ChildId,
	tenantId: string,
): Promise<ChildChallengeWithSiblings[]> {
	const repos = getRepos();
	const today = todayDateJST();

	// 自身の active + 未請求完成 instance (#2488 must-1)
	const myActive = await repos.childChallenge.findActiveOrUnclaimedByChildId(
		childId,
		today,
		tenantId,
	);
	if (myActive.length === 0) return [];

	// tenant 全体 (同期間 + 同 group key の兄弟 instance を捕捉するため)
	const allTenant = await repos.childChallenge.findAllByTenant(tenantId);

	// group key → group 内全 instance の map (期間 filter は下で実施、#2488 must-2)
	const groupMap = new Map<string, ChildChallenge[]>();
	for (const c of allTenant) {
		const key = resolveGroupKey(c);
		const arr = groupMap.get(key) ?? [];
		arr.push(c);
		groupMap.set(key, arr);
	}

	return myActive.map((mine) => {
		const key = resolveGroupKey(mine);
		// #2488 must-2: siblings[] は同一 startDate + endDate (= 同一期間) の instance のみ
		// 含める。`sourceTemplateId` 共有の preset 過去期間 instance が混入し allCompleted を
		// 誤判定する regression を防ぐ。
		const siblings = (groupMap.get(key) ?? [mine]).filter(
			(s) => s.startDate === mine.startDate && s.endDate === mine.endDate,
		);
		// filter で自身が脱落しないよう (理論上ありえないが安全側) fallback
		const finalSiblings = siblings.length > 0 ? siblings : [mine];
		const allCompleted = finalSiblings.length > 0 && finalSiblings.every((s) => s.completed === 1);
		return { ...mine, siblings: finalSiblings, allCompleted };
	});
}

/**
 * #4410: 「達成祝福 (SiblingCelebration) を出すべき instance」を 1 件解決する (無ければ null)。
 *
 * **表示可否の根拠は `celebrationShownAt IS NULL` のみ**であり、クライアントの `$state` は
 * 根拠にしない (AC2)。閉じた事実はサーバに永続化されるので、ページ遷移・リロード・
 * `invalidateAll()`・別端末のいずれでも 2 回目以降は null になる。
 *
 * `rewardClaimed` は条件に含めない (AC3) — ごほうびを受け取ったかどうかは祝福の停止条件では
 * なく、受取導線は `challenge-reward-claim-card` 単一経路のまま (#3333) 独立して機能する。
 *
 * ADR-0012 (anti-engagement): 同時に出すのは常に 1 件のみ (docs/DESIGN.md §10 重畳ルール)。
 */
export function resolveCelebrationChallenge(
	challenges: readonly ChildChallengeWithSiblings[],
	childId: ChildId,
): ChildChallengeWithSiblings | null {
	return (
		challenges.find(
			(c) => c.childId === childId && c.allCompleted && c.celebrationShownAt === null,
		) ?? null
	);
}

/**
 * #4410: 達成祝福を「見せた」ことを記録する (`markCheersShown` と同型)。
 *
 * @returns 記録できた (または既に記録済) なら true。他 child / 存在しない instance なら false
 *          (IDOR 防止: tenant 内の別 child の行を閉じられないようにする)。
 */
export async function markChallengeCelebrationShown(
	challengeId: string,
	childId: ChildId,
	tenantId: string,
): Promise<boolean> {
	const repos = getRepos();
	const challenge = await repos.childChallenge.findById(challengeId, tenantId);
	if (!challenge || challenge.childId !== childId) return false;
	// repo 側が `celebration_shown_at IS NULL` 条件付き UPDATE で冪等 (最初の時刻を保つ)。
	await repos.childChallenge.markCelebrationShown(challengeId, tenantId);
	return true;
}

/**
 * 活動記録時の進捗更新フック。child の活動 1 件記録時に呼び出される。
 * 旧 sibling-challenge-service.checkChallengeProgress の per-child 後継。
 */
export async function updateChildChallengeProgress(
	childId: ChildId,
	_activityId: ActivityId,
	categoryId: CategoryId,
	tenantId: string,
): Promise<{ challengeId: string; completed: boolean; challengeTitle: string }[]> {
	const repos = getRepos();
	const today = todayDateJST();
	const challenges = await repos.childChallenge.findActiveByChildId(childId, today, tenantId);
	const results: { challengeId: string; completed: boolean; challengeTitle: string }[] = [];

	for (const challenge of challenges) {
		if (challenge.completed === 1) continue;
		// 旧行の targetConfig は number categoryId (legacy)。asCategoryId で正規化して照合する。
		const targetConfig = JSON.parse(challenge.targetConfig) as Omit<TargetConfig, 'categoryId'> & {
			categoryId?: number | string;
		};
		const cfgCategoryId =
			targetConfig.categoryId != null ? asCategoryId(targetConfig.categoryId) : undefined;
		if (cfgCategoryId && cfgCategoryId !== categoryId) continue;

		if (targetConfig.metric === 'count') {
			const newValue = challenge.currentValue + 1;
			await repos.childChallenge.updateProgress(challenge.id, newValue, tenantId);
			if (newValue >= challenge.targetValue) {
				await repos.childChallenge.markCompleted(challenge.id, tenantId);
				results.push({
					challengeId: challenge.id,
					completed: true,
					challengeTitle: challenge.title,
				});
				continue;
			}
		}
		results.push({ challengeId: challenge.id, completed: false, challengeTitle: challenge.title });
	}
	return results;
}

/**
 * #4686: 活動とりけし時のチャレンジ進捗巻き戻し (updateChildChallengeProgress の逆操作)。
 * 同 category の metric='count' チャレンジについて currentValue を 1 戻し、completed=1 かつ
 * 未受取なら completed を外す (受取済みは repo 側の条件で触らない = 受取済ポイントとの整合)。
 * @returns 巻き戻した instance (UI 用途は無し、テスト / 観測用)
 */
export async function revertChildChallengeProgress(
	childId: ChildId,
	categoryId: CategoryId,
	tenantId: string,
): Promise<{ challengeId: string; reverted: boolean; uncompleted: boolean }[]> {
	const repos = getRepos();
	const today = todayDateJST();
	// active + 「完了済だが未受取」を包括 (completed 直後の取消で完了を外せるように)。
	// 受取済み (status=completed & rewardClaimed=1) は本一覧に含まれない = 触らない。
	const challenges = await repos.childChallenge.findActiveOrUnclaimedByChildId(
		childId,
		today,
		tenantId,
	);
	const results: { challengeId: string; reverted: boolean; uncompleted: boolean }[] = [];

	for (const challenge of challenges) {
		const targetConfig = JSON.parse(challenge.targetConfig) as Omit<TargetConfig, 'categoryId'> & {
			categoryId?: number | string;
		};
		const cfgCategoryId =
			targetConfig.categoryId != null ? asCategoryId(targetConfig.categoryId) : undefined;
		if (cfgCategoryId && cfgCategoryId !== categoryId) continue;
		if (targetConfig.metric !== 'count') continue;
		// 受取済みは進捗も完了も触らない (受取済ポイントとの整合。5 秒窓内に受取まで済む経路のみ)
		if (challenge.completed === 1 && challenge.rewardClaimed === 1) continue;
		if (challenge.currentValue <= 0) continue;

		const newValue = challenge.currentValue - 1;
		await repos.childChallenge.updateProgress(challenge.id, newValue, tenantId);
		let uncompleted = false;
		if (challenge.completed === 1 && newValue < challenge.targetValue) {
			await repos.childChallenge.revertCompletion(challenge.id, tenantId);
			uncompleted = true;
		}
		results.push({ challengeId: challenge.id, reverted: true, uncompleted });
	}
	return results;
}

/** ごほうび受取 (per-child instance ごと) */
export async function claimChildChallengeReward(
	challengeId: string,
	childId: ChildId,
	tenantId: string,
): Promise<{ points: number; message?: string } | { error: string }> {
	const repos = getRepos();
	const challenge = await repos.childChallenge.findById(challengeId, tenantId);
	if (!challenge) return { error: 'チャレンジが見つかりません' };
	// IDOR 防御 + 事前 gate (childId 所有権 / completed)。rewardClaimed の最終判定は下の原子 primitive で行う。
	if (challenge.childId !== childId) return { error: 'このチャレンジは別のお子さま用です' };
	if (challenge.completed !== 1) return { error: 'まだクリアしていません' };

	// #3284 / #3342 (#3333 claim-first の後継): 条件付き flip + point ledger insert を repo 層の
	// **単一原子 primitive** で実行する。旧 2 段構成 (claimReward flip → 別呼び出しで
	// insertPointLedger) は flip 成功後の ledger throw で lost-award (rewardClaimed=1 のまま付与 0 =
	// 恒久受取不能) が残っていた。primitive 内では両成功 or 両 rollback が保証され、ledger 側の
	// 冪等 UNIQUE (child, type='child_challenge', referenceId=challengeId) が二重付与を DB 層で拒否する。
	const rewardConfig: RewardConfig = JSON.parse(challenge.rewardConfig);
	const flipped = await repos.childChallenge.claimRewardAndGrantPoints(
		challengeId,
		{
			childId,
			amount: rewardConfig.points,
			description: `チャレンジ達成: ${challenge.title}`,
		},
		tenantId,
	);
	if (flipped !== 1) return { error: 'すでに受け取り済みです' };
	return { points: rewardConfig.points, message: rewardConfig.message };
}

/** 削除 (admin 画面から) */
export async function deleteChildChallenge(id: string, tenantId: string): Promise<void> {
	const repos = getRepos();
	await repos.childChallenge.deleteChallenge(id, tenantId);
}

/**
 * age-adjusted target を計算するヘルパー (全 child 分の childId → targetValue マップを構築)。
 * marketplace 取込 + admin 一括追加で使用。
 *
 * #2488 (must-3 fix): loop 内呼出時の N+1 query 解消のため、pre-fetched children 配列を
 * 受け取る overload を追加。caller 側で `findAllChildren(tenantId)` を 1 回だけ実行し、
 * 配列を渡すこと。配列省略時は従来通り内部で 1 回 fetch する。
 */
export async function buildPerChildTargets(
	baseTarget: number,
	ageAdjustments: Record<string, number> | undefined,
	childIds: readonly ChildId[],
	tenantId: string,
	prefetchedChildren?: readonly { id: ChildId; age: number }[],
): Promise<Record<string, number>> {
	const allChildren = prefetchedChildren ?? (await findAllChildren(tenantId));
	const result: Record<string, number> = {};
	for (const childId of childIds) {
		const child = allChildren.find((c) => c.id === childId);
		const age = child?.age ?? 6;
		result[childId] = calcAgeAdjustedTarget(baseTarget, ageAdjustments, age);
	}
	return result;
}

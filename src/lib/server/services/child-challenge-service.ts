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

import { todayDateJST } from '$lib/domain/date-utils';
import { insertPointLedger } from '$lib/server/db/activity-repo';
import { findAllChildren } from '$lib/server/db/child-repo';
import { getRepos } from '$lib/server/db/factory';
import type {
	ChildChallenge,
	ChildChallengeGroup,
	ChildChallengeWithSiblings,
	InsertChildChallengeInput,
} from '$lib/server/db/types';
import { aggregateActivityLogsByCategory } from '$lib/server/services/activity-log-aggregation';

// ============================================================
// 週次チャレンジ生成アルゴリズム (#3194 / #3213、旧 auto-challenge-service より移設)
// 苦手中心＋時々得意の週次チャレンジを、行動科学・教育心理学ベースの
// ヒューリスティック＋調整可能定数で生成する純粋関数群。
// auto_challenges テーブル廃止 (#3213) に伴い child_challenges 一本化側へ移設した。
// 設計: docs/design/44-チャレンジ設計書.md §3.4 / docs/rationale/12-auto-challenge-generation-rationale.md
// ============================================================

/** Category IDs from the categories master table */
const ALL_CATEGORY_IDS = [1, 2, 3, 4, 5];

/** Category names for display (生成 challenge の view 整形でも再利用) */
export const CATEGORY_NAMES: Record<number, string> = {
	1: 'うんどう',
	2: 'べんきょう',
	3: 'せいかつ',
	4: 'こうりゅう',
	5: 'そうぞう',
};

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
	categoryId: number;
	/** 前週の目標回数 (翌週適応の Flow 分岐に使う) */
	targetCount: number;
	/** 前週の実績回数 (overshoot / reach ratio 計算に使う) */
	currentCount: number;
}

export interface ChallengeProposal {
	categoryId: number;
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
 * Get the current Monday's date string (YYYY-MM-DD) for a given date.
 * Uses local date components to avoid timezone issues.
 */
export function getWeekStart(date: Date = new Date()): string {
	const d = new Date(date);
	const day = d.getDay(); // 0=Sun, 1=Mon, ...
	const diff = day === 0 ? -6 : 1 - day; // Adjust to Monday
	d.setDate(d.getDate() + diff);
	const yyyy = d.getFullYear();
	const mm = String(d.getMonth() + 1).padStart(2, '0');
	const dd = String(d.getDate()).padStart(2, '0');
	return `${yyyy}-${mm}-${dd}`;
}

/** weekStart (YYYY-MM-DD, Monday) の 1 週間前の Monday を返す。 */
export function getLastWeekStart(weekStart: string): string {
	const [y, m, d] = weekStart.split('-').map(Number);
	const dt = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
	dt.setUTCDate(dt.getUTCDate() - 7);
	const yyyy = dt.getUTCFullYear();
	const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
	const dd = String(dt.getUTCDate()).padStart(2, '0');
	return `${yyyy}-${mm}-${dd}`;
}

/** weekStart を epoch からの週インデックスに変換する (得意週の周期判定用、決定的)。 */
function weekIndexOf(weekStart: string): number {
	const [y, m, d] = weekStart.split('-').map(Number);
	const ms = Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
	return Math.floor(ms / (7 * 24 * 60 * 60 * 1000));
}

/** 2 つの weekStart (Monday) 間の週数。連続週なら 1、1 週 skip なら 2 (#3203 item1)。 */
function weeksBetween(earlier: string, later: string): number {
	return weekIndexOf(later) - weekIndexOf(earlier);
}

/** 直近 2 週間のカテゴリ別記録数を集計する。週次自動生成の苦手判定入力に使う。 */
export async function aggregateCategoryCounts(
	childId: number,
	tenantId: string,
): Promise<Record<number, number>> {
	const now = new Date();
	const twoWeeksAgo = new Date(now);
	twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
	const fromDate = twoWeeksAgo.toISOString().slice(0, 10);
	const toDate = now.toISOString().slice(0, 10);

	const { summary } = await aggregateActivityLogsByCategory(childId, tenantId, {
		from: fromDate,
		to: toDate,
	});

	const counts: Record<number, number> = {};
	for (const catId of ALL_CATEGORY_IDS) {
		counts[catId] = summary.byCategory[catId]?.count ?? 0;
	}
	return counts;
}

/** 最多記録カテゴリ (得意) を返す。同数は最小 id を優先 (決定的)。 */
function strongestCategory(counts: Record<number, number>): number {
	let best = ALL_CATEGORY_IDS[0] ?? 1;
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
function hashSeed(childId: number, weekStart: string): number {
	let h = 2166136261 ^ childId; // FNV-1a 風
	for (let i = 0; i < weekStart.length; i++) {
		h = Math.imul(h ^ weekStart.charCodeAt(i), 16777619);
	}
	return h >>> 0;
}

/** mulberry32: seed から決定的な [0,1) 乱数を返す PRNG を作る。 */
function makeSeededRand(childId: number, weekStart: string): () => number {
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
	counts: Record<number, number>,
	rand: () => number,
	excludeId?: number,
): number {
	const cats = ALL_CATEGORY_IDS.filter((c) => c !== excludeId);
	const sorted = [...cats].sort((a, b) => (counts[a] ?? 0) - (counts[b] ?? 0));
	const weighted = sorted.map((c, rank) => ({ c, w: Math.max(1, WEAK_BIAS_BASE - rank) }));
	const total = weighted.reduce((s, x) => s + x.w, 0);
	let r = rand() * total;
	for (const x of weighted) {
		r -= x.w;
		if (r <= 0) return x.c;
	}
	return sorted[0] ?? ALL_CATEGORY_IDS[0] ?? 1;
}

function reasonFor(mode: ChallengeProposalMode, categoryName: string): string {
	switch (mode) {
		case 'explore':
			return 'まだ記録が少ないので、いろんなことにチャレンジしてみよう！';
		case 'strength':
			return `得意な「${categoryName}」をもっと伸ばしてみよう！`;
		case 'rescue-strength':
			return `得意な「${categoryName}」でリズムを取り戻そう！`;
		default:
			return `最近「${categoryName}」が少なめだったから、今週はチャレンジしてみよう！`;
	}
}

/** カテゴリ選択 (weighted interleaving §3.4)。explore / rescue-strength / strength / weakness を返す。 */
function selectCategory(
	counts: Record<number, number>,
	prev: ChallengePrev | undefined,
	weekStart: string,
	consecutiveMissCount: number,
	rand: () => number,
): { categoryId: number; mode: ChallengeProposalMode } {
	const totalRecords = Object.values(counts).reduce((a, b) => a + b, 0);
	if (totalRecords < MIN_RECORDS_FOR_ANALYSIS) {
		return {
			categoryId: ALL_CATEGORY_IDS[Math.floor(rand() * ALL_CATEGORY_IDS.length)] ?? 1,
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
	counts: Record<number, number>,
	prev: ChallengePrev | undefined,
	categoryId: number,
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
	counts: Record<number, number>,
	prev: ChallengePrev | undefined,
	weekStart: string,
	opts?: { childId?: number; skippedWeeks?: number },
): ChallengeProposal {
	// #3203 item2: childId 指定時は seed 化した決定的 RNG、未指定 (既存 test) は Math.random。
	const rand = opts?.childId != null ? makeSeededRand(opts.childId, weekStart) : Math.random;
	// #3203 item1: skippedWeeks = 直近生成週から今週までに challenge を生成しなかった (skip した) 週数。
	// 週を skip する child = disengaging であり rescue (Bandura mastery、易しい得意 challenge) の本来対象。
	// skip 週を miss として streak に加算し、跨いでも rescue を発火させる。
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
		reason: reasonFor(mode, categoryName),
	};
}

/** group key 解決 (admin getChallengeGroupsForAdmin と同一規約、ADR-0055 §4.7 整合) */
function resolveGroupKey(
	c: Pick<ChildChallenge, 'sourceTemplateId' | 'title' | 'startDate' | 'endDate'>,
): string {
	return c.sourceTemplateId ?? `${c.title}::${c.startDate}::${c.endDate}`;
}

interface TargetConfig {
	metric: 'count' | 'xp';
	categoryId?: number;
	activityId?: number;
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
		perChildTargets: Record<number, number>;
	},
	childIds: readonly number[],
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
 */
export async function getChallengeGroupsForAdmin(tenantId: string): Promise<ChildChallengeGroup[]> {
	const repos = getRepos();
	const all = await repos.childChallenge.findAllByTenant(tenantId);

	const groupMap = new Map<string, ChildChallenge[]>();
	for (const c of all) {
		const key = c.sourceTemplateId ?? `${c.title}::${c.startDate}::${c.endDate}`;
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
	const [y, m, d] = weekStart.split('-').map(Number);
	const dt = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
	dt.setUTCDate(dt.getUTCDate() + 6);
	const yyyy = dt.getUTCFullYear();
	const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
	const dd = String(dt.getUTCDate()).padStart(2, '0');
	return `${yyyy}-${mm}-${dd}`;
}

/** 前週の自動生成 child_challenge を computeProposal の prev 入力 (ChallengePrev 形) に写像する。 */
function toProposalPrev(row: ChildChallenge): ChallengePrev {
	let categoryId = 1;
	let genMissStreak = 0;
	try {
		const cfg = JSON.parse(row.targetConfig) as {
			categoryId?: number;
			genMissStreak?: number;
		};
		categoryId = cfg.categoryId ?? 1;
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
	childId: number,
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
			title: `今週は「${proposal.categoryName}」を${proposal.targetCount}回`,
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
	childId: number,
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
	id: number;
	categoryName: string;
	targetCount: number;
	currentCount: number;
	weekStart: string;
	status: 'active' | 'completed' | 'expired';
	progressPercent: number;
	description: string;
}

/** child_challenge row → 子供画面 view (categoryName は targetConfig.categoryId から解決)。 */
function toChildChallengeView(row: ChildChallenge): ChildChallengeView {
	let categoryId: number | undefined;
	try {
		const cfg = JSON.parse(row.targetConfig) as { categoryId?: number };
		categoryId = cfg.categoryId;
	} catch {
		// 破損 JSON は categoryName 空で続行
	}
	const categoryName = categoryId ? (CATEGORY_NAMES[categoryId] ?? '') : '';
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
		description: row.description ?? '',
	};
}

/**
 * #3195: 子供 challenges ページの当週アクティブ challenge を view 形で取得 (なければ自動生成)。
 * home の `getOrCreateWeeklyChildChallenge` と同一の生成入口を共有するため、challenges ページと
 * home は常に同一の週次 child_challenge を表示する (一本化、二重生成なし)。
 */
export async function getOrCreateWeeklyChildChallengeView(
	childId: number,
	tenantId: string,
): Promise<ChildChallengeView> {
	const row = await getOrCreateWeeklyChildChallenge(childId, tenantId);
	return toChildChallengeView(row);
}

/** #3195: 子供 challenges ページの履歴 (新しい順、上限 limit)。 */
export async function getChildChallengeHistory(
	childId: number,
	tenantId: string,
	limit = 10,
): Promise<ChildChallengeView[]> {
	const repos = getRepos();
	const all = await repos.childChallenge.findByChildId(childId, tenantId);
	return all
		.slice()
		.sort((a, b) => b.startDate.localeCompare(a.startDate))
		.slice(0, limit)
		.map(toChildChallengeView);
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
	childId: number,
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
 * 活動記録時の進捗更新フック。child の活動 1 件記録時に呼び出される。
 * 旧 sibling-challenge-service.checkChallengeProgress の per-child 後継。
 */
export async function updateChildChallengeProgress(
	childId: number,
	_activityId: number,
	categoryId: number,
	tenantId: string,
): Promise<{ challengeId: number; completed: boolean; challengeTitle: string }[]> {
	const repos = getRepos();
	const today = todayDateJST();
	const challenges = await repos.childChallenge.findActiveByChildId(childId, today, tenantId);
	const results: { challengeId: number; completed: boolean; challengeTitle: string }[] = [];

	for (const challenge of challenges) {
		if (challenge.completed === 1) continue;
		const targetConfig: TargetConfig = JSON.parse(challenge.targetConfig);
		if (targetConfig.categoryId && targetConfig.categoryId !== categoryId) continue;

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

/** ごほうび受取 (per-child instance ごと) */
export async function claimChildChallengeReward(
	challengeId: number,
	childId: number,
	tenantId: string,
): Promise<{ points: number; message?: string } | { error: string }> {
	const repos = getRepos();
	const challenge = await repos.childChallenge.findById(challengeId, tenantId);
	if (!challenge) return { error: 'チャレンジが見つかりません' };
	// IDOR 防御 + 事前 gate (childId 所有権 / completed)。rewardClaimed の最終判定は下の条件付き UPDATE で行う。
	if (challenge.childId !== childId) return { error: 'このチャレンジは別のお子さま用です' };
	if (challenge.completed !== 1) return { error: 'まだクリアしていません' };

	// claim-first (#3333): 先に条件付き claimReward を atomic に実行し、実際に flip できた (戻り値 === 1)
	// ときだけポイントを付与する。check-then-act だと並行 submit で findById が両方 rewardClaimed=0 を
	// 読み、insertPointLedger が 2 回走る TOCTOU 二重付与が起きるため、付与の前に flip を確定させる。
	const flipped = await repos.childChallenge.claimReward(challengeId, tenantId);
	if (flipped !== 1) return { error: 'すでに受け取り済みです' };

	const rewardConfig: RewardConfig = JSON.parse(challenge.rewardConfig);
	await insertPointLedger(
		{
			childId,
			amount: rewardConfig.points,
			type: 'child_challenge',
			description: `チャレンジ達成: ${challenge.title}`,
			referenceId: challengeId,
		},
		tenantId,
	);
	return { points: rewardConfig.points, message: rewardConfig.message };
}

/** 削除 (admin 画面から) */
export async function deleteChildChallenge(id: number, tenantId: string): Promise<void> {
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
	childIds: readonly number[],
	tenantId: string,
	prefetchedChildren?: readonly { id: number; age: number }[],
): Promise<Record<number, number>> {
	const allChildren = prefetchedChildren ?? (await findAllChildren(tenantId));
	const result: Record<number, number> = {};
	for (const childId of childIds) {
		const child = allChildren.find((c) => c.id === childId);
		const age = child?.age ?? 6;
		result[childId] = calcAgeAdjustedTarget(baseTarget, ageAdjustments, age);
	}
	return result;
}

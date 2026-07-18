// src/lib/server/demo/synthetic-staging-dataset.ts — staging 用 PII-free 合成ダミーデータセット (#3412)
//
// staging (NUC #2872 / AWS #2873) を本番 DB snapshot (実在の子供名・活動履歴 = PII、#2999) から
// 切り離すための合成 seed の SSOT。要件次元 (docs/research/2026-06-28-dummy-dataset-requirements.md §2)
// を「demo-data.ts の PII-free がんばり家 (Tenant A) + 薄い専用 tenant B〜D」の 5 tenant で網羅する
// (research §5 決定 = 選択肢 A+B)。
//
// 設計原則:
//   - **決定的** (AC3): 乱数・wall-clock 非使用。同一 anchorDate に対し常に byte 同一の出力。
//     既定 anchor は demo fixture の固定日 (SYNTHETIC_SEED_ANCHOR)。staging deploy 時は
//     `--anchor` に当日を渡すと全日付が一律 shift され「直近 14 日の履歴」として描画される
//     (offset は日数の純関数なので anchor を固定すれば出力も固定 = visual regression と両立)。
//   - **PII-free** (AC1): 人物名は SYNTHETIC_NICKNAME_ALLOWLIST の合成名のみ。機械 assert は
//     tests/unit/demo/synthetic-staging-dataset.test.ts (全走査 + email/電話 pattern 0 件)。
//   - **wire format 再利用** (#1442 / ADR-0066): 出力は export-service の ExportData (backup wire
//     format)。流し込みは既存 importFamilyData + nuc-cutover-verify 件数突合を再利用し、
//     専用 insert 経路を新設しない。
//
// 各 tenant の役割 (research §4):
//   A  premium-family : がんばり家 5 人 (5 age mode × 5 theme × M/F、demo-data.ts 変換)。フル機能表示
//   B  free           : 子供 1 人 + 最小データ。free gate / empty admin (D18)
//   C1 trial-active   : standard トライアル中 (バナー表示)
//   C2 trial-expired  : トライアル期限切れ + archive 済データ (D19)
//   D  empty          : 子供 0 人 (genuine-empty 全画面 + 初回オンボーディング)
//
// ロール軸 (owner/parent/child/ops/federated、research D8) は auth 層 (Cognito user) の関心で
// DB seed では表現しない。cognito staging のアカウント整備は DEV_USERS 同型で #2873 lane が担う。

import { CATEGORY_CODE_TO_ID, toCategoryCode } from '$lib/domain/categories';
import { SUBSCRIPTION_PLAN } from '$lib/domain/constants/subscription-plan';
import {
	SUBSCRIPTION_STATUS,
	type SubscriptionStatus,
} from '$lib/domain/constants/subscription-status';
import {
	EXPORT_FORMAT,
	EXPORT_VERSION,
	type ExportActivityLog,
	type ExportChild,
	type ExportChildActivity,
	type ExportDailyMission,
	type ExportData,
	type ExportSpecialReward,
	type ExportTransactionData,
} from '$lib/domain/export-format';
import { asChildId, type ChildId } from '$lib/domain/ids';
import { PLAN_FULL_TERMS } from '$lib/domain/terms';
import { LOCAL_TENANT_UUID } from '$lib/server/auth/local-tenant';
import type { ChildActivity } from '$lib/server/db/types/index.js';
import { finalizeExport } from '$lib/server/services/export-service';
import {
	DEMO_ACTIVITIES,
	DEMO_ACTIVITY_LOGS,
	DEMO_CERTIFICATES,
	DEMO_CHECKLIST_ITEMS,
	DEMO_CHECKLIST_TEMPLATES,
	DEMO_CHILD_ACTIVITIES,
	DEMO_CHILD_CHALLENGES,
	DEMO_CHILDREN,
	DEMO_DAILY_MISSIONS,
	DEMO_EVALUATIONS,
	DEMO_LOGIN_BONUSES,
	DEMO_MARKETPLACE_SPECIAL_REWARDS,
	DEMO_POINT_BALANCES,
	DEMO_SIBLING_CHEERS,
	DEMO_STAMP_CARDS,
	DEMO_STAMP_ENTRIES,
	DEMO_STATUSES,
	getDemoMarketplaceActivitiesByChild,
	getDemoMarketplaceChecklistItemsByTemplate,
	getDemoMarketplaceChecklistTemplatesByChild,
} from './demo-data';

// ============================================================
// Anchor (決定性の基準日)
// ============================================================

/** demo fixture の固定「今日」(demo-data.ts TODAY と同値)。既定 anchor = shift 0。 */
export const SYNTHETIC_SEED_ANCHOR = '2026-03-27';

/** anchor 間の日数差 (b - a、UTC 日割り)。 */
export function daysBetween(a: string, b: string): number {
	const ms = Date.parse(`${b}T00:00:00.000Z`) - Date.parse(`${a}T00:00:00.000Z`);
	return Math.round(ms / 86_400_000);
}

function shiftDateOnly(date: string, offsetDays: number): string {
	if (offsetDays === 0) return date;
	const d = new Date(`${date}T00:00:00.000Z`);
	d.setUTCDate(d.getUTCDate() + offsetDays);
	return d.toISOString().slice(0, 10);
}

function shiftIso(iso: string, offsetDays: number): string {
	if (offsetDays === 0) return iso;
	const d = new Date(iso);
	d.setUTCDate(d.getUTCDate() + offsetDays);
	return d.toISOString();
}

// ============================================================
// PII-free 保証 (機械 assert の SSOT)
// ============================================================

/**
 * データセットに出現してよい人物ニックネームの完全列挙 (合成名のみ)。
 * ここに無い nickname が 1 件でも出たら PII 混入疑いとして unit test が fail する。
 * 実在家族名の再混入事故 (demo-data.ts 2026-05-16 リネーム経緯) の構造的再発防止。
 */
export const SYNTHETIC_NICKNAME_ALLOWLIST: readonly string[] = [
	// Tenant A = demo-data.ts がんばり家 (PII-free 済)
	'たろうくん',
	'ひなちゃん',
	'けんたくん',
	'さくらちゃん',
	'けいすけくん',
	// Tenant B〜C2 (本 module 定義の合成 persona)
	'まなぶくん',
	'ももちゃん',
	'そらくん',
] as const;

// ============================================================
// Dataset envelope 型
// ============================================================

export const SYNTHETIC_DATASET_FORMAT = 'ganbari-quest-synthetic-staging-seed' as const;

export interface SyntheticTrialSpec {
	tier: 'standard' | 'family';
	/** anchor からの相対日数 (負 = 過去)。決定性のため絶対日付を持たない。 */
	startOffsetDays: number;
	endOffsetDays: number;
}

export interface SyntheticFamilySpec {
	name: string;
	/** families.status (subscription-status.ts SSOT) */
	status: SubscriptionStatus;
	/** families.plan (subscription-plan.ts SSOT)。null = free (未課金) */
	plan: string | null;
}

export interface SyntheticTenant {
	key: 'premium-family' | 'free' | 'trial-active' | 'trial-expired' | 'empty';
	tenantUuid: string;
	description: string;
	family: SyntheticFamilySpec;
	trial: SyntheticTrialSpec | null;
	/** backup wire format の家族データ。null = 空 tenant (行を一切 seed しない) */
	data: ExportData | null;
}

export interface SyntheticStagingDataset {
	format: typeof SYNTHETIC_DATASET_FORMAT;
	version: 1;
	anchorDate: string;
	tenants: SyntheticTenant[];
}

/** trial 相対 offset を anchor 基準の絶対日付 (start/end) に解決する (apply 時に使用)。 */
export function resolveTrialWindow(
	trial: SyntheticTrialSpec,
	anchorDate: string,
): { startDate: string; endDate: string } {
	return {
		startDate: shiftDateOnly(anchorDate, trial.startOffsetDays),
		endDate: shiftDateOnly(anchorDate, trial.endOffsetDays),
	};
}

// ============================================================
// Tenant A — がんばり家 (demo-data.ts → wire format 変換)
// ============================================================

function categoryCodeOf(categoryId: unknown): string {
	return toCategoryCode(categoryId as Parameters<typeof toCategoryCode>[0]) ?? 'seikatsu';
}

/** demo 内部 sourcePresetId (`demo:<masterId>`) は marketplace 由来ではないため null に落とす。 */
function normalizePresetId(sourcePresetId: string | null | undefined): string | null {
	if (!sourcePresetId) return null;
	return sourcePresetId.startsWith('demo:') ? null : sourcePresetId;
}

function emptyTransactionData(): ExportTransactionData {
	return {
		childActivities: [],
		activityLogs: [],
		pointLedger: [],
		statuses: [],
		statusHistory: [],
		childAchievements: [],
		childTitles: [],
		loginBonuses: [],
		evaluations: [],
		specialRewards: [],
		rewardRedemptions: [],
		childChallenges: [],
		stampCards: [],
		certificates: [],
		parentMessages: [],
		siblingCheers: [],
		activityPrefs: [],
		checklistTemplates: [],
		checklistLogs: [],
		checklistOverrides: [],
		restDays: [],
		childVoices: [],
		childAvatarItems: [],
		dailyMissions: [],
		settings: [],
	};
}

type ExportBody = Omit<ExportData, 'checksum'>;

function baseBody(
	anchorDate: string,
	children: ExportChild[],
	data: ExportTransactionData,
): ExportBody {
	return {
		format: EXPORT_FORMAT,
		version: EXPORT_VERSION,
		// 決定性: wall-clock を使わず anchor 由来の固定時刻にする
		exportedAt: `${anchorDate}T09:00:00.000Z`,
		master: { categories: [], activities: [], titles: [], achievements: [], avatarItems: [] },
		family: { children },
		data,
	};
}

function toExportChildActivity(a: ChildActivity, childRef: string): ExportChildActivity {
	return {
		childRef,
		name: a.name,
		categoryCode: categoryCodeOf(a.categoryId),
		icon: a.icon,
		basePoints: a.basePoints,
		triggerHint: a.triggerHint,
		isMainQuest: a.isMainQuest,
		priority: a.priority,
		sourcePresetId: normalizePresetId(a.sourcePresetId),
		isVisible: a.isVisible,
		sortOrder: a.sortOrder,
		isArchived: a.isArchived,
		archivedReason: a.archivedReason,
		dailyLimit: a.dailyLimit,
		nameKana: a.nameKana,
		nameKanji: a.nameKanji,
	};
}

function buildTenantABody(anchorDate: string): ExportBody {
	const offset = daysBetween(SYNTHETIC_SEED_ANCHOR, anchorDate);
	const d = (v: string): string => shiftDateOnly(v, offset);
	const ts = (v: string): string => shiftIso(v, offset);
	const tsOrNull = (v: string | null): string | null => (v === null ? null : ts(v));

	// children (5 age mode × 5 theme × M/F、D1-D3)。birthDate も同一 offset で shift し、
	// compute-on-read (age = birth_date 起点) の age-tier 網羅が anchor に依らず保たれるようにする。
	const childRefById = new Map<ChildId, string>();
	const children: ExportChild[] = DEMO_CHILDREN.map((c, i) => {
		const ref = `child-${i + 1}`;
		childRefById.set(c.id, ref);
		return {
			exportId: ref,
			nickname: c.nickname,
			age: c.age,
			birthDate: c.birthDate === null ? null : d(c.birthDate),
			theme: c.theme,
			uiMode: c.uiMode,
			avatarUrl: c.avatarUrl,
			activeTitle: null,
			createdAt: ts(c.createdAt),
			sourceChildId: c.id,
		};
	});
	const refOf = (childId: ChildId): string | undefined => childRefById.get(childId);

	// per-child 活動 (D10 per-child instance): 手作り fixture + marketplace 取込済 pack (D11)
	const childActivities: ExportChildActivity[] = [];
	const activityNamesByChild = new Map<string, Set<string>>();
	const pushChildActivity = (entry: ExportChildActivity): void => {
		const names = activityNamesByChild.get(entry.childRef) ?? new Set<string>();
		if (names.has(entry.name)) return; // per-child 同名重複は import が dedup する前に除く (決定的)
		names.add(entry.name);
		activityNamesByChild.set(entry.childRef, names);
		childActivities.push(entry);
	};
	for (const a of DEMO_CHILD_ACTIVITIES) {
		const ref = refOf(a.childId);
		if (!ref) continue;
		pushChildActivity(toExportChildActivity(a, ref));
	}
	for (const c of DEMO_CHILDREN) {
		const ref = refOf(c.id);
		if (!ref) continue;
		for (const a of getDemoMarketplaceActivitiesByChild(c.id)) {
			pushChildActivity(
				toExportChildActivity(
					{ ...a, childId: c.id, dailyLimit: a.dailyLimit ?? null } as unknown as ChildActivity,
					ref,
				),
			);
		}
	}

	// activityId → 活動名の解決 (log / dailyMission 用)。
	//   1. 同 child の per-child fixture の sourcePresetId `demo:<masterId>` に一致
	//   2. master fixture (DEMO_ACTIVITIES) の同 id の name が同 child の活動名に存在
	// 解決できない行は決定的に drop する (件数突合は本 dataset 自身を期待値にするため整合)。
	const resolveActivityName = (childId: ChildId, activityId: unknown): string | null => {
		const ref = refOf(childId);
		if (!ref) return null;
		const names = activityNamesByChild.get(ref);
		if (!names) return null;
		const fromPerChild = DEMO_CHILD_ACTIVITIES.find(
			(a) => a.childId === childId && a.sourcePresetId === `demo:${activityId}`,
		);
		if (fromPerChild && names.has(fromPerChild.name)) return fromPerChild.name;
		const master = DEMO_ACTIVITIES.find((a) => a.id === activityId);
		if (master && names.has(master.name)) return master.name;
		return null;
	};

	const activityLogs: ExportActivityLog[] = [];
	for (const log of DEMO_ACTIVITY_LOGS) {
		const ref = refOf(log.childId);
		const name = resolveActivityName(log.childId, log.activityId);
		if (!ref || !name) continue;
		const activity = childActivities.find((a) => a.childRef === ref && a.name === name) ?? null;
		activityLogs.push({
			childRef: ref,
			activityName: name,
			activityCategory: activity?.categoryCode ?? 'seikatsu',
			points: log.points,
			streakDays: log.streakDays,
			streakBonus: log.streakBonus,
			recordedDate: d(log.recordedDate),
			recordedAt: ts(log.recordedAt),
			cancelled: log.cancelled !== 0,
		});
	}

	const dailyMissions: ExportDailyMission[] = [];
	for (const m of DEMO_DAILY_MISSIONS) {
		const ref = refOf(m.childId);
		const name = resolveActivityName(m.childId, m.activityId);
		if (!ref || !name) continue;
		dailyMissions.push({
			childRef: ref,
			missionDate: d(m.missionDate),
			activityName: name,
			completed: m.completed !== 0,
			completedAt: tsOrNull(m.completedAt),
		});
	}

	// ごほうび (D14): marketplace reward-set 由来 (sourcePresetId 付き = D11) + 交換申請 3 status
	const specialRewards: ExportSpecialReward[] = DEMO_MARKETPLACE_SPECIAL_REWARDS.flatMap((r) => {
		const ref = refOf(r.childId);
		if (!ref) return [];
		return [
			{
				childRef: ref,
				title: r.title,
				description: r.description,
				points: r.points,
				icon: r.icon,
				category: r.category,
				grantedAt: ts(r.grantedAt),
				sourcePresetId: normalizePresetId(r.sourcePresetId),
				exportId: `reward-${ref}-${r.id}`,
			},
		];
	});
	const rewardsOf903 = specialRewards.filter((r) => r.childRef === refOf(asChildId(903)));
	// requestedAt 系は epoch **秒** (reward-redemption-repo の epochToIso 契約)
	const redemptionAnchorSec = Math.floor(Date.parse(`${anchorDate}T09:00:00.000Z`) / 1000);
	const rewardRedemptions = rewardsOf903.slice(0, 3).map((r, i) => ({
		childRef: r.childRef,
		rewardRef: r.title,
		rewardExportId: r.exportId ?? null,
		requestedAt: redemptionAnchorSec - (i + 1) * 86_400,
		status: (['pending_parent_approval', 'approved', 'rejected'] as const)[i] as string,
		parentNote: i === 2 ? 'ポイントがたりないので今回は見送り' : null,
		resolvedAt: i === 0 ? null : redemptionAnchorSec - i * 43_200,
		resolvedByParentId: null,
		shownToChildAt: i === 1 ? redemptionAnchorSec - 21_600 : null,
		rewardTitle: r.title,
		rewardPoints: r.points,
		rewardIcon: r.icon,
	}));

	// checklist (D10 family master + assignment): 手作り + marketplace 由来
	const checklistTemplates = [
		...DEMO_CHECKLIST_TEMPLATES.map((t) => ({ template: t, items: DEMO_CHECKLIST_ITEMS })),
		...DEMO_CHILDREN.flatMap((c) =>
			getDemoMarketplaceChecklistTemplatesByChild(c.id).map((t) => ({
				template: t,
				items: getDemoMarketplaceChecklistItemsByTemplate(t.id),
			})),
		),
	].flatMap(({ template, items }) => {
		const ref = refOf(template.childId);
		if (!ref) return [];
		return [
			{
				childRef: ref,
				name: template.name,
				icon: template.icon,
				pointsPerItem: template.pointsPerItem,
				completionBonus: template.completionBonus,
				isActive: template.isActive !== 0,
				isArchived: template.isArchived !== 0,
				sourcePresetId: normalizePresetId(template.sourcePresetId),
				exportId: `checklist-${ref}-${template.id}`,
				items: items
					.filter((it) => it.templateId === template.id)
					.map((it) => ({
						name: it.name,
						icon: it.icon,
						frequency: it.frequency,
						direction: it.direction,
						sortOrder: it.sortOrder,
					})),
			},
		];
	});

	// スタンプカード (D15): card + entries を nested 化
	const stampCards = DEMO_STAMP_CARDS.flatMap((card) => {
		const ref = refOf(card.childId);
		if (!ref) return [];
		return [
			{
				childRef: ref,
				weekStart: d(card.weekStart),
				weekEnd: d(card.weekEnd),
				status: card.status,
				redeemedPoints: card.redeemedPoints,
				redeemedAt: tsOrNull(card.redeemedAt),
				createdAt: ts(card.createdAt),
				updatedAt: ts(card.updatedAt),
				entries: DEMO_STAMP_ENTRIES.filter((e) => e.cardId === card.id).map((e) => ({
					stampMasterId: e.stampMasterId,
					omikujiRank: e.omikujiRank,
					slot: e.slot,
					loginDate: d(e.loginDate),
					earnedAt: ts(e.earnedAt),
				})),
			},
		];
	});

	const body = baseBody(anchorDate, children, {
		...emptyTransactionData(),
		childActivities,
		activityLogs,
		// point 残高 (demo と同値): 残高 = ledger 合算になるよう 1 行の付与 entry に集約
		pointLedger: DEMO_CHILDREN.flatMap((c) => {
			const ref = refOf(c.id);
			const balance = DEMO_POINT_BALANCES[String(c.id)] ?? 0;
			if (!ref || balance <= 0) return [];
			return [
				{
					childRef: ref,
					amount: balance,
					type: 'activity',
					description: '合成 seed 初期残高',
					createdAt: `${anchorDate}T00:00:00.000Z`,
				},
			];
		}),
		statuses: DEMO_STATUSES.flatMap((s) => {
			const ref = refOf(s.childId);
			if (!ref) return [];
			return [
				{
					childRef: ref,
					categoryCode: categoryCodeOf(s.categoryId),
					totalXp: s.totalXp,
					level: s.level,
					peakXp: s.peakXp,
					updatedAt: ts(s.updatedAt),
				},
			];
		}),
		loginBonuses: DEMO_LOGIN_BONUSES.flatMap((b) => {
			const ref = refOf(b.childId);
			if (!ref) return [];
			return [
				{
					childRef: ref,
					loginDate: d(b.loginDate),
					rank: b.rank,
					basePoints: b.basePoints,
					multiplier: b.multiplier,
					totalPoints: b.totalPoints,
					consecutiveDays: b.consecutiveDays,
					createdAt: ts(b.createdAt),
				},
			];
		}),
		evaluations: DEMO_EVALUATIONS.flatMap((e) => {
			const ref = refOf(e.childId);
			if (!ref) return [];
			return [
				{
					childRef: ref,
					weekStart: d(e.weekStart),
					weekEnd: d(e.weekEnd),
					scoresJson: e.scoresJson,
					bonusPoints: e.bonusPoints,
					createdAt: ts(e.createdAt),
				},
			];
		}),
		specialRewards,
		rewardRedemptions,
		childChallenges: DEMO_CHILD_CHALLENGES.flatMap((c) => {
			const ref = refOf(c.childId);
			if (!ref) return [];
			return [
				{
					childRef: ref,
					title: c.title,
					description: c.description,
					challengeType: c.challengeType,
					periodType: c.periodType,
					startDate: d(c.startDate),
					endDate: d(c.endDate),
					targetConfig: c.targetConfig,
					rewardConfig: c.rewardConfig,
					status: c.status,
					isActive: c.isActive,
					sourceTemplateId: c.sourceTemplateId,
					currentValue: c.currentValue,
					targetValue: c.targetValue,
					completed: c.completed,
					completedAt: tsOrNull(c.completedAt),
					rewardClaimed: c.rewardClaimed,
					rewardClaimedAt: tsOrNull(c.rewardClaimedAt),
					createdAt: ts(c.createdAt),
					updatedAt: ts(c.updatedAt),
				},
			];
		}),
		stampCards,
		certificates: DEMO_CERTIFICATES.flatMap((c) => {
			const ref = refOf(c.childId);
			if (!ref) return [];
			return [
				{
					childRef: ref,
					certificateType: c.certificateType,
					title: c.title,
					description: c.description,
					issuedAt: ts(c.issuedAt),
					metadata: c.metadata,
				},
			];
		}),
		// 親→子おうえんメッセージ (D20)
		parentMessages: [
			{
				childRef: 'child-2',
				messageType: 'stamp',
				// STAMP_PRESETS (message-service.ts) の実在 code を使う
				stampCode: 'sugoi',
				body: null,
				icon: '🌟',
				sentAt: ts('2026-03-26T18:00:00.000Z'),
				shownAt: ts('2026-03-26T18:30:00.000Z'),
				bonusPoints: null,
				rewardCategory: null,
			},
			{
				childRef: 'child-3',
				messageType: 'text',
				stampCode: null,
				body: 'しゅくだい がんばってるね！',
				icon: '💌',
				sentAt: ts('2026-03-27T08:00:00.000Z'),
				shownAt: null,
				bonusPoints: null,
				rewardCategory: null,
			},
		],
		siblingCheers: DEMO_SIBLING_CHEERS.flatMap((c) => {
			const fromRef = refOf(c.fromChildId);
			const toRef = refOf(c.toChildId);
			if (!fromRef || !toRef) return [];
			return [
				{
					fromChildRef: fromRef,
					toChildRef: toRef,
					stampCode: c.stampCode,
					sentAt: ts(c.sentAt),
					shownAt: tsOrNull(c.shownAt),
				},
			];
		}),
		checklistTemplates,
		dailyMissions,
	});
	// マスタ活動 (setup wizard 相当の活動候補一覧)
	body.master.activities = DEMO_ACTIVITIES.map((a) => ({
		name: a.name,
		categoryCode: categoryCodeOf(a.categoryId),
		icon: a.icon,
		basePoints: a.basePoints,
		gradeLevel: a.gradeLevel,
		nameKana: a.nameKana,
		nameKanji: a.nameKanji,
		triggerHint: a.triggerHint,
		sourcePresetId: normalizePresetId(a.sourcePresetId),
	}));
	return body;
}

// ============================================================
// Tenant B / C1 / C2 (薄い専用 persona、research §4)
// ============================================================

interface SmallChildSpec {
	nickname: string;
	age: number;
	birthOffsetDays: number; // anchor からの相対 (負)。age-tier が anchor に依らず一定になる
	theme: string;
	uiMode: string;
}

function buildSmallBody(
	anchorDate: string,
	child: SmallChildSpec,
	options: { logDays: number[]; archived?: boolean },
): ExportBody {
	const d = (offset: number): string => shiftDateOnly(anchorDate, offset);
	const iso = (offset: number): string => `${shiftDateOnly(anchorDate, offset)}T09:00:00.000Z`;
	const children: ExportChild[] = [
		{
			exportId: 'child-1',
			nickname: child.nickname,
			age: child.age,
			birthDate: d(child.birthOffsetDays),
			theme: child.theme,
			uiMode: child.uiMode,
			avatarUrl: null,
			activeTitle: null,
			createdAt: iso(-30),
		},
	];
	const activities: ExportChildActivity[] = [
		{
			childRef: 'child-1',
			name: 'はみがき',
			categoryCode: 'seikatsu',
			icon: '🦷',
			basePoints: 5,
			triggerHint: null,
			isMainQuest: 0,
			priority: 'must',
			sourcePresetId: null,
			isVisible: 1,
			sortOrder: 1,
			isArchived: 0,
			archivedReason: null,
		},
		{
			childRef: 'child-1',
			name: 'おてつだい',
			categoryCode: 'seikatsu',
			icon: '🧹',
			basePoints: 10,
			triggerHint: null,
			isMainQuest: 0,
			priority: 'optional',
			sourcePresetId: null,
			isVisible: 1,
			sortOrder: 2,
			isArchived: 0,
			archivedReason: null,
		},
	];
	if (options.archived) {
		// D19: トライアル期限切れ由来の archive 済 instance (ARCHIVED_REASONS SSOT 準拠)
		activities.push({
			childRef: 'child-1',
			name: 'ならいごとのれんしゅう',
			categoryCode: 'souzou',
			icon: '🎹',
			basePoints: 15,
			triggerHint: null,
			isMainQuest: 0,
			priority: 'optional',
			sourcePresetId: null,
			isVisible: 1,
			sortOrder: 3,
			isArchived: 1,
			archivedReason: 'trial_expired',
		});
	}
	const activityLogs: ExportActivityLog[] = options.logDays.map((offset, i) => ({
		childRef: 'child-1',
		activityName: i % 2 === 0 ? 'はみがき' : 'おてつだい',
		activityCategory: 'seikatsu',
		points: i % 2 === 0 ? 5 : 10,
		streakDays: 1,
		streakBonus: 0,
		recordedDate: d(offset),
		recordedAt: iso(offset),
		cancelled: false,
	}));
	const body = baseBody(anchorDate, children, {
		...emptyTransactionData(),
		childActivities: activities,
		activityLogs,
		pointLedger:
			activityLogs.length > 0
				? [
						{
							childRef: 'child-1',
							amount: activityLogs.reduce((sum, l) => sum + l.points, 0),
							type: 'activity',
							description: '合成 seed 初期残高',
							createdAt: iso(0),
						},
					]
				: [],
	});
	if (options.archived) {
		body.data.checklistTemplates = [
			{
				childRef: 'child-1',
				name: 'とこうじゅんび (きゅうし中)',
				icon: '🎒',
				pointsPerItem: 2,
				completionBonus: 5,
				isActive: false,
				isArchived: true,
				sourcePresetId: null,
				exportId: 'checklist-child-1-archived',
				items: [
					{ name: 'ハンカチ', icon: '🧻', frequency: 'daily', direction: 'positive', sortOrder: 1 },
				],
			},
		];
	}
	return body;
}

// ============================================================
// Dataset builder (pure、決定的)
// ============================================================

/**
 * 合成 staging データセットを構築する (AC1-AC3)。
 * anchorDate 既定 = SYNTHETIC_SEED_ANCHOR (shift 0 = demo fixture 素値、byte 決定的)。
 * staging deploy では当日を渡し「直近履歴」として描画させる (同一 anchor なら出力同一)。
 */
export async function buildSyntheticStagingDataset(
	anchorDate: string = SYNTHETIC_SEED_ANCHOR,
): Promise<SyntheticStagingDataset> {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(anchorDate)) {
		throw new Error(`anchorDate は YYYY-MM-DD 形式で指定してください: ${anchorDate}`);
	}
	const finalize = async (body: ExportBody): Promise<ExportData> =>
		(await finalizeExport(body)).exportData;

	const tenantA = await finalize(buildTenantABody(anchorDate));
	const tenantB = await finalize(
		buildSmallBody(
			anchorDate,
			// 小学生 1 人 (単独子構成、D9)。birthDate は anchor - 7歳ぶん
			{
				nickname: 'まなぶくん',
				age: 7,
				birthOffsetDays: -(365 * 7 + 40),
				theme: 'blue',
				uiMode: 'elementary',
			},
			{ logDays: [0, -1, -3] },
		),
	);
	const tenantC1 = await finalize(
		buildSmallBody(
			anchorDate,
			{
				nickname: 'ももちゃん',
				age: 4,
				birthOffsetDays: -(365 * 4 + 100),
				theme: 'pink',
				uiMode: 'preschool',
			},
			{ logDays: [0, -1] },
		),
	);
	const tenantC2 = await finalize(
		buildSmallBody(
			anchorDate,
			{
				nickname: 'そらくん',
				age: 13,
				birthOffsetDays: -(365 * 13 + 200),
				theme: 'green',
				uiMode: 'junior',
			},
			{ logDays: [-25, -27, -29], archived: true },
		),
	);

	return {
		format: SYNTHETIC_DATASET_FORMAT,
		version: 1,
		anchorDate,
		tenants: [
			{
				key: 'premium-family',
				tenantUuid: LOCAL_TENANT_UUID,
				description:
					'がんばり家 5 人 (demo-data.ts 再利用)。5 age mode × 5 theme × M/F、marketplace 取込済、フル機能表示。NUC local staging の単一 tenant として可視',
				family: {
					name: 'がんばり家',
					status: SUBSCRIPTION_STATUS.ACTIVE,
					plan: SUBSCRIPTION_PLAN.FAMILY_MONTHLY,
				},
				trial: null,
				data: tenantA,
			},
			{
				key: 'free',
				tenantUuid: '00000000-0000-4000-8000-0000000000b1',
				description: `${PLAN_FULL_TERMS.free}。子供 1 人 + 最小データ、marketplace 未取込 (empty admin、D18)`,
				family: { name: 'まなび家', status: SUBSCRIPTION_STATUS.ACTIVE, plan: null },
				trial: null,
				data: tenantB,
			},
			{
				key: 'trial-active',
				tenantUuid: '00000000-0000-4000-8000-0000000000c1',
				description: 'standard トライアル中 (anchor-2日 開始 / anchor+5日 終了、バナー表示)',
				family: { name: 'もも家', status: SUBSCRIPTION_STATUS.ACTIVE, plan: null },
				trial: { tier: 'standard', startOffsetDays: -2, endOffsetDays: 5 },
				data: tenantC1,
			},
			{
				key: 'trial-expired',
				tenantUuid: '00000000-0000-4000-8000-0000000000c2',
				description:
					'トライアル期限切れ (anchor-30日 開始 / anchor-23日 終了) + archive 済データ (D19)',
				family: { name: 'そら家', status: SUBSCRIPTION_STATUS.ACTIVE, plan: null },
				trial: { tier: 'family', startOffsetDays: -30, endOffsetDays: -23 },
				data: tenantC2,
			},
			{
				key: 'empty',
				tenantUuid: '00000000-0000-4000-8000-0000000000d1',
				description: '空 tenant (子供 0 人)。genuine-empty 全画面 + 初回オンボーディング導線 (D18)',
				family: { name: 'はじまり家', status: SUBSCRIPTION_STATUS.ACTIVE, plan: null },
				trial: null,
				data: null,
			},
		],
	};
}

// re-export (categories SSOT からの派生確認用。CATEGORY_CODE_TO_ID は builder の
// fallback 'seikatsu' が実在 code であることを test が assert するために公開参照する)
export { CATEGORY_CODE_TO_ID };

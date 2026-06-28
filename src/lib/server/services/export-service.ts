// src/lib/server/services/export-service.ts
// 家族データエクスポートサービス（Phase 1: エクスポートのみ）

import {
	EXPORT_FORMAT,
	EXPORT_VERSION,
	EXPORTABLE_SETTING_KEYS,
	type ExportAchievement,
	type ExportActivity,
	type ExportActivityLog,
	type ExportCategory,
	type ExportCertificate,
	type ExportChecklistLog,
	type ExportChecklistTemplate,
	type ExportChild,
	type ExportChildActivity,
	type ExportChildChallenge,
	type ExportData,
	type ExportEvaluation,
	type ExportLoginBonus,
	type ExportOptions,
	type ExportParentMessage,
	type ExportPointLedger,
	type ExportRewardRedemption,
	type ExportSetting,
	type ExportSpecialReward,
	type ExportStampCard,
	type ExportStatus,
	type ExportStatusHistory,
	type ExportTitle,
	type ExportTransactionData,
} from '$lib/domain/export-format';
import { CATEGORY_CODES } from '$lib/domain/validation/activity';
import { findActivities, findActivityLogs } from '$lib/server/db/activity-repo';
import {
	findLogsByChild,
	findTemplateItems,
	findTemplatesByChild,
} from '$lib/server/db/checklist-repo';
import { findAllChildren } from '$lib/server/db/child-repo';
import { findEvaluationsByChild } from '$lib/server/db/evaluation-repo';
import { getRepos } from '$lib/server/db/factory';
import { findRecentBonuses } from '$lib/server/db/login-bonus-repo';
import { findPointHistory } from '$lib/server/db/point-repo';
import { findRedemptionRequestsByTenant } from '$lib/server/db/reward-redemption-repo';
import { getSettings } from '$lib/server/db/settings-repo';
import { findSpecialRewards } from '$lib/server/db/special-reward-repo';
import { findRecentStatusHistory, findStatuses } from '$lib/server/db/status-repo';
import { logger } from '$lib/server/logger';

// カテゴリID → コード マッピング（5件固定）
const CATEGORY_ID_TO_CODE: Record<number, string> = {
	1: CATEGORY_CODES[0], // undou
	2: CATEGORY_CODES[1], // benkyou
	3: CATEGORY_CODES[2], // seikatsu
	4: CATEGORY_CODES[3], // kouryuu
	5: CATEGORY_CODES[4], // souzou
};

// カテゴリID → 情報マッピング
const CATEGORY_INFO: ExportCategory[] = [
	{ id: 1, code: 'undou', name: 'うんどう', icon: '🏃', color: '#FF6B6B' },
	{ id: 2, code: 'benkyou', name: 'べんきょう', icon: '📚', color: '#4ECDC4' },
	{ id: 3, code: 'seikatsu', name: 'せいかつ', icon: '🏠', color: '#45B7D1' },
	{ id: 4, code: 'kouryuu', name: 'こうりゅう', icon: '🤝', color: '#96CEB4' },
	{ id: 5, code: 'souzou', name: 'そうぞう', icon: '🎨', color: '#DDA0DD' },
];

const MAX_EXPORT_ROWS = 999999;

function getCategoryCode(categoryId: number): string {
	return CATEGORY_ID_TO_CODE[categoryId] ?? 'unknown';
}

/**
 * SHA-256 チェックサムを計算
 */
async function computeChecksum(data: string): Promise<string> {
	const encoder = new TextEncoder();
	const buffer = encoder.encode(data);
	const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	return `sha256:${hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * 家族データをエクスポート
 */
export async function exportFamilyData(options: ExportOptions): Promise<ExportData> {
	const { tenantId, childIds } = options;

	logger.info('[export] エクスポート開始', { context: { tenantId, childIds } });

	// 子供一覧の取得
	let allChildren = await findAllChildren(tenantId);
	if (childIds && childIds.length > 0) {
		const idSet = new Set(childIds);
		allChildren = allChildren.filter((c) => idSet.has(c.id));
	}

	if (allChildren.length === 0) {
		logger.warn('[export] エクスポート対象の子供がいません');
	}

	// マスタデータの取得
	const activitiesRaw = await findActivities(tenantId);

	// 実績システム廃止（#322）— achievementMap は空
	const achievementMap = new Map<number, { code: string }>();
	// マスタデータの変換
	// #2458-A1: gradeLevel は ChildActivity per-child instance に存在しない (ADR-0055)。
	// _toActivityShape adapter で null 化されているため null を export する。
	// 後方互換のため field 自体は残す (import 側で null tolerated)。
	const masterActivities: ExportActivity[] = activitiesRaw.map((a) => ({
		name: a.name,
		categoryCode: getCategoryCode(a.categoryId),
		icon: a.icon,
		basePoints: a.basePoints,
		gradeLevel: a.gradeLevel,
		nameKana: a.nameKana,
		nameKanji: a.nameKanji,
		triggerHint: a.triggerHint,
		sourcePresetId: a.sourcePresetId,
	}));

	// 称号システム廃止（#322）— 空配列
	const masterTitles: ExportTitle[] = [];

	// 実績システム廃止（#322）— 空配列
	const masterAchievements: ExportAchievement[] = [];

	// 子供データの変換
	const exportChildren: ExportChild[] = allChildren.map((child, index) => ({
		exportId: `child-${index + 1}`,
		nickname: child.nickname,
		age: child.age,
		birthDate: child.birthDate,
		theme: child.theme,
		uiMode: child.uiMode,
		avatarUrl: child.avatarUrl,
		activeTitle: null, // 称号システム廃止（#322）
		createdAt: child.createdAt,
		sourceChildId: child.id, // #3077: ZIP 静的ファイルの id 再マップ用
	}));

	// childId → exportId マッピング
	const childExportIdMap = new Map(
		allChildren.map((child, index) => [child.id, `child-${index + 1}`]),
	);

	// 各子供のトランザクションデータを収集
	const transactionData = await collectTransactionData(
		allChildren.map((c) => c.id),
		childExportIdMap,
		achievementMap,
		tenantId,
	);

	// チェックサム計算用の仮データ構築
	const exportDataWithoutChecksum = {
		format: EXPORT_FORMAT,
		version: EXPORT_VERSION,
		exportedAt: new Date().toISOString(),
		checksum: '',
		master: {
			categories: CATEGORY_INFO,
			activities: masterActivities,
			titles: masterTitles,
			achievements: masterAchievements,
			avatarItems: [],
		},
		family: {
			children: exportChildren,
		},
		data: transactionData,
	};

	// チェックサム計算（checksum フィールドを除いたJSON文字列のハッシュ）
	const checksumPayload = JSON.stringify({
		...exportDataWithoutChecksum,
		checksum: undefined,
	});
	const checksum = await computeChecksum(checksumPayload);

	const exportData: ExportData = {
		...exportDataWithoutChecksum,
		checksum,
	};

	const totalRecords =
		transactionData.activityLogs.length +
		transactionData.pointLedger.length +
		transactionData.statuses.length +
		transactionData.childAchievements.length;

	logger.info('[export] エクスポート完了', {
		context: {
			children: exportChildren.length,
			activities: masterActivities.length,
			totalRecords,
		},
	});

	return exportData;
}

/**
 * capped query が cap ちょうどの件数を返した = silent truncation の可能性を observable にする
 * (#3259 perf-6、no-silent-cap 原則。MAX_EXPORT_ROWS で頭打ちした export は半損のため warn する)。
 */
function warnIfTruncated(kind: string, childId: number, count: number): void {
	if (count >= MAX_EXPORT_ROWS) {
		logger.warn(
			'[export] 取得件数が上限に達しました — export が truncate されている可能性があります',
			{
				context: { kind, childId, count, cap: MAX_EXPORT_ROWS },
			},
		);
	}
}

/** 1 child 分の transaction データ。collectForChild が返し、collectTransactionData が childIds 順に連結する。 */
interface ChildTransactionData {
	childActivities: ExportChildActivity[];
	activityLogs: ExportActivityLog[];
	pointLedger: ExportPointLedger[];
	statuses: ExportStatus[];
	statusHistory: ExportStatusHistory[];
	loginBonuses: ExportLoginBonus[];
	evaluations: ExportEvaluation[];
	specialRewards: ExportSpecialReward[];
	rewardRedemptions: ExportRewardRedemption[];
	childChallenges: ExportChildChallenge[];
	stampCards: ExportStampCard[];
	certificates: ExportCertificate[];
	parentMessages: ExportParentMessage[];
	checklistTemplates: ExportChecklistTemplate[];
	checklistLogs: ExportChecklistLog[];
}

/**
 * 1 child 分の全 transaction データを収集する。
 * #3259 perf-6: 旧実装は childIds を sequential `for...of await` で回し N child = N 回の
 * 直列ラウンドトリップになっていた (N+1)。本関数を child 単位に切り出し、呼び出し側で
 * `Promise.all(childIds.map(...))` 並列化する。出力は childIds 順に連結するため checksum は決定的。
 */
async function collectForChild(
	childId: number,
	childExportIdMap: Map<number, string>,
	tenantId: string,
): Promise<ChildTransactionData> {
	const childRef = childExportIdMap.get(childId) ?? `child-${childId}`;

	// 各データを並列取得
	const [
		childActivitiesRaw,
		activityLogs,
		pointHistory,
		statuses,
		loginBonuses,
		evaluations,
		specialRewards,
		redemptions,
		challenges,
		stampCardsRaw,
		certificatesRaw,
		parentMessagesRaw,
		checklistTemplates,
	] = await Promise.all([
		// #3327 P2: per-child 活動インスタンスを backup に保持 (archive 済も含む)。
		getRepos().childActivity.findActivitiesByChild(childId, tenantId, { includeArchived: true }),
		findActivityLogs(childId, tenantId),
		findPointHistory(childId, { limit: MAX_EXPORT_ROWS, offset: 0 }, tenantId),
		findStatuses(childId, tenantId),
		findRecentBonuses(childId, tenantId, MAX_EXPORT_ROWS),
		findEvaluationsByChild(childId, MAX_EXPORT_ROWS, tenantId),
		findSpecialRewards(childId, tenantId),
		// #3329: ごほうびショップ交換/購入履歴を backup に保持 (WithDetails = snapshot 解決済の
		// rewardTitle/Icon/Points 付き)。childId filter で per-child 収集する。
		findRedemptionRequestsByTenant(tenantId, { childId, limit: MAX_EXPORT_ROWS }),
		// #3329: per-child チャレンジ instance を backup に保持 (auto:weekly 含む全 status)。
		getRepos().childChallenge.findByChildId(childId, tenantId),
		// #3329: per-child スタンプカードを backup に保持 (entry は後段で card ごとに収集)。
		getRepos().stampCard.findCardsByChild(childId, tenantId),
		// #3329: per-child 証明書を backup に保持。
		getRepos().certificate.findCertificates(childId, tenantId),
		// #3329: 親→子おうえんメッセージを backup に保持。
		getRepos().message.findMessages(childId, MAX_EXPORT_ROWS, tenantId),
		// #3106: backup なので includeInactive=true + includeArchived=true。
		// archive 済 template も含め、その checklistLog の silent drop を防ぐ。
		findTemplatesByChild(childId, tenantId, true, true),
	]);

	// #3327 P2: per-child 活動を childRef 付きで出力 (master flatten の binding 喪失を補う)。
	const childActivitiesOut: ExportChildActivity[] = childActivitiesRaw.map((a) => ({
		childRef,
		name: a.name,
		categoryCode: getCategoryCode(a.categoryId),
		icon: a.icon,
		basePoints: a.basePoints,
		triggerHint: a.triggerHint,
		isMainQuest: a.isMainQuest,
		priority: a.priority,
		sourcePresetId: a.sourcePresetId ?? null,
		isVisible: a.isVisible,
		sortOrder: a.sortOrder,
		// #3358: archive 状態を round-trip 保全 (archived→active 復活防止)
		isArchived: a.isArchived,
		archivedReason: a.archivedReason ?? null,
	}));

	// ステータス履歴は全カテゴリ分を取得
	const statusHistoryResults = await Promise.all(
		[1, 2, 3, 4, 5].map((catId) =>
			findRecentStatusHistory(childId, catId, tenantId, MAX_EXPORT_ROWS),
		),
	);

	// #3259 perf-6: cap 到達 (= 取りこぼし可能性) を observable 化
	warnIfTruncated('pointLedger', childId, pointHistory.length);
	warnIfTruncated('loginBonuses', childId, loginBonuses.length);
	warnIfTruncated('evaluations', childId, evaluations.length);
	for (const entries of statusHistoryResults) {
		warnIfTruncated('statusHistory', childId, entries.length);
	}

	const activityLogsOut: ExportActivityLog[] = activityLogs.map((log) => ({
		childRef,
		activityName: log.activityName,
		activityCategory: getCategoryCode(log.categoryId),
		points: log.points,
		streakDays: log.streakDays,
		streakBonus: log.streakBonus,
		recordedDate: log.recordedAt.split('T')[0] ?? log.recordedAt,
		recordedAt: log.recordedAt,
		cancelled: false,
	}));

	const pointLedgerOut: ExportPointLedger[] = pointHistory.map((entry) => ({
		childRef,
		amount: entry.amount,
		type: entry.type,
		description: entry.description,
		createdAt: entry.createdAt,
	}));

	const statusesOut: ExportStatus[] = statuses.map((status) => ({
		childRef,
		categoryCode: getCategoryCode(status.categoryId),
		totalXp: status.totalXp,
		level: status.level,
		peakXp: status.peakXp,
		updatedAt: status.updatedAt,
	}));

	const statusHistoryOut: ExportStatusHistory[] = statusHistoryResults.flatMap((entries) =>
		entries.map((entry) => ({
			childRef,
			categoryCode: getCategoryCode(entry.categoryId),
			value: entry.value,
			changeAmount: entry.changeAmount,
			changeType: entry.changeType,
			recordedAt: entry.recordedAt,
		})),
	);

	// 実績システム廃止（#322）— Achievements / Titles スキップ

	const loginBonusesOut: ExportLoginBonus[] = loginBonuses.map((lb) => ({
		childRef,
		loginDate: lb.loginDate,
		rank: lb.rank,
		basePoints: lb.basePoints,
		multiplier: lb.multiplier,
		totalPoints: lb.totalPoints,
		consecutiveDays: lb.consecutiveDays,
		createdAt: lb.createdAt,
	}));

	const evaluationsOut: ExportEvaluation[] = evaluations.map((ev) => ({
		childRef,
		weekStart: ev.weekStart,
		weekEnd: ev.weekEnd,
		scoresJson: ev.scoresJson,
		bonusPoints: ev.bonusPoints,
		createdAt: ev.createdAt,
	}));

	const specialRewardsOut: ExportSpecialReward[] = specialRewards.map((sr) => ({
		childRef,
		title: sr.title,
		description: sr.description,
		points: sr.points,
		icon: sr.icon,
		category: sr.category,
		grantedAt: sr.grantedAt,
		sourcePresetId: sr.sourcePresetId,
	}));

	// #3329: 交換履歴。FK rewardId は import 後に変わるため rewardRef (reward title) で再結合する。
	// WithDetails の rewardTitle は snapshot 優先で解決済 (COALESCE(snapshot, live))。
	warnIfTruncated('rewardRedemptions', childId, redemptions.length);
	const rewardRedemptionsOut: ExportRewardRedemption[] = redemptions.map((r) => ({
		childRef,
		rewardRef: r.rewardTitle,
		requestedAt: r.requestedAt,
		status: r.status,
		parentNote: r.parentNote,
		resolvedAt: r.resolvedAt,
		resolvedByParentId: r.resolvedByParentId,
		shownToChildAt: r.shownToChildAt,
		rewardTitle: r.rewardTitle,
		rewardPoints: r.rewardPoints,
		rewardIcon: r.rewardIcon,
	}));

	// #3329: per-child チャレンジ instance を childRef 付きで出力 (進捗/完了/請求/status 保全)。
	warnIfTruncated('childChallenges', childId, challenges.length);
	const childChallengesOut: ExportChildChallenge[] = challenges.map((c) => ({
		childRef,
		title: c.title,
		description: c.description,
		challengeType: c.challengeType,
		periodType: c.periodType,
		startDate: c.startDate,
		endDate: c.endDate,
		targetConfig: c.targetConfig,
		rewardConfig: c.rewardConfig,
		status: c.status,
		isActive: c.isActive,
		sourceTemplateId: c.sourceTemplateId,
		currentValue: c.currentValue,
		targetValue: c.targetValue,
		completed: c.completed,
		completedAt: c.completedAt,
		rewardClaimed: c.rewardClaimed,
		rewardClaimedAt: c.rewardClaimedAt,
		createdAt: c.createdAt,
		updatedAt: c.updatedAt,
	}));

	// #3329: スタンプカード + 押印 entry を nested で出力。card ごとに entry を引く (件数小)。
	warnIfTruncated('stampCards', childId, stampCardsRaw.length);
	const stampRepo = getRepos().stampCard;
	const stampCardsOut: ExportStampCard[] = await Promise.all(
		stampCardsRaw.map(async (card) => {
			const entries = await stampRepo.findEntriesByCardId(card.id, tenantId);
			return {
				childRef,
				weekStart: card.weekStart,
				weekEnd: card.weekEnd,
				status: card.status,
				redeemedPoints: card.redeemedPoints,
				redeemedAt: card.redeemedAt,
				createdAt: card.createdAt,
				updatedAt: card.updatedAt,
				entries: entries.map((e) => ({
					stampMasterId: e.stampMasterId,
					omikujiRank: e.omikujiRank,
					slot: e.slot,
					loginDate: e.loginDate,
					earnedAt: e.earnedAt,
				})),
			};
		}),
	);
	// #3329: per-child 証明書を childRef 付きで出力 (issuedAt/metadata 保全)。
	warnIfTruncated('certificates', childId, certificatesRaw.length);
	const certificatesOut: ExportCertificate[] = certificatesRaw.map((c) => ({
		childRef,
		certificateType: c.certificateType,
		title: c.title,
		description: c.description,
		issuedAt: c.issuedAt,
		metadata: c.metadata,
	}));

	// #3329: 親→子おうえんメッセージを childRef 付きで出力 (sentAt/shownAt 保全)。
	warnIfTruncated('parentMessages', childId, parentMessagesRaw.length);
	const parentMessagesOut: ExportParentMessage[] = parentMessagesRaw.map((m) => ({
		childRef,
		messageType: m.messageType,
		stampCode: m.stampCode,
		body: m.body,
		icon: m.icon,
		sentAt: m.sentAt,
		shownAt: m.shownAt,
		bonusPoints: m.bonusPoints,
		rewardCategory: m.rewardCategory,
	}));

	// Checklist templates with items
	// #3078 / #3107: templateId → (name, exportId) マップを構築し checklistLogs の参照解決に使う。
	// exportId は export 内で安定な識別子 (`chk-${childRef}-${templateId}`) で、同名 template が
	// 複数あっても log を取り違えない round-trip キーにする。
	// #3259 perf-6: template ごとの findTemplateItems も sequential N+1 だったため Promise.all 並列化
	// (出力は checklistTemplates の元順を維持するため index 対応で組み立てる)。
	const templateItems = await Promise.all(
		checklistTemplates.map((tpl) => findTemplateItems(tpl.id, tenantId)),
	);
	const templateNameById = new Map<number, string>();
	const exportIdByTemplateId = new Map<number, string>();
	const checklistTemplatesOut: ExportChecklistTemplate[] = checklistTemplates.map((tpl, idx) => {
		templateNameById.set(tpl.id, tpl.name);
		const exportId = `chk-${childRef}-${tpl.id}`;
		exportIdByTemplateId.set(tpl.id, exportId);
		return {
			childRef,
			name: tpl.name,
			icon: tpl.icon,
			pointsPerItem: tpl.pointsPerItem,
			completionBonus: tpl.completionBonus,
			isActive: tpl.isActive === 1,
			sourcePresetId: tpl.sourcePresetId,
			exportId, // #3107
			isArchived: tpl.isArchived === 1, // #3106: archive 状態を round-trip 保全
			items: (templateItems[idx] ?? []).map((item) => ({
				name: item.name,
				icon: item.icon,
				frequency: item.frequency,
				direction: item.direction,
				sortOrder: item.sortOrder,
			})),
		};
	});

	// #3078 / #3106: チェックリスト完了ログ。#3106 で archive 済 template も export に含めたため、
	// その log も exportId 経由で保全される (従来は name 解決不能で silent drop していた)。
	const checklistLogsRaw = await findLogsByChild(childId, tenantId);
	const checklistLogsOut: ExportChecklistLog[] = [];
	for (const log of checklistLogsRaw) {
		const templateName = templateNameById.get(log.templateId);
		const templateExportId = exportIdByTemplateId.get(log.templateId);
		// template が export に含まれない場合のみスキップ (#3106 で archived も含むため通常は解決可)
		if (!templateName || !templateExportId) continue;
		checklistLogsOut.push({
			childRef,
			templateName,
			templateExportId, // #3107: import 側はこれを優先して再マップ
			checkedDate: log.checkedDate,
			itemsJson: log.itemsJson,
			completedAll: log.completedAll === 1,
			pointsAwarded: log.pointsAwarded,
			createdAt: log.createdAt,
		});
	}

	return {
		childActivities: childActivitiesOut,
		activityLogs: activityLogsOut,
		pointLedger: pointLedgerOut,
		statuses: statusesOut,
		statusHistory: statusHistoryOut,
		loginBonuses: loginBonusesOut,
		evaluations: evaluationsOut,
		specialRewards: specialRewardsOut,
		rewardRedemptions: rewardRedemptionsOut,
		childChallenges: childChallengesOut,
		stampCards: stampCardsOut,
		certificates: certificatesOut,
		parentMessages: parentMessagesOut,
		checklistTemplates: checklistTemplatesOut,
		checklistLogs: checklistLogsOut,
	};
}

async function collectTransactionData(
	childIds: number[],
	childExportIdMap: Map<number, string>,
	_achievementMap: Map<number, { code: string }>,
	tenantId: string,
): Promise<ExportTransactionData> {
	// #3259 perf-6: child を並列収集 (旧 sequential N+1 解消)。Promise.all は入力順を維持するため、
	// 連結後の childRef 順は childIds 順で決定的 = checksum 安定 (round-trip 不変)。
	const perChild = await Promise.all(
		childIds.map((childId) => collectForChild(childId, childExportIdMap, tenantId)),
	);

	// #3329: 各種設定 (tenant-scoped KVS)。default-deny allowlist のキーのみ取得し、
	// pin_hash / session_token 等の秘匿キーは構造的に export に載らない (CWE-522/916、D3)。
	// key 昇順で push して checksum を決定的に保つ。
	const settingsMap = await getSettings([...EXPORTABLE_SETTING_KEYS], tenantId);
	const settingsOut: ExportSetting[] = Object.keys(settingsMap)
		.sort()
		.map((key) => ({ key, value: settingsMap[key] as string }));

	return {
		childActivities: perChild.flatMap((p) => p.childActivities),
		activityLogs: perChild.flatMap((p) => p.activityLogs),
		pointLedger: perChild.flatMap((p) => p.pointLedger),
		statuses: perChild.flatMap((p) => p.statuses),
		statusHistory: perChild.flatMap((p) => p.statusHistory),
		childAchievements: [], // 実績システム廃止（#322）
		childTitles: [], // 称号システム廃止（#322）
		loginBonuses: perChild.flatMap((p) => p.loginBonuses),
		evaluations: perChild.flatMap((p) => p.evaluations),
		specialRewards: perChild.flatMap((p) => p.specialRewards),
		rewardRedemptions: perChild.flatMap((p) => p.rewardRedemptions),
		childChallenges: perChild.flatMap((p) => p.childChallenges),
		stampCards: perChild.flatMap((p) => p.stampCards),
		certificates: perChild.flatMap((p) => p.certificates),
		parentMessages: perChild.flatMap((p) => p.parentMessages),
		checklistTemplates: perChild.flatMap((p) => p.checklistTemplates),
		checklistLogs: perChild.flatMap((p) => p.checklistLogs), // #3078
		childAvatarItems: [],
		dailyMissions: [], // Phase 2: エフェメラルデータ対応後に対応
		settings: settingsOut, // #3329
	};
}

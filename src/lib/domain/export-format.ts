// src/lib/domain/export-format.ts
// エクスポートファイルのフォーマット型定義

export const EXPORT_FORMAT = 'ganbari-quest-backup' as const;
// #1254 G1: 1.2.0 で `sourcePresetId` フィールドを追加 (activities / specialRewards / checklistTemplates)
export const EXPORT_VERSION = '1.2.0' as const;

// ============================================================
// マスタデータ型
// ============================================================

export interface ExportCategory {
	id: number;
	code: string;
	name: string;
	icon: string | null;
	color: string | null;
}

export interface ExportActivity {
	name: string;
	categoryCode: string;
	icon: string;
	basePoints: number;
	gradeLevel: string | null;
	nameKana: string | null;
	nameKanji: string | null;
	triggerHint: string | null;
	// #1254 G1: マーケットプレイスプリセット由来の識別子 (v1.2.0+)
	sourcePresetId?: string | null;
}

export interface ExportTitle {
	code: string;
	name: string;
	icon: string;
	rarity: string;
}

export interface ExportAchievement {
	code: string;
	name: string;
	icon: string;
	rarity: string;
}

// ============================================================
// 家族データ型
// ============================================================

export interface ExportChild {
	exportId: string;
	nickname: string;
	age: number;
	birthDate: string | null;
	theme: string;
	uiMode: string;
	avatarUrl: string | null;
	activeTitle: string | null;
	createdAt: string;
	/**
	 * #3077: エクスポート元の数値 childId。ZIP 同梱の静的ファイル
	 * (`avatars/{childId}/…` / `voices/{childId}/…`) を import 時に
	 * 新 childId へ再マップするために用いる (v1.3.0+、省略時は静的ファイル再配置スキップ)。
	 */
	sourceChildId?: number;
}

// ============================================================
// トランザクションデータ型
// ============================================================

export interface ExportActivityLog {
	childRef: string;
	activityName: string;
	activityCategory: string;
	points: number;
	streakDays: number;
	streakBonus: number;
	recordedDate: string;
	recordedAt: string;
	cancelled: boolean;
}

export interface ExportPointLedger {
	childRef: string;
	amount: number;
	type: string;
	description: string | null;
	createdAt: string;
}

export interface ExportStatus {
	childRef: string;
	categoryCode: string;
	totalXp: number;
	level: number;
	peakXp: number;
	updatedAt: string;
}

export interface ExportStatusHistory {
	childRef: string;
	categoryCode: string;
	value: number;
	changeAmount: number;
	changeType: string;
	recordedAt: string;
}

export interface ExportChildAchievement {
	childRef: string;
	achievementCode: string;
	milestoneValue: number | null;
	unlockedAt: string;
}

export interface ExportChildTitle {
	childRef: string;
	titleCode: string;
	unlockedAt: string;
}

export interface ExportLoginBonus {
	childRef: string;
	loginDate: string;
	rank: string;
	basePoints: number;
	multiplier: number;
	totalPoints: number;
	consecutiveDays: number;
	createdAt: string;
}

export interface ExportEvaluation {
	childRef: string;
	weekStart: string;
	weekEnd: string;
	scoresJson: string;
	bonusPoints: number;
	createdAt: string;
}

export interface ExportSpecialReward {
	childRef: string;
	title: string;
	description: string | null;
	points: number;
	icon: string | null;
	category: string;
	grantedAt: string;
	// #1254 G1: マーケットプレイスプリセット由来の識別子 (v1.2.0+)
	sourcePresetId?: string | null;
}

export interface ExportChecklistTemplate {
	childRef: string;
	name: string;
	icon: string;
	pointsPerItem: number;
	completionBonus: number;
	isActive: boolean;
	items: ExportChecklistTemplateItem[];
	// #1254 G1: マーケットプレイスプリセット由来の識別子 (v1.2.0+)
	sourcePresetId?: string | null;
}

export interface ExportChecklistTemplateItem {
	name: string;
	icon: string;
	frequency: string;
	direction: string;
	sortOrder: number;
}

export interface ExportChecklistLog {
	childRef: string;
	templateName: string;
	checkedDate: string;
	itemsJson: string;
	completedAll: boolean;
	pointsAwarded: number;
	createdAt: string;
}

export interface ExportDailyMission {
	childRef: string;
	missionDate: string;
	activityName: string;
	completed: boolean;
	completedAt: string | null;
}

// ============================================================
// ルートエクスポート型
// ============================================================

export interface ExportMasterData {
	categories: ExportCategory[];
	activities: ExportActivity[];
	titles: ExportTitle[];
	achievements: ExportAchievement[];
	avatarItems: never[];
}

export interface ExportTransactionData {
	activityLogs: ExportActivityLog[];
	pointLedger: ExportPointLedger[];
	statuses: ExportStatus[];
	statusHistory: ExportStatusHistory[];
	childAchievements: ExportChildAchievement[];
	childTitles: ExportChildTitle[];
	loginBonuses: ExportLoginBonus[];
	evaluations: ExportEvaluation[];
	specialRewards: ExportSpecialReward[];
	checklistTemplates: ExportChecklistTemplate[];
	checklistLogs: ExportChecklistLog[];
	childAvatarItems: never[];
	dailyMissions: ExportDailyMission[];
}

export interface ExportData {
	format: typeof EXPORT_FORMAT;
	version: string;
	exportedAt: string;
	checksum: string;
	master: ExportMasterData;
	family: {
		children: ExportChild[];
	};
	data: ExportTransactionData;
}

export interface ExportOptions {
	tenantId: string;
	childIds?: number[];
	compact?: boolean;
}

// ============================================================
// Content-Disposition (RFC 5987) — #3104
// ============================================================

/**
 * `Content-Disposition: attachment` ヘッダ値を RFC 5987 準拠で組む (#3104)。
 *
 * 背景: HTTP ヘッダ値は ByteString (Latin-1, ≤ U+00FF) のため、日本語等の非 ASCII を
 * `filename="..."` に直接入れると `new Response()` が TypeError (ByteString 変換失敗) を投げ
 * 500 になる (checklists/export が日本語名テンプレで全滅した #3104 の root cause)。
 *
 * 対策: ASCII fallback (`filename=`、非 ASCII を `_` 置換) と RFC 5987
 * (`filename*=UTF-8''<percent-encoded>`) を併記する。modern browser は `filename*` を
 * 優先し日本語名を復元、`filename*` 非対応の旧 browser は ASCII fallback を使う。
 *
 * 動的に user データからファイル名を組む全 export 経路は本関数を経由すること
 * (静的 ASCII 名は対象外で可、横展開方針 #3104)。
 *
 * @param filename ダウンロード時のファイル名 (拡張子込み、非 ASCII 可)
 */
export function buildAttachmentContentDisposition(filename: string): string {
	// ASCII fallback: 非 ASCII (> U+007E) と制御文字 (< U+0020) と " \ を `_` に置換し
	// ByteString 安全 + ヘッダ injection 安全にする (printable ASCII 0x20-0x7E 以外 + 引用符)
	const asciiFallback = filename.replace(/[^ -~]|["\\]/g, '_');
	// RFC 5987: UTF-8 を percent-encoding (encodeURIComponent は RFC 5987 の値表現として十分)
	const encoded = encodeURIComponent(filename);
	return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}

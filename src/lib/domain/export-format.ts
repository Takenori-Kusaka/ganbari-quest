// src/lib/domain/export-format.ts
// エクスポートファイルのフォーマット型定義

export const EXPORT_FORMAT = 'ganbari-quest-backup' as const;
// #1254 G1: 1.2.0 で `sourcePresetId` フィールドを追加 (activities / specialRewards / checklistTemplates)
// #3106 / #3107: 1.3.0 で checklist の `exportId` / `isArchived` / log `templateExportId` を追加
//   (archive 済 template の log 保全 + 同名 template の round-trip 取り違え防止)。いずれも optional で後方互換。
// #3329: 1.4.0 で `data.settings` (各種設定 KVS の allowlist) を追加。optional で後方互換。
// #3358: 1.5.0 で childActivity の `isArchived` / `archivedReason` を追加 (isVisible / sortOrder は
//   1.4.0 以前から存在)。archived 済活動が import 後に active へ復活する round-trip 取りこぼし
//   (第10回監査 data-5) の修正。いずれも optional で後方互換 (旧 backup は非アーカイブとして復元)。
export const EXPORT_VERSION = '1.5.0' as const;

// ============================================================
// #3329: backup 可能な設定キーの allowlist (default-deny セキュリティ設計、D3)
// ============================================================
// settings は任意キーの KVS。backup に「全キー」を載せると pin_hash (bcrypt の おやカギコード) /
// session_token / lockout 状態 等の認証情報・秘匿状態が平文 ZIP に漏れる (CWE-522 平文認証情報 /
// CWE-916 不十分なハッシュ保護 = bcrypt hash の offline crack 露出)。
// そこで「載せてよいキーだけを明示列挙する default-deny allowlist」を採用する。新キー追加時は
// デフォルト除外 = 安全側に倒れ、ユーザー設定として保全したい場合のみ意図的に本列挙へ足す。
//
// 意図的除外 (本 allowlist に**載せない**もの):
//   - 認証/秘匿 (CWE-522/916): pin_hash / pin_locked_until / pin_failed_attempts / pin_reset_applied /
//     session_token / session_expires_at
//   - 課金/アカウントライフサイクル (環境間で移送すべきでない状態): deletion_grace_plan_tier /
//     physical_deletion_date / soft_deleted_at / premium_welcome_shown / trial_expiration_modal_shown /
//     dormant_reactivation_sent / marketing_unsubscribed_at
// import 側でも本 allowlist で再 filter する (改竄/旧 backup に pin_hash が混在しても書き戻さない多層防御)。
export const EXPORTABLE_SETTING_KEYS = [
	'decay_intensity',
	'notification_achievements_enabled',
	'notification_quiet_end',
	'notification_quiet_start',
	'notification_reminder_time',
	'notification_reminders_enabled',
	'notification_streak_enabled',
	'pin_gate_onboarding_seen',
	'point_currency',
	'point_rate',
	'point_unit_mode',
	'questionnaire_activity_level',
	'questionnaire_challenges',
	'reward_auto_approve',
	'sibling_ranking_enabled',
	'tutorial_banner_dismissed',
	'tutorial_completed_at',
	'tutorial_started_at',
	'weekly_report_day',
	'weekly_report_enabled',
] as const;

/** #3329: 設定キーが backup allowlist に含まれるか (export/import 双方の filter に使う SSOT)。 */
export function isExportableSettingKey(key: string): boolean {
	return (EXPORTABLE_SETTING_KEYS as readonly string[]).includes(key);
}

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

/**
 * per-child 活動インスタンス (#3327 P2)。`master.activities` の名前 flatten・dedup では
 * per-child binding が失われ replace import で全活動が喪失するため、childRef 付きで
 * 子ごとの活動を保持する (ADR-0055 per-child instance を round-trip 復元する SSOT)。
 */
export interface ExportChildActivity {
	/** どの子の活動か (ExportChild.exportId 参照) */
	childRef: string;
	name: string;
	categoryCode: string;
	icon: string;
	basePoints: number;
	triggerHint: string | null;
	isMainQuest: number;
	priority: string;
	sourcePresetId: string | null;
	isVisible: number;
	sortOrder: number;
	// #3358: archive 状態を round-trip 保全 (optional で後方互換、旧 backup は非アーカイブ復元)
	isArchived?: number;
	archivedReason?: string | null;
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

export interface ExportRewardRedemption {
	childRef: string;
	/** import 後に FK rewardId を再解決するための reward タイトル (per-child で一意) */
	rewardRef: string;
	requestedAt: number;
	status: string;
	parentNote: string | null;
	resolvedAt: number | null;
	resolvedByParentId: string | null;
	shownToChildAt: number | null;
	// #2832: 申請時点 snapshot (reward 改名/削除後も申請時の内容で表示・控除する)
	rewardTitle: string | null;
	rewardPoints: number | null;
	rewardIcon: string | null;
}

export interface ExportSetting {
	key: string;
	value: string;
}

/**
 * #3329: per-child チャレンジ instance (auto:weekly 自動週次も sourceTemplateId='auto:weekly' の
 * 行として同テーブルに含まれるため本 export で両方を保全する)。進捗 / 完了 / 請求 / status を round-trip
 * 復元する (id / childId は import で振り直すため childRef で再結合)。
 */
export interface ExportChildChallenge {
	childRef: string;
	title: string;
	description: string | null;
	challengeType: string;
	periodType: string;
	startDate: string;
	endDate: string;
	targetConfig: string;
	rewardConfig: string;
	status: string;
	isActive: number;
	sourceTemplateId: string | null;
	currentValue: number;
	targetValue: number;
	completed: number;
	completedAt: string | null;
	rewardClaimed: number;
	rewardClaimedAt: string | null;
	createdAt: string;
	updatedAt: string;
}

/**
 * #3329: per-child スタンプカード (週単位) + 押印 entry を nested で保全する。
 * stampMasterId はグローバル master (環境間で同一 seed) を参照するため値のまま保持する
 * (import 時に存在しなければ当該 entry を skip)。card status / redeemed / earnedAt を round-trip 復元。
 */
export interface ExportStampEntry {
	stampMasterId: number | null;
	omikujiRank: string | null;
	slot: number;
	loginDate: string;
	earnedAt: string;
}

export interface ExportStampCard {
	childRef: string;
	weekStart: string;
	weekEnd: string;
	status: string;
	redeemedPoints: number | null;
	redeemedAt: string | null;
	createdAt: string;
	updatedAt: string;
	entries: ExportStampEntry[];
}

/**
 * #3329: per-child 証明書 (がんばり証明書/卒業証明書 等の授与記録)。issuedAt / metadata を保全して
 * round-trip 復元する (id / tenantId は import 環境で振り直すため childRef で再結合)。
 */
export interface ExportCertificate {
	childRef: string;
	certificateType: string;
	title: string;
	description: string | null;
	issuedAt: string;
	metadata: string | null;
}

/**
 * #3329: 親→子おうえんメッセージ (stamp/text/reward_notice)。sentAt / shownAt (既読) を保全して
 * round-trip 復元する (id / childId は import 環境で振り直すため childRef で再結合)。
 */
export interface ExportParentMessage {
	childRef: string;
	messageType: string;
	stampCode: string | null;
	body: string | null;
	icon: string;
	sentAt: string;
	shownAt: string | null;
	bonusPoints: number | null;
	rewardCategory: string | null;
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
	// #3107: export 内で安定な template 識別子 (v1.3.0+)。checklistLog の round-trip キーに使い、
	// 同名 template が複数あっても log を取り違えない。旧 export には無いため optional。
	exportId?: string;
	// #3106: archive 状態を round-trip で保全 (v1.3.0+)。旧 export には無いため optional (未指定=非 archived)。
	isArchived?: boolean;
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
	// #3107: 紐づく template の安定識別子 (v1.3.0+)。import 側はこれを優先して再マップし、
	// 無い場合 (旧 export) のみ templateName で fallback する。
	templateExportId?: string;
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
	/** #3327 P2: per-child 活動インスタンス (master.activities の binding 喪失を補う) */
	childActivities: ExportChildActivity[];
	activityLogs: ExportActivityLog[];
	pointLedger: ExportPointLedger[];
	statuses: ExportStatus[];
	statusHistory: ExportStatusHistory[];
	childAchievements: ExportChildAchievement[];
	childTitles: ExportChildTitle[];
	loginBonuses: ExportLoginBonus[];
	evaluations: ExportEvaluation[];
	specialRewards: ExportSpecialReward[];
	/** #3329: ごほうびショップ交換/購入履歴 (per-child、rewardRef で reward に再結合) */
	rewardRedemptions: ExportRewardRedemption[];
	/** #3329: per-child チャレンジ instance (auto:weekly 含む。進捗/完了/請求を保全) */
	childChallenges: ExportChildChallenge[];
	/** #3329: per-child スタンプカード + 押印 entry (nested、status/redeemed/earnedAt 保全) */
	stampCards: ExportStampCard[];
	/** #3329: per-child 証明書 (がんばり/卒業証明書 授与記録、issuedAt/metadata 保全) */
	certificates: ExportCertificate[];
	/** #3329: 親→子おうえんメッセージ (sentAt/shownAt 保全) */
	parentMessages: ExportParentMessage[];
	checklistTemplates: ExportChecklistTemplate[];
	checklistLogs: ExportChecklistLog[];
	childAvatarItems: never[];
	dailyMissions: ExportDailyMission[];
	/** #3329: 各種設定 (tenant-scoped KVS、allowlist 済キーのみ。pin_hash 等の秘匿キーは除外) */
	settings: ExportSetting[];
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
 * (静的 ASCII 名 / timestamp・数値のみの補間は対象外で可、横展開方針 #3104)。
 * **新規 export endpoint で user データ由来の動的ファイル名を Content-Disposition に入れる場合は
 * 必ず本関数を経由する** (header 直書きすると #3104 ByteString 500 + injection が再発する、#3115)。
 *
 * @param filename ダウンロード時のファイル名 (拡張子込み、非 ASCII 可)
 */
export function buildAttachmentContentDisposition(filename: string): string {
	// ASCII fallback: 非 ASCII (> U+007E) / 制御文字 (< U+0020) / " \ ; = を `_` に置換し
	// ByteString 安全 + ヘッダ injection 安全にする (printable ASCII 0x20-0x7E 以外 + 引用符)。
	// #3115: `;` `=` も `_` 化する (defense-in-depth)。RFC 6266 の quoted-string 内では `;` `=` は
	// 本来 inert だが、寛容/非準拠なパーサ・proxy・WAF が `filename="x"; foo=bar` を directive
	// injection と解釈するリスクを断つ。CR/LF (header splitting) は制御文字として既に塞がれている。
	const asciiFallback = filename.replace(/[^ -~]|["\\;=]/g, '_');
	// RFC 5987 ext-value: encodeURIComponent は ' ( ) * ! ~ を escape しないが、これらは
	// RFC 5987 ext-value grammar の attr-char ではないため、strict parser / proxy / WAF が
	// 不正値として reject しうる。追加で percent-encode し attr-char + pct-encoded のみにする。
	const encoded = encodeURIComponent(filename).replace(
		/['()*!~]/g,
		(c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
	);
	return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}

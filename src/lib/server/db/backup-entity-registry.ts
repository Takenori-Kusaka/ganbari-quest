// src/lib/server/db/backup-entity-registry.ts
// #3329: backup 対象実体の分類 SSOT（source / 派生 / 除外）。
//
// 背景: export/import が「アプリの保存する実体の一部」しか扱わず、replace import で活動・評価・
// ごほうび交換履歴・設定 等が silent に失われた (本番 t-82c17558 で実証)。
//
// 権威列挙 (#3329 QM BLOCK 是正): 実体の「真実集合」は `schema.ts` の **全 sqliteTable 定義**である。
// 旧実装は `keys.ts` の key builder のみを列挙していたため、key builder を持たない実テーブル
// (rest_days / child_custom_voices / usage_logs / stamp_masters) が盲点となり緑通過していた。
// 本レジストリは各実体に `schemaTable` (対応する schema.ts の table const 名) を持たせ、
// `tests/unit/db/backup-entity-registry.test.ts` が **「schema.ts の全テーブル ⊆ 本レジストリ」**を
// 主軸で機械検証する (key builder の有無に依らず全実体を分類強制)。keys.ts の key builder 照合は
// DynamoDB single-table key の網羅を担保する補助軸として残す。
// 新実体 (schema テーブル or key builder) を追加して分類を忘れると test が fail し、
// 「backup 対象への入れ忘れ」を CI で弾く (silent-gap ガード、設計 doc backup-import-redesign §3.1)。
//
// classification:
//   - 'source'   : イベント=真実。backup 必須 (失えば再計算不能)。
//   - 'derived'  : source + ルールから再計算で復元可。backup は不要 (復元時 rebuild)。
//   - 'excluded' : backup 対象外 (グローバル master / 機能廃止 / 運用ログ / 再生成可 / billing infra 等)。
//
// backupStatus (source のみ意味を持つ): 'exported' = export/import 実装済 / 'not-yet-exported' = #3329 残課題。
// 残課題は test がベースラインとして固定し、新たな not-yet-exported source の silent 増加を禁止する (ratchet)。
//
// excludedKind (excluded のみ意味を持つ):
//   - 'permanent' : 恒久除外 (機能廃止 / グローバル master / billing infra / 運用ログ 等、将来も backup 対象外)。
//   - 'deferred'  : 繰延除外 (Phase 2 等で将来 source 化を再判断する暫定除外)。test が exact-equality で
//                   固定し、実装フェーズ到来時に再分類を強制する (source の not-yet-exported ratchet と同型)。

export type BackupClassification = 'source' | 'derived' | 'excluded';
export type BackupExportStatus = 'exported' | 'not-yet-exported';
export type BackupExcludedKind = 'permanent' | 'deferred';

export interface BackupEntityEntry {
	classification: BackupClassification;
	/**
	 * 対応する `schema.ts` の sqliteTable const 名 (実テーブルの権威。schema 列挙との照合に使う)。
	 * SQLite に実テーブルを持たない DynamoDB single-table 専用 key / 純粋な派生概念は省略する。
	 */
	schemaTable?: string;
	/** source のときのみ: export/import で round-trip 済か。'not-yet-exported' は #3329 残課題 */
	backupStatus?: BackupExportStatus;
	/** excluded のときのみ: 恒久除外 / 繰延除外 (Phase 2 で再分類) の区別 */
	excludedKind?: BackupExcludedKind;
	reason: string;
}

/**
 * 実体名をキーに分類を宣言する SSOT。
 * - schema.ts に table を持つ実体は `schemaTable` を必ず設定する (schema 権威列挙との照合キー)。
 * - keys.ts に key builder を追加した / schema に table を追加したら本レジストリにも追記する
 *   (未追記は coverage test で fail)。
 */
export const BACKUP_ENTITY_REGISTRY: Record<string, BackupEntityEntry> = {
	// ---- source: 実装済 (export/import で round-trip 済) ----
	child: {
		classification: 'source',
		schemaTable: 'children',
		backupStatus: 'exported',
		reason: '子供プロフィール',
	},
	childActivity: {
		classification: 'source',
		schemaTable: 'childActivities',
		backupStatus: 'exported',
		reason: 'per-child 活動インスタンス (#3327 で per-child round-trip 化)',
	},
	activityLog: {
		classification: 'source',
		schemaTable: 'activityLogs',
		backupStatus: 'exported',
		reason: '活動記録',
	},
	pointLedger: {
		classification: 'source',
		schemaTable: 'pointLedger',
		backupStatus: 'exported',
		reason: 'ポイント台帳 (付与/交換/bonus、残高の真実)',
	},
	evaluation: {
		classification: 'source',
		schemaTable: 'evaluations',
		backupStatus: 'exported',
		reason: '週次評価 (#3327/#3328 で import 実装)',
	},
	loginBonus: {
		classification: 'source',
		schemaTable: 'loginBonuses',
		backupStatus: 'exported',
		reason: 'ログインボーナス記録 (streak は派生だがレコードは source)',
	},
	specialReward: {
		classification: 'source',
		schemaTable: 'specialRewards',
		backupStatus: 'exported',
		reason: '特別ごほうび',
	},
	checklistTemplate: {
		classification: 'source',
		schemaTable: 'checklistTemplates',
		backupStatus: 'exported',
		reason: 'チェックリストテンプレート',
	},
	checklistItem: {
		classification: 'source',
		schemaTable: 'checklistTemplateItems',
		backupStatus: 'exported',
		reason: 'チェックリスト項目 (template に同梱 export)',
	},
	checklistLog: {
		classification: 'source',
		schemaTable: 'checklistLogs',
		backupStatus: 'exported',
		reason: 'チェックリスト完了記録',
	},
	statusHistory: {
		classification: 'source',
		schemaTable: 'statusHistory',
		backupStatus: 'exported',
		reason:
			'ステータス変更履歴 (daily_decay/admin_edit は activityLog から再構成不能のため source、設計 §3.1)',
	},

	// ---- source: 未実装 (#3329 残課題、export/import 経路が無い = backup で失われる) ----
	rewardRedemption: {
		classification: 'source',
		schemaTable: 'rewardRedemptionRequests',
		backupStatus: 'not-yet-exported',
		reason: 'ごほうびショップ交換/購入履歴。残高整合に必須だが export 未対応 (#3329)',
	},
	childChallenge: {
		classification: 'source',
		schemaTable: 'childChallenges',
		backupStatus: 'not-yet-exported',
		reason: 'チャレンジ + 達成履歴。export 未対応 (#3329)',
	},
	childChallengeAutoWeekly: {
		classification: 'source',
		// 専用 SQLite table なし (child_challenges の自動週次フラグ運用 + DynamoDB key 専用)
		backupStatus: 'not-yet-exported',
		reason: '自動週次チャレンジ。export 未対応 (#3329)',
	},
	stampCard: {
		classification: 'source',
		schemaTable: 'stampCards',
		backupStatus: 'not-yet-exported',
		reason: 'スタンプカード。export 未対応 (#3329)',
	},
	stampEntry: {
		classification: 'source',
		schemaTable: 'stampEntries',
		backupStatus: 'not-yet-exported',
		reason: 'スタンプ押印。export 未対応 (#3329)',
	},
	certificate: {
		classification: 'source',
		schemaTable: 'certificates',
		backupStatus: 'not-yet-exported',
		reason: '証明書/賞状の授与記録。export 未対応 (#3329)',
	},
	parentMessage: {
		classification: 'source',
		schemaTable: 'parentMessages',
		backupStatus: 'not-yet-exported',
		reason: '親→子メッセージ。export 未対応 (#3329)',
	},
	siblingCheer: {
		classification: 'source',
		schemaTable: 'siblingCheers',
		backupStatus: 'not-yet-exported',
		reason: '兄弟応援。export 未対応 (#3329)',
	},
	activityPref: {
		classification: 'source',
		schemaTable: 'childActivityPreferences',
		backupStatus: 'not-yet-exported',
		reason: '活動の per-child 設定。export 未対応 (#3329)',
	},
	checklistAssignment: {
		classification: 'source',
		schemaTable: 'checklistTemplateAssignments',
		backupStatus: 'not-yet-exported',
		reason:
			'チェックリスト配信先。現状 import 時に取込先 child へ再導出のみ。原本 fan-out は未保全 (#3329)',
	},
	checklistOverride: {
		classification: 'source',
		schemaTable: 'checklistOverrides',
		backupStatus: 'not-yet-exported',
		reason: 'チェックリスト日次 override。export 未対応 (#3329)',
	},
	setting: {
		classification: 'source',
		schemaTable: 'settings',
		backupStatus: 'not-yet-exported',
		reason:
			'各種設定 (ポイント表示/onboarding 等)。export 未対応 (#3329)。PIN(pin_hash) は CWE-522/916 で除外 or 暗号化 (設計 D3)',
	},
	// #3329 QM BLOCK 是正: schema.ts 権威列挙で surface した builder-less source テーブル。
	restDays: {
		classification: 'source',
		schemaTable: 'restDays',
		backupStatus: 'not-yet-exported',
		reason:
			'おやすみ日設定 (per-child、保護者が任意指定)。evaluation-repo が週次評価/streak/decay 計算の input に使い活動記録から再構成不能。export 未対応のため backup で失われる (#3329)',
	},
	childCustomVoices: {
		classification: 'source',
		schemaTable: 'childCustomVoices',
		backupStatus: 'not-yet-exported',
		reason:
			'子のカスタム音声 (ユーザーがアップロードした録音、file_path/public_url はストレージ実体参照)。再生成不能のユーザー生成データ。export 未対応 (#3329)',
	},

	// ---- derived: source から再計算で復元 (backup 不要) ----
	status: {
		classification: 'derived',
		schemaTable: 'statuses',
		reason: 'カテゴリ別 現在 XP/level/peak。statusHistory + ルールから再構成可',
	},
	pointBalance: {
		classification: 'derived',
		// 専用 SQLite table なし (DynamoDB single-table の集約 key、SQLite は pointLedger から都度算出)
		reason: 'ポイント残高。pointLedger から再計算可',
	},
	activityMastery: {
		classification: 'derived',
		schemaTable: 'activityMastery',
		reason: '活動習熟。活動記録から再計算可',
	},
	dailyBattle: {
		classification: 'derived',
		schemaTable: 'dailyBattles',
		reason: 'デイリーバトル結果。活動結果から派生',
	},
	enemyCollection: {
		classification: 'derived',
		schemaTable: 'enemyCollection',
		reason: '敵図鑑。バトル結果から派生',
	},

	// ---- excluded: グローバル master / 機能廃止 / 運用 / 再生成可 / billing infra ----
	category: {
		classification: 'excluded',
		schemaTable: 'categories',
		excludedKind: 'permanent',
		reason: 'グローバルカテゴリ master (tenant 非依存 seed)',
	},
	activity: {
		classification: 'excluded',
		schemaTable: 'activities',
		excludedKind: 'permanent',
		reason: 'legacy tenant 活動 master。per-child モデルは childActivity を使用 (ADR-0055)',
	},
	achievement: {
		classification: 'excluded',
		schemaTable: 'achievements',
		excludedKind: 'permanent',
		reason: 'グローバル実績 master (実績システム廃止 #322)',
	},
	childAchievement: {
		classification: 'excluded',
		schemaTable: 'childAchievements',
		excludedKind: 'permanent',
		reason: '子の実績 (実績システム廃止 #322、データ不在)',
	},
	title: {
		classification: 'excluded',
		// 専用 SQLite table なし (称号システム廃止 #322、DynamoDB key 残骸のみ)
		excludedKind: 'permanent',
		reason: 'グローバル称号 master (称号システム廃止 #322)',
	},
	childTitle: {
		classification: 'excluded',
		excludedKind: 'permanent',
		reason: '子の称号 (称号システム廃止 #322、データ不在)',
	},
	dailyMission: {
		classification: 'excluded',
		schemaTable: 'dailyMissions',
		excludedKind: 'deferred',
		reason: 'デイリーミッション (Phase 2 繰延・エフェメラル。設計 D4 で意図的除外、実装時に再分類)',
	},
	characterImage: {
		classification: 'excluded',
		schemaTable: 'characterImages',
		excludedKind: 'deferred',
		reason:
			'生成キャラ画像 (Gemini 再生成可。設計 D4。バイト同一復元が必要なら将来 source 化を再判断する繰延除外)',
	},
	marketBenchmark: {
		classification: 'excluded',
		schemaTable: 'marketBenchmarks',
		excludedKind: 'permanent',
		reason: 'グローバル年齢別ベンチマーク master',
	},
	analyticsAggregate: {
		classification: 'excluded',
		// 専用 SQLite table なし (DynamoDB 集約 key、SQLite は source から再集計)
		excludedKind: 'permanent',
		reason: '運用集計 (前日 funnel 等、source から再集計可)',
	},
	challengeAggregate: {
		classification: 'excluded',
		excludedKind: 'permanent',
		reason: '運用集計 (challenge 事前集計)',
	},
	reportDailySummary: {
		classification: 'excluded',
		schemaTable: 'reportDailySummaries',
		excludedKind: 'permanent',
		reason: '運用日次サマリ集計 (source から再集計可)',
	},
	cancellationReason: {
		classification: 'excluded',
		schemaTable: 'cancellationReasons',
		excludedKind: 'permanent',
		reason: '解約理由 (運用/分析、家族コアデータ外)',
	},
	graduationConsent: {
		classification: 'excluded',
		schemaTable: 'graduationConsent',
		excludedKind: 'permanent',
		reason:
			'卒業 (=解約) 時点の事例公開承諾 + ポジティブ churn KPI の運用記録 (tenant scope、ops-analytics 用)。COPPA のサービス利用同意ではなく公開承諾であり、卒業フローで都度取得される終端イベント artifact。家族のコア活動データではなく、データ復元 = 利用継続の文脈で再取得前提のため恒久除外 (graduation-service.ts 確認)',
	},
	usageLogs: {
		classification: 'excluded',
		schemaTable: 'usageLogs',
		excludedKind: 'permanent',
		reason:
			'利用時間ログ (起動/終了/滞在秒、ops 分析専用)。家族のコア活動データ外の運用計測ログで、ADR-0012 anti-engagement 上もユーザーへ復元する性質ではない。source から導出されないが運用集計目的のため恒久除外',
	},
	stampMasters: {
		classification: 'excluded',
		schemaTable: 'stampMasters',
		excludedKind: 'permanent',
		reason:
			'スタンプ master (グローバル seed、create-tables.ts / seed.ts の 16 既定スタンプを INSERT OR IGNORE で配備)。ユーザー作成経路なし (sqlite repo は select のみ)、seed から再生成可のため恒久除外',
	},
	inquiry: {
		classification: 'excluded',
		// 専用 SQLite table なし (DynamoDB key 専用、運用問い合わせ)
		excludedKind: 'permanent',
		reason: 'お問い合わせ (運用、家族データ外)',
	},
	counter: {
		classification: 'excluded',
		excludedKind: 'permanent',
		reason: 'id 採番カウンタ (infra、復元時に再採番)',
	},
	pushSubscription: {
		classification: 'excluded',
		schemaTable: 'pushSubscriptions',
		excludedKind: 'permanent',
		reason: 'Push 購読 (device 固有、可搬性なし)',
	},
	notificationLog: {
		classification: 'excluded',
		schemaTable: 'notificationLogs',
		excludedKind: 'permanent',
		reason: '通知送信ログ (運用ログ)',
	},
	stripeWebhookEvent: {
		classification: 'excluded',
		schemaTable: 'stripeWebhookEvents',
		excludedKind: 'permanent',
		reason: 'Stripe webhook 冪等化 (billing infra)',
	},
	trialHistory: {
		classification: 'excluded',
		schemaTable: 'trialHistory',
		excludedKind: 'permanent',
		reason: 'トライアル履歴 (billing 状態、Stripe 管理)',
	},
	cloudExport: {
		classification: 'excluded',
		schemaTable: 'cloudExports',
		excludedKind: 'permanent',
		reason: 'クラウド export ジョブ自体の状態 (運用)',
	},
	viewerToken: {
		classification: 'excluded',
		schemaTable: 'viewerTokens',
		excludedKind: 'permanent',
		reason: '閲覧共有トークン (エフェメラル)',
	},
};

/** source かつ未 export の実体名一覧 (#3329 残課題の ratchet ベースライン)。 */
export function notYetExportedSourceEntities(): string[] {
	return Object.entries(BACKUP_ENTITY_REGISTRY)
		.filter(([, e]) => e.classification === 'source' && e.backupStatus === 'not-yet-exported')
		.map(([name]) => name)
		.sort();
}

/** excluded かつ繰延 (deferred) の実体名一覧 (#3329 Phase 2 再分類強制の ratchet ベースライン)。 */
export function deferredExcludedEntities(): string[] {
	return Object.entries(BACKUP_ENTITY_REGISTRY)
		.filter(([, e]) => e.classification === 'excluded' && e.excludedKind === 'deferred')
		.map(([name]) => name)
		.sort();
}

/** registry が分類済として宣言する schema.ts テーブル const 名の集合 (schema 権威列挙との照合用)。 */
export function classifiedSchemaTables(): string[] {
	return Object.values(BACKUP_ENTITY_REGISTRY)
		.map((e) => e.schemaTable)
		.filter((t): t is string => typeof t === 'string')
		.sort();
}

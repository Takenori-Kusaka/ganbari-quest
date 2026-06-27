// src/lib/server/db/backup-entity-registry.ts
// #3329: backup 対象実体の分類 SSOT（source / 派生 / 除外）。
//
// 背景: export/import が「アプリの保存する実体の一部」しか扱わず、replace import で活動・評価・
// ごほうび交換履歴・設定 等が silent に失われた (本番 t-82c17558 で実証)。本レジストリは
// `keys.ts` の全 key builder を分類し、`tests/unit/db/backup-entity-registry.test.ts` が
// 「keys.ts の key builder ⊆ 本レジストリ」を機械検証する。新実体追加時に分類を強制し、
// 「backup 対象への入れ忘れ」を CI で弾く (silent-gap ガード、設計 doc backup-import-redesign §3.1)。
//
// classification:
//   - 'source'   : イベント=真実。backup 必須 (失えば再計算不能)。
//   - 'derived'  : source + ルールから再計算で復元可。backup は不要 (復元時 rebuild)。
//   - 'excluded' : backup 対象外 (グローバル master / 機能廃止 / 運用ログ / 再生成可 / billing infra 等)。
//
// backupStatus (source のみ意味を持つ): 'exported' = export/import 実装済 / 'not-yet-exported' = #3329 残課題。
// 残課題は test がベースラインとして固定し、新たな not-yet-exported source の silent 増加を禁止する (ratchet)。

export type BackupClassification = 'source' | 'derived' | 'excluded';
export type BackupExportStatus = 'exported' | 'not-yet-exported';

export interface BackupEntityEntry {
	classification: BackupClassification;
	/** source のときのみ: export/import で round-trip 済か。'not-yet-exported' は #3329 残課題 */
	backupStatus?: BackupExportStatus;
	reason: string;
}

/**
 * `keys.ts` の key builder 名 (`<name>Key`) をキーに分類を宣言する SSOT。
 * key builder を追加したら本レジストリにも追記する (未追記は coverage test で fail)。
 */
export const BACKUP_ENTITY_REGISTRY: Record<string, BackupEntityEntry> = {
	// ---- source: 実装済 (export/import で round-trip 済) ----
	child: { classification: 'source', backupStatus: 'exported', reason: '子供プロフィール' },
	childActivity: {
		classification: 'source',
		backupStatus: 'exported',
		reason: 'per-child 活動インスタンス (#3327 で per-child round-trip 化)',
	},
	activityLog: { classification: 'source', backupStatus: 'exported', reason: '活動記録' },
	pointLedger: {
		classification: 'source',
		backupStatus: 'exported',
		reason: 'ポイント台帳 (付与/交換/bonus、残高の真実)',
	},
	evaluation: {
		classification: 'source',
		backupStatus: 'exported',
		reason: '週次評価 (#3327/#3328 で import 実装)',
	},
	loginBonus: {
		classification: 'source',
		backupStatus: 'exported',
		reason: 'ログインボーナス記録 (streak は派生だがレコードは source)',
	},
	specialReward: { classification: 'source', backupStatus: 'exported', reason: '特別ごほうび' },
	checklistTemplate: {
		classification: 'source',
		backupStatus: 'exported',
		reason: 'チェックリストテンプレート',
	},
	checklistItem: {
		classification: 'source',
		backupStatus: 'exported',
		reason: 'チェックリスト項目 (template に同梱 export)',
	},
	checklistLog: {
		classification: 'source',
		backupStatus: 'exported',
		reason: 'チェックリスト完了記録',
	},
	statusHistory: {
		classification: 'source',
		backupStatus: 'exported',
		reason:
			'ステータス変更履歴 (daily_decay/admin_edit は activityLog から再構成不能のため source、設計 §3.1)',
	},

	// ---- source: 未実装 (#3329 残課題、export/import 経路が無い = backup で失われる) ----
	rewardRedemption: {
		classification: 'source',
		backupStatus: 'not-yet-exported',
		reason: 'ごほうびショップ交換/購入履歴。残高整合に必須だが export 未対応 (#3329)',
	},
	childChallenge: {
		classification: 'source',
		backupStatus: 'not-yet-exported',
		reason: 'チャレンジ + 達成履歴。export 未対応 (#3329)',
	},
	childChallengeAutoWeekly: {
		classification: 'source',
		backupStatus: 'not-yet-exported',
		reason: '自動週次チャレンジ。export 未対応 (#3329)',
	},
	stampCard: {
		classification: 'source',
		backupStatus: 'not-yet-exported',
		reason: 'スタンプカード。export 未対応 (#3329)',
	},
	stampEntry: {
		classification: 'source',
		backupStatus: 'not-yet-exported',
		reason: 'スタンプ押印。export 未対応 (#3329)',
	},
	certificate: {
		classification: 'source',
		backupStatus: 'not-yet-exported',
		reason: '証明書/賞状の授与記録。export 未対応 (#3329)',
	},
	parentMessage: {
		classification: 'source',
		backupStatus: 'not-yet-exported',
		reason: '親→子メッセージ。export 未対応 (#3329)',
	},
	siblingCheer: {
		classification: 'source',
		backupStatus: 'not-yet-exported',
		reason: '兄弟応援。export 未対応 (#3329)',
	},
	activityPref: {
		classification: 'source',
		backupStatus: 'not-yet-exported',
		reason: '活動の per-child 設定。export 未対応 (#3329)',
	},
	checklistAssignment: {
		classification: 'source',
		backupStatus: 'not-yet-exported',
		reason:
			'チェックリスト配信先。現状 import 時に取込先 child へ再導出のみ。原本 fan-out は未保全 (#3329)',
	},
	checklistOverride: {
		classification: 'source',
		backupStatus: 'not-yet-exported',
		reason: 'チェックリスト日次 override。export 未対応 (#3329)',
	},
	setting: {
		classification: 'source',
		backupStatus: 'not-yet-exported',
		reason:
			'各種設定 (ポイント表示/onboarding 等)。export 未対応 (#3329)。PIN(pin_hash) は CWE-522/916 で除外 or 暗号化 (設計 D3)',
	},

	// ---- derived: source から再計算で復元 (backup 不要) ----
	status: {
		classification: 'derived',
		reason: 'カテゴリ別 現在 XP/level/peak。statusHistory + ルールから再構成可',
	},
	pointBalance: { classification: 'derived', reason: 'ポイント残高。pointLedger から再計算可' },
	activityMastery: { classification: 'derived', reason: '活動習熟。活動記録から再計算可' },
	dailyBattle: { classification: 'derived', reason: 'デイリーバトル結果。活動結果から派生' },
	enemyCollection: { classification: 'derived', reason: '敵図鑑。バトル結果から派生' },

	// ---- excluded: グローバル master / 機能廃止 / 運用 / 再生成可 / billing infra ----
	category: {
		classification: 'excluded',
		reason: 'グローバルカテゴリ master (tenant 非依存 seed)',
	},
	activity: {
		classification: 'excluded',
		reason: 'legacy tenant 活動 master。per-child モデルは childActivity を使用 (ADR-0055)',
	},
	achievement: {
		classification: 'excluded',
		reason: 'グローバル実績 master (実績システム廃止 #322)',
	},
	childAchievement: {
		classification: 'excluded',
		reason: '子の実績 (実績システム廃止 #322、データ不在)',
	},
	title: { classification: 'excluded', reason: 'グローバル称号 master (称号システム廃止 #322)' },
	childTitle: {
		classification: 'excluded',
		reason: '子の称号 (称号システム廃止 #322、データ不在)',
	},
	dailyMission: {
		classification: 'excluded',
		reason: 'デイリーミッション (Phase 2 繰延・エフェメラル。設計 D4 で意図的除外)',
	},
	characterImage: {
		classification: 'excluded',
		reason:
			'生成キャラ画像 (Gemini 再生成可。設計 D4。バイト同一復元が必要なら将来 source 化を再判断)',
	},
	marketBenchmark: { classification: 'excluded', reason: 'グローバル年齢別ベンチマーク master' },
	analyticsAggregate: {
		classification: 'excluded',
		reason: '運用集計 (前日 funnel 等、source から再集計可)',
	},
	challengeAggregate: { classification: 'excluded', reason: '運用集計 (challenge 事前集計)' },
	reportDailySummary: {
		classification: 'excluded',
		reason: '運用日次サマリ集計 (source から再集計可)',
	},
	cancellationReason: {
		classification: 'excluded',
		reason: '解約理由 (運用/分析、家族コアデータ外)',
	},
	graduationConsent: {
		classification: 'excluded',
		reason: '卒業同意の運用記録 (家族コアデータ外、要レビュー)',
	},
	inquiry: { classification: 'excluded', reason: 'お問い合わせ (運用、家族データ外)' },
	counter: { classification: 'excluded', reason: 'id 採番カウンタ (infra、復元時に再採番)' },
	pushSubscription: { classification: 'excluded', reason: 'Push 購読 (device 固有、可搬性なし)' },
	notificationLog: { classification: 'excluded', reason: '通知送信ログ (運用ログ)' },
	stripeWebhookEvent: {
		classification: 'excluded',
		reason: 'Stripe webhook 冪等化 (billing infra)',
	},
	trialHistory: {
		classification: 'excluded',
		reason: 'トライアル履歴 (billing 状態、Stripe 管理)',
	},
	cloudExport: { classification: 'excluded', reason: 'クラウド export ジョブ自体の状態 (運用)' },
	viewerToken: { classification: 'excluded', reason: '閲覧共有トークン (エフェメラル)' },
};

/** source かつ未 export の実体名一覧 (#3329 残課題の ratchet ベースライン)。 */
export function notYetExportedSourceEntities(): string[] {
	return Object.entries(BACKUP_ENTITY_REGISTRY)
		.filter(([, e]) => e.classification === 'source' && e.backupStatus === 'not-yet-exported')
		.map(([name]) => name)
		.sort();
}

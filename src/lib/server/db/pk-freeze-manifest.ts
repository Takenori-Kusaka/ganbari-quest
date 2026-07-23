// src/lib/server/db/pk-freeze-manifest.ts
// EPIC #3424 / 実装 #3512 (#N0-1) / 設計 SSOT: docs/design/dsql-data-model.md §11.2 / §13.1(fitness#9)
//
// PK 凍結 manifest = §11.2「全テナント表 PK 凍結表」の機械可読 SSOT。
// DSQL は PK = 物理レイアウトで後変更不可 (§P1)。fitness#9 (pk-freeze-manifest.test.ts) が
// (a) 本 manifest == §11.2 markdown 表 (test 内 parser で抽出) と
// (b) drizzle pg/sqlite schema の PK == 本 manifest を CI で hard-fail し、凍結逸脱を機械封鎖する。
// PK 変更は「§11.2 + 本 manifest の同時更新 + migration ADR」を人手強制する唯一の点 (§12.5)。
//
// governing rule (§11.2, 戦略/PO パネル 2026-07-01): 自然複合 PK 凍結は
//   (a) policy invariant (ADR 参照) or (b) 構造的確実性 に anchor される表のみ。
//   mutable product default だけが根拠の表は UUID PK + droppable UNIQUE (例: certificates)。
//
// §11.2 で凍結対象外のため本 manifest に載せない表:
//   - report_daily_summaries (廃止、§7 compute-on-read) / achievements 系 (drop 確定、§10-10)
//   - グローバル master (categories(code) 等) / auth 5 表 (§6.6) — family_id 先頭でない例外 (test [5])

export const PK_FREEZE_MANIFEST = {
	// ── Child 集約 (§3) ──
	// children は linchpin: child_id が下記 ~30 表の複合 PK 先頭。UUID v4 (§P3 時刻列を PK に入れない)。
	children: ['family_id', 'child_id'],
	child_activities: ['family_id', 'child_id', 'activity_id'],
	// activity_logs / point_ledger: UUID v4 random で hot-partition ゼロ。
	// created_at は PK に入れない (sort 用途のみ = identity でない、§11.2 判断⑬訂正)。
	activity_logs: ['family_id', 'child_id', 'log_id'],
	point_ledger: ['family_id', 'child_id', 'ledger_id'],
	statuses: ['family_id', 'child_id', 'category_id'],
	status_history: ['family_id', 'child_id', 'category_id', 'hist_id'],
	activity_mastery: ['family_id', 'child_id', 'activity_id'],
	child_activity_preferences: ['family_id', 'child_id', 'activity_id'],
	daily_missions: ['family_id', 'child_id', 'mission_date', 'activity_id'],
	// daily_battles / rest_days: 1日1回 = ADR-0012 anti-engagement の
	// policy invariant に anchor された自然複合 PK (governing rule (a)、PO 決裁済)。
	// login_streaks (#3330 counter 縮約): 子供ごと counter 1 行 = anchor (b) 構造的確実性
	// (per-date cardinality は counter 縮約により product 上存在しない)。1日1回の冪等は
	// claimToday の conditional write が担う (旧 login_bonuses per-date PK は廃止)。
	login_streaks: ['family_id', 'child_id'],
	// stamp_cards: UUID surrogate (PO 決裁 2026-07-03、PR #3547: シーズン/イベントカード復活が
	// あり得る = 同一週複数カードの cardinality 可変で anchor (b) 不成立)。「1子1週1枚」の
	// 現行制約は droppable UNIQUE(family,child,week_start) で維持 (復活時は UNIQUE DROP のみ)。
	stamp_cards: ['family_id', 'child_id', 'card_id'],
	stamp_entries: ['family_id', 'card_id', 'slot'],
	// checklist_logs.itemsJson は text 据置 (子表 checklist_log_items を作らない、M3 §4.2 [must]A /
	// reset-plan 決定#1)。凍結 list に子表を残すと M4 が非可逆 PK 凍結 → 原初喪失が非可逆に再来する。
	checklist_logs: ['family_id', 'child_id', 'template_id', 'checked_date'],
	checklist_overrides: ['family_id', 'child_id', 'override_id'],
	checklist_templates: ['family_id', 'template_id'],
	checklist_template_items: ['family_id', 'template_id', 'item_id'],
	checklist_template_assignments: ['family_id', 'template_id', 'child_id'],
	// certificates: governing rule で UUID surrogate 化 (再発行/周期型証書が roadmap プラウジブル、
	// policy anchor 無し)。「1 type 有効1通」は生成列 + droppable UNIQUE で担保 (§11.2)。
	certificates: ['family_id', 'child_id', 'certificate_id'],
	// evaluations.scoresJson は text 据置 (子表 evaluation_scores を作らない、M3 §4.2 [must]A /
	// reset-plan 決定#1)。凍結 list に子表を残すと非可逆 PK 凍結で原初喪失が再来する。
	evaluations: ['family_id', 'child_id', 'eval_id'],
	rest_days: ['family_id', 'child_id', 'date'],
	daily_battles: ['family_id', 'child_id', 'date'],
	enemy_collection: ['family_id', 'child_id', 'enemy_id'],
	special_rewards: ['family_id', 'child_id', 'reward_id'],
	reward_redemption_requests: ['family_id', 'redemption_id'],
	parent_messages: ['family_id', 'child_id', 'msg_id'],
	sibling_cheers: ['family_id', 'cheer_id'],
	character_images: ['family_id', 'child_id', 'image_id'],
	child_custom_voices: ['family_id', 'child_id', 'voice_id'],
	child_challenges: ['family_id', 'child_id', 'challenge_id'],
	usage_logs: ['family_id', 'child_id', 'log_id'],
	// ── Family 系 8 表 (2026-07-03 実クエリ調査で §11.2 確定。governing rule 適用) ──
	// settings のみ自然複合 (anchor (b): KVS の 1 key = 1 value は構造的確実)。
	// 他 7 表は once-per-period 一意が無い append-only/履歴/mutable token 表で UUID surrogate。
	// endpoint/token/pin の global UNIQUE は無 tenant 単点 lookup の機能要件 (PK とは別、DDL 側)。
	settings: ['family_id', 'key'],
	push_subscriptions: ['family_id', 'subscription_id'],
	notification_logs: ['family_id', 'log_id'],
	trial_history: ['family_id', 'trial_id'],
	viewer_tokens: ['family_id', 'token_id'],
	cloud_exports: ['family_id', 'export_id'],
	cancellation_reasons: ['family_id', 'reason_id'],
	graduation_consent: ['family_id', 'consent_id'],
	// ── Family 方針 / 認証 / ライフサイクル 表 (M3 §1.1a 別テーブル baseline、#3424 M4-C) ──
	// (family_id) 1:1/1:0..1 従属表 = 親キー PK (M2 §1.1 3NF)。bonus_rules は family master 1:N。
	parent_gate_credentials: ['family_id'],
	loyalty_state: ['family_id'],
	account_lifecycle: ['family_id'],
	decay_policy: ['family_id'],
	approval_policy: ['family_id'],
	point_conversion_policy: ['family_id'],
	notification_settings: ['family_id'],
	bonus_rules: ['family_id', 'rule_id'],
} as const satisfies Record<string, readonly string[]>;

export type PkFreezeManifest = typeof PK_FREEZE_MANIFEST;

// ── auth 5 表 (§6.6、#3528 Phase B) ──
// §11.2 の例外: users/invites/consents は自然キー/UUID 単独 PK で family_id 先頭でない
// (users はグローバル、invites/consents は token_hash/append-only の設計上単独 UUID)。
// families/memberships はテナントルートゆえ family_id 先頭。凍結 SSOT は §6.6 表
// (dsql-auth-schema.test.ts [A1] が doc-parse 突合)。
export const AUTH_PK_MANIFEST = {
	users: ['user_id'],
	families: ['family_id'],
	memberships: ['family_id', 'user_id'],
	invites: ['invite_id'],
	consents: ['consent_id'],
	// inquiries (#3612): auth 5 表ではないが同じ「family_id 先頭でない例外」class。
	// PK = inquiry_id (text、既存 interface の INQ-YYYYMMDD-seq 形式を維持)。
	// family_id nullable (未ログイン founder 導線も受ける) のため PK_FREEZE (family 先頭) に
	// 置けない。backup 対象外 (backup-entity-registry `inquiry` excluded)。
	inquiries: ['inquiry_id'],
} as const satisfies Record<string, readonly string[]>;

// ── グローバル master (§11.2 例外: tenant プレフィクスなし、自然キー PK) ──
// §11.2「グローバル master（tenant 非依存）: categories(code) / stamp_masters /
// market_benchmarks(age,category_id) / stripe_webhook_events(event_id)」の機械可読宣言。
// schema.ts へグローバル master 表を追記する際は本 manifest にも 1 行追加する
// (fitness#9 [3] が PK_FREEZE / AUTH / GLOBAL_MASTER の union で schema 全表を突合)。
export const GLOBAL_MASTER_PK_MANIFEST = {
	// U-1 決裁済 (実データ調査、2026-07-05): market_benchmarks PK = (age, category_id)。
	// AGE_BENCHMARK ‖–o{ STATUS (status はカテゴリ別) との整合で category 弁別子を PK に含む。
	market_benchmarks: ['age', 'category_id'],
	// ── グローバル master / tenant 非依存 (M3 §1.10 / §1.1、#3424 M4-C) ──
	// 自然キー PK・tenant プレフィクスなし。family_id fitness allowlist 除外表 (M3 §3.4)。
	categories: ['code'],
	stamp_masters: ['stamp_code'],
	plans: ['plan_code'],
	plan_tiers: ['plan_tier'],
	stripe_webhook_events: ['event_id'],
	// email_login_lockouts は家族非依存 (PK=email、未登録メールもロック対象)。family_id 先頭で
	// ないため PK_FREEZE でなく本 manifest に置く (M2 §1.1 R-EMAIL_LOGIN_LOCKOUT、I-EMAIL-LOCK)。
	email_login_lockouts: ['email'],
} as const satisfies Record<string, readonly string[]>;

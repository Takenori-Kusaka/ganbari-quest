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
//   - Family 系 (settings 等、PK は §11.3 で確定 = 未凍結。確定時に追記)
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
	// login_bonuses / daily_battles / rest_days: 1日1回 = ADR-0012 anti-engagement の
	// policy invariant に anchor された自然複合 PK (governing rule (a)、PO 決裁済)。
	login_bonuses: ['family_id', 'child_id', 'login_date'],
	// stamp_cards: anchor (b) シーズン撤去前提。条件 = シーズン/イベントカード復活が roadmap に無いこと。
	stamp_cards: ['family_id', 'child_id', 'week_start'],
	stamp_entries: ['family_id', 'card_id', 'slot'],
	checklist_logs: ['family_id', 'child_id', 'template_id', 'checked_date'],
	checklist_log_items: ['family_id', 'child_id', 'template_id', 'checked_date', 'item_id'],
	checklist_overrides: ['family_id', 'child_id', 'override_id'],
	checklist_templates: ['family_id', 'template_id'],
	checklist_template_items: ['family_id', 'template_id', 'item_id'],
	checklist_template_assignments: ['family_id', 'template_id', 'child_id'],
	// certificates: governing rule で UUID surrogate 化 (再発行/周期型証書が roadmap プラウジブル、
	// policy anchor 無し)。「1 type 有効1通」は生成列 + droppable UNIQUE で担保 (§11.2)。
	certificates: ['family_id', 'child_id', 'certificate_id'],
	evaluations: ['family_id', 'child_id', 'eval_id'],
	evaluation_scores: ['family_id', 'child_id', 'eval_id', 'category_id'],
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
} as const satisfies Record<string, readonly string[]>;

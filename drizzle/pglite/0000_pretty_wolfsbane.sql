CREATE TABLE "account_lifecycle" (
	"family_id" uuid NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	"soft_deleted_at" timestamp with time zone,
	"grace_plan_tier" text,
	"purge_scheduled_date" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_lifecycle_family_id_pk" PRIMARY KEY("family_id")
);
--> statement-breakpoint
CREATE TABLE "activity_logs" (
	"family_id" uuid NOT NULL,
	"child_id" uuid NOT NULL,
	"log_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"activity_id" uuid NOT NULL,
	"points" integer NOT NULL,
	"streak_days" integer DEFAULT 1 NOT NULL,
	"streak_bonus" integer DEFAULT 0 NOT NULL,
	"recorded_date" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled" boolean DEFAULT false NOT NULL,
	CONSTRAINT "activity_logs_family_id_child_id_log_id_pk" PRIMARY KEY("family_id","child_id","log_id")
);
--> statement-breakpoint
CREATE TABLE "activity_mastery" (
	"family_id" uuid NOT NULL,
	"child_id" uuid NOT NULL,
	"activity_id" uuid NOT NULL,
	"total_count" integer DEFAULT 0 NOT NULL,
	"level" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activity_mastery_family_id_child_id_activity_id_pk" PRIMARY KEY("family_id","child_id","activity_id")
);
--> statement-breakpoint
CREATE TABLE "approval_policy" (
	"family_id" uuid NOT NULL,
	"auto_approve" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_policy_family_id_pk" PRIMARY KEY("family_id")
);
--> statement-breakpoint
CREATE TABLE "bonus_rules" (
	"family_id" uuid NOT NULL,
	"rule_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"condition_type" text NOT NULL,
	"trigger_config" text,
	"bonus_points" integer,
	"multiplier" real,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bonus_rules_family_id_rule_id_pk" PRIMARY KEY("family_id","rule_id")
);
--> statement-breakpoint
CREATE TABLE "cancellation_reasons" (
	"family_id" uuid NOT NULL,
	"reason_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"category" text NOT NULL,
	"free_text" text,
	"plan_at_cancellation" text,
	"stripe_subscription_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cancellation_reasons_family_id_reason_id_pk" PRIMARY KEY("family_id","reason_id")
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"code" text NOT NULL,
	"name" text NOT NULL,
	"icon" text,
	"color" text,
	CONSTRAINT "categories_code_pk" PRIMARY KEY("code")
);
--> statement-breakpoint
CREATE TABLE "certificates" (
	"family_id" uuid NOT NULL,
	"child_id" uuid NOT NULL,
	"certificate_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"certificate_type" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" text,
	CONSTRAINT "certificates_family_id_child_id_certificate_id_pk" PRIMARY KEY("family_id","child_id","certificate_id")
);
--> statement-breakpoint
CREATE TABLE "character_images" (
	"family_id" uuid NOT NULL,
	"child_id" uuid NOT NULL,
	"image_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"file_path" text NOT NULL,
	"prompt_hash" text,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "character_images_family_id_child_id_image_id_pk" PRIMARY KEY("family_id","child_id","image_id")
);
--> statement-breakpoint
CREATE TABLE "checklist_logs" (
	"family_id" uuid NOT NULL,
	"child_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"checked_date" text NOT NULL,
	"items_json" text DEFAULT '[]' NOT NULL,
	"completed_all" boolean DEFAULT false NOT NULL,
	"points_awarded" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checklist_logs_family_id_child_id_template_id_checked_date_pk" PRIMARY KEY("family_id","child_id","template_id","checked_date")
);
--> statement-breakpoint
CREATE TABLE "checklist_overrides" (
	"family_id" uuid NOT NULL,
	"child_id" uuid NOT NULL,
	"override_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"target_date" text NOT NULL,
	"action" text NOT NULL,
	"item_name" text NOT NULL,
	"icon" text DEFAULT '📦' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checklist_overrides_family_id_child_id_override_id_pk" PRIMARY KEY("family_id","child_id","override_id"),
	CONSTRAINT "checklist_overrides_action_ck" CHECK ("checklist_overrides"."action" IN ('add', 'remove'))
);
--> statement-breakpoint
CREATE TABLE "checklist_template_assignments" (
	"family_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"child_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checklist_template_assignments_family_id_template_id_child_id_pk" PRIMARY KEY("family_id","template_id","child_id")
);
--> statement-breakpoint
CREATE TABLE "checklist_template_items" (
	"family_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"item_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"icon" text DEFAULT '🏫' NOT NULL,
	"frequency" text DEFAULT 'daily' NOT NULL,
	"direction" text DEFAULT 'bring' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checklist_template_items_family_id_template_id_item_id_pk" PRIMARY KEY("family_id","template_id","item_id")
);
--> statement-breakpoint
CREATE TABLE "checklist_templates" (
	"family_id" uuid NOT NULL,
	"template_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"icon" text DEFAULT '📋' NOT NULL,
	"points_per_item" integer DEFAULT 2 NOT NULL,
	"completion_bonus" integer DEFAULT 5 NOT NULL,
	"time_slot" text DEFAULT 'anytime' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"archived_reason" text,
	"source_preset_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checklist_templates_family_id_template_id_pk" PRIMARY KEY("family_id","template_id"),
	CONSTRAINT "checklist_templates_time_slot_ck" CHECK ("checklist_templates"."time_slot" IN ('morning', 'afternoon', 'evening', 'anytime')),
	CONSTRAINT "checklist_templates_archived_reason_ck" CHECK ("checklist_templates"."archived_reason" IN ('trial_expired', 'downgrade_user_selected', 'dunning_canceled'))
);
--> statement-breakpoint
CREATE TABLE "child_activities" (
	"family_id" uuid NOT NULL,
	"child_id" uuid NOT NULL,
	"activity_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"category_id" text NOT NULL,
	"icon" text NOT NULL,
	"base_points" integer DEFAULT 5 NOT NULL,
	"is_visible" boolean DEFAULT true NOT NULL,
	"daily_limit" integer,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"source" text DEFAULT 'seed' NOT NULL,
	"name_kana" text,
	"name_kanji" text,
	"trigger_hint" text,
	"is_main_quest" boolean DEFAULT false NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"archived_reason" text,
	"source_preset_id" text,
	"priority" text DEFAULT 'optional' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "child_activities_family_id_child_id_activity_id_pk" PRIMARY KEY("family_id","child_id","activity_id"),
	CONSTRAINT "child_activities_priority_ck" CHECK ("child_activities"."priority" IN ('must', 'optional')),
	CONSTRAINT "child_activities_archived_reason_ck" CHECK ("child_activities"."archived_reason" IN ('trial_expired', 'downgrade_user_selected', 'dunning_canceled'))
);
--> statement-breakpoint
CREATE TABLE "child_activity_preferences" (
	"family_id" uuid NOT NULL,
	"child_id" uuid NOT NULL,
	"activity_id" uuid NOT NULL,
	"is_pinned" boolean DEFAULT false NOT NULL,
	"pin_order" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "child_activity_preferences_family_id_child_id_activity_id_pk" PRIMARY KEY("family_id","child_id","activity_id")
);
--> statement-breakpoint
CREATE TABLE "child_challenges" (
	"family_id" uuid NOT NULL,
	"child_id" uuid NOT NULL,
	"challenge_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"challenge_type" text DEFAULT 'cooperative' NOT NULL,
	"period_type" text DEFAULT 'weekly' NOT NULL,
	"start_date" text NOT NULL,
	"end_date" text NOT NULL,
	"target_config" text NOT NULL,
	"reward_config" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"source_template_id" text,
	"current_value" integer DEFAULT 0 NOT NULL,
	"target_value" integer NOT NULL,
	"completed" boolean DEFAULT false NOT NULL,
	"completed_at" timestamp with time zone,
	"reward_claimed" boolean DEFAULT false NOT NULL,
	"reward_claimed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"weekly_auto_guard" text GENERATED ALWAYS AS (CASE WHEN source_template_id = 'auto:weekly' THEN (child_id::text || ':' || start_date) ELSE NULL END) STORED,
	CONSTRAINT "child_challenges_family_id_child_id_challenge_id_pk" PRIMARY KEY("family_id","child_id","challenge_id"),
	CONSTRAINT "child_challenges_weekly_auto_guard_unique" UNIQUE("weekly_auto_guard"),
	CONSTRAINT "child_challenges_status_ck" CHECK ("child_challenges"."status" IN ('active', 'completed', 'expired')),
	CONSTRAINT "child_challenges_period_type_ck" CHECK ("child_challenges"."period_type" IN ('weekly', 'monthly', 'custom'))
);
--> statement-breakpoint
CREATE TABLE "child_custom_voices" (
	"family_id" uuid NOT NULL,
	"child_id" uuid NOT NULL,
	"voice_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"scene" text DEFAULT 'complete' NOT NULL,
	"label" text NOT NULL,
	"file_path" text NOT NULL,
	"public_url" text NOT NULL,
	"duration_ms" integer,
	"is_active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "child_custom_voices_family_id_child_id_voice_id_pk" PRIMARY KEY("family_id","child_id","voice_id")
);
--> statement-breakpoint
CREATE TABLE "children" (
	"family_id" uuid NOT NULL,
	"child_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"nickname" text NOT NULL,
	"birth_date" text,
	"theme" text DEFAULT 'pink' NOT NULL,
	"ui_mode" text DEFAULT 'preschool' NOT NULL,
	"ui_mode_manually_set" boolean DEFAULT false NOT NULL,
	"avatar_url" text,
	"display_config" text,
	"user_id" text,
	"birthday_bonus_multiplier" real DEFAULT 1 NOT NULL,
	"last_birthday_bonus_year" integer,
	"total_point" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"archived_reason" text,
	CONSTRAINT "children_family_id_child_id_pk" PRIMARY KEY("family_id","child_id"),
	CONSTRAINT "children_ui_mode_ck" CHECK ("children"."ui_mode" IN ('baby', 'preschool', 'elementary', 'junior', 'senior')),
	CONSTRAINT "children_theme_ck" CHECK ("children"."theme" IN ('pink', 'blue', 'green', 'orange', 'purple')),
	CONSTRAINT "children_archived_reason_ck" CHECK ("children"."archived_reason" IN ('trial_expired', 'downgrade_user_selected', 'dunning_canceled'))
);
--> statement-breakpoint
CREATE TABLE "cloud_exports" (
	"family_id" uuid NOT NULL,
	"export_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"export_type" text NOT NULL,
	"pin_code" text NOT NULL,
	"s3_key" text NOT NULL,
	"file_size_bytes" integer NOT NULL,
	"label" text,
	"description" text,
	"expires_at" timestamp with time zone NOT NULL,
	"download_count" integer DEFAULT 0 NOT NULL,
	"max_downloads" integer DEFAULT 10 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"failure_reason" text,
	"build_started_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cloud_exports_family_id_export_id_pk" PRIMARY KEY("family_id","export_id"),
	CONSTRAINT "cloud_exports_pin_code_unique" UNIQUE("pin_code"),
	CONSTRAINT "cloud_exports_status_ck" CHECK ("cloud_exports"."status" IN ('pending', 'building', 'ready', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "consents" (
	"consent_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"version" text NOT NULL,
	"consented_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text NOT NULL,
	"user_agent" text NOT NULL,
	CONSTRAINT "consents_consent_id_pk" PRIMARY KEY("consent_id"),
	CONSTRAINT "consents_type_ck" CHECK ("consents"."type" IN ('terms', 'privacy'))
);
--> statement-breakpoint
CREATE TABLE "daily_battles" (
	"family_id" uuid NOT NULL,
	"child_id" uuid NOT NULL,
	"date" text NOT NULL,
	"enemy_id" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"outcome" text,
	"reward_points" integer DEFAULT 0 NOT NULL,
	"turns_used" integer DEFAULT 0 NOT NULL,
	"player_stats_json" text DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_battles_family_id_child_id_date_pk" PRIMARY KEY("family_id","child_id","date"),
	CONSTRAINT "daily_battles_status_ck" CHECK ("daily_battles"."status" IN ('pending', 'completed')),
	CONSTRAINT "daily_battles_outcome_ck" CHECK ("daily_battles"."outcome" IN ('win', 'lose'))
);
--> statement-breakpoint
CREATE TABLE "daily_missions" (
	"family_id" uuid NOT NULL,
	"child_id" uuid NOT NULL,
	"mission_date" text NOT NULL,
	"activity_id" uuid NOT NULL,
	"completed" boolean DEFAULT false NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "daily_missions_family_id_child_id_mission_date_activity_id_pk" PRIMARY KEY("family_id","child_id","mission_date","activity_id")
);
--> statement-breakpoint
CREATE TABLE "decay_policy" (
	"family_id" uuid NOT NULL,
	"intensity" text DEFAULT 'normal' NOT NULL,
	"grace_days" integer DEFAULT 2 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "decay_policy_family_id_pk" PRIMARY KEY("family_id")
);
--> statement-breakpoint
CREATE TABLE "email_login_lockouts" (
	"email" text NOT NULL,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_failed_at" timestamp with time zone,
	CONSTRAINT "email_login_lockouts_email_pk" PRIMARY KEY("email")
);
--> statement-breakpoint
CREATE TABLE "enemy_collection" (
	"family_id" uuid NOT NULL,
	"child_id" uuid NOT NULL,
	"enemy_id" integer NOT NULL,
	"first_defeated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"defeat_count" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "enemy_collection_family_id_child_id_enemy_id_pk" PRIMARY KEY("family_id","child_id","enemy_id")
);
--> statement-breakpoint
CREATE TABLE "evaluations" (
	"family_id" uuid NOT NULL,
	"child_id" uuid NOT NULL,
	"eval_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"week_start" text NOT NULL,
	"week_end" text NOT NULL,
	"scores_json" text NOT NULL,
	"bonus_points" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evaluations_family_id_child_id_eval_id_pk" PRIMARY KEY("family_id","child_id","eval_id")
);
--> statement-breakpoint
CREATE TABLE "families" (
	"family_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"owner_user_id" uuid,
	"status" text NOT NULL,
	"plan" text,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"plan_expires_at" timestamp with time zone,
	"trial_used_at" timestamp with time zone,
	"last_active_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "families_family_id_pk" PRIMARY KEY("family_id"),
	CONSTRAINT "families_stripe_customer_id_unique" UNIQUE("stripe_customer_id"),
	CONSTRAINT "families_status_ck" CHECK ("families"."status" IN ('active', 'grace_period', 'suspended', 'terminated'))
);
--> statement-breakpoint
CREATE TABLE "graduation_consent" (
	"family_id" uuid NOT NULL,
	"consent_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"nickname" text NOT NULL,
	"consented" boolean DEFAULT false NOT NULL,
	"user_points" integer DEFAULT 0 NOT NULL,
	"usage_period_days" integer DEFAULT 0 NOT NULL,
	"message" text,
	"consented_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "graduation_consent_family_id_consent_id_pk" PRIMARY KEY("family_id","consent_id")
);
--> statement-breakpoint
CREATE TABLE "inquiries" (
	"inquiry_id" text NOT NULL,
	"family_id" uuid,
	"email" text NOT NULL,
	"reply_email" text,
	"category" text NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inquiries_inquiry_id_pk" PRIMARY KEY("inquiry_id"),
	CONSTRAINT "inquiries_status_ck" CHECK ("inquiries"."status" IN ('open', 'replied', 'closed'))
);
--> statement-breakpoint
CREATE TABLE "invites" (
	"invite_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"invited_by" uuid NOT NULL,
	"role" text NOT NULL,
	"child_id" uuid,
	"email" text,
	"token_hash" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_by" uuid,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invites_invite_id_pk" PRIMARY KEY("invite_id"),
	CONSTRAINT "invites_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "invites_status_ck" CHECK ("invites"."status" IN ('pending', 'accepted', 'revoked', 'expired')),
	CONSTRAINT "invites_role_ck" CHECK ("invites"."role" IN ('owner', 'parent', 'child'))
);
--> statement-breakpoint
CREATE TABLE "login_bonuses" (
	"family_id" uuid NOT NULL,
	"child_id" uuid NOT NULL,
	"login_date" text NOT NULL,
	"rank" text NOT NULL,
	"base_points" integer NOT NULL,
	"multiplier" real DEFAULT 1 NOT NULL,
	"total_points" integer NOT NULL,
	"consecutive_days" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "login_bonuses_family_id_child_id_login_date_pk" PRIMARY KEY("family_id","child_id","login_date")
);
--> statement-breakpoint
CREATE TABLE "loyalty_state" (
	"family_id" uuid NOT NULL,
	"continuation_months" integer DEFAULT 0 NOT NULL,
	"memento_tickets" integer DEFAULT 0 NOT NULL,
	"last_granted_month" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "loyalty_state_family_id_pk" PRIMARY KEY("family_id")
);
--> statement-breakpoint
CREATE TABLE "market_benchmarks" (
	"age" integer NOT NULL,
	"category_id" text NOT NULL,
	"mean" real NOT NULL,
	"std_dev" real NOT NULL,
	"source" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "market_benchmarks_age_category_id_pk" PRIMARY KEY("age","category_id")
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"family_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"owner_guard" uuid GENERATED ALWAYS AS (CASE WHEN role = 'owner' THEN family_id END) STORED,
	"invited_by" uuid,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_family_id_user_id_pk" PRIMARY KEY("family_id","user_id"),
	CONSTRAINT "memberships_owner_guard_unique" UNIQUE("owner_guard"),
	CONSTRAINT "memberships_role_ck" CHECK ("memberships"."role" IN ('owner', 'parent', 'child'))
);
--> statement-breakpoint
CREATE TABLE "notification_logs" (
	"family_id" uuid NOT NULL,
	"log_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"notification_type" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"success" boolean DEFAULT true NOT NULL,
	"error_message" text,
	CONSTRAINT "notification_logs_family_id_log_id_pk" PRIMARY KEY("family_id","log_id")
);
--> statement-breakpoint
CREATE TABLE "notification_settings" (
	"family_id" uuid NOT NULL,
	"reminder_enabled" boolean DEFAULT false NOT NULL,
	"reminder_time" text,
	"consecutive_enabled" boolean DEFAULT false NOT NULL,
	"quiet_hours" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_settings_family_id_pk" PRIMARY KEY("family_id")
);
--> statement-breakpoint
CREATE TABLE "parent_gate_credentials" (
	"family_id" uuid NOT NULL,
	"pin_hash" text NOT NULL,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"reset_trace" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "parent_gate_credentials_family_id_pk" PRIMARY KEY("family_id")
);
--> statement-breakpoint
CREATE TABLE "parent_messages" (
	"family_id" uuid NOT NULL,
	"child_id" uuid NOT NULL,
	"msg_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"message_type" text NOT NULL,
	"stamp_code" text,
	"body" text,
	"icon" text DEFAULT '💌' NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"shown_at" timestamp with time zone,
	"bonus_points" integer,
	"reward_category" text,
	CONSTRAINT "parent_messages_family_id_child_id_msg_id_pk" PRIMARY KEY("family_id","child_id","msg_id"),
	CONSTRAINT "parent_messages_message_type_ck" CHECK ("parent_messages"."message_type" IN ('stamp', 'text', 'reward_notice'))
);
--> statement-breakpoint
CREATE TABLE "plan_tiers" (
	"plan_tier" text NOT NULL,
	"grace_days" integer NOT NULL,
	CONSTRAINT "plan_tiers_plan_tier_pk" PRIMARY KEY("plan_tier")
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"plan_code" text NOT NULL,
	"plan_tier" text NOT NULL,
	CONSTRAINT "plans_plan_code_pk" PRIMARY KEY("plan_code")
);
--> statement-breakpoint
CREATE TABLE "point_conversion_policy" (
	"family_id" uuid NOT NULL,
	"unit_mode" text DEFAULT 'point' NOT NULL,
	"currency" text DEFAULT 'JPY' NOT NULL,
	"conversion_rate" real DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "point_conversion_policy_family_id_pk" PRIMARY KEY("family_id")
);
--> statement-breakpoint
CREATE TABLE "point_ledger" (
	"family_id" uuid NOT NULL,
	"child_id" uuid NOT NULL,
	"ledger_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"amount" integer NOT NULL,
	"type" text NOT NULL,
	"description" text,
	"reference_id" text,
	"recorded_date" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "point_ledger_family_id_child_id_ledger_id_pk" PRIMARY KEY("family_id","child_id","ledger_id")
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"family_id" uuid NOT NULL,
	"subscription_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"endpoint" text NOT NULL,
	"keys_p256dh" text NOT NULL,
	"keys_auth" text NOT NULL,
	"user_agent" text,
	"subscriber_role" text DEFAULT 'parent' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_subscriptions_family_id_subscription_id_pk" PRIMARY KEY("family_id","subscription_id"),
	CONSTRAINT "push_subscriptions_endpoint_unique" UNIQUE("endpoint")
);
--> statement-breakpoint
CREATE TABLE "rest_days" (
	"family_id" uuid NOT NULL,
	"child_id" uuid NOT NULL,
	"date" text NOT NULL,
	"reason" text DEFAULT 'rest' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rest_days_family_id_child_id_date_pk" PRIMARY KEY("family_id","child_id","date")
);
--> statement-breakpoint
CREATE TABLE "reward_redemption_requests" (
	"family_id" uuid NOT NULL,
	"redemption_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"child_id" uuid NOT NULL,
	"reward_id" uuid NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'pending_parent_approval' NOT NULL,
	"parent_note" text,
	"resolved_at" timestamp with time zone,
	"resolved_by_parent_id" text,
	"shown_to_child_at" timestamp with time zone,
	"reward_title" text,
	"reward_points" integer,
	"reward_icon" text,
	CONSTRAINT "reward_redemption_requests_family_id_redemption_id_pk" PRIMARY KEY("family_id","redemption_id"),
	CONSTRAINT "reward_redemption_requests_status_ck" CHECK ("reward_redemption_requests"."status" IN ('pending_parent_approval', 'approved', 'rejected', 'expired'))
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"family_id" uuid NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settings_family_id_key_pk" PRIMARY KEY("family_id","key")
);
--> statement-breakpoint
CREATE TABLE "sibling_cheers" (
	"family_id" uuid NOT NULL,
	"cheer_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"from_child_id" uuid NOT NULL,
	"to_child_id" uuid NOT NULL,
	"stamp_code" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"shown_at" timestamp with time zone,
	CONSTRAINT "sibling_cheers_family_id_cheer_id_pk" PRIMARY KEY("family_id","cheer_id")
);
--> statement-breakpoint
CREATE TABLE "special_rewards" (
	"family_id" uuid NOT NULL,
	"child_id" uuid NOT NULL,
	"reward_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"granted_by" text,
	"title" text NOT NULL,
	"description" text,
	"points" integer NOT NULL,
	"icon" text,
	"category" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"shown_at" timestamp with time zone,
	"source_preset_id" text,
	"shop_category" text,
	CONSTRAINT "special_rewards_family_id_child_id_reward_id_pk" PRIMARY KEY("family_id","child_id","reward_id")
);
--> statement-breakpoint
CREATE TABLE "stamp_cards" (
	"family_id" uuid NOT NULL,
	"child_id" uuid NOT NULL,
	"card_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"week_start" text NOT NULL,
	"week_end" text NOT NULL,
	"status" text DEFAULT 'collecting' NOT NULL,
	"redeemed_points" integer,
	"redeemed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stamp_cards_family_id_child_id_card_id_pk" PRIMARY KEY("family_id","child_id","card_id"),
	CONSTRAINT "stamp_cards_week_uq" UNIQUE("family_id","child_id","week_start"),
	CONSTRAINT "stamp_cards_status_ck" CHECK ("stamp_cards"."status" IN ('collecting', 'redeemable', 'redeemed'))
);
--> statement-breakpoint
CREATE TABLE "stamp_entries" (
	"family_id" uuid NOT NULL,
	"card_id" uuid NOT NULL,
	"slot" integer NOT NULL,
	"stamp_master_id" text,
	"omikuji_rank" text,
	"login_date" text NOT NULL,
	"earned_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stamp_entries_family_id_card_id_slot_pk" PRIMARY KEY("family_id","card_id","slot"),
	CONSTRAINT "stamp_entries_daily_uq" UNIQUE("family_id","card_id","login_date")
);
--> statement-breakpoint
CREATE TABLE "stamp_masters" (
	"stamp_code" text NOT NULL,
	"name" text NOT NULL,
	"emoji" text NOT NULL,
	"rarity" text NOT NULL,
	"is_default" boolean DEFAULT true NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stamp_masters_stamp_code_pk" PRIMARY KEY("stamp_code")
);
--> statement-breakpoint
CREATE TABLE "status_history" (
	"family_id" uuid NOT NULL,
	"child_id" uuid NOT NULL,
	"category_id" text NOT NULL,
	"hist_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"value" real NOT NULL,
	"change_amount" real NOT NULL,
	"change_type" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "status_history_family_id_child_id_category_id_hist_id_pk" PRIMARY KEY("family_id","child_id","category_id","hist_id")
);
--> statement-breakpoint
CREATE TABLE "statuses" (
	"family_id" uuid NOT NULL,
	"child_id" uuid NOT NULL,
	"category_id" text NOT NULL,
	"total_xp" integer DEFAULT 0 NOT NULL,
	"level" integer DEFAULT 1 NOT NULL,
	"peak_xp" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "statuses_family_id_child_id_category_id_pk" PRIMARY KEY("family_id","child_id","category_id")
);
--> statement-breakpoint
CREATE TABLE "stripe_webhook_events" (
	"event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"handler_result" text NOT NULL,
	"error_message" text,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"tenant_id" text,
	CONSTRAINT "stripe_webhook_events_event_id_pk" PRIMARY KEY("event_id")
);
--> statement-breakpoint
CREATE TABLE "trial_history" (
	"family_id" uuid NOT NULL,
	"trial_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"start_date" text NOT NULL,
	"end_date" text NOT NULL,
	"tier" text DEFAULT 'standard' NOT NULL,
	"source" text NOT NULL,
	"campaign_id" text,
	"stripe_subscription_id" text,
	"upgrade_reason" text,
	"trial_start_source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trial_history_family_id_trial_id_pk" PRIMARY KEY("family_id","trial_id")
);
--> statement-breakpoint
CREATE TABLE "usage_logs" (
	"family_id" uuid NOT NULL,
	"child_id" uuid NOT NULL,
	"log_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"duration_sec" integer,
	CONSTRAINT "usage_logs_family_id_child_id_log_id_pk" PRIMARY KEY("family_id","child_id","log_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"user_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"email_lower" text GENERATED ALWAYS AS (lower(email)) STORED,
	"provider" text NOT NULL,
	"display_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_user_id_pk" PRIMARY KEY("user_id"),
	CONSTRAINT "users_email_lower_unique" UNIQUE("email_lower"),
	CONSTRAINT "users_provider_ck" CHECK ("users"."provider" IN ('cognito'))
);
--> statement-breakpoint
CREATE TABLE "viewer_tokens" (
	"family_id" uuid NOT NULL,
	"token_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"token" text NOT NULL,
	"label" text,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "viewer_tokens_family_id_token_id_pk" PRIMARY KEY("family_id","token_id"),
	CONSTRAINT "viewer_tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE INDEX "checklist_template_assignments_child_idx" ON "checklist_template_assignments" USING btree ("family_id","child_id");--> statement-breakpoint
CREATE INDEX "child_challenges_status_idx" ON "child_challenges" USING btree ("family_id","child_id","status");--> statement-breakpoint
CREATE INDEX "cloud_exports_status_idx" ON "cloud_exports" USING btree ("status");--> statement-breakpoint
CREATE INDEX "consents_family_type_at_idx" ON "consents" USING btree ("family_id","type","consented_at");--> statement-breakpoint
CREATE INDEX "graduation_consent_public_idx" ON "graduation_consent" USING btree ("consented","consented_at");--> statement-breakpoint
CREATE INDEX "invites_family_id_idx" ON "invites" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "memberships_user_id_idx" ON "memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "point_ledger_type_date_idx" ON "point_ledger" USING btree ("family_id","child_id","type","recorded_date");--> statement-breakpoint
CREATE INDEX "redemption_child_status_idx" ON "reward_redemption_requests" USING btree ("family_id","child_id","status");--> statement-breakpoint
CREATE INDEX "redemption_status_requested_idx" ON "reward_redemption_requests" USING btree ("family_id","status","requested_at");--> statement-breakpoint
CREATE INDEX "sibling_cheers_to_shown_idx" ON "sibling_cheers" USING btree ("family_id","to_child_id","shown_at");--> statement-breakpoint
CREATE INDEX "special_rewards_granted_idx" ON "special_rewards" USING btree ("family_id","child_id","granted_at");--> statement-breakpoint
CREATE INDEX "stripe_webhook_events_processed_at_idx" ON "stripe_webhook_events" USING btree ("processed_at");--> statement-breakpoint
CREATE INDEX "stripe_webhook_events_type_result_idx" ON "stripe_webhook_events" USING btree ("event_type","handler_result");
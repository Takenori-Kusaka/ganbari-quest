/**
 * `getSettingForAllTenants` に渡してよいキーの allowlist (#4706)。
 *
 * ADR-0063 は「テナント境界はアプリ層の単一強制点で強制する」ことを求めており、
 * **tenant 述語を持たない読み取り口を無制限に開けてはいけない**。ここに列挙したキーは
 * いずれも「配信するかどうかの判定材料」であって顧客が書いたテキストではない
 * (`reward_templates` のような自由記述 JSON は入っていない)。
 *
 * 新しいキーを足すときは「全テナント分をまとめて読んでも、その値が顧客の書いた内容を
 * 含まないか」を確認すること。実装側は allowlist 外のキーを **throw で拒否する**
 * (呼び出し側の判断に委ねない。`tests/unit/db/settings-all-tenants.test.ts` が固定)。
 */
export const CROSS_TENANT_READABLE_SETTING_KEYS = [
	'weekly_report_enabled',
	'weekly_report_day',
	'weekly_report_sent_week',
	'notification_reminders_enabled',
	'notification_reminder_time',
	'notification_reminder_sent_date',
	'notification_streak_enabled',
	'notification_streak_sent_date',
] as const;

/** allowlist 外のキーで横断読み取りしようとしたときに throw する共通 guard。 */
export function assertCrossTenantReadableKey(key: string): void {
	if (!(CROSS_TENANT_READABLE_SETTING_KEYS as readonly string[]).includes(key)) {
		throw new Error(
			`getSettingForAllTenants: key "${key}" は横断読み取りの allowlist に無い ` +
				'(ADR-0063: tenant 述語を持たない読み取りは判定材料キーに限る)',
		);
	}
}

export interface ISettingsRepo {
	getSetting(key: string, tenantId: string): Promise<string | undefined>;
	setSetting(key: string, value: string, tenantId: string): Promise<void>;
	getSettings(keys: string[], tenantId: string): Promise<Record<string, string>>;
	deleteByTenantId(tenantId: string): Promise<void>;
	/**
	 * 全テナント横断で、ある key の保存値を「valuePrefix で始まる / 始まらない」で数える (#4269 ①)。
	 *
	 * `/ops` の在庫監査が「基準不明の旧値がまだ残っているテナント数」を出すための集計。
	 * **返すのは件数だけ**で、どのテナントかは持ち出さない (`contract-state-audit-service` の
	 * PII 方針を踏襲)。テナントごとに `getSetting` を引く N+1 を避けるため repo 層で 1 クエリに畳む
	 * (ADR-0065 原則 2)。`total - withPrefix` が prefix 無しの件数。
	 */
	countValuesByPrefix(
		key: string,
		valuePrefix: string,
	): Promise<{ total: number; withPrefix: number }>;
	/**
	 * 全テナント横断で、ある key の保存値を `tenantId → value` として返す (#4706)。
	 *
	 * 配信 cron (通知 / 週次レポート) は「どのテナントが今この時刻に対象か」を判定するために
	 * 複数の設定キーを毎回読む。テナントごとに `getSettings` を引くと 15 分ごとに
	 * テナント数 × キー数のクエリが出る (ADR-0065 原則 2 の N+1)。判定に使うキーは
	 * 数個で固定なので、**キーごとに 1 クエリへ畳む**ことで実行回数をテナント数から切り離す。
	 *
	 * `countValuesByPrefix` と違い値そのものを返すが、返すのは設定値だけで
	 * 顧客の識別情報は含まない (settings は tenant scope の KVS)。
	 * 値が未保存のテナントは **含まれない** — 既定値の適用は呼び出し側の責務
	 * (「未保存 = 既定で有効」なキーがあるため、ここで既定を埋めると判定が二重になる)。
	 *
	 * **キーは {@link CROSS_TENANT_READABLE_SETTING_KEYS} に限る。** 実装は allowlist 外を
	 * throw で拒否する (呼び出し側の良識に委ねない)。
	 */
	getSettingForAllTenants(key: string): Promise<Map<string, string>>;
	/**
	 * #4338: `keepKeys` に**挙げたキー以外**をすべて削除する（列挙の向きが `deleteByTenantId`
	 * の逆でも `getSettings` の逆でもある）。
	 *
	 * 退会の物理削除は「判定材料 (`soft_deleted_at` / `physical_deletion_date` /
	 * `deletion_grace_plan_tier`) を最後に消す」順序 (#4327) を採っており、最終ステップが
	 * 失敗すると `settings` 行だけが孤児として残る。そこに `pin_hash` / `session_token` /
	 * `questionnaire_*` が同居していると「退会したのに認証情報が残る」状態になる。
	 *
	 * これを「消すキーを列挙する」形で潰すと、**新しい設定キーが増えたとき黙って消し漏らす**
	 * (#4327 と同型の silent gap)。残すキーを列挙して他を全部消す本メソッドなら、
	 * 新キーは何もしなくても削除対象に入る。
	 *
	 * `keepKeys` が空配列のときは {@link deleteByTenantId} と同義（全削除）。
	 */
	deleteByTenantIdExcept(tenantId: string, keepKeys: readonly string[]): Promise<void>;
}

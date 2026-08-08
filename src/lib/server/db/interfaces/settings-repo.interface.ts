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

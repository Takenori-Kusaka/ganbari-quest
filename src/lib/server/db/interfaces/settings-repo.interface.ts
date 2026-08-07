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
}

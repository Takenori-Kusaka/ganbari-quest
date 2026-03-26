export interface ISettingsRepo {
	getSetting(key: string, tenantId: string): Promise<string | undefined>;
	setSetting(key: string, value: string, tenantId: string): Promise<void>;
	getSettings(keys: string[], tenantId: string): Promise<Record<string, string>>;
}

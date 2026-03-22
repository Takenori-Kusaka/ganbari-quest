export interface ISettingsRepo {
	getSetting(key: string): Promise<string | undefined>;
	setSetting(key: string, value: string): Promise<void>;
	getSettings(keys: string[]): Promise<Record<string, string>>;
}

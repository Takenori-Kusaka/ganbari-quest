import type { ChildCustomVoice } from '../types';

export interface IVoiceRepo {
	findByChild(childId: number, scene: string, tenantId: string): Promise<ChildCustomVoice[]>;
	findById(id: number, tenantId: string): Promise<ChildCustomVoice | null>;
	findActiveVoice(
		childId: number,
		scene: string,
		tenantId: string,
	): Promise<ChildCustomVoice | null>;
	insert(voice: Omit<ChildCustomVoice, 'id' | 'createdAt'>): Promise<{ id: number }>;

	/** #3329 backup: child の全カスタム音声 (scene 不問、export 用)。 */
	findAllByChild(childId: number, tenantId: string): Promise<ChildCustomVoice[]>;

	/**
	 * #3329 backup restore 用: createdAt / filePath / publicUrl / isActive を保全して音声行を復元する。
	 * insert は createdAt を now で発番するため round-trip で作成日時が失われる。本メソッドは
	 * 呼び出し側が新 tenant+childId へ remap 済の filePath/publicUrl をそのまま書き戻す
	 * (音声ファイル本体は #3077 importStaticFiles が voices/<newChildId>/ へ復元済)。id は新規採番。
	 */
	insertForRestore(voice: Omit<ChildCustomVoice, 'id'>, tenantId: string): Promise<{ id: number }>;

	setActive(id: number, childId: number, scene: string, tenantId: string): Promise<void>;
	deleteById(id: number, tenantId: string): Promise<void>;
	deleteByChild(childId: number, tenantId: string): Promise<void>;
}

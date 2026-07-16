import type { ChildId } from '$lib/domain/ids';
import type { ChildCustomVoice } from '../types';

export interface IVoiceRepo {
	findByChild(childId: ChildId, scene: string, tenantId: string): Promise<ChildCustomVoice[]>;
	findById(id: string, tenantId: string): Promise<ChildCustomVoice | null>;
	findActiveVoice(
		childId: ChildId,
		scene: string,
		tenantId: string,
	): Promise<ChildCustomVoice | null>;
	insert(voice: Omit<ChildCustomVoice, 'id' | 'createdAt'>): Promise<{ id: string }>;

	/** #3329 backup: child の全カスタム音声 (scene 不問、export 用)。 */
	findAllByChild(childId: ChildId, tenantId: string): Promise<ChildCustomVoice[]>;

	/**
	 * #3329 backup restore 用: createdAt / filePath / publicUrl / isActive を保全して音声行を復元する。
	 * insert は createdAt を now で発番するため round-trip で作成日時が失われる。本メソッドは
	 * 呼び出し側が新 tenant+childId へ remap 済の filePath/publicUrl をそのまま書き戻す
	 * (音声ファイル本体は #3077 importStaticFiles が voices/<newChildId>/ へ復元済)。id は新規採番。
	 *
	 * #3394 統一冪等契約: 永続化しなかった場合 (demo no-op stub) は **null** を返し、
	 * import カウント (childVoicesImported) を偽装しない (#2263 count 偽装 class)。
	 */
	insertForRestore(
		voice: Omit<ChildCustomVoice, 'id'>,
		tenantId: string,
	): Promise<{ id: string } | null>;

	setActive(id: string, childId: ChildId, scene: string, tenantId: string): Promise<void>;
	deleteById(id: string, tenantId: string): Promise<void>;
	deleteByChild(childId: ChildId, tenantId: string): Promise<void>;
}

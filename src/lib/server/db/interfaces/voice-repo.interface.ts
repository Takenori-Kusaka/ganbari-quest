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
	setActive(id: number, childId: number, scene: string, tenantId: string): Promise<void>;
	deleteById(id: number, tenantId: string): Promise<void>;
	deleteByChild(childId: number, tenantId: string): Promise<void>;
}

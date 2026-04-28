import { logger } from '$lib/server/logger';
import { addTemplateItem, createTemplate } from '$lib/server/services/checklist-service';

/** アンケートの回答 */
export interface QuestionnaireAnswers {
	/** お子さまの課題（複数選択） */
	challenges: string[];
	/** 1日の活動量 */
	activityLevel: 'few' | 'normal' | 'many';
	/** 自動作成するチェックリストプリセット */
	checklistPresets: string[];
}

/** チェックリストプリセットアイテム */
interface PresetItem {
	name: string;
	icon: string;
	sortOrder: number;
}

/** チェックリストプリセット定義 */
interface ChecklistPreset {
	presetId: string;
	name: string;
	icon: string;
	pointsPerItem: number;
	completionBonus: number;
	items: PresetItem[];
}

/**
 * 課題ごとのおすすめカテゴリ重み付け
 *
 * #1592 (ADR-0023 I4): setup challenges を 6→3 に簡素化。
 * 旧キー (morning/homework/exercise/picky/balanced) は後方互換のため保持し、過去にアンケート回答を
 * 保存済みのテナントが再度クエリしても壊れないようにする。新規 setup フローからは投稿されない。
 */
const CHALLENGE_CATEGORY_WEIGHTS: Record<string, string[]> = {
	// 新 3 軸（#1592）
	'homework-daily': ['benkyou'],
	chores: ['seikatsu'],
	'beyond-games': ['souzou', 'undou', 'kouryuu'],
	// 旧キー（後方互換 / 廃止予定）
	morning: ['seikatsu'],
	homework: ['benkyou'],
	exercise: ['undou'],
	picky: ['seikatsu'],
	balanced: ['undou', 'benkyou', 'seikatsu', 'souzou', 'kouryuu'],
};

/**
 * 課題ごとのおすすめチェックリスト
 *
 * #1592 (ADR-0023 I4): 新 3 軸 → 対応プリセット
 * - homework-daily → after-school（がっこうからかえったら：宿題ルーティン）
 * - chores → weekend-chores（しゅうまつのおてつだい）
 * - beyond-games → beyond-games（ゲーム以外のチャレンジ：読書/外遊び/工作/音楽）
 */
const CHALLENGE_CHECKLIST_MAP: Record<string, string[]> = {
	// 新 3 軸（#1592）
	'homework-daily': ['after-school'],
	chores: ['weekend-chores'],
	'beyond-games': ['beyond-games'],
	// 旧キー（後方互換 / 廃止予定）
	morning: ['morning-routine'],
	homework: ['after-school'],
	exercise: [],
	picky: [],
	balanced: ['morning-routine', 'evening-routine'],
};

/**
 * アンケート回答からおすすめカテゴリコードを算出
 */
export function getRecommendedCategories(challenges: string[]): string[] {
	const categorySet = new Set<string>();
	for (const challenge of challenges) {
		const categories = CHALLENGE_CATEGORY_WEIGHTS[challenge];
		if (categories) {
			for (const cat of categories) categorySet.add(cat);
		}
	}
	if (categorySet.size === 0) {
		return ['undou', 'benkyou', 'seikatsu', 'souzou', 'kouryuu'];
	}
	return [...categorySet];
}

/**
 * アンケート回答からおすすめチェックリストプリセットIDを算出
 */
export function getRecommendedPresets(challenges: string[]): string[] {
	const presetSet = new Set<string>();
	for (const challenge of challenges) {
		const presets = CHALLENGE_CHECKLIST_MAP[challenge];
		if (presets) {
			for (const p of presets) presetSet.add(p);
		}
	}
	// 最低限 morning-routine + evening-routine は推奨
	presetSet.add('morning-routine');
	presetSet.add('evening-routine');
	return [...presetSet];
}

/**
 * 活動レベルに応じた表示件数目安
 */
export function getActivityDisplayCount(level: 'few' | 'normal' | 'many'): number {
	switch (level) {
		case 'few':
			return 10;
		case 'normal':
			return 20;
		case 'many':
			return 50;
	}
}

/**
 * チェックリストプリセットを子供に自動適用
 */
export async function applyChecklistPresets(
	childId: number,
	presetIds: string[],
	tenantId: string,
): Promise<number> {
	let created = 0;
	for (const presetId of presetIds) {
		try {
			const preset = await loadPreset(presetId);
			if (!preset) continue;

			const template = await createTemplate(
				{
					childId,
					name: preset.name,
					icon: preset.icon,
					pointsPerItem: preset.pointsPerItem,
					completionBonus: preset.completionBonus,
					sourcePresetId: presetId,
				},
				tenantId,
			);

			for (const item of preset.items) {
				await addTemplateItem(
					{
						templateId: template.id,
						name: item.name,
						icon: item.icon,
						sortOrder: item.sortOrder,
					},
					tenantId,
				);
			}
			created++;
		} catch (e) {
			logger.error('Failed to apply checklist preset', { context: { presetId, error: String(e) } });
		}
	}
	return created;
}

/**
 * プリセットJSONファイルを読み込む（ビルド済み静的ファイルから）
 */
async function loadPreset(presetId: string): Promise<ChecklistPreset | null> {
	try {
		const res = await fetch(`/checklist-presets/${presetId}.json`);
		if (!res.ok) return null;
		return (await res.json()) as ChecklistPreset;
	} catch {
		// サーバーサイドではfetchが使えない場合、fs で読む
		try {
			const { readFileSync } = await import('node:fs');
			const { resolve } = await import('node:path');
			const filePath = resolve('static', 'checklist-presets', `${presetId}.json`);
			const raw = readFileSync(filePath, 'utf-8');
			return JSON.parse(raw) as ChecklistPreset;
		} catch {
			logger.warn('Checklist preset not found', { context: { presetId } });
			return null;
		}
	}
}

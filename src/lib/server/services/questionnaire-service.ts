import type { CategoryCode } from '$lib/domain/categories';
import type { ChildId } from '$lib/domain/ids';
import {
	assignTemplateToChildren,
	findAssignmentsByTemplate,
	findTemplateItems,
	findTemplatesByChild,
	findTemplatesByTenant,
} from '$lib/server/db/checklist-repo';
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
// #3607: 値は CategoryCode 型で SSOT に束縛 (rename / typo をコンパイル時検出)。
// 配列順は既存挙動維持のため据置 (SSOT 定義順とは独立の重み付け順)。
const CHALLENGE_CATEGORY_WEIGHTS: Record<string, readonly CategoryCode[]> = {
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
export function getRecommendedCategories(challenges: string[]): CategoryCode[] {
	const categorySet = new Set<CategoryCode>();
	for (const challenge of challenges) {
		const categories = CHALLENGE_CATEGORY_WEIGHTS[challenge];
		if (categories) {
			for (const cat of categories) categorySet.add(cat);
		}
	}
	if (categorySet.size === 0) {
		// #3607: 全カテゴリ fallback。配列順は既存挙動維持のため据置 (SSOT 定義順と souzou/kouryuu が逆)
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
 * チェックリストプリセットを子供に自動適用する。
 *
 * **同じ preset を 2 回適用しない** (#4863 / PO 決裁 2026-09-09)。中断した親の
 * 「続きをする」がウィザードへ戻るようになったので、この step (`/setup/questionnaire`) は
 * **現実に 2 周する**。`createTemplate` → `insertTemplate` は `sourcePresetId` の重複を
 * 一切見ないため、2 周すると子供のチェックリスト画面に「あさのしたく」「よるのじゅんび」が
 * **2 つずつ並ぶ** (実測: template 3 → 6 / item 5 → 10)。
 *
 * 判定は marketplace 側の取込と同じ `sourcePresetId` を鍵にする
 * (`checklist-template-import-service` が同じ鍵で重複検出しているのと揃える)。
 */
export async function applyChecklistPresets(
	childId: ChildId,
	presetIds: string[],
	tenantId: string,
): Promise<number> {
	let created = 0;
	// この子に既に入っている preset (2 周目はここで弾く)。
	// **inactive / archive 済も見る** (#4868 adversarial 指摘)。
	//
	// archive を書くのは `downgrade-service` / `resource-archive-service` で、
	// **親が archive するボタンは無い** (親の削除は `removeTemplate` = 物理削除)。
	// つまり archive 済 = 「無料プランの上限で退避中」で、#4708 の告知バナーが
	// 「有料プランで元に戻る」と案内している状態。ここで見ずに判定すると、
	// **退避中のものと同名の template を歩き直しのたびに作り足す**ことになり、
	// プランを戻した親の画面に同じチェックリストが 2 つ並ぶ。
	const existing = await findTemplatesByChild(childId, tenantId, true, true);
	const appliedPresetIds = new Set(
		existing.map((t) => t.sourcePresetId).filter((v): v is string => Boolean(v)),
	);
	// 配信先を外された結果、**どの子にも配信されていない**同 preset の family template。
	// `/admin/checklists` の `syncDistribution` は assignment を削る実在の顧客導線なので、
	// 「あさのしたく は下の子だけにする」と外した親が歩き直すと、per-child 判定だけでは
	// **別 id の同名 template を新規作成し、旧 template は assignment 0 本の孤児として
	// family に残る** (#4868 adversarial 実測: template 1 → 2 / item 5 → 10。
	// `checkChecklistTemplateLimit` は child 経由で数えるので quota には出ず、
	// admin の一覧にだけ「あさのしたく」が 2 本並ぶ)。孤児があれば**作り直さず配信し直す**。
	//
	// 兄弟の扱いは変えない: 別の子に配信中の template は孤児ではないので、この子には
	// この子の template を作る (family master を共有させると、片方の子だけ item を
	// 足す・減らすができなくなる = 親のカスタマイズを奪う)。
	//
	// **配信し直すのは「プリセットのままの孤児」だけ** (#4868 adversarial round 4 実測)。
	// 孤児は配信解除だけでなく **子供の削除**でもできる (`deleteChild` は assignment を
	// 消すが family scope の template 本体は残す)。そのとき template は削除した子のために
	// 親が書き換えた内容 (「さくらの あさのしたく」/ item「さくらのピアノ」) を持っている
	// ことがあり、それを新しい子へ配信すると**別の子のために書いた個人的な内容が、
	// 新しく登録した子の画面に出る**。名前と item がプリセットと完全一致するものだけを
	// 拾えば、拾った側は「作り直したのと中身が同じ」なので実害が無い。
	const familyTemplates = await findTemplatesByTenant(tenantId, true);
	for (const presetId of presetIds) {
		try {
			if (appliedPresetIds.has(presetId)) continue;

			const preset = await loadPreset(presetId);
			if (!preset) continue;

			const orphan = await findPristineOrphanForPreset(familyTemplates, preset, presetId, tenantId);
			if (orphan) {
				await assignTemplateToChildren(orphan.id, [childId], tenantId);
				appliedPresetIds.add(presetId);
				created++;
				continue;
			}

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
			appliedPresetIds.add(presetId);
			created++;
		} catch (e) {
			logger.error('Failed to apply checklist preset', { context: { presetId, error: String(e) } });
		}
	}
	return created;
}

/**
 * 同じ preset から作られ、**どの子にも配信されておらず、中身がプリセットのまま**の
 * family template を探す (#4868)。
 *
 * 見つかったら、それを作り直さずこの子へ配信し直す。「作り直したのと中身が同じ」なので、
 * 同名 template が 2 本並ぶことも、assignment 0 本の孤児が残ることも避けられる。
 *
 * **中身の一致を要求する理由** (adversarial round 4 実測): 孤児は配信解除だけでなく
 * **子供の削除**でもできる (`deleteChild` は assignment を消すが template 本体は残す)。
 * そのとき template は削除した子のために親が書き換えた内容を持っていることがあり、
 * 名前だけで拾うと**別の子のために書いた個人的な内容が新しい子の画面に出る**。
 *
 * archive 済は `findTemplatesByTenant` が返さないのでここには来ない。
 *
 * **残余**: 別の子に配信中のまま archive された template は family scope の read API が
 * 返さないため見えない (`findTemplatesByTenant` に includeArchived が無い)。その場合は
 * この子に新しい template が作られる。repo interface を 3 backend ぶん広げる変更になるので、
 * ここでは踏み込まない。
 */
async function findPristineOrphanForPreset(
	familyTemplates: readonly { id: string; name?: string; sourcePresetId?: string | null }[],
	preset: ChecklistPreset,
	presetId: string,
	tenantId: string,
): Promise<{ id: string } | null> {
	for (const t of familyTemplates) {
		if ((t.sourcePresetId ?? null) !== presetId) continue;
		// 名前を書き換えられていたら「その子のためのもの」なので拾わない
		if ((t.name ?? '') !== preset.name) continue;
		const assignments = await findAssignmentsByTemplate(t.id, tenantId);
		if (assignments.length > 0) continue;
		// item まで一致していることを見る (名前はそのままで中身だけ足す親が居る)
		const items = await findTemplateItems(t.id, tenantId);
		const actual = JSON.stringify(items.map((i) => i.name));
		const expected = JSON.stringify(preset.items.map((i) => i.name));
		if (actual !== expected) continue;
		return t;
	}
	return null;
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

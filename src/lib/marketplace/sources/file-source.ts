/**
 * File source adapter — ADR-0052 (Issue #2365)
 *
 * ユーザがアップロードする `.json` / `.csv` ファイルを raw payload に正規化する
 * source adapter。`+page.server.ts` から `?/importFile` action 内で呼ばれる。
 *
 * 設計原則 (ADR-0052 §3.2):
 *   - parse の **構文** (JSON / CSV) のみここで吸収
 *   - **意味** validation は Strategy.parse() (Valibot schema) の責務
 *   - DB write は Strategy.apply() の責務
 *
 * 旧経路: `+page.server.ts` 内 inline `parseCsvActivities` (#0224)。
 * Strangler Fig パターンで本ファイルに集約し、+page.server.ts 側は dispatcher 呼出のみに変える。
 *
 * 関連:
 *   - $lib/server/services/activity-import-service.ts (旧 service、deprecated)
 *   - ADR-0052
 */

import type { ActivityPackItem } from '$lib/domain/activity-pack';
import { CATEGORY_CODES } from '$lib/domain/validation/activity';
import { parseAnyExportEnvelope } from '../export-schema.js';
import type { ChecklistPayload } from '../schemas/checklist-schema.js';
import type { RewardSetPayload } from '../schemas/reward-set-schema.js';

/**
 * File パースエラー (UI fail() メッセージに使う)
 */
export class FileSourceError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'FileSourceError';
	}
}

/**
 * `.json` / `.csv` の File から `{ activities: ActivityPackItem[] }` 形式の raw payload を生成。
 *
 * @param file アップロードされた File オブジェクト
 * @returns Strategy.parse() に渡せる payload (Valibot schema 経由で検証される)
 * @throws FileSourceError 構文エラー / 空 / 形式不正
 */
export async function loadActivityPackFromFile(
	file: File,
): Promise<{ activities: ActivityPackItem[]; displayName: string }> {
	if (!file || file.size === 0) {
		throw new FileSourceError('ファイルを選択してください');
	}

	const text = await file.text();
	let activities: ActivityPackItem[];

	try {
		if (file.name.endsWith('.csv')) {
			activities = parseCsvActivities(text);
		} else {
			const parsed = JSON.parse(text);
			activities = parsed.activities ?? parsed;
			if (!Array.isArray(activities)) {
				throw new FileSourceError('JSON の形式が正しくありません');
			}
		}
	} catch (e) {
		if (e instanceof FileSourceError) throw e;
		throw new FileSourceError('ファイルの解析に失敗しました');
	}

	if (activities.length === 0) {
		throw new FileSourceError('インポートする活動がありません');
	}

	return { activities, displayName: file.name };
}

/**
 * CSV を ActivityPackItem[] に変換。
 *
 * 旧 `+page.server.ts` 内 inline 実装を移植。CSV 仕様は変えない (E2E 互換性維持)。
 *
 * 形式: 1 行目はヘッダー (スキップ)、2 行目以降 `name,categoryCode,icon,basePoints,description?`
 */
function parseCsvActivities(text: string): ActivityPackItem[] {
	const lines = text.split('\n').filter((l) => l.trim());
	if (lines.length < 2) return [];

	const validCodes = new Set<string>(CATEGORY_CODES);
	const items: ActivityPackItem[] = [];

	for (let i = 1; i < lines.length; i++) {
		const line = lines[i];
		if (!line) continue;
		const cols = line.split(',').map((c) => c.trim());
		if (cols.length < 4) continue;

		const [name, categoryCode, icon, pointsStr, description] = cols;
		if (!name || !categoryCode || !validCodes.has(categoryCode)) continue;

		items.push({
			name,
			categoryCode: categoryCode as ActivityPackItem['categoryCode'],
			icon: icon || '📝',
			basePoints: Number(pointsStr) || 5,
			ageMin: null,
			ageMax: null,
			gradeLevel: null,
			description: description || undefined,
		});
	}

	return items;
}

/**
 * v2 export envelope (#2372 / dispatchExport 出力) の `.json` File を payload に展開する
 * 汎用 loader (#3079: ごほうび・チェックリスト個別 backup/restore)。
 *
 * activity-pack は CSV 互換 + 旧 v1 形式があるため `loadActivityPackFromFile` を別 path で
 * 維持するが、reward-set / checklist は marketplace 5 type の export が v2 envelope 1 形式に
 * 統一されている (`dispatchExportToJson`) ため、本 loader が envelope を `parseAnyExportEnvelope`
 * で剥がし `envelope.payload` を rawPayload として返す。round-trip 整合は
 * `tests/unit/marketplace/file-source-envelope.test.ts` で検証する。
 *
 * @param file       アップロードされた `.json` File (v2 envelope)
 * @param typeCode   期待する marketplace typeCode (envelope.typeCode と一致必須)
 * @returns          Strategy.parse() に渡せる payload + displayName (= file 名)
 * @throws FileSourceError 構文エラー / 空 / typeCode 不一致 / checksum 不一致
 */
async function loadEnvelopePayloadFromFile(
	file: File,
	typeCode: 'reward-set' | 'checklist',
): Promise<{ payload: unknown; displayName: string }> {
	if (!file || file.size === 0) {
		throw new FileSourceError('ファイルを選択してください');
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(await file.text());
	} catch {
		throw new FileSourceError('JSON の形式が正しくありません');
	}

	let envelope: ReturnType<typeof parseAnyExportEnvelope>;
	try {
		// checksum 検証 + schema validation を一括実行 (改竄 / 破損ファイル検知)
		envelope = parseAnyExportEnvelope(parsed);
	} catch {
		throw new FileSourceError('バックアップファイルの形式が正しくありません');
	}

	if (envelope.typeCode !== typeCode) {
		throw new FileSourceError(
			'このページのバックアップファイルではありません（種類が一致しません）',
		);
	}

	return { payload: envelope.payload, displayName: file.name };
}

/**
 * ごほうび (reward-set) の v2 envelope バックアップファイルを payload に展開する (#3079)。
 *
 * 戻り値 `payload` は `RewardSetPayload` shape (`{ rewards: [...] }`)。
 * 呼出側は `dispatchImport({ typeCode: 'reward-set', rawPayload: payload, ctx })` に渡す。
 */
export async function loadRewardSetFromFile(
	file: File,
): Promise<{ payload: RewardSetPayload; displayName: string }> {
	const { payload, displayName } = await loadEnvelopePayloadFromFile(file, 'reward-set');
	return { payload: payload as RewardSetPayload, displayName };
}

/**
 * チェックリスト (checklist) の v2 envelope バックアップファイルを payload に展開する (#3079)。
 *
 * 戻り値 `payload` は `ChecklistPayload` shape (`{ timing, items: [...] }`、単一テンプレート)。
 * 呼出側は `importChecklistTemplateFromPayload(payload, ...)` に渡す
 * (checklist Strategy は marketplace preset registry 参照型のため、file 復元は payload-driven
 * import helper を直接呼ぶ。詳細は marketplace-import-flow.md §3.3)。
 */
export async function loadChecklistFromFile(
	file: File,
): Promise<{ payload: ChecklistPayload; displayName: string }> {
	const { payload, displayName } = await loadEnvelopePayloadFromFile(file, 'checklist');
	return { payload: payload as ChecklistPayload, displayName };
}

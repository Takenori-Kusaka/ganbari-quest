/**
 * file-source v2 envelope loader 単体テスト — Issue #3079.
 *
 * ごほうび・チェックリストの個別 backup/restore で、export した v2 envelope ファイルを
 * `loadRewardSetFromFile` / `loadChecklistFromFile` が剥がして payload を返す round-trip を検証する。
 *
 * 検証経路:
 *   payload → dispatchExportToJson(typeCode) → File → loadXxxFromFile → payload (一致)
 *
 * + 異常系: 空ファイル / 不正 JSON / typeCode 不一致 / checksum 改竄 で FileSourceError。
 */

import { describe, expect, it } from 'vitest';
import { dispatchExportToJson } from '$lib/marketplace/export-dispatcher';
import type { ActivityPackPayload } from '$lib/marketplace/schemas/activity-pack-schema';
import type { ChecklistPayload } from '$lib/marketplace/schemas/checklist-schema';
import type { RewardSetPayload } from '$lib/marketplace/schemas/reward-set-schema';
import {
	FileSourceError,
	loadActivityPackFromFile,
	loadChecklistFromFile,
	loadRewardSetFromFile,
} from '$lib/marketplace/sources/file-source';

const REWARD_PAYLOAD: RewardSetPayload = {
	rewards: [
		{ title: 'ゲーム30分', points: 100, icon: '🎮', category: 'other' },
		{ title: '好きなおやつ', points: 50, icon: '🍫', category: 'life', description: '1つ選べる' },
	],
};

const CHECKLIST_PAYLOAD: ChecklistPayload = {
	timing: 'morning',
	items: [
		{ label: 'ハンカチ', icon: '🧻', order: 0 },
		{ label: 'ティッシュ', icon: '🤧', order: 1 },
	],
};

const ACTIVITY_PACK_PAYLOAD: ActivityPackPayload = {
	activities: [
		{
			name: 'ランニング',
			categoryCode: 'undou',
			icon: '🏃',
			basePoints: 10,
			ageMin: null,
			ageMax: null,
			gradeLevel: null,
		},
		{
			name: '読書',
			categoryCode: 'benkyou',
			icon: '📚',
			basePoints: 5,
			ageMin: null,
			ageMax: null,
			gradeLevel: null,
			triggerHint: '寝る前',
		},
	],
};

function makeFile(content: string, name: string): File {
	return new File([content], name, { type: 'application/json' });
}

describe('loadRewardSetFromFile (#3079)', () => {
	it('export した reward-set envelope を round-trip で payload に復元する', async () => {
		const json = dispatchExportToJson({ typeCode: 'reward-set', payload: REWARD_PAYLOAD });
		const file = makeFile(json, 'rewards-export.json');

		const { payload, displayName } = await loadRewardSetFromFile(file);

		expect(payload).toEqual(REWARD_PAYLOAD);
		expect(displayName).toBe('rewards-export.json');
	});

	it('空ファイルは FileSourceError', async () => {
		await expect(loadRewardSetFromFile(makeFile('', 'empty.json'))).rejects.toBeInstanceOf(
			FileSourceError,
		);
	});

	it('不正 JSON は FileSourceError', async () => {
		await expect(loadRewardSetFromFile(makeFile('{not json', 'bad.json'))).rejects.toBeInstanceOf(
			FileSourceError,
		);
	});

	it('typeCode 不一致 (checklist envelope を reward として読む) は FileSourceError', async () => {
		const json = dispatchExportToJson({ typeCode: 'checklist', payload: CHECKLIST_PAYLOAD });
		await expect(loadRewardSetFromFile(makeFile(json, 'wrong.json'))).rejects.toBeInstanceOf(
			FileSourceError,
		);
	});

	it('checksum 改竄ファイルは FileSourceError (parseAnyExportEnvelope で検知)', async () => {
		const json = dispatchExportToJson({ typeCode: 'reward-set', payload: REWARD_PAYLOAD });
		const tampered = JSON.parse(json);
		tampered.payload.rewards[0].points = 999999; // checksum 不一致になる
		await expect(
			loadRewardSetFromFile(makeFile(JSON.stringify(tampered), 'tampered.json')),
		).rejects.toBeInstanceOf(FileSourceError);
	});
});

describe('loadChecklistFromFile (#3079)', () => {
	it('export した checklist envelope を round-trip で payload に復元する', async () => {
		const json = dispatchExportToJson({ typeCode: 'checklist', payload: CHECKLIST_PAYLOAD });
		const file = makeFile(json, 'checklist-もちもの.json');

		const { payload, displayName } = await loadChecklistFromFile(file);

		expect(payload).toEqual(CHECKLIST_PAYLOAD);
		expect(displayName).toBe('checklist-もちもの.json');
	});

	it('typeCode 不一致 (reward envelope を checklist として読む) は FileSourceError', async () => {
		const json = dispatchExportToJson({ typeCode: 'reward-set', payload: REWARD_PAYLOAD });
		await expect(loadChecklistFromFile(makeFile(json, 'wrong.json'))).rejects.toBeInstanceOf(
			FileSourceError,
		);
	});
});

describe('loadActivityPackFromFile v2 統一 (#3079 AC4)', () => {
	it('export した activity-pack v2 envelope を round-trip で payload に復元する', async () => {
		const json = dispatchExportToJson({
			typeCode: 'activity-pack',
			payload: ACTIVITY_PACK_PAYLOAD,
		});
		const file = makeFile(json, 'activities-export.json');

		const { activities, displayName } = await loadActivityPackFromFile(file);

		expect(activities).toEqual(ACTIVITY_PACK_PAYLOAD.activities);
		expect(displayName).toBe('activities-export.json');
	});

	it('旧 v1 (formatVersion 1.0) エクスポートファイルの復元を受理する (後方互換、ADR-0006)', async () => {
		// 旧 /api/v1/activities/export が出力していた v1 形式をそのまま復元できることを保証する。
		// この回帰テストは v1 入力サポートの削除を検知するための安全装置 (削除禁止)。
		const v1Export = {
			formatVersion: '1.0' as const,
			packId: 'user-export',
			packName: 'エクスポートされた活動',
			description: '2件の活動をエクスポート',
			icon: '📤',
			targetAgeMin: 0,
			targetAgeMax: 15,
			tags: ['エクスポート'],
			activities: [
				{
					name: 'ランニング',
					nameKana: 'ランニング',
					categoryCode: 'undou',
					icon: '🏃',
					basePoints: 10,
					ageMin: null,
					ageMax: null,
					gradeLevel: null,
					triggerHint: undefined,
				},
				{
					name: '読書',
					categoryCode: 'benkyou',
					icon: '📚',
					basePoints: 5,
					ageMin: null,
					ageMax: null,
					gradeLevel: null,
					triggerHint: '寝る前',
				},
			],
		};
		const { activities } = await loadActivityPackFromFile(
			makeFile(JSON.stringify(v1Export), 'activities-export.json'),
		);
		// v1 migration 後も name / categoryCode / basePoints / triggerHint が保持される
		expect(activities.map((a) => a.name)).toEqual(['ランニング', '読書']);
		expect(activities[1]?.triggerHint).toBe('寝る前');
	});

	it('bare array / { activities:[] } JSON も受理する (手書きインポート互換)', async () => {
		const bare = { activities: ACTIVITY_PACK_PAYLOAD.activities };
		const { activities } = await loadActivityPackFromFile(
			makeFile(JSON.stringify(bare), 'manual.json'),
		);
		expect(activities.map((a) => a.name)).toEqual(['ランニング', '読書']);
	});

	it('typeCode 不一致 (reward envelope を activity として読む) は FileSourceError', async () => {
		const json = dispatchExportToJson({ typeCode: 'reward-set', payload: REWARD_PAYLOAD });
		await expect(loadActivityPackFromFile(makeFile(json, 'wrong.json'))).rejects.toBeInstanceOf(
			FileSourceError,
		);
	});

	it('checksum 改竄ファイルは FileSourceError (parseAnyExportEnvelope で検知)', async () => {
		const json = dispatchExportToJson({
			typeCode: 'activity-pack',
			payload: ACTIVITY_PACK_PAYLOAD,
		});
		const tampered = JSON.parse(json);
		tampered.payload.activities[0].basePoints = 999999; // checksum 不一致になる
		await expect(
			loadActivityPackFromFile(makeFile(JSON.stringify(tampered), 'tampered.json')),
		).rejects.toBeInstanceOf(FileSourceError);
	});

	it('空ファイルは FileSourceError', async () => {
		await expect(loadActivityPackFromFile(makeFile('', 'empty.json'))).rejects.toBeInstanceOf(
			FileSourceError,
		);
	});
});

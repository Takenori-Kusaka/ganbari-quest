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
import type { ChecklistPayload } from '$lib/marketplace/schemas/checklist-schema';
import type { RewardSetPayload } from '$lib/marketplace/schemas/reward-set-schema';
import {
	FileSourceError,
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

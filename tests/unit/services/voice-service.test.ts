// tests/unit/services/voice-service.test.ts
// voice-service ユニットテスト — 親の声・カスタム音声管理

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockVoiceRepo = {
	findByChild: vi.fn(),
	findById: vi.fn(),
	insert: vi.fn(),
	setActive: vi.fn(),
	deleteById: vi.fn(),
	findActiveVoice: vi.fn(),
};

vi.mock('$lib/server/db/factory', () => ({
	getRepos: () => ({ voice: mockVoiceRepo }),
}));

vi.mock('$lib/server/storage', () => ({
	saveFile: vi.fn(),
	deleteFile: vi.fn(),
}));

vi.mock('$lib/server/storage-keys', () => ({
	voiceKey: vi.fn().mockReturnValue('voices/test-key.mp3'),
	storageKeyToPublicUrl: vi.fn().mockReturnValue('/public/voices/test-key.mp3'),
}));

vi.mock('$lib/server/security/file-sanitizer', () => ({
	sanitizeAudio: vi.fn().mockImplementation((buf: Buffer) => buf),
}));

vi.mock('$lib/server/security/magic-bytes', () => ({
	validateAudioMagicBytes: vi.fn().mockReturnValue({ valid: true }),
}));

vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

import { validateAudioMagicBytes } from '$lib/server/security/magic-bytes';
import {
	activateVoice,
	deleteVoice,
	getActiveVoicePath,
	listVoices,
	uploadVoice,
} from '$lib/server/services/voice-service';
import { deleteFile } from '$lib/server/storage';

function makeFile(size: number, type: string): File {
	const bytes = new Uint8Array(size);
	const file = new File([bytes], 'test.mp3', { type });
	// jsdom の Blob.slice().arrayBuffer() が未実装のため、
	// slice が arrayBuffer() を持つオブジェクトを返すようパッチ
	file.slice = (start?: number, end?: number, _contentType?: string) => {
		const slicedBytes = bytes.slice(start ?? 0, end ?? bytes.length);
		return {
			arrayBuffer: () => Promise.resolve(slicedBytes.buffer as ArrayBuffer),
		} as Blob;
	};
	// file.arrayBuffer() 自体も jsdom で動かない場合があるためパッチ
	file.arrayBuffer = () => Promise.resolve(bytes.buffer as ArrayBuffer);
	return file;
}

const TENANT = 'tenant-1';
const CHILD_ID = 1;
const SCENE = 'complete';

describe('voice-service', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('listVoices', () => {
		it('ボイス一覧を返し isActive を boolean に変換する', async () => {
			mockVoiceRepo.findByChild.mockResolvedValueOnce([
				{
					id: 1,
					label: 'よくできました',
					publicUrl: '/voices/1.mp3',
					durationMs: 3000,
					isActive: 1,
					createdAt: '2026-01-01',
				},
				{
					id: 2,
					label: 'がんばったね',
					publicUrl: '/voices/2.mp3',
					durationMs: null,
					isActive: 0,
					createdAt: '2026-01-02',
				},
			]);

			const result = await listVoices(CHILD_ID, SCENE, TENANT);

			expect(result).toHaveLength(2);
			expect(result[0]?.isActive).toBe(true);
			expect(result[1]?.isActive).toBe(false);
			expect(typeof result[0]?.isActive).toBe('boolean');
			expect(typeof result[1]?.isActive).toBe('boolean');
		});

		it('ボイスがない場合は空配列を返す', async () => {
			mockVoiceRepo.findByChild.mockResolvedValueOnce([]);
			const result = await listVoices(CHILD_ID, SCENE, TENANT);
			expect(result).toEqual([]);
		});

		it('正しいフィールドをマッピングする', async () => {
			mockVoiceRepo.findByChild.mockResolvedValueOnce([
				{
					id: 5,
					label: 'テストラベル',
					publicUrl: '/voices/5.mp3',
					durationMs: 1500,
					isActive: 0,
					createdAt: '2026-03-15',
				},
			]);

			const result = await listVoices(CHILD_ID, SCENE, TENANT);
			expect(result[0]).toEqual({
				id: 5,
				label: 'テストラベル',
				publicUrl: '/voices/5.mp3',
				durationMs: 1500,
				isActive: false,
				createdAt: '2026-03-15',
			});
		});
	});

	describe('uploadVoice', () => {
		it('有効なファイルをアップロードして id と publicUrl を返す', async () => {
			mockVoiceRepo.findByChild.mockResolvedValueOnce([]);
			mockVoiceRepo.insert.mockResolvedValueOnce({ id: 42 });

			const file = makeFile(1024, 'audio/mpeg');
			const result = await uploadVoice(CHILD_ID, TENANT, file, 'テスト音声');

			expect(result).toEqual({ id: 42, publicUrl: '/public/voices/test-key.mp3' });
		});

		it('Fileインスタンスでない場合 INVALID_FILE を返す', async () => {
			const result = await uploadVoice(CHILD_ID, TENANT, 'not-a-file' as unknown as File, 'テスト');
			expect(result).toEqual({ error: 'INVALID_FILE' });
		});

		it('サイズ0のファイルは INVALID_FILE を返す', async () => {
			const file = makeFile(0, 'audio/mpeg');
			const result = await uploadVoice(CHILD_ID, TENANT, file, 'テスト');
			expect(result).toEqual({ error: 'INVALID_FILE' });
		});

		it('5MBを超えるファイルは FILE_TOO_LARGE を返す', async () => {
			const file = makeFile(5 * 1024 * 1024 + 1, 'audio/mpeg');
			const result = await uploadVoice(CHILD_ID, TENANT, file, 'テスト');
			expect(result).toEqual({ error: 'FILE_TOO_LARGE' });
		});

		it('5MBちょうどのファイルは受け付ける', async () => {
			mockVoiceRepo.findByChild.mockResolvedValueOnce([]);
			mockVoiceRepo.insert.mockResolvedValueOnce({ id: 1 });

			const file = makeFile(5 * 1024 * 1024, 'audio/mpeg');
			const result = await uploadVoice(CHILD_ID, TENANT, file, 'テスト');
			expect(result).toEqual({ id: 1, publicUrl: '/public/voices/test-key.mp3' });
		});

		it('サポートされていないMIMEタイプは UNSUPPORTED_TYPE を返す', async () => {
			const file = makeFile(1024, 'audio/flac');
			const result = await uploadVoice(CHILD_ID, TENANT, file, 'テスト');
			expect(result).toEqual({ error: 'UNSUPPORTED_TYPE' });
		});

		it('マジックバイトが無効な場合 INVALID_FILE を返す', async () => {
			vi.mocked(validateAudioMagicBytes).mockReturnValueOnce({
				valid: false,
			} as ReturnType<typeof validateAudioMagicBytes>);

			const file = makeFile(1024, 'audio/mpeg');
			const result = await uploadVoice(CHILD_ID, TENANT, file, 'テスト');
			expect(result).toEqual({ error: 'INVALID_FILE' });
		});

		it('既存ボイスが10件以上の場合 TOO_MANY_VOICES を返す', async () => {
			mockVoiceRepo.findByChild.mockResolvedValueOnce(
				Array.from({ length: 10 }, (_, i) => ({ id: i + 1 })),
			);

			const file = makeFile(1024, 'audio/mpeg');
			const result = await uploadVoice(CHILD_ID, TENANT, file, 'テスト');
			expect(result).toEqual({ error: 'TOO_MANY_VOICES' });
		});

		it('許可されたオーディオタイプはすべて受け付ける', async () => {
			const allowedTypes = [
				'audio/mpeg',
				'audio/mp4',
				'audio/wav',
				'audio/webm',
				'audio/ogg',
				'audio/x-m4a',
			];

			for (const type of allowedTypes) {
				vi.clearAllMocks();
				mockVoiceRepo.findByChild.mockResolvedValueOnce([]);
				mockVoiceRepo.insert.mockResolvedValueOnce({ id: 1 });

				const file = makeFile(1024, type);
				const result = await uploadVoice(CHILD_ID, TENANT, file, 'テスト');
				expect(result).toEqual(expect.objectContaining({ id: 1 }));
			}
		});

		it('ラベルの前後空白をトリムして保存する', async () => {
			mockVoiceRepo.findByChild.mockResolvedValueOnce([]);
			mockVoiceRepo.insert.mockResolvedValueOnce({ id: 1 });

			const file = makeFile(1024, 'audio/mpeg');
			await uploadVoice(CHILD_ID, TENANT, file, '  テスト音声  ');

			expect(mockVoiceRepo.insert).toHaveBeenCalledWith(
				expect.objectContaining({ label: 'テスト音声' }),
			);
		});

		it('durationMsが未指定の場合nullで保存する', async () => {
			mockVoiceRepo.findByChild.mockResolvedValueOnce([]);
			mockVoiceRepo.insert.mockResolvedValueOnce({ id: 1 });

			const file = makeFile(1024, 'audio/mpeg');
			await uploadVoice(CHILD_ID, TENANT, file, 'テスト');

			expect(mockVoiceRepo.insert).toHaveBeenCalledWith(
				expect.objectContaining({ durationMs: null }),
			);
		});

		it('durationMsが指定された場合はその値で保存する', async () => {
			mockVoiceRepo.findByChild.mockResolvedValueOnce([]);
			mockVoiceRepo.insert.mockResolvedValueOnce({ id: 1 });

			const file = makeFile(1024, 'audio/mpeg');
			await uploadVoice(CHILD_ID, TENANT, file, 'テスト', 'complete', 5000);

			expect(mockVoiceRepo.insert).toHaveBeenCalledWith(
				expect.objectContaining({ durationMs: 5000 }),
			);
		});
	});

	describe('activateVoice', () => {
		it('ボイスが存在し子供IDが一致する場合 true を返す', async () => {
			mockVoiceRepo.findById.mockResolvedValueOnce({ id: 1, childId: CHILD_ID });
			const result = await activateVoice(1, CHILD_ID, SCENE, TENANT);
			expect(result).toBe(true);
			expect(mockVoiceRepo.setActive).toHaveBeenCalledWith(1, CHILD_ID, SCENE, TENANT);
		});

		it('ボイスが見つからない場合 false を返す', async () => {
			mockVoiceRepo.findById.mockResolvedValueOnce(null);
			const result = await activateVoice(999, CHILD_ID, SCENE, TENANT);
			expect(result).toBe(false);
			expect(mockVoiceRepo.setActive).not.toHaveBeenCalled();
		});

		it('ボイスが別の子供に属する場合 false を返す', async () => {
			mockVoiceRepo.findById.mockResolvedValueOnce({ id: 1, childId: 999 });
			const result = await activateVoice(1, CHILD_ID, SCENE, TENANT);
			expect(result).toBe(false);
			expect(mockVoiceRepo.setActive).not.toHaveBeenCalled();
		});
	});

	describe('deleteVoice', () => {
		it('ボイスが存在する場合ファイルとDBレコードを削除して true を返す', async () => {
			mockVoiceRepo.findById.mockResolvedValueOnce({
				id: 1,
				filePath: 'voices/old.mp3',
			});
			mockVoiceRepo.deleteById.mockResolvedValueOnce(undefined);

			const result = await deleteVoice(1, TENANT);

			expect(result).toBe(true);
			expect(deleteFile).toHaveBeenCalledWith('voices/old.mp3');
			expect(mockVoiceRepo.deleteById).toHaveBeenCalledWith(1, TENANT);
		});

		it('ボイスが見つからない場合 false を返す', async () => {
			mockVoiceRepo.findById.mockResolvedValueOnce(null);
			const result = await deleteVoice(999, TENANT);
			expect(result).toBe(false);
			expect(deleteFile).not.toHaveBeenCalled();
			expect(mockVoiceRepo.deleteById).not.toHaveBeenCalled();
		});

		it('ファイル削除に失敗してもDBレコードは削除して true を返す', async () => {
			mockVoiceRepo.findById.mockResolvedValueOnce({
				id: 1,
				filePath: 'voices/broken.mp3',
			});
			vi.mocked(deleteFile).mockRejectedValueOnce(new Error('S3 delete failed'));
			mockVoiceRepo.deleteById.mockResolvedValueOnce(undefined);

			const result = await deleteVoice(1, TENANT);

			expect(result).toBe(true);
			expect(mockVoiceRepo.deleteById).toHaveBeenCalledWith(1, TENANT);
		});
	});

	describe('getActiveVoicePath', () => {
		it('アクティブなボイスがある場合 publicUrl を返す', async () => {
			mockVoiceRepo.findActiveVoice.mockResolvedValueOnce({
				publicUrl: '/voices/active.mp3',
			});

			const result = await getActiveVoicePath(CHILD_ID, TENANT);
			expect(result).toBe('/voices/active.mp3');
		});

		it('アクティブなボイスがない場合 null を返す', async () => {
			mockVoiceRepo.findActiveVoice.mockResolvedValueOnce(null);
			const result = await getActiveVoicePath(CHILD_ID, TENANT);
			expect(result).toBeNull();
		});

		it('undefinedが返された場合も null を返す', async () => {
			mockVoiceRepo.findActiveVoice.mockResolvedValueOnce(undefined);
			const result = await getActiveVoicePath(CHILD_ID, TENANT);
			expect(result).toBeNull();
		});

		it('sceneパラメータのデフォルト値は complete', async () => {
			mockVoiceRepo.findActiveVoice.mockResolvedValueOnce(null);
			await getActiveVoicePath(CHILD_ID, TENANT);
			expect(mockVoiceRepo.findActiveVoice).toHaveBeenCalledWith(CHILD_ID, 'complete', TENANT);
		});
	});
});

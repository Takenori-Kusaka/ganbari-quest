// tests/unit/services/message-service.test.ts
// おうえんメッセージサービスのユニットテスト

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../../../src/lib/server/db/schema';
import type { InsertParentMessageInput } from '../../../src/lib/server/db/types';
import {
	closeDb,
	createTestDb,
	resetDb as resetAllTables,
	type TestDb,
	type TestSqlite,
} from '../helpers/test-db';

let sqlite: TestSqlite;
let testDb: TestDb;

vi.mock('$lib/server/db', () => ({
	get db() {
		return testDb;
	},
}));
vi.mock('$lib/server/db/client', () => ({
	get db() {
		return testDb;
	},
}));

// サービス層テスト用: message-repo ファサードのモック
const mockInsertMessage = vi.fn();
const mockFindMessages = vi.fn();
const mockFindUnshownMessage = vi.fn();
const mockCountUnshownMessages = vi.fn();
const mockMarkMessageShown = vi.fn();

vi.mock('$lib/server/db/message-repo', () => ({
	insertMessage: (...args: unknown[]) => mockInsertMessage(...args),
	findMessages: (...args: unknown[]) => mockFindMessages(...args),
	findUnshownMessage: (...args: unknown[]) => mockFindUnshownMessage(...args),
	countUnshownMessages: (...args: unknown[]) => mockCountUnshownMessages(...args),
	markMessageShown: (...args: unknown[]) => mockMarkMessageShown(...args),
}));

import {
	countUnshownMessages,
	findMessages,
	findUnshownMessage,
	insertMessage,
	markMessageShown,
} from '../../../src/lib/server/db/sqlite/message-repo';
import {
	getMessageHistory,
	getStampPreset,
	getUnshownMessage,
	STAMP_PRESETS,
	sendMessage,
} from '../../../src/lib/server/services/message-service';

beforeAll(() => {
	const t = createTestDb();
	sqlite = t.sqlite;
	testDb = t.db;
});

afterAll(() => {
	closeDb(sqlite);
});

function resetDb() {
	resetAllTables(sqlite);
}

function seedBase() {
	resetDb();
	testDb.insert(schema.children).values({ nickname: 'テストちゃん', age: 4, theme: 'pink' }).run();
}

describe('STAMP_PRESETS', () => {
	it('8種類以上の定型スタンプが定義されている', () => {
		expect(STAMP_PRESETS.length).toBeGreaterThanOrEqual(8);
	});

	it('各スタンプにcode, label, iconがある', () => {
		for (const stamp of STAMP_PRESETS) {
			expect(stamp.code).toBeTypeOf('string');
			expect(stamp.label).toBeTypeOf('string');
			expect(stamp.icon).toBeTypeOf('string');
		}
	});
});

describe('getStampPreset', () => {
	it('存在するコードでプリセットを取得', () => {
		const result = getStampPreset('sugoi');
		expect(result).toBeDefined();
		expect(result?.label).toBe('すごいね！');
	});

	it('存在しないコードはundefined', () => {
		expect(getStampPreset('nonexistent')).toBeUndefined();
	});
});

describe('message-repo', () => {
	beforeEach(() => {
		seedBase();
	});

	it('スタンプメッセージを送信・取得できる', async () => {
		const msg = await insertMessage(
			{ childId: 1, messageType: 'stamp', stampCode: 'sugoi', icon: '🌟' },
			'test-tenant',
		);
		expect(msg.id).toBe(1);
		expect(msg.messageType).toBe('stamp');
		expect(msg.stampCode).toBe('sugoi');
	});

	it('テキストメッセージを送信・取得できる', async () => {
		const msg = await insertMessage(
			{ childId: 1, messageType: 'text', body: 'がんばってるね！' },
			'test-tenant',
		);
		expect(msg.body).toBe('がんばってるね！');
	});

	it('未表示メッセージを取得できる', async () => {
		await insertMessage(
			{ childId: 1, messageType: 'stamp', stampCode: 'daisuki', icon: '🤗' },
			'test-tenant',
		);

		const unshown = await findUnshownMessage(1, 'test-tenant');
		expect(unshown).toBeDefined();
		expect(unshown?.stampCode).toBe('daisuki');
	});

	it('未表示メッセージ数をカウントできる', async () => {
		await insertMessage(
			{ childId: 1, messageType: 'stamp', stampCode: 'sugoi', icon: '🌟' },
			'test-tenant',
		);
		await insertMessage({ childId: 1, messageType: 'text', body: 'テスト' }, 'test-tenant');

		const count = await countUnshownMessages(1, 'test-tenant');
		expect(count).toBe(2);
	});

	it('メッセージを表示済みにできる', async () => {
		const msg = await insertMessage(
			{ childId: 1, messageType: 'stamp', stampCode: 'sugoi', icon: '🌟' },
			'test-tenant',
		);

		const shown = await markMessageShown(msg.id, 'test-tenant');
		expect(shown?.shownAt).toMatch(/^\d{4}-\d{2}-\d{2}/);

		const unshown = await findUnshownMessage(1, 'test-tenant');
		expect(unshown).toBeUndefined();
	});

	it('メッセージ履歴を降順で取得できる', async () => {
		await insertMessage(
			{ childId: 1, messageType: 'stamp', stampCode: 'sugoi', icon: '🌟' },
			'test-tenant',
		);
		await insertMessage({ childId: 1, messageType: 'text', body: '2番目' }, 'test-tenant');

		const messages = await findMessages(1, 10, 'test-tenant');
		expect(messages.length).toBe(2);
		// 最新が先（降順）
		expect(messages[0]?.body).toBe('2番目');
	});
});

// ============================================================
// サービス層テスト（message-repo をモック）
// ============================================================

describe('sendMessage（サービス層）', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('存在しない stampCode の場合 icon が設定されない', async () => {
		const returnedMsg = {
			id: 1,
			childId: 1,
			messageType: 'stamp',
			stampCode: 'nonexistent_code',
			body: null,
			icon: '',
			sentAt: '2026-04-01T00:00:00Z',
			shownAt: null,
		};
		mockInsertMessage.mockResolvedValue(returnedMsg);

		const input: InsertParentMessageInput = {
			childId: 1,
			messageType: 'stamp',
			stampCode: 'nonexistent_code',
		};
		await sendMessage(input, 'test-tenant');

		// preset が見つからないため icon は設定されない
		expect(input.icon).toBeUndefined();
		expect(mockInsertMessage).toHaveBeenCalledWith(input, 'test-tenant');
	});

	it('有効な stampCode の場合 icon がプリセットから設定される', async () => {
		const returnedMsg = {
			id: 2,
			childId: 1,
			messageType: 'stamp',
			stampCode: 'arigatou',
			body: null,
			icon: '💖',
			sentAt: '2026-04-01T00:00:00Z',
			shownAt: null,
		};
		mockInsertMessage.mockResolvedValue(returnedMsg);

		const input: InsertParentMessageInput = {
			childId: 1,
			messageType: 'stamp',
			stampCode: 'arigatou',
		};
		await sendMessage(input, 'test-tenant');

		expect(input.icon).toBe('💖');
		expect(mockInsertMessage).toHaveBeenCalledWith(
			expect.objectContaining({ icon: '💖', stampCode: 'arigatou' }),
			'test-tenant',
		);
	});

	it('messageType が text の場合はスタンプ処理をスキップする', async () => {
		const returnedMsg = {
			id: 3,
			childId: 1,
			messageType: 'text',
			stampCode: null,
			body: 'テストメッセージ',
			icon: '',
			sentAt: '2026-04-01T00:00:00Z',
			shownAt: null,
		};
		mockInsertMessage.mockResolvedValue(returnedMsg);

		const input: InsertParentMessageInput = {
			childId: 1,
			messageType: 'text',
			body: 'テストメッセージ',
		};
		await sendMessage(input, 'test-tenant');

		expect(input.icon).toBeUndefined();
		expect(mockInsertMessage).toHaveBeenCalledTimes(1);
	});
});

describe('getUnshownMessage（サービス層）', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('未表示メッセージがない場合 undefined を返す', async () => {
		mockFindUnshownMessage.mockResolvedValue(undefined);

		const result = await getUnshownMessage(1, 'test-tenant');

		expect(result).toBeUndefined();
		expect(mockFindUnshownMessage).toHaveBeenCalledWith(1, 'test-tenant');
	});

	it('stampCode がないメッセージの場合 stampLabel は空文字になる', async () => {
		mockFindUnshownMessage.mockResolvedValue({
			id: 10,
			childId: 1,
			messageType: 'text',
			stampCode: null,
			body: 'がんばれ！',
			icon: '',
			sentAt: '2026-04-01T00:00:00Z',
			shownAt: null,
		});

		const result = await getUnshownMessage(1, 'test-tenant');

		expect(result).toBeDefined();
		expect(result?.stampLabel).toBe('');
		expect(result?.body).toBe('がんばれ！');
	});

	it('有効な stampCode がある場合 stampLabel にラベルが設定される', async () => {
		mockFindUnshownMessage.mockResolvedValue({
			id: 11,
			childId: 1,
			messageType: 'stamp',
			stampCode: 'sugoi',
			body: null,
			icon: '🌟',
			sentAt: '2026-04-01T00:00:00Z',
			shownAt: null,
		});

		const result = await getUnshownMessage(1, 'test-tenant');

		expect(result).toBeDefined();
		expect(result?.stampLabel).toBe('すごいね！');
		expect(result?.stampCode).toBe('sugoi');
	});

	it('存在しない stampCode の場合 stampLabel は空文字になる', async () => {
		mockFindUnshownMessage.mockResolvedValue({
			id: 12,
			childId: 1,
			messageType: 'stamp',
			stampCode: 'unknown_stamp',
			body: null,
			icon: '?',
			sentAt: '2026-04-01T00:00:00Z',
			shownAt: null,
		});

		const result = await getUnshownMessage(1, 'test-tenant');

		expect(result).toBeDefined();
		expect(result?.stampLabel).toBe('');
	});
});

describe('getMessageHistory（サービス層）', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('デフォルトの limit=20 で履歴を取得する', async () => {
		mockFindMessages.mockResolvedValue([]);

		await getMessageHistory(1, 'test-tenant');

		expect(mockFindMessages).toHaveBeenCalledWith(1, 20, 'test-tenant');
	});

	it('カスタム limit を指定できる', async () => {
		mockFindMessages.mockResolvedValue([]);

		await getMessageHistory(1, 'test-tenant', 5);

		expect(mockFindMessages).toHaveBeenCalledWith(1, 5, 'test-tenant');
	});

	it('limit=50 で大きめの履歴を取得できる', async () => {
		const manyMessages = Array.from({ length: 50 }, (_, i) => ({
			id: i + 1,
			childId: 1,
			messageType: 'text',
			stampCode: null,
			body: `メッセージ ${i + 1}`,
			icon: '',
			sentAt: `2026-04-01T00:${String(i).padStart(2, '0')}:00Z`,
			shownAt: null,
		}));
		mockFindMessages.mockResolvedValue(manyMessages);

		const result = await getMessageHistory(1, 'test-tenant', 50);

		expect(mockFindMessages).toHaveBeenCalledWith(1, 50, 'test-tenant');
		expect(result).toHaveLength(50);
	});

	it('limit=1 で最新メッセージのみ取得できる', async () => {
		mockFindMessages.mockResolvedValue([
			{
				id: 100,
				childId: 1,
				messageType: 'stamp',
				stampCode: 'daisuki',
				body: null,
				icon: '🤗',
				sentAt: '2026-04-01T12:00:00Z',
				shownAt: null,
			},
		]);

		const result = await getMessageHistory(1, 'test-tenant', 1);

		expect(mockFindMessages).toHaveBeenCalledWith(1, 1, 'test-tenant');
		expect(result).toHaveLength(1);
	});
});

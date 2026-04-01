// tests/unit/services/message-service.test.ts
// おうえんメッセージサービスのユニットテスト

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../../../src/lib/server/db/schema';
import {
	type TestDb,
	type TestSqlite,
	closeDb,
	createTestDb,
	resetDb as resetAllTables,
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

import {
	countUnshownMessages,
	findMessages,
	findUnshownMessage,
	insertMessage,
	markMessageShown,
} from '../../../src/lib/server/db/sqlite/message-repo';
import { STAMP_PRESETS, getStampPreset } from '../../../src/lib/server/services/message-service';

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
			expect(stamp.code).toBeTruthy();
			expect(stamp.label).toBeTruthy();
			expect(stamp.icon).toBeTruthy();
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
		expect(shown?.shownAt).toBeTruthy();

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

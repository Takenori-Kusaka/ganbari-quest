// tests/unit/services/message-service.test.ts
// おうえんメッセージサービスのユニットテスト

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../../../src/lib/server/db/schema';

let sqlite: InstanceType<typeof Database>;
let testDb: ReturnType<typeof drizzle>;

const SQL_TABLES = `
	CREATE TABLE children (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		nickname TEXT NOT NULL, age INTEGER NOT NULL,
		theme TEXT NOT NULL DEFAULT 'pink',
		ui_mode TEXT NOT NULL DEFAULT 'kinder',
		avatar_url TEXT, active_title_id INTEGER,
		active_avatar_bg INTEGER, active_avatar_frame INTEGER,
		active_avatar_effect INTEGER, active_avatar_sound INTEGER,
		active_avatar_celebration INTEGER, display_config TEXT,
		user_id TEXT, birth_date TEXT,
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
		updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
	CREATE TABLE parent_messages (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		child_id INTEGER NOT NULL REFERENCES children(id),
		message_type TEXT NOT NULL,
		stamp_code TEXT,
		body TEXT,
		icon TEXT NOT NULL DEFAULT '💌',
		sent_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
		shown_at TEXT
	);
	CREATE INDEX idx_parent_messages_child ON parent_messages(child_id, sent_at);
	CREATE INDEX idx_parent_messages_unshown ON parent_messages(child_id, shown_at);
`;

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
	getStampPreset,
	STAMP_PRESETS,
} from '../../../src/lib/server/services/message-service';
import {
	countUnshownMessages,
	findMessages,
	findUnshownMessage,
	insertMessage,
	markMessageShown,
} from '../../../src/lib/server/db/sqlite/message-repo';

beforeAll(() => {
	sqlite = new Database(':memory:');
	sqlite.pragma('foreign_keys = ON');
	sqlite.exec(SQL_TABLES);
	testDb = drizzle(sqlite, { schema });
});

afterAll(() => {
	sqlite.close();
});

function resetDb() {
	sqlite.exec('DELETE FROM parent_messages');
	sqlite.exec('DELETE FROM children');
	sqlite.exec(
		"DELETE FROM sqlite_sequence WHERE name IN ('children','parent_messages')",
	);
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
		await insertMessage(
			{ childId: 1, messageType: 'text', body: 'テスト' },
			'test-tenant',
		);

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
		await insertMessage(
			{ childId: 1, messageType: 'text', body: '2番目' },
			'test-tenant',
		);

		const messages = await findMessages(1, 10, 'test-tenant');
		expect(messages.length).toBe(2);
		// 最新が先（降順）
		expect(messages[0]?.body).toBe('2番目');
	});
});

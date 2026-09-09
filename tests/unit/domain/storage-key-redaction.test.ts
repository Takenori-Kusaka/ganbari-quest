// tests/unit/domain/storage-key-redaction.test.ts
//
// クラウド共有 export の PIN を伏せる純関数の契約 (#4867)。
//
// PIN は**他家庭のフル PII バックアップ**を引き当てる唯一の材料で、
// `fetchCloudExportByPin` は tenant 述語なしで引く。key / メッセージを外へ出す経路は
// service・repo・route の 3 層に散っているので、判定は 1 つに寄せてここで固定する。
//
// 固定する不変条件:
//   [K1] 正規の形から PIN を落とし、**テナントと file 名は残す** (運用が追える)
//   [K2] 想定外の形でも素通りさせない (fail-closed)
//   [K3] 無関係な key を壊さない (誤爆で運用情報を消さない)
//   [K4] Windows / local FS の `\` 区切りでも効く
//   [K5] path 形になっていない**裸の PIN** も伏せる
//   [K6] 伏せた結果が全テナントで同じ定数にならない (join 情報を失わない)

import { describe, expect, it } from 'vitest';
import {
	redactStorageKey,
	redactStorageKeysInText,
} from '../../../src/lib/domain/storage-key-redaction';

const PIN = 'K7M2QX';

describe('[K1][K6] 正規の形', () => {
	it('PIN だけを伏せ、テナントと file 名は残す', () => {
		expect(redactStorageKey(`exports/t-alice/${PIN}/backup.zip`)).toBe(
			'exports/t-alice/<pin>/backup.zip',
		);
	});

	it('[K6] テナントが違えば結果も違う (join 情報がゼロにならない)', () => {
		const a = redactStorageKey(`exports/t-alice/${PIN}/backup.zip`);
		const b = redactStorageKey(`exports/t-bob/${PIN}/backup.zip`);
		expect(a === b, '全テナントで同じ定数になると「どの家庭のどの成果物か」を運用が追えない').toBe(
			false,
		);
	});
});

describe('[K2] 想定外の形でも素通りさせない', () => {
	for (const key of [
		`exports/${PIN}`,
		`exports//${PIN}/backup.zip`,
		`tenants/t-owner/exports/${PIN}/backup.zip`,
		`exports/t-owner/${PIN}`,
		`exports/t-owner/${PIN}/nested/dir/backup.zip`,
		`${PIN}/backup.zip`,
	]) {
		it(key, () => {
			expect(redactStorageKey(key), `PIN が素通りしている: ${key}`).not.toContain(PIN);
		});
	}
});

describe('[K3] 無関係な key を壊さない', () => {
	it('tenants/<id> の id は伏せない', () => {
		// PIN と同じ文字種・長さの tenant id を誤爆すると、運用がどの家庭か分からなくなる
		expect(redactStorageKey('tenants/ABC234/children/c-1/avatar.svg')).toBe(
			'tenants/ABC234/children/c-1/avatar.svg',
		);
	});

	it('通常の avatar key はそのまま', () => {
		expect(redactStorageKey('tenants/t-owner/children/c-1/avatar.svg')).toBe(
			'tenants/t-owner/children/c-1/avatar.svg',
		);
	});

	it('空文字を壊さない', () => {
		expect(redactStorageKey('')).toBe('');
	});
});

describe('[K4] `` 区切り (Windows / NUC の local FS)', () => {
	it('backslash path でも PIN を伏せる', () => {
		const key = String.raw`C:\data\exports\t-alice\K7M2QX\backup.zip`;
		const out = redactStorageKey(key);
		expect(out, `backslash path で PIN が素通りしている: ${out}`).not.toContain(PIN);
		expect(out, '区切り文字を壊している').toContain(String.raw`\backup.zip`);
	});
});

describe('[K5] 任意の文字列', () => {
	it('S3 部分失敗サマリの key を伏せ、エラーコードは残す', () => {
		const out = redactStorageKeysInText(
			`S3 purge partially failed: 1/1 objects remain (exports/t-a/${PIN}/backup.zip:AccessDenied)`,
		);
		expect(out).not.toContain(PIN);
		expect(out, '原因が読めなくなる').toContain('AccessDenied');
		expect(out, 'テナントまで消してはいけない').toContain('t-a');
	});

	it('path になっていない裸の PIN も伏せる', () => {
		expect(redactStorageKeysInText(`pin ${PIN} not found`)).not.toContain(PIN);
	});

	it('local FS の絶対パス (backslash) も伏せる', () => {
		const msg = String.raw`ENOENT: no such file or directory, open 'C:\data\exports\t-a\K7M2QX\backup.zip'`;
		expect(redactStorageKeysInText(msg)).not.toContain(PIN);
	});

	it('空文字を壊さない', () => {
		expect(redactStorageKeysInText('')).toBe('');
	});
});

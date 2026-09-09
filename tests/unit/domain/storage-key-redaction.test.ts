// tests/unit/domain/storage-key-redaction.test.ts
// cspell:ignore pping
// ^ `-ping` / `-pping` は誤爆の負例として意図した語尾 (綴りを直すと負例が成立しない)。
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
	]) {
		it(key, () => {
			expect(redactStorageKey(key), `PIN が素通りしている: ${key}`).not.toContain(PIN);
		});
	}
});

describe('[K3] 無関係な key を壊さない', () => {
	it('exports を含まない key は PIN 形のセグメントがあっても伏せない', () => {
		// PIN と同じ文字種・長さの語は無関係な key にも現れる (adversarial 実測)。
		// 実在する PIN key は必ず `exports/…` なので、そこへ絞って誤爆を消す。
		expect(redactStorageKey('assets/BRAND2/logo.svg')).toBe('assets/BRAND2/logo.svg');
		expect(redactStorageKey(`${PIN}/backup.zip`)).toBe(`${PIN}/backup.zip`);
	});

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

	it('`pin` の近くにある裸の PIN は伏せる', () => {
		// #4867 adversarial: このコードベースが実際に使う識別子は `pinCode` / `pin_code` で、
		// `pin` 直後だけを見る形では `Code` / `_code` で外れて素通りしていた。
		// とくに `Key (pin_code)=(…)` は **PostgreSQL の UNIQUE 制約違反 detail の標準形**で、
		// `pin_code` に global UNIQUE を張っている以上、PIN を載せる最有力の実エラーである。
		for (const msg of [
			`pin ${PIN} not found`,
			`PIN検索失敗: ${PIN}`,
			`pinCode=${PIN}`,
			`pin_code=${PIN}`,
			`{"pinCode":"${PIN}"}`,
			`Key (pin_code)=(${PIN}) already exists.`,
			`no row for pin ${PIN}`,
			`export pin ${PIN} expired`,
		]) {
			expect(redactStorageKeysInText(msg), `素通りしている: ${msg}`).not.toContain(PIN);
		}
	});

	it('`pin` を単語の途中で拾わない (-ping / -pping に終わる語)', () => {
		// #4867 adversarial 実測: 英語で `-ping` / `-pping` に終わる語は例外なく `p-i-n` を
		// 内部に含むので、`pin` を語頭に限定しないと直後の 6 文字 ALL-CAPS が潰れる
		// (14 例中 12 例が誤爆)。影響先は failureReason → DB → **保護者の画面**。
		for (const msg of [
			'skipping DELETE of remaining objects',
			'mapping TENANT to bucket',
			'dropping SELECT cache',
			'shipping BACKUP to cold storage',
			'stopping WORKER after timeout',
			'keeping SECRET out of logs',
			'wrapping ERRORS for the client',
			'escaping SEARCH input',
		]) {
			expect(redactStorageKeysInText(msg), `誤爆している: ${msg}`).toBe(msg);
		}
	});

	it('**PIN と同じ形の英単語を誤爆しない** (伏せた文字列は保護者の画面に出る)', () => {
		// adversarial 実測: 6 文字 ALL-CAPS 40 語のうち 25 語が誤認していた。
		// PIN の文字種は I/O/0/1 を除くが、これらの語はどれもそれを避けているため
		// 文字種では分離できない。`pin` の近さで絞る。
		for (const msg of [
			"EACCES: permission denied, open '/data/x'",
			'ERROR: syntax error at or near "SELECT"',
			'UPDATE failed: DELETE not permitted',
			'SECRET rotation skipped',
			'BACKUP window exceeded',
		]) {
			expect(redactStorageKeysInText(msg), `誤爆している: ${msg}`).toBe(msg);
		}
	});

	it('local FS の絶対パス (backslash) も伏せる', () => {
		const msg = String.raw`ENOENT: no such file or directory, open 'C:\data\exports\t-a\K7M2QX\backup.zip'`;
		expect(redactStorageKeysInText(msg)).not.toContain(PIN);
	});

	it('空文字を壊さない', () => {
		expect(redactStorageKeysInText('')).toBe('');
	});
});

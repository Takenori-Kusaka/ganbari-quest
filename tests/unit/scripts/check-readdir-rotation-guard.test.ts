// tests/unit/scripts/check-readdir-rotation-guard.test.ts
// #3978 — 「readdir の緩い一致 × 破壊的操作」gate の実効性テスト。
//
// gate を書いても「実は何も落とせていない」ことがある (#3072 と同型)。本テストは
//   [RG1] #3978 修正**前**の scripts/backup-db.cjs を検出できる    ← gate の実効性
//   [RG2] 修正**後**の実ファイルは検出されない                      ← 修正が gate 基準を満たす
//   [RG3] 抑制コメントが効く / 理由が空なら効かない
//   [RG4] false positive を出さない条件 (破壊的操作なし / *_PATTERN 経由)
//   [RG5] repo 全体を走査して違反 0 件 (走査件数 > 0 も併せて固定)
//   [RG6] storage-repo.ts の抑制コメントに理由が書かれている (#3978 AC4)
// を固定する。

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	findAllViolations,
	PROXIMITY_WINDOW,
	scanSource,
} from '../../../scripts/check-readdir-rotation-guard.mjs';

const REPO_ROOT = process.cwd();

/**
 * #3978 修正前の scripts/backup-db.cjs のローテーション部 (実物のコピー)。
 * gate がこの形を落とせなければ、gate は本 Issue の目的を果たしていない。
 */
const PRE_FIX_BACKUP_DB = `
	// Rotate old backups
	const files = fs
		.readdirSync(BACKUP_DIR)
		.filter((f) => f.startsWith('ganbari-quest-') && f.endsWith('.db'))
		.sort()
		.reverse();
	if (files.length > MAX_BACKUPS) {
		for (const old of files.slice(MAX_BACKUPS)) {
			fs.unlinkSync(path.join(BACKUP_DIR, old));
			console.log(\`[Rotate] Removed: \${old}\`);
		}
	}
`;

describe('check-readdir-rotation-guard (#3978)', () => {
	it('[RG1] 修正前の backup-db.cjs ローテーションを検出する (gate の実効性)', () => {
		const violations = scanSource('scripts/backup-db.cjs', PRE_FIX_BACKUP_DB);
		expect(violations).toHaveLength(1);
		expect(violations[0]?.text).toContain('readdirSync');
		expect(violations[0]?.file).toBe('scripts/backup-db.cjs');
	});

	it('[RG2] 修正後の実 scripts/backup-db.cjs は検出されない', () => {
		const rel = 'scripts/backup-db.cjs';
		const source = readFileSync(join(REPO_ROOT, rel), 'utf8');
		// 修正が「gate を黙らせただけ」でないこと: 命名済みパターンの完全一致を実際に使っている。
		expect(source).toContain('SQLITE_BACKUP_FILENAME_PATTERN');
		expect(source).toMatch(/SQLITE_BACKUP_FILENAME_PATTERN\s*=\s*\/\^ganbari-quest-/);
		expect(scanSource(rel, source)).toStrictEqual([]);
	});

	it('[RG3] 抑制コメントは理由付きのときだけ効く', () => {
		const withReason = `
	// rotation-gate-ok: プレフィックス検索という API 仕様そのもので、世代を数える class ではない
	const files = readdirSync(dir).filter((f) => f.startsWith(base));
	for (const f of files) unlinkSync(join(dir, f));
`;
		expect(scanSource('src/x.ts', withReason)).toStrictEqual([]);

		// 理由が空のマーカーは opt-out として認めない (無言の抑止を防ぐ)。
		const withoutReason = withReason.replace(
			'rotation-gate-ok: プレフィックス検索という API 仕様そのもので、世代を数える class ではない',
			'rotation-gate-ok:',
		);
		expect(scanSource('src/x.ts', withoutReason)).toHaveLength(1);

		// 同一行に書いた場合も効く。
		const inline = `
	const files = readdirSync(dir).filter((f) => f.startsWith(base)); // rotation-gate-ok: 別 class
	for (const f of files) unlinkSync(join(dir, f));
`;
		expect(scanSource('src/x.ts', inline)).toStrictEqual([]);
	});

	it('[RG4] 破壊的操作がなければ検出しない (列挙だけの走査 script を巻き込まない)', () => {
		const enumerateOnly = `
	const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
	for (const f of files) console.log(f);
`;
		expect(scanSource('scripts/audit/x.mjs', enumerateOnly)).toStrictEqual([]);
	});

	it('[RG4b] *_PATTERN の完全一致を経由していれば検出しない (目標形)', () => {
		const namedPattern = `
	const BACKUP_FILENAME_PATTERN = /^snap-\\d{14}\\.tgz$/;
	const files = readdirSync(dir).filter((f) => BACKUP_FILENAME_PATTERN.test(f)).sort().reverse();
	for (const old of files.slice(3)) unlinkSync(join(dir, old));
`;
		expect(scanSource('src/x.ts', namedPattern)).toStrictEqual([]);

		// 緩い一致と *_PATTERN が同居する形 (段階的な移行途中) も、パターン経由と見なして通す。
		// gate の水準を意図的に下げている箇所であり、ここは書き手の宣言に委ねる。
		const mixed = `
	const NAME_PATTERN = /^snap-\\d+$/;
	const files = readdirSync(dir).filter((f) => NAME_PATTERN.test(f) && f.endsWith('.tgz'));
	for (const old of files) unlinkSync(join(dir, old));
`;
		expect(scanSource('src/x.ts', mixed)).toStrictEqual([]);
	});

	it('[RG4c] 破壊的操作が近接窓の外なら検出しない (窓幅が効いている)', () => {
		const far = [
			"const files = readdirSync(dir).filter((f) => f.startsWith('x'));",
			...Array.from({ length: PROXIMITY_WINDOW + 2 }, (_, i) => `const pad${i} = ${i};`),
			'unlinkSync(join(dir, files[0]));',
		].join('\n');
		expect(scanSource('src/x.ts', far)).toStrictEqual([]);

		// 窓の内側なら検出する (境界の両側を固定する)。
		const near = [
			"const files = readdirSync(dir).filter((f) => f.startsWith('x'));",
			...Array.from({ length: PROXIMITY_WINDOW - 2 }, (_, i) => `const pad${i} = ${i};`),
			'unlinkSync(join(dir, files[0]));',
		].join('\n');
		expect(scanSource('src/x.ts', near)).toHaveLength(1);
	});

	// 本 test は src/ + scripts/ の 900+ ファイルを実際に読む I/O bound な fitness で、
	// 既定 testTimeout (5s、vite.config.ts) では並列実行の負荷次第で timeout する
	// (#3972 / #4005 と同 class)。assertion を弱めるのではなく、本 test の性質に見合う
	// 明示 timeout を与える (cli-entry-guard.test.ts の spawn 系 test と同じ扱い)。
	it('[RG5] repo 全体に違反 0 件、かつ 1 件以上のファイルを実際に走査している', () => {
		const { violations, fileCount } = findAllViolations(REPO_ROOT);
		expect(
			violations,
			`違反:\n${violations.map((v) => `  ${v.file}:${v.line} ${v.text}`).join('\n')}`,
		).toStrictEqual([]);
		// 「0 件走査だから 0 件違反」= 無言の PASS を弾く (本 gate が塞ぐ class と同型)。
		expect(fileCount).toBeGreaterThan(100);
	}, 60_000);

	it('[RG6] storage-repo.ts の抑制コメントに別 class である理由が書かれている (#3978 AC4)', () => {
		const source = readFileSync(
			join(REPO_ROOT, 'src/lib/server/db/sqlite/storage-repo.ts'),
			'utf8',
		);
		const marker = source
			.split(/\r?\n/)
			.find((l) => l.includes('rotation-gate-ok:'))
			?.trim();
		expect(marker, 'storage-repo.ts に抑制コメントがない').toBeDefined();
		// 理由が「別 class である」ことを述べていること (無言の抑止・空マーカーを防ぐ)。
		expect(marker).toContain('プレフィックス検索');
		expect(source).toContain('プレフィックス境界の欠落');
	});
});

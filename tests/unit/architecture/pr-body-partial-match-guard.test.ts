// tests/unit/architecture/pr-body-partial-match-guard.test.ts
// #4348 AC6 (ADR-0061 same-class-N→guard): PR body の構造化識別子 (`## ` 見出し) や宣言を
// **部分一致 / 本文全体への 1 本の正規表現**で判定するコードを機械で止める fitness function。
//
// 背景 (同 class 4 回):
//   #4084  SS ペア 0 件を skip で通した            (検査できなかったのに pass)
//   #4255  story 参照を「それっぽい文字列」で通した (実在性を見ない)
//   #4333  見出しの存在だけで NG-0 を常に緑にした   (見出し行・コメント・否定文を拾う)
//   #4348  上記と同 class が gate 6 箇所に残存      (本 guard の起票元)
//
// instance ごとの対処では止まらないので、**判定の形そのもの**を lock する:
//   - PR body に対する `.indexOf(` / `.includes(` / `<regex>.test(body)` は
//     ALLOWLIST に理由付きで登録されたものだけを許す
//   - 新規に増やせば fail (是正済みの箇所を緩い判定に戻すことも fail)
//   - ALLOWLIST に書いたのに現物が消えたら fail (stale = 実態と乖離した許可)
//
// 構造化識別子の正しい判定は `scripts/lib/ci/pr-body-sections.mjs` (見出し行の完全一致 +
// HTML コメント / code block 除去) に集約してある。新規 gate はそれを import する。

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

// repo 走査 test。区分宣言は scripts/lib/ci/repo-scan-test-registry.mjs が SSOT (#4085)。
vi.setConfig({ testTimeout: 60_000 });

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const SCAN_DIR = resolve(REPO_ROOT, 'scripts');

/** PR body を指す変数名 (これらに対する部分一致判定を検出対象にする)。 */
const BODY_IDENT = String.raw`(?:[A-Za-z_$][\w$]*)?[Bb]ody`;

/** `<body>.indexOf(` / `<body>.includes(` — 部分一致で section / 宣言を探す形。 */
const SUBSTRING_RE = new RegExp(String.raw`\b(${BODY_IDENT})\s*\.\s*(indexOf|includes)\s*\(`, 'g');
/** `<regex or array>.test(<body>)` — 本文全体に 1 本の正規表現を当てる形。 */
const WHOLE_BODY_TEST_RE = new RegExp(String.raw`\.test\(\s*(${BODY_IDENT})\s*\)`, 'g');

/**
 * 許可済み occurrence。key = `<repo 相対パス>::<空白正規化した該当行>`。
 * 行番号は差分で動くので使わない。値は **なぜ許すか**（理由なしの許可は作らない、#3956）。
 *
 * 該当行を編集すると key が変わり unknown + stale の両方で落ちる。これは意図した挙動で、
 * 「この判定を触ったならもう一度理由を書け」という強制になる。
 */
const ALLOWLIST: Record<string, string> = {
	// --- #4348 で是正しなかった残置 (Issue #4348 に残件として記録、1 箇所ずつ corpus 比較して消化) ---
	"scripts/check-ac-verification-map.mjs::const mapHeaderIdx = body.indexOf('AC 検証マップ');":
		'#4348 残置 (対象 #6): feature lane の AC マップ section 探索。全 feature PR に波及するため別 PR で corpus 比較のうえ是正する',
	'scripts/check-admin-bypass-evidence.mjs::return EVIDENCE_MARKER_PATTERNS.some((re) => re.test(body));':
		'#4348 残置 (対象 #3): admin bypass 証跡マーカーの存在検査。nightly 監査 script で PR gate とは別経路のため別 PR で是正する',
	'scripts/check-pr-screenshot.mjs::return DOM_REF_PATTERN.test(body);':
		'#4348 残置 (対象 #4): DOM スナップショット参照の存在検査。#4255 の兄弟関数と同様に実在検査へ寄せる別 PR で是正する',
	'scripts/check-pr-screenshot.mjs::return INTEGRATION_VR_EVIDENCE_PATTERNS.some((p) => p.test(body));':
		'#4348 残置 (対象 #4): 統合 PR の VR 証跡の存在検査。同上',

	// --- 構造化識別子ではなく prose (自然文) を探す用途。本文全体を見るのが正しい ---
	'scripts/check-pr-screenshot.mjs::hasBefore: BEFORE_LABEL_PATTERN.test(body),':
		'prose 検査: 「修正前」ラベルの表記ゆれを本文から探す用途で、見出し等の構造化識別子ではない',
	'scripts/check-pr-screenshot.mjs::hasAfter: AFTER_LABEL_PATTERN.test(body),':
		'prose 検査: 「修正後」ラベルの表記ゆれを本文から探す用途で、構造化識別子ではない',
	'scripts/check-pr-screenshot.mjs::return FUTURE_TENSE_PATTERNS.some((p) => p.test(body));':
		'prose 検査: 「SS は後で push する」等の未来形記述を本文から探す用途 (#2918)',
	'scripts/check-new-required-env.mjs::return re.test(prBody);':
		'prose 検査: env 配布証跡の記述を本文から探す用途 (#4129)。構造化識別子ではない',
	'scripts/pr-template-gate-checks.mjs::if (/^closes\\s+#\\s*$/im.test(body) || /closes\\s+#\\s*<!--/im.test(body)) {':
		'prose 検査: `closes #` の空欄記入を行頭アンカー付きで探す。見出し探索ではない',

	// --- section 探索だが #4348 の対象 6 箇所には含まれない残置 (同 class、後続で移行) ---
	'scripts/check-pr-body.mjs::const startIdx = body.indexOf(startMatch[0]);':
		'#4348 scope 外: check-pr-body の section 切り出し。同 class のため後続 PR で pr-body-sections.mjs へ寄せる',
	'scripts/check-pr-body.mjs::const startIdx = body.indexOf(section);':
		'#4348 scope 外: check-pr-body の section 切り出し。同上',
	'scripts/pr-template-gate-checks.mjs::const start = body.indexOf(heading);':
		'#4348 scope 外: sliceSection / detectChangeTypeHeading の見出し探索。同 class のため後続 PR で移行する',
	"scripts/pr-template-gate-checks.mjs::const end = body.indexOf('\\n## ', start + 1);":
		'#4348 scope 外: 上記 sliceSection の終端探索 (見出しの存在判定ではない)。同上',
	'scripts/pr-template-gate-checks.mjs::const idx = body.indexOf(`**${field}**:`);':
		'顧客価値 section の field 探索。`## ` 見出しではなく本文中の太字ラベルを探すため部分一致が妥当',
};

function walkMjs(dir: string, acc: string[]): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = resolve(dir, entry.name);
		if (entry.isDirectory()) {
			if (entry.name === 'node_modules') continue;
			walkMjs(full, acc);
		} else if (entry.name.endsWith('.mjs')) {
			acc.push(full);
		}
	}
	return acc;
}

/** コメント行 (行コメント / block コメント本体) を除外する。 */
function isCommentLine(line: string): boolean {
	const t = line.trim();
	return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
}

type Occurrence = { key: string; file: string; line: number; text: string };

function collectOccurrences(): Occurrence[] {
	const out: Occurrence[] = [];
	for (const file of walkMjs(SCAN_DIR, [])) {
		const rel = relative(REPO_ROOT, file).replace(/\\/g, '/');
		const lines = readFileSync(file, 'utf8').split('\n');
		lines.forEach((line, i) => {
			if (isCommentLine(line)) return;
			for (const re of [SUBSTRING_RE, WHOLE_BODY_TEST_RE]) {
				re.lastIndex = 0;
				let m = re.exec(line);
				while (m !== null) {
					const snippet = line.trim().replace(/\s+/g, ' ');
					out.push({ key: `${rel}::${snippet}`, file: rel, line: i + 1, text: snippet });
					m = re.exec(line);
				}
			}
		});
	}
	return out;
}

// ---------------------------------------------------------------------------
// #4348 対象 #7: 「入力ゼロのまま skip / pass に倒れる」形を止める guard
//
// 判定ロジック (上の guard) を厳しくしても、**入力が届いていない**まま実行されれば
// gate は何も検査せず成功終了する。実測 (2026-08-12): SS 系 3 本が argv を読まず、
// `--pr <N>` を付けた誤用が空入力の検査になって exit 0 していた (#4513 の 404 SS を見逃した)。
// 入力解決は scripts/lib/ci/pr-input.mjs (SSOT) に集約し、env 直読みを増やさせない。
// ---------------------------------------------------------------------------

/** PR 入力を env から直読みしている形 (コメント行は除外して検出する)。 */
const ENV_INPUT_RE = /process\.env\.(?:PR_BODY|PR_NUMBER)\b/;

/** 入力解決 SSOT の import (これがあれば env 直読みでも解決経路を通っている)。 */
const PR_INPUT_IMPORT_RE = /from\s+'\.(?:\/lib)?\/(?:lib\/)?ci\/pr-input\.mjs'/;

/**
 * env 直読みのまま残す script。値は **なぜ本 PR で是正しないか**。
 *
 * #4348 の「やらないこと」に従い、箇所ごとに実測してから移行する。本 PR の scope は
 * SS 系 gate 3 本 (check-ss-blob-sha-uniqueness / check-pr-screenshot / check-ss-render-health)。
 */
const ENV_INPUT_ALLOWLIST: Record<string, string> = {
	'scripts/check-ac-verification-map.mjs':
		'#4348 scope 外: 本 PR は SS 系 gate 3 本の入力層のみ是正した。全 feature PR に波及するため箇所ごとに corpus 実測してから pr-input.mjs へ移行する',
	'scripts/check-cdk-replacement.mjs':
		'#4348 scope 外: deploy 経路の gate で PR body は補助入力。移行時に deploy lane の実測が要るため別 PR で扱う',
	'scripts/check-merge-gate-checklist.mjs':
		'#4348 scope 外: 統合 lane の gate。#4357 で判定側を是正済のため入力層は別 PR で続けて移行する',
	'scripts/check-new-required-env.mjs':
		'#4348 scope 外: env 配布証跡 gate。本 PR の SS 系 3 本と実行経路が異なるため別 PR で移行する',
	'scripts/check-pr-file-overlap.mjs':
		'#4348 scope 外: PR_NUMBER を使う並行 PR 検査。CI 専用経路で手元実行の誤用報告が無いため別 PR で移行する',
	'scripts/check-schema-change-tests.mjs':
		'#4348 scope 外: schema 変更 lane の gate。別 PR で移行する',
	'scripts/check-schema-migration-completeness.mjs':
		'#4348 scope 外: schema 変更 lane の gate。同上',
};

describe('#4348 fitness: PR 入力を env から直読みする gate を増やさない', () => {
	const offenders = walkMjs(SCAN_DIR, [])
		.map((file) => ({ file, rel: relative(REPO_ROOT, file).replace(/\\/g, '/') }))
		.filter(({ file }) => {
			const src = readFileSync(file, 'utf8');
			const hit = src.split('\n').some((line) => !isCommentLine(line) && ENV_INPUT_RE.test(line));
			return hit && !PR_INPUT_IMPORT_RE.test(src);
		})
		.map(({ rel }) => rel);

	it('検出器が機能している (0 件なら regex が壊れている)', () => {
		expect(offenders.length).toBeGreaterThan(0);
	});

	it('ALLOWLIST 外の env 直読みが存在しない', () => {
		const unknown = offenders.filter((f) => !(f in ENV_INPUT_ALLOWLIST));
		expect(
			unknown,
			[
				'PR 入力を env から直読みする gate を検出しました (#4348 対象 #7)。',
				'',
				'argv を読まない gate は `--pr <N>` を黙殺し、空入力を検査して成功終了します。',
				'scripts/lib/ci/pr-input.mjs の resolvePrInput() を使ってください',
				'(入力ゼロ / 取得失敗は PrInputError で非 0 終了し、skip / pass に倒れません)。',
				'',
				...unknown,
			].join('\n'),
		).toEqual([]);
	});

	it('ALLOWLIST に stale なエントリがない', () => {
		const stale = Object.keys(ENV_INPUT_ALLOWLIST).filter((f) => !offenders.includes(f));
		expect(
			stale,
			`是正済みなのに許可が残っています。該当行を削除してください:\n${stale.join('\n')}`,
		).toEqual([]);
	});

	it('SS 系 gate 3 本は入力解決 SSOT を経由している', () => {
		for (const rel of [
			'scripts/check-ss-blob-sha-uniqueness.mjs',
			'scripts/check-pr-screenshot.mjs',
			'scripts/check-ss-render-health.mjs',
		]) {
			const src = readFileSync(resolve(REPO_ROOT, rel), 'utf8');
			expect(PR_INPUT_IMPORT_RE.test(src), `${rel} が pr-input.mjs を import していません`).toBe(
				true,
			);
			expect(ENV_INPUT_RE.test(src), `${rel} に env 直読みが残っています`).toBe(false);
		}
	});
});

describe('#4348 fitness: PR body を部分一致で判定する新規コードを増やさない', () => {
	const occurrences = collectOccurrences();

	it('検出器が機能している (occurrence が 0 件なら regex が壊れている)', () => {
		expect(occurrences.length).toBeGreaterThan(0);
	});

	it('ALLOWLIST 外の部分一致判定が存在しない', () => {
		const unknown = occurrences.filter((o) => !(o.key in ALLOWLIST));
		const detail = unknown.map((o) => `  ${o.file}:${o.line}  ${o.text}\n    key: ${o.key}`);
		expect(
			unknown,
			[
				'PR body の見出し / 宣言を部分一致で判定する新規コードを検出しました (#4348 / ADR-0061)。',
				'',
				'構造化識別子 (`## ` 見出し) を探すなら scripts/lib/ci/pr-body-sections.mjs の',
				'hasH2Section / extractSection / extractH2Section を使ってください',
				'(見出し行の完全一致 + HTML コメント / code block 除去 + 不在は fail)。',
				'',
				'prose (自然文) を探す正当な用途なら、本 test の ALLOWLIST に **理由付きで** 追加してください。',
				'',
				...detail,
			].join('\n'),
		).toEqual([]);
	});

	it('ALLOWLIST に stale なエントリがない (消えた occurrence の許可を残さない)', () => {
		const present = new Set(occurrences.map((o) => o.key));
		const stale = Object.keys(ALLOWLIST).filter((k) => !present.has(k));
		expect(
			stale,
			`ALLOWLIST に現物のないエントリが残っています。是正が済んだなら該当行を削除してください:\n${stale.join('\n')}`,
		).toEqual([]);
	});

	it('ALLOWLIST の全エントリが実体のある理由を持つ (理由の非強制を作らない)', () => {
		const weak = Object.entries(ALLOWLIST).filter(([, reason]) => reason.trim().length < 12);
		expect(weak.map(([k]) => k)).toEqual([]);
	});
});

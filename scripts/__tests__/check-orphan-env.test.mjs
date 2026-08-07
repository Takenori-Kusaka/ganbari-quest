/**
 * scripts/__tests__/check-orphan-env.test.mjs (#4408)
 *
 * check-orphan-env.mjs の走査母数 (SEARCH_EXTENSIONS) の unit test。
 *
 * 背景: shell script (`.sh`) が走査対象から漏れていたため、
 * `scripts/deploy.sh` / `scripts/setup-server.sh` からしか参照されない env が
 * dead env と誤判定されていた (false positive)。baseline 登録で黙らせると
 * 「shell からしか使われない env は全部 baseline 行き」になり本物の dead env と
 * 区別できなくなるため、走査母数側を直す。
 *
 * 注意: 本ファイルは `scripts/**\/*.mjs` として check-orphan-env 自身の走査対象に入る。
 * 実在する env 名を literal で書くと**本ファイルが参照 1 件として数えられ**、
 * 走査母数を直さなくても検査が通ってしまう (偽 green)。
 * そのため実 env 名は書かず、fixture 名と構造的性質のみで検証する。
 *
 * 実行: node --test scripts/__tests__/check-orphan-env.test.mjs
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const { collectSearchFiles, countEnvReferences, extractEnvVars, SEARCH_EXTENSIONS } = await import(
	'../check-orphan-env.mjs'
);

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), '..', '..');
const TMP_ROOT = path.join(REPO_ROOT, 'scripts', '__tests__', '__tmp__', 'orphan-env');

function writeFixture(relPath, content) {
	const full = path.join(TMP_ROOT, relPath);
	fs.mkdirSync(path.dirname(full), { recursive: true });
	fs.writeFileSync(full, content, 'utf8');
	return full;
}

after(() => {
	fs.rmSync(TMP_ROOT, { recursive: true, force: true });
});

describe('check-orphan-env: 走査母数', () => {
	it('shell script からしか参照されない env を orphan と誤判定しない', () => {
		writeFixture(
			'scripts/deploy.sh',
			['#!/usr/bin/env bash', 'REMOTE_HOST="${FIXTURE_SSH_HOST:?required}"', ''].join('\n'),
		);
		// .ts 側からは一切参照しない (shell 単独参照の再現)
		writeFixture('src/unrelated.ts', 'export const x = 1;\n');

		const files = collectSearchFiles(TMP_ROOT);
		const refCount = countEnvReferences(['FIXTURE_SSH_HOST'], files);

		assert.ok(
			refCount.get('FIXTURE_SSH_HOST') > 0,
			'shell script (.sh) 内の env 参照が走査母数から漏れている (SEARCH_EXTENSIONS に .sh が必要)',
		);
	});

	it('SEARCH_EXTENSIONS に .sh を含む', () => {
		assert.ok(SEARCH_EXTENSIONS.includes('.sh'));
	});

	it('参照が本当に無い env は orphan として検出する (over-detection にしない)', () => {
		writeFixture('scripts/deploy.sh', '#!/usr/bin/env bash\necho hello\n');

		const files = collectSearchFiles(TMP_ROOT);
		const refCount = countEnvReferences(['FIXTURE_NEVER_USED'], files);

		assert.equal(refCount.get('FIXTURE_NEVER_USED'), 0);
	});

	it('実 repo の走査母数に .sh が含まれる (regression)', () => {
		const files = collectSearchFiles();
		const shFiles = files.filter((f) => f.endsWith('.sh'));
		assert.ok(shFiles.length > 0, '実 repo の走査母数に .sh が 1 件も含まれていない');
	});

	it('extractEnvVars は .env.example のコメント行も拾う', () => {
		const r = extractEnvVars('FOO=1\n# BAR=2\nnot_an_env\n');
		assert.deepEqual(r, ['BAR', 'FOO']);
	});
});

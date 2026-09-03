// tests/unit/security/nuc-compose-cognito-dev-mode-pinned-4836.test.ts
//
// NUC (docker-compose) では isCognitoDevMode() の deploy guard (AWS_LAMBDA_FUNCTION_NAME / IS_NUC_DEPLOY /
// APP_MODE) が効かないため、出荷物である docker-compose.yml の app `environment` が COGNITO_DEV_MODE=false を
// 固定していることが唯一の構造的防御線。compose の `environment` は env_file (.env) より優先されるので、
// この 1 行が消えると operator の .env 1 行で固定パスワードの DEV_USERS が有効になる (#4834 / #4836)。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const compose = readFileSync(join(__dirname, '../../../docker-compose.yml'), 'utf8');
const setupServer = readFileSync(join(__dirname, '../../../scripts/setup-server.sh'), 'utf8');
const deployScript = readFileSync(join(__dirname, '../../../scripts/deploy.sh'), 'utf8');
const rootPkg = readFileSync(join(__dirname, '../../../package.json'), 'utf8');

/** `services:` 直下の service block を切り出す (2 space indent の service 名 → 次の service 名の直前まで) */
function serviceBlock(name: string): string {
	const lines = compose.split('\n');
	const start = lines.indexOf(`  ${name}:`);
	if (start < 0) throw new Error(`docker-compose.yml に service "${name}" が無い`);
	const rest = lines.slice(start + 1);
	const end = rest.findIndex((l) => /^ {2}[a-z-]+:$/.test(l));
	return (end < 0 ? rest : rest.slice(0, end)).join('\n');
}

describe('NUC compose は COGNITO_DEV_MODE を false に固定する (#4836)', () => {
	it('app service の environment に COGNITO_DEV_MODE=false がある (コメント行ではない)', () => {
		const app = serviceBlock('app');
		const pinned = app.split('\n').some((line) => /^\s*-\s*COGNITO_DEV_MODE=false\s*$/.test(line));
		expect(
			pinned,
			'app.environment に `- COGNITO_DEV_MODE=false` を置くこと (env_file より優先される固定値)',
		).toBe(true);
	});

	it('Windows 直起動経路 (setup-server.sh が生成する start.bat) でも node 起動前に COGNITO_DEV_MODE=false を set する', () => {
		// docker を使わない NUC (scripts/deploy.sh + setup-server.sh) は compose の environment を通らない。
		// start.bat の `set` は .env (dotenv は既存値を上書きしない) より先に効く唯一の固定点
		// start.bat の heredoc は `@echo off` で始まる (テンプレート変数名を literal に持たないよう本文側で切る)
		const bat = setupServer.slice(setupServer.indexOf('@echo off')).split('\n');
		const setLine = bat.findIndex((l) => /^set COGNITO_DEV_MODE=false\s*$/.test(l));
		const nodeLine = bat.findIndex((l) => /^node index\.js/.test(l));
		expect(setLine, 'start.bat に `set COGNITO_DEV_MODE=false` が無い').toBeGreaterThanOrEqual(0);
		expect(nodeLine).toBeGreaterThan(setLine);
	});

	it('deploy 経路 (deploy.sh の Start-Process) でも起動前に COGNITO_DEV_MODE=false を渡す', () => {
		// deploy のたびにアプリを起動し直すのはこちら。start.bat (logon 自動起動) だけ固定しても
		// deploy 直後のプロセスは素通りする (adv-4836 指摘)
		const lines = deployScript.split('\n');
		const setLine = lines.findIndex((l) => /env:COGNITO_DEV_MODE\s*=\s*'false'/.test(l));
		const startLine = lines.findIndex((l) => /Start-Process -FilePath 'node'/.test(l));
		expect(setLine, "deploy.sh に COGNITO_DEV_MODE = 'false' が無い").toBeGreaterThanOrEqual(0);
		expect(startLine).toBeGreaterThan(setLine);
	});

	it('アプリが .env を読まない前提 (dotenv 非依存) が崩れていない', () => {
		// `.env.example` と docs/security FINDING-12 が「Windows 直起動経路ではアプリが .env を読まない」
		// と断言している。dotenv が依存に入ると .env が読まれ始め、その断言が黙って偽になる
		// (起動 script の固定より .env が後勝ちになる経路が生まれうる)。前提そのものを固定する
		const pkg = JSON.parse(rootPkg) as {
			dependencies?: Record<string, string>;
			devDependencies?: Record<string, string>;
		};
		const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
		expect(
			Object.keys(deps).filter((n) => n === 'dotenv' || n.startsWith('dotenv-')),
			'dotenv を入れるなら .env.example / FINDING-12 の「アプリは .env を読まない」を先に書き換えること',
		).toEqual([]);
	});

	it('true / 変数展開 (ドル記号 + 波括弧) で上書き可能な形にはなっていない', () => {
		const app = serviceBlock('app');
		for (const line of app.split('\n')) {
			if (/^\s*#/.test(line)) continue;
			if (!line.includes('COGNITO_DEV_MODE')) continue;
			expect(line).not.toMatch(/COGNITO_DEV_MODE=(true|\$)/);
		}
	});
});

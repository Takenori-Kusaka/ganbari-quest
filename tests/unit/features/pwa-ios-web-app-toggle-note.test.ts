// tests/unit/features/pwa-ios-web-app-toggle-note.test.ts
//
// iOS の「ホーム画面に追加」手順は「Webアプリとして開く」を「オンのまま」とだけ書いていて、
// 何のための切り替えかが読めなかった (#4988 の QM 指摘)。オフにされると、ホーム画面から
// アプリのように開かない。アプリ内の手順と LP の両方に、オンにすると何が起きるかを 1 文で出す。
//
// 文の中身は Apple の iPhone ユーザガイド (iOS 26)「iPhoneのSafariでWebサイトをアプリにする」に拠る
// (オンにして追加すると、アイコンから Web サイトがアプリのように開く)。

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import {
	FEATURES_PWA_WEB_APP_TOGGLE_NOTE,
	LP_INDEX_PHASEB_LABELS,
	PWA_INSTALL_LABELS,
} from '../../../src/lib/domain/labels';
import { PWA_TERMS } from '../../../src/lib/domain/terms';
import PwaInstallGuide from '../../../src/lib/features/pwa/PwaInstallGuide.svelte';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

describe('「Webアプリとして開く」が何の切り替えかを書く', () => {
	afterEach(() => cleanup());

	it('補足文は切り替えの名前 (実機の表記) と、オンのときに起きること (アプリのように全画面で開く) を持つ', () => {
		expect(FEATURES_PWA_WEB_APP_TOGGLE_NOTE).toContain(`「${PWA_TERMS.iosWebAppToggle}」`);
		expect(FEATURES_PWA_WEB_APP_TOGGLE_NOTE).toContain('オンにすると');
		expect(FEATURES_PWA_WEB_APP_TOGGLE_NOTE).toContain(PWA_TERMS.standalone);
	});

	it('アプリ内の iOS 手順の下に補足文を出す', () => {
		expect(PWA_INSTALL_LABELS.iosHint).toBe(FEATURES_PWA_WEB_APP_TOGGLE_NOTE);
		const { getByTestId } = render(PwaInstallGuide, { platform: 'ios' });
		expect(getByTestId('pwa-install-guide-ios-hint').textContent?.trim()).toBe(
			FEATURES_PWA_WEB_APP_TOGGLE_NOTE,
		);
	});

	it('LP の iPhone / iPad 手順にも同じ文を出す (生成物と fallback の両方)', () => {
		expect(LP_INDEX_PHASEB_LABELS.pwaIosSteps).toContain(FEATURES_PWA_WEB_APP_TOGGLE_NOTE);
		const sharedLabels = readFileSync(join(REPO_ROOT, 'site/shared-labels.js'), 'utf8');
		expect(sharedLabels).toContain(FEATURES_PWA_WEB_APP_TOGGLE_NOTE);
		const lp = readFileSync(join(REPO_ROOT, 'site/index.html'), 'utf8');
		const iosSteps = /<p data-lp-key="indexB\.pwaIosSteps">([^<]*)<\/p>/.exec(lp)?.[1];
		expect(iosSteps).toContain(FEATURES_PWA_WEB_APP_TOGGLE_NOTE);
	});
});

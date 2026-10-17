// #5085: ポイントの単位を「ポイント」に統一した (#4567) 後に残っていた 2 箇所の取りこぼしを固定する。
// 画面に出る表記と、それを案内する文言が食い違わないことを確かめる。

import { describe, expect, it } from 'vitest';
import { CHALLENGES_LABELS } from '../../../src/lib/domain/labels/admin-challenges';
import { PAGE_GUIDE_LABELS } from '../../../src/lib/domain/labels/page-guide';
import { SETUP_ACTIVITIES_DEFAULTS_LABELS } from '../../../src/lib/domain/labels/setup';
import { POINT_TERMS } from '../../../src/lib/domain/terms';

describe('#5085 ポイント単位の取りこぼし', () => {
	it('初期設定の案内は、実際に出る単位「ポイント」を示す', () => {
		const label = SETUP_ACTIVITIES_DEFAULTS_LABELS.defaultPointModeLabel;
		expect(label).toContain(`「${POINT_TERMS.unit}」`);
		expect(label).not.toContain('「P」');
	});

	it('チャレンジのページガイドは、カードに出る「ごほうび N ポイント」と同じ単位で案内する', () => {
		const step = JSON.stringify(PAGE_GUIDE_LABELS);
		expect(step).not.toMatch(/報酬 N P/);
		expect(step).toContain(`N ${POINT_TERMS.unit}」`);
		// カード側の実表記も「ポイント」で終わる
		expect(CHALLENGES_LABELS.rewardLabel(10)).toMatch(new RegExp(`${POINT_TERMS.unit}$`));
	});
});

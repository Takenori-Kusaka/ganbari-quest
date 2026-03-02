import {
	findAllChildren,
	findChildById,
	insertChild,
	updateChild,
	deleteChild,
} from '$lib/server/db/child-repo';

export function getAllChildren() {
	return findAllChildren();
}

export function getChildById(id: number) {
	return findChildById(id);
}

export function addChild(input: {
	nickname: string;
	age: number;
	theme?: string;
	uiMode?: string;
}) {
	return insertChild(input);
}

export function editChild(
	id: number,
	input: { nickname?: string; age?: number; theme?: string; uiMode?: string },
) {
	return updateChild(id, input);
}

export function removeChild(id: number) {
	return deleteChild(id);
}

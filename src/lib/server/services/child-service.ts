import {
	deleteChild,
	findAllChildren,
	findChildById,
	insertChild,
	updateChild,
} from '$lib/server/db/child-repo';

export async function getAllChildren() {
	return await findAllChildren();
}

export async function getChildById(id: number) {
	return await findChildById(id);
}

export async function addChild(input: {
	nickname: string;
	age: number;
	theme?: string;
	uiMode?: string;
}) {
	return await insertChild(input);
}

export async function editChild(
	id: number,
	input: { nickname?: string; age?: number; theme?: string; uiMode?: string },
) {
	return await updateChild(id, input);
}

export async function removeChild(id: number) {
	return await deleteChild(id);
}

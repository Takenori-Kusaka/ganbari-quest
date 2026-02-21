import { findAllChildren, findChildById } from '$lib/server/db/child-repo';

export function getAllChildren() {
	return findAllChildren();
}

export function getChildById(id: number) {
	return findChildById(id);
}

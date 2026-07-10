/**
 * Stable owner sentinel shared by favorites. Legacy admins and login-disabled
 * single-user deployments intentionally share this key; it is a durable value
 * that survives across instances, so backup merges may carry it verbatim.
 *
 * Kept in a dependency-free module so lightweight consumers (e.g. the database
 * merge logic) can reference it without importing the full favorite service.
 */
export const OWNER_FAVORITES_USER_ID = "__admin__";

export const cache = (_ttlSeconds) => (_req, _res, next) => next();

export const invalidateCache = async (_pattern) => {};

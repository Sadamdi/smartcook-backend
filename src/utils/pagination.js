"use strict";

/**
 * Parse `page` / `limit` from a query string into safe numbers.
 *
 * Without this, `?limit=100000` pulled a whole collection into memory and
 * `?page=abc` produced a NaN skip that Mongo rejects with a 500.
 */
function paginate(query = {}, { defaultLimit = 10, maxLimit = 50 } = {}) {
  const toInt = (v, fallback) => {
    const n = Number.parseInt(v, 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  const page = Math.min(toInt(query.page, 1), 10000);
  const limit = Math.min(toInt(query.limit, defaultLimit), maxLimit);
  return { page, limit, offset: (page - 1) * limit };
}

module.exports = { paginate };

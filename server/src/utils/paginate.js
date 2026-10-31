// Every large list uses page/limit so a response never grows with the size of the database.
export function pageParams(query, { defaultLimit = 20, maxLimit = 100 } = {}) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(maxLimit, Math.max(1, parseInt(query.limit, 10) || defaultLimit));
  return { page, limit, skip: (page - 1) * limit };
}

// Runs the count and the page query together. `build(findQuery)` can add populate/select.
export async function paginate(Model, filter, req, { sort = { createdAt: -1 }, build = q => q, ...opts } = {}) {
  const { page, limit, skip } = pageParams(req.query, opts);
  const [total, data] = await Promise.all([
    Model.countDocuments(filter),
    build(Model.find(filter).sort(sort).skip(skip).limit(limit)).lean()
  ]);
  return { data, total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) };
}

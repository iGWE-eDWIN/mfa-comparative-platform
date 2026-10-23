/**
 * Zod validation middleware. Parsed (and therefore type-coerced and stripped) values replace
 * the raw input so controllers only ever see validated data.
 * @param {{ body?: import('zod').ZodTypeAny, query?: import('zod').ZodTypeAny, params?: import('zod').ZodTypeAny }} schemas
 */
export const validate = (schemas) => (req, _res, next) => {
  try {
    if (schemas.body) req.body = schemas.body.parse(req.body ?? {});
    if (schemas.params) req.params = schemas.params.parse(req.params);
    // Express 5 exposes req.query as a getter, so the parsed copy is stored separately.
    if (schemas.query) req.validQuery = schemas.query.parse(req.query);
    next();
  } catch (err) {
    next(err);
  }
};

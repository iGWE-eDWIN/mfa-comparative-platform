import { z } from 'zod';

/** Boolean that accepts true/false and the strings "true"/"false" (z.coerce.boolean treats "false" as true). */
export const zBool = (def) =>
  z
    .preprocess((v) => (v === 'true' ? true : v === 'false' ? false : v), z.boolean())
    .default(def);

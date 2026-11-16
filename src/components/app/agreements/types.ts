import type { FunctionReturnType } from "convex/server";

import type { api } from "../../../../convex/_generated/api";

export type Detail = FunctionReturnType<typeof api.companyAgreements.get>;
export type Catalog = FunctionReturnType<typeof api.companyAgreements.catalog>;

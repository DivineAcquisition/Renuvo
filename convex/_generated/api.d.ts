/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as approvals from "../approvals.js";
import type * as assignments from "../assignments.js";
import type * as availability from "../availability.js";
import type * as cleaners from "../cleaners.js";
import type * as companies from "../companies.js";
import type * as crons from "../crons.js";
import type * as customers from "../customers.js";
import type * as earlyAccess from "../earlyAccess.js";
import type * as events from "../events.js";
import type * as jobs from "../jobs.js";
import type * as lib_access from "../lib/access.js";
import type * as lib_authority from "../lib/authority.js";
import type * as lib_availability from "../lib/availability.js";
import type * as lib_builders from "../lib/builders.js";
import type * as lib_errors from "../lib/errors.js";
import type * as lib_events from "../lib/events.js";
import type * as lib_guard from "../lib/guard.js";
import type * as lib_permissionCatalog from "../lib/permissionCatalog.js";
import type * as lib_rateLimit from "../lib/rateLimit.js";
import type * as lib_roles from "../lib/roles.js";
import type * as lib_statuses from "../lib/statuses.js";
import type * as lib_text from "../lib/text.js";
import type * as members from "../members.js";
import type * as permissions from "../permissions.js";
import type * as properties from "../properties.js";
import type * as tasks from "../tasks.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  approvals: typeof approvals;
  assignments: typeof assignments;
  availability: typeof availability;
  cleaners: typeof cleaners;
  companies: typeof companies;
  crons: typeof crons;
  customers: typeof customers;
  earlyAccess: typeof earlyAccess;
  events: typeof events;
  jobs: typeof jobs;
  "lib/access": typeof lib_access;
  "lib/authority": typeof lib_authority;
  "lib/availability": typeof lib_availability;
  "lib/builders": typeof lib_builders;
  "lib/errors": typeof lib_errors;
  "lib/events": typeof lib_events;
  "lib/guard": typeof lib_guard;
  "lib/permissionCatalog": typeof lib_permissionCatalog;
  "lib/rateLimit": typeof lib_rateLimit;
  "lib/roles": typeof lib_roles;
  "lib/statuses": typeof lib_statuses;
  "lib/text": typeof lib_text;
  members: typeof members;
  permissions: typeof permissions;
  properties: typeof properties;
  tasks: typeof tasks;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};

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
import type * as details from "../details.js";
import type * as dispatch from "../dispatch.js";
import type * as earlyAccess from "../earlyAccess.js";
import type * as events from "../events.js";
import type * as jobs from "../jobs.js";
import type * as lib_access from "../lib/access.js";
import type * as lib_approvalQueue from "../lib/approvalQueue.js";
import type * as lib_authority from "../lib/authority.js";
import type * as lib_availability from "../lib/availability.js";
import type * as lib_builders from "../lib/builders.js";
import type * as lib_departments from "../lib/departments.js";
import type * as lib_dispatch_eligibility from "../lib/dispatch/eligibility.js";
import type * as lib_dispatch_facts from "../lib/dispatch/facts.js";
import type * as lib_dispatch_offers from "../lib/dispatch/offers.js";
import type * as lib_dispatch_pay from "../lib/dispatch/pay.js";
import type * as lib_dispatch_run from "../lib/dispatch/run.js";
import type * as lib_dispatch_settings from "../lib/dispatch/settings.js";
import type * as lib_dispatch_workflow from "../lib/dispatch/workflow.js";
import type * as lib_errors from "../lib/errors.js";
import type * as lib_eventWords from "../lib/eventWords.js";
import type * as lib_events from "../lib/events.js";
import type * as lib_guard from "../lib/guard.js";
import type * as lib_permissionCatalog from "../lib/permissionCatalog.js";
import type * as lib_rateLimit from "../lib/rateLimit.js";
import type * as lib_roles from "../lib/roles.js";
import type * as lib_statuses from "../lib/statuses.js";
import type * as lib_taskState from "../lib/taskState.js";
import type * as lib_text from "../lib/text.js";
import type * as lib_time from "../lib/time.js";
import type * as members from "../members.js";
import type * as overview from "../overview.js";
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
  details: typeof details;
  dispatch: typeof dispatch;
  earlyAccess: typeof earlyAccess;
  events: typeof events;
  jobs: typeof jobs;
  "lib/access": typeof lib_access;
  "lib/approvalQueue": typeof lib_approvalQueue;
  "lib/authority": typeof lib_authority;
  "lib/availability": typeof lib_availability;
  "lib/builders": typeof lib_builders;
  "lib/departments": typeof lib_departments;
  "lib/dispatch/eligibility": typeof lib_dispatch_eligibility;
  "lib/dispatch/facts": typeof lib_dispatch_facts;
  "lib/dispatch/offers": typeof lib_dispatch_offers;
  "lib/dispatch/pay": typeof lib_dispatch_pay;
  "lib/dispatch/run": typeof lib_dispatch_run;
  "lib/dispatch/settings": typeof lib_dispatch_settings;
  "lib/dispatch/workflow": typeof lib_dispatch_workflow;
  "lib/errors": typeof lib_errors;
  "lib/eventWords": typeof lib_eventWords;
  "lib/events": typeof lib_events;
  "lib/guard": typeof lib_guard;
  "lib/permissionCatalog": typeof lib_permissionCatalog;
  "lib/rateLimit": typeof lib_rateLimit;
  "lib/roles": typeof lib_roles;
  "lib/statuses": typeof lib_statuses;
  "lib/taskState": typeof lib_taskState;
  "lib/text": typeof lib_text;
  "lib/time": typeof lib_time;
  members: typeof members;
  overview: typeof overview;
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

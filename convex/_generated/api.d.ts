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
import type * as dispatchOps from "../dispatchOps.js";
import type * as dispatchTools from "../dispatchTools.js";
import type * as dispatchViews from "../dispatchViews.js";
import type * as earlyAccess from "../earlyAccess.js";
import type * as events from "../events.js";
import type * as invitations from "../invitations.js";
import type * as jobs from "../jobs.js";
import type * as lib_access from "../lib/access.js";
import type * as lib_approvalQueue from "../lib/approvalQueue.js";
import type * as lib_assessment from "../lib/assessment.js";
import type * as lib_authority from "../lib/authority.js";
import type * as lib_availability from "../lib/availability.js";
import type * as lib_builders from "../lib/builders.js";
import type * as lib_departments from "../lib/departments.js";
import type * as lib_dispatch_assignmentState from "../lib/dispatch/assignmentState.js";
import type * as lib_dispatch_coverage from "../lib/dispatch/coverage.js";
import type * as lib_dispatch_crew from "../lib/dispatch/crew.js";
import type * as lib_dispatch_delivery from "../lib/dispatch/delivery.js";
import type * as lib_dispatch_eligibility from "../lib/dispatch/eligibility.js";
import type * as lib_dispatch_facts from "../lib/dispatch/facts.js";
import type * as lib_dispatch_handoffs from "../lib/dispatch/handoffs.js";
import type * as lib_dispatch_links from "../lib/dispatch/links.js";
import type * as lib_dispatch_live from "../lib/dispatch/live.js";
import type * as lib_dispatch_offers from "../lib/dispatch/offers.js";
import type * as lib_dispatch_pay from "../lib/dispatch/pay.js";
import type * as lib_dispatch_policy from "../lib/dispatch/policy.js";
import type * as lib_dispatch_run from "../lib/dispatch/run.js";
import type * as lib_dispatch_settings from "../lib/dispatch/settings.js";
import type * as lib_dispatch_sms from "../lib/dispatch/sms.js";
import type * as lib_dispatch_tools from "../lib/dispatch/tools.js";
import type * as lib_dispatch_workflow from "../lib/dispatch/workflow.js";
import type * as lib_email_invitation from "../lib/email/invitation.js";
import type * as lib_email_layout from "../lib/email/layout.js";
import type * as lib_email_provider from "../lib/email/provider.js";
import type * as lib_errors from "../lib/errors.js";
import type * as lib_eventWords from "../lib/eventWords.js";
import type * as lib_events from "../lib/events.js";
import type * as lib_guard from "../lib/guard.js";
import type * as lib_invitations from "../lib/invitations.js";
import type * as lib_messaging_outbox from "../lib/messaging/outbox.js";
import type * as lib_messaging_provider from "../lib/messaging/provider.js";
import type * as lib_permissionCatalog from "../lib/permissionCatalog.js";
import type * as lib_rateLimit from "../lib/rateLimit.js";
import type * as lib_roles from "../lib/roles.js";
import type * as lib_statuses from "../lib/statuses.js";
import type * as lib_taskState from "../lib/taskState.js";
import type * as lib_text from "../lib/text.js";
import type * as lib_time from "../lib/time.js";
import type * as links from "../links.js";
import type * as members from "../members.js";
import type * as messaging from "../messaging.js";
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
  dispatchOps: typeof dispatchOps;
  dispatchTools: typeof dispatchTools;
  dispatchViews: typeof dispatchViews;
  earlyAccess: typeof earlyAccess;
  events: typeof events;
  invitations: typeof invitations;
  jobs: typeof jobs;
  "lib/access": typeof lib_access;
  "lib/approvalQueue": typeof lib_approvalQueue;
  "lib/assessment": typeof lib_assessment;
  "lib/authority": typeof lib_authority;
  "lib/availability": typeof lib_availability;
  "lib/builders": typeof lib_builders;
  "lib/departments": typeof lib_departments;
  "lib/dispatch/assignmentState": typeof lib_dispatch_assignmentState;
  "lib/dispatch/coverage": typeof lib_dispatch_coverage;
  "lib/dispatch/crew": typeof lib_dispatch_crew;
  "lib/dispatch/delivery": typeof lib_dispatch_delivery;
  "lib/dispatch/eligibility": typeof lib_dispatch_eligibility;
  "lib/dispatch/facts": typeof lib_dispatch_facts;
  "lib/dispatch/handoffs": typeof lib_dispatch_handoffs;
  "lib/dispatch/links": typeof lib_dispatch_links;
  "lib/dispatch/live": typeof lib_dispatch_live;
  "lib/dispatch/offers": typeof lib_dispatch_offers;
  "lib/dispatch/pay": typeof lib_dispatch_pay;
  "lib/dispatch/policy": typeof lib_dispatch_policy;
  "lib/dispatch/run": typeof lib_dispatch_run;
  "lib/dispatch/settings": typeof lib_dispatch_settings;
  "lib/dispatch/sms": typeof lib_dispatch_sms;
  "lib/dispatch/tools": typeof lib_dispatch_tools;
  "lib/dispatch/workflow": typeof lib_dispatch_workflow;
  "lib/email/invitation": typeof lib_email_invitation;
  "lib/email/layout": typeof lib_email_layout;
  "lib/email/provider": typeof lib_email_provider;
  "lib/errors": typeof lib_errors;
  "lib/eventWords": typeof lib_eventWords;
  "lib/events": typeof lib_events;
  "lib/guard": typeof lib_guard;
  "lib/invitations": typeof lib_invitations;
  "lib/messaging/outbox": typeof lib_messaging_outbox;
  "lib/messaging/provider": typeof lib_messaging_provider;
  "lib/permissionCatalog": typeof lib_permissionCatalog;
  "lib/rateLimit": typeof lib_rateLimit;
  "lib/roles": typeof lib_roles;
  "lib/statuses": typeof lib_statuses;
  "lib/taskState": typeof lib_taskState;
  "lib/text": typeof lib_text;
  "lib/time": typeof lib_time;
  links: typeof links;
  members: typeof members;
  messaging: typeof messaging;
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

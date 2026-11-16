/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as agreements from "../agreements.js";
import type * as applicantPages from "../applicantPages.js";
import type * as applications from "../applications.js";
import type * as approvals from "../approvals.js";
import type * as assignments from "../assignments.js";
import type * as availability from "../availability.js";
import type * as cleaners from "../cleaners.js";
import type * as companies from "../companies.js";
import type * as compliance from "../compliance.js";
import type * as consent from "../consent.js";
import type * as crons from "../crons.js";
import type * as customers from "../customers.js";
import type * as dataRights from "../dataRights.js";
import type * as details from "../details.js";
import type * as dispatch from "../dispatch.js";
import type * as dispatchOps from "../dispatchOps.js";
import type * as dispatchTools from "../dispatchTools.js";
import type * as dispatchViews from "../dispatchViews.js";
import type * as earlyAccess from "../earlyAccess.js";
import type * as events from "../events.js";
import type * as hiringNeeds from "../hiringNeeds.js";
import type * as hiringOffers from "../hiringOffers.js";
import type * as http from "../http.js";
import type * as inbound from "../inbound.js";
import type * as interviews from "../interviews.js";
import type * as invitations from "../invitations.js";
import type * as jobs from "../jobs.js";
import type * as lib_access from "../lib/access.js";
import type * as lib_approvalQueue from "../lib/approvalQueue.js";
import type * as lib_assessment from "../lib/assessment.js";
import type * as lib_authority from "../lib/authority.js";
import type * as lib_availability from "../lib/availability.js";
import type * as lib_builders from "../lib/builders.js";
import type * as lib_compliance_agreements from "../lib/compliance/agreements.js";
import type * as lib_compliance_ledger from "../lib/compliance/ledger.js";
import type * as lib_compliance_permissions from "../lib/compliance/permissions.js";
import type * as lib_compliance_profile from "../lib/compliance/profile.js";
import type * as lib_compliance_readiness from "../lib/compliance/readiness.js";
import type * as lib_compliance_recipients from "../lib/compliance/recipients.js";
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
import type * as lib_dispatch_reschedule from "../lib/dispatch/reschedule.js";
import type * as lib_dispatch_run from "../lib/dispatch/run.js";
import type * as lib_dispatch_settings from "../lib/dispatch/settings.js";
import type * as lib_dispatch_sms from "../lib/dispatch/sms.js";
import type * as lib_dispatch_templates from "../lib/dispatch/templates.js";
import type * as lib_dispatch_tools from "../lib/dispatch/tools.js";
import type * as lib_dispatch_workflow from "../lib/dispatch/workflow.js";
import type * as lib_email_invitation from "../lib/email/invitation.js";
import type * as lib_email_layout from "../lib/email/layout.js";
import type * as lib_email_provider from "../lib/email/provider.js";
import type * as lib_email_trustRequest from "../lib/email/trustRequest.js";
import type * as lib_errors from "../lib/errors.js";
import type * as lib_eventWords from "../lib/eventWords.js";
import type * as lib_events from "../lib/events.js";
import type * as lib_guard from "../lib/guard.js";
import type * as lib_invitationTerms from "../lib/invitationTerms.js";
import type * as lib_invitations from "../lib/invitations.js";
import type * as lib_messaging_campaign from "../lib/messaging/campaign.js";
import type * as lib_messaging_email from "../lib/messaging/email.js";
import type * as lib_messaging_outbox from "../lib/messaging/outbox.js";
import type * as lib_messaging_policy from "../lib/messaging/policy.js";
import type * as lib_messaging_provider from "../lib/messaging/provider.js";
import type * as lib_messaging_resend from "../lib/messaging/resend.js";
import type * as lib_messaging_telnyx from "../lib/messaging/telnyx.js";
import type * as lib_messaging_telnyxAccount from "../lib/messaging/telnyxAccount.js";
import type * as lib_permissionCatalog from "../lib/permissionCatalog.js";
import type * as lib_rateLimit from "../lib/rateLimit.js";
import type * as lib_recruiter_applications from "../lib/recruiter/applications.js";
import type * as lib_recruiter_approvals from "../lib/recruiter/approvals.js";
import type * as lib_recruiter_calendar from "../lib/recruiter/calendar.js";
import type * as lib_recruiter_claude from "../lib/recruiter/claude.js";
import type * as lib_recruiter_contact from "../lib/recruiter/contact.js";
import type * as lib_recruiter_decisions from "../lib/recruiter/decisions.js";
import type * as lib_recruiter_delivery from "../lib/recruiter/delivery.js";
import type * as lib_recruiter_fairness from "../lib/recruiter/fairness.js";
import type * as lib_recruiter_form from "../lib/recruiter/form.js";
import type * as lib_recruiter_handoff from "../lib/recruiter/handoff.js";
import type * as lib_recruiter_intake from "../lib/recruiter/intake.js";
import type * as lib_recruiter_interpret from "../lib/recruiter/interpret.js";
import type * as lib_recruiter_interviews from "../lib/recruiter/interviews.js";
import type * as lib_recruiter_invitations from "../lib/recruiter/invitations.js";
import type * as lib_recruiter_links from "../lib/recruiter/links.js";
import type * as lib_recruiter_mail from "../lib/recruiter/mail.js";
import type * as lib_recruiter_mailbox from "../lib/recruiter/mailbox.js";
import type * as lib_recruiter_model from "../lib/recruiter/model.js";
import type * as lib_recruiter_offers from "../lib/recruiter/offers.js";
import type * as lib_recruiter_outbox from "../lib/recruiter/outbox.js";
import type * as lib_recruiter_retention from "../lib/recruiter/retention.js";
import type * as lib_recruiter_screening from "../lib/recruiter/screening.js";
import type * as lib_recruiter_settings from "../lib/recruiter/settings.js";
import type * as lib_recruiter_signature from "../lib/recruiter/signature.js";
import type * as lib_recruiter_tools from "../lib/recruiter/tools.js";
import type * as lib_recruiter_urgent from "../lib/recruiter/urgent.js";
import type * as lib_recruiter_words from "../lib/recruiter/words.js";
import type * as lib_roles from "../lib/roles.js";
import type * as lib_statuses from "../lib/statuses.js";
import type * as lib_taskState from "../lib/taskState.js";
import type * as lib_text from "../lib/text.js";
import type * as lib_time from "../lib/time.js";
import type * as lib_trust_changes from "../lib/trust/changes.js";
import type * as lib_trust_checks from "../lib/trust/checks.js";
import type * as lib_trust_documents from "../lib/trust/documents.js";
import type * as lib_trust_erase from "../lib/trust/erase.js";
import type * as lib_trust_exportTables from "../lib/trust/exportTables.js";
import type * as lib_trust_requests from "../lib/trust/requests.js";
import type * as lib_trust_seed from "../lib/trust/seed.js";
import type * as lib_trust_staffSchema from "../lib/trust/staffSchema.js";
import type * as links from "../links.js";
import type * as members from "../members.js";
import type * as messaging from "../messaging.js";
import type * as onboarding from "../onboarding.js";
import type * as overview from "../overview.js";
import type * as permissions from "../permissions.js";
import type * as properties from "../properties.js";
import type * as recruiter from "../recruiter.js";
import type * as recruiterInbox from "../recruiterInbox.js";
import type * as recruiterTools from "../recruiterTools.js";
import type * as requests from "../requests.js";
import type * as retention from "../retention.js";
import type * as staff from "../staff.js";
import type * as tasks from "../tasks.js";
import type * as texting from "../texting.js";
import type * as trust from "../trust.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  agreements: typeof agreements;
  applicantPages: typeof applicantPages;
  applications: typeof applications;
  approvals: typeof approvals;
  assignments: typeof assignments;
  availability: typeof availability;
  cleaners: typeof cleaners;
  companies: typeof companies;
  compliance: typeof compliance;
  consent: typeof consent;
  crons: typeof crons;
  customers: typeof customers;
  dataRights: typeof dataRights;
  details: typeof details;
  dispatch: typeof dispatch;
  dispatchOps: typeof dispatchOps;
  dispatchTools: typeof dispatchTools;
  dispatchViews: typeof dispatchViews;
  earlyAccess: typeof earlyAccess;
  events: typeof events;
  hiringNeeds: typeof hiringNeeds;
  hiringOffers: typeof hiringOffers;
  http: typeof http;
  inbound: typeof inbound;
  interviews: typeof interviews;
  invitations: typeof invitations;
  jobs: typeof jobs;
  "lib/access": typeof lib_access;
  "lib/approvalQueue": typeof lib_approvalQueue;
  "lib/assessment": typeof lib_assessment;
  "lib/authority": typeof lib_authority;
  "lib/availability": typeof lib_availability;
  "lib/builders": typeof lib_builders;
  "lib/compliance/agreements": typeof lib_compliance_agreements;
  "lib/compliance/ledger": typeof lib_compliance_ledger;
  "lib/compliance/permissions": typeof lib_compliance_permissions;
  "lib/compliance/profile": typeof lib_compliance_profile;
  "lib/compliance/readiness": typeof lib_compliance_readiness;
  "lib/compliance/recipients": typeof lib_compliance_recipients;
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
  "lib/dispatch/reschedule": typeof lib_dispatch_reschedule;
  "lib/dispatch/run": typeof lib_dispatch_run;
  "lib/dispatch/settings": typeof lib_dispatch_settings;
  "lib/dispatch/sms": typeof lib_dispatch_sms;
  "lib/dispatch/templates": typeof lib_dispatch_templates;
  "lib/dispatch/tools": typeof lib_dispatch_tools;
  "lib/dispatch/workflow": typeof lib_dispatch_workflow;
  "lib/email/invitation": typeof lib_email_invitation;
  "lib/email/layout": typeof lib_email_layout;
  "lib/email/provider": typeof lib_email_provider;
  "lib/email/trustRequest": typeof lib_email_trustRequest;
  "lib/errors": typeof lib_errors;
  "lib/eventWords": typeof lib_eventWords;
  "lib/events": typeof lib_events;
  "lib/guard": typeof lib_guard;
  "lib/invitationTerms": typeof lib_invitationTerms;
  "lib/invitations": typeof lib_invitations;
  "lib/messaging/campaign": typeof lib_messaging_campaign;
  "lib/messaging/email": typeof lib_messaging_email;
  "lib/messaging/outbox": typeof lib_messaging_outbox;
  "lib/messaging/policy": typeof lib_messaging_policy;
  "lib/messaging/provider": typeof lib_messaging_provider;
  "lib/messaging/resend": typeof lib_messaging_resend;
  "lib/messaging/telnyx": typeof lib_messaging_telnyx;
  "lib/messaging/telnyxAccount": typeof lib_messaging_telnyxAccount;
  "lib/permissionCatalog": typeof lib_permissionCatalog;
  "lib/rateLimit": typeof lib_rateLimit;
  "lib/recruiter/applications": typeof lib_recruiter_applications;
  "lib/recruiter/approvals": typeof lib_recruiter_approvals;
  "lib/recruiter/calendar": typeof lib_recruiter_calendar;
  "lib/recruiter/claude": typeof lib_recruiter_claude;
  "lib/recruiter/contact": typeof lib_recruiter_contact;
  "lib/recruiter/decisions": typeof lib_recruiter_decisions;
  "lib/recruiter/delivery": typeof lib_recruiter_delivery;
  "lib/recruiter/fairness": typeof lib_recruiter_fairness;
  "lib/recruiter/form": typeof lib_recruiter_form;
  "lib/recruiter/handoff": typeof lib_recruiter_handoff;
  "lib/recruiter/intake": typeof lib_recruiter_intake;
  "lib/recruiter/interpret": typeof lib_recruiter_interpret;
  "lib/recruiter/interviews": typeof lib_recruiter_interviews;
  "lib/recruiter/invitations": typeof lib_recruiter_invitations;
  "lib/recruiter/links": typeof lib_recruiter_links;
  "lib/recruiter/mail": typeof lib_recruiter_mail;
  "lib/recruiter/mailbox": typeof lib_recruiter_mailbox;
  "lib/recruiter/model": typeof lib_recruiter_model;
  "lib/recruiter/offers": typeof lib_recruiter_offers;
  "lib/recruiter/outbox": typeof lib_recruiter_outbox;
  "lib/recruiter/retention": typeof lib_recruiter_retention;
  "lib/recruiter/screening": typeof lib_recruiter_screening;
  "lib/recruiter/settings": typeof lib_recruiter_settings;
  "lib/recruiter/signature": typeof lib_recruiter_signature;
  "lib/recruiter/tools": typeof lib_recruiter_tools;
  "lib/recruiter/urgent": typeof lib_recruiter_urgent;
  "lib/recruiter/words": typeof lib_recruiter_words;
  "lib/roles": typeof lib_roles;
  "lib/statuses": typeof lib_statuses;
  "lib/taskState": typeof lib_taskState;
  "lib/text": typeof lib_text;
  "lib/time": typeof lib_time;
  "lib/trust/changes": typeof lib_trust_changes;
  "lib/trust/checks": typeof lib_trust_checks;
  "lib/trust/documents": typeof lib_trust_documents;
  "lib/trust/erase": typeof lib_trust_erase;
  "lib/trust/exportTables": typeof lib_trust_exportTables;
  "lib/trust/requests": typeof lib_trust_requests;
  "lib/trust/seed": typeof lib_trust_seed;
  "lib/trust/staffSchema": typeof lib_trust_staffSchema;
  links: typeof links;
  members: typeof members;
  messaging: typeof messaging;
  onboarding: typeof onboarding;
  overview: typeof overview;
  permissions: typeof permissions;
  properties: typeof properties;
  recruiter: typeof recruiter;
  recruiterInbox: typeof recruiterInbox;
  recruiterTools: typeof recruiterTools;
  requests: typeof requests;
  retention: typeof retention;
  staff: typeof staff;
  tasks: typeof tasks;
  texting: typeof texting;
  trust: typeof trust;
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

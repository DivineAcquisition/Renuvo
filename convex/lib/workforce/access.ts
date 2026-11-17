/**
 * Who may see and change what about a worker. These are checked in Convex on every read and write, and
 * applied to everything that reads workforce records (the directory, the profile, Chat, exports), never
 * only by hiding a part of a screen.
 *
 *  - Everyone in the company: the directory, contact details, skills, areas, availability, crews, jobs
 *    and readiness. Office staff schedule and call cleaners, so they need these.
 *  - Managers and the Owner: add, edit and import workers; subcontractors and crews; engagement status
 *    and its reasons; personnel notes.
 *  - The Owner only: pay, tax and payout details, and the relationship type (classification).
 */
import { isManager, isOwner, type Role } from "../roles";

export const mayManageWorkforce = (role: Role) => isManager(role);
export const maySeePay = (role: Role) => isOwner(role);
export const maySeePersonnelNotes = (role: Role) => isManager(role);
export const mayChangeClassification = (role: Role) => isOwner(role);

/** Clients & Properties: its addresses, profile tabs and directory views. Plain data, shared by pages and components. */

export const CLIENTS_PATH = "/app/clients";

export const TABS = [
  { id: "overview", label: "Overview" },
  { id: "properties", label: "Properties" },
  { id: "services", label: "Services" },
  { id: "conversations", label: "Conversations" },
  { id: "documents", label: "Documents" },
  { id: "billing", label: "Billing" },
] as const;
export type TabId = (typeof TABS)[number]["id"];

export function isTab(value: string | undefined | null): value is TabId {
  return TABS.some((tab) => tab.id === value);
}

const ID = /^[a-z0-9]{8,64}$/i;
export const isRecordId = (value: string | undefined | null): value is string => typeof value === "string" && ID.test(value);

/** A client's page, or one of its tabs: /app/clients/<id>/<tab>. */
export const clientPath = (customerId: string, tab?: TabId) => `${CLIENTS_PATH}/${customerId}${tab && tab !== "overview" ? `/${tab}` : ""}`;

/** One property, inside its client: /app/clients/<id>/properties/<propertyId>. */
export const propertyPath = (customerId: string, propertyId: string) => `${CLIENTS_PATH}/${customerId}/properties/${propertyId}`;

/** The Services tab's switch. Each is a view over existing records. */
export const SERVICE_VIEWS = [
  { id: "upcoming", label: "Upcoming" },
  { id: "history", label: "History" },
  { id: "plans", label: "Plans" },
  { id: "quotes", label: "Quotes & Proposals" },
] as const;
export type ServiceViewId = (typeof SERVICE_VIEWS)[number]["id"];

/**
 * The directory's views, in the order they are offered. A client can be in several: counts never add up
 * to the total. Residential has its own switch for Recurring and One-time.
 */
export const VIEWS = [
  { id: "all", label: "All clients", detail: "Every current client. Prospects and archived clients are under Filters." },
  { id: "residential", label: "Residential", detail: "Clients with a home property." },
  { id: "commercial", label: "Commercial", detail: "Clients with a commercial or office property. Office clients are here too." },
  { id: "office", label: "Office", detail: "Clients with an office property." },
  { id: "str", label: "STR", detail: "Clients with a short-term rental." },
] as const;

export const RESIDENTIAL_VIEWS = [
  { id: "residential", label: "All" },
  { id: "residential_recurring", label: "Recurring", detail: "Residential, with a recurring plan that is set up, running or paused." },
  { id: "residential_one_time", label: "One-time", detail: "Residential, with a one-time visit in the last year or ahead, or no recurring plan." },
] as const;

export type DirectoryView = "all" | "residential" | "residential_recurring" | "residential_one_time" | "commercial" | "office" | "str" | "prospects" | "archived";

export const DIRECTORY_VIEWS: readonly DirectoryView[] = ["all", "residential", "residential_recurring", "residential_one_time", "commercial", "office", "str", "prospects", "archived"];

export const RELATIONSHIP_LABELS = { prospect: "Prospect", active: "Active", paused: "Paused", former: "Former" } as const;

export const PROPERTY_KIND_LABELS: Record<string, string> = { home: "Home", short_term_rental: "Short-term rental", property_manager: "Managed property", commercial: "Commercial", office: "Office" };

export const CADENCE_LABELS: Record<string, string> = { every_7_days: "Every week", every_14_days: "Every 2 weeks", twice_per_month: "Twice a month", once_per_month: "Once a month" };

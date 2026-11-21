import type { Option } from "./types";

/**
 * Options for business records, with the secondary details that tell two records apart. Each builder
 * reads only fields the caller already has from a query the current person is allowed to run, and
 * shows only what is there: no field is guessed, and nothing is promised that the record doesn't say.
 * Pay, private notes and access instructions are never read here.
 */

const join = (parts: readonly (string | null | undefined | false)[]) => parts.filter((part): part is string => Boolean(part && part.trim())).join(" · ");

type Address = { line1: string; line2?: string; city: string; region?: string; postalCode?: string };

export function addressLine(address: Address): string {
  return [address.line1, address.line2, address.city, [address.region, address.postalCode].filter(Boolean).join(" ")].filter((part) => part && part.trim()).join(", ");
}

/** A customer: the name, then the contact details that distinguish two people with the same name. */
export function customerOption(customer: { _id: string; name: string; type?: "person" | "business"; email?: string; phone?: string }): Option {
  return {
    value: customer._id,
    label: customer.name,
    meta: join([customer.type === "business" ? "Business" : null, customer.email, customer.phone]) || undefined,
    keywords: [customer.email, customer.phone].filter((word): word is string => Boolean(word)),
  };
}

/** A property: its label or first address line, then the full address and, when known, whose it is. */
export function propertyOption(property: { _id: string; label?: string; address: Address }, customerName?: string): Option {
  const address = addressLine(property.address);
  return {
    value: property._id,
    label: property.label ?? `${property.address.line1}, ${property.address.city}`,
    meta: join([property.label ? address : null, customerName]) || undefined,
    keywords: [address, property.address.postalCode ?? "", customerName ?? ""].filter(Boolean),
  };
}

const MONTH = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

/**
 * A cleaner: the name, then their confirmed skills. Availability is mentioned only as what was actually
 * recorded (the date the weekly hours were last confirmed), never as "available" for a particular time.
 */
export function cleanerOption(cleaner: { _id: string; name: string; skills?: readonly string[]; availabilityConfirmedAt?: number; email?: string; phone?: string }): Option {
  const skills = cleaner.skills ?? [];
  const shown = skills.slice(0, 3).join(", ") + (skills.length > 3 ? ` +${skills.length - 3}` : "");
  return {
    value: cleaner._id,
    label: cleaner.name,
    meta: join([shown || null, cleaner.availabilityConfirmedAt ? `Hours confirmed ${MONTH.format(cleaner.availabilityConfirmedAt)}` : null]) || undefined,
    keywords: [...skills, cleaner.email ?? "", cleaner.phone ?? ""].filter(Boolean),
  };
}

const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100);

/** A service: the name, then its published starting price and length, only when the service has them. */
export function serviceOption(service: { id: string; name: string; startingPriceCents?: number; durationMinutes?: number; scope?: string }): Option {
  return {
    value: service.id,
    label: service.name,
    meta: join([service.startingPriceCents !== undefined ? `From ${money(service.startingPriceCents)}` : null, service.durationMinutes ? `${service.durationMinutes} min` : null]) || undefined,
    description: service.scope ? service.scope.slice(0, 140) + (service.scope.length > 140 ? "…" : "") : undefined,
  };
}

/** A kind of agreement or template: its name, grouped under its family (customer, worker, vendor…). */
export function agreementTypeOption(type: { key: string; label: string; family?: string }): Option {
  return { value: type.key, label: type.label, group: type.family };
}

/** Kinds of agreement as options, with each family's kinds kept together in the order families first appear. */
export function agreementTypeOptions(types: readonly { key: string; label: string; family?: string }[]): Option[] {
  const order = [...new Set(types.map((type) => type.family ?? ""))];
  return [...types].sort((a, b) => order.indexOf(a.family ?? "") - order.indexOf(b.family ?? "")).map(agreementTypeOption);
}

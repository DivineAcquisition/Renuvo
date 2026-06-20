import Link from "next/link";

const NAV = [
  { href: "/dashboard/settings/profile", label: "Business profile" },
  { href: "/dashboard/settings/messaging", label: "Messaging" },
  { href: "/dashboard/settings/schedule", label: "Schedule" },
  { href: "/dashboard/settings/payments", label: "Billing & payments" },
  { href: "/dashboard/settings/calendar", label: "Calendar" },
  { href: "/dashboard/settings/team", label: "Team" },
];

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-8 lg:grid-cols-[200px_1fr]">
      <nav className="space-y-1">
        <h2 className="mb-3 font-display text-lg font-bold">Settings</h2>
        {NAV.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            className="block rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            {n.label}
          </Link>
        ))}
      </nav>
      <div>{children}</div>
    </div>
  );
}

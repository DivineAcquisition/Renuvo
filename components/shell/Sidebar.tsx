import { SidebarContent } from "./SidebarContent";

export function Sidebar({
  orgName,
  walletBalanceCents,
}: {
  orgName: string;
  walletBalanceCents: number;
}) {
  return (
    <aside className="sticky top-0 hidden h-screen w-64 shrink-0 border-r border-border/60 lg:flex lg:flex-col">
      <div className="glass h-full">
        <SidebarContent
          orgName={orgName}
          walletBalanceCents={walletBalanceCents}
        />
      </div>
    </aside>
  );
}

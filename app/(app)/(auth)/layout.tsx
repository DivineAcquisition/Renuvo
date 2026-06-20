import { LogoMark } from "@/components/ui/logo";
import { AuroraBackground } from "@/components/fx/aurora-background";

const VALUE_PROPS = [
  "Turn one-time jobs into recurring revenue — automatically.",
  "An AI agent that texts, converts, and re-books for you.",
  "Sits on top of Stripe & your booking tools. Nothing to rip out.",
];

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="flex min-h-screen">
      {/* brand panel — the first impression (lg+) */}
      <AuroraBackground
        dark
        className="hidden w-[46%] shrink-0 lg:flex"
      >
        <div className="flex h-full flex-col justify-between p-12 text-white">
          <div className="flex items-center gap-2.5">
            <LogoMark className="h-10 w-10" />
            <span className="font-display text-xl font-bold tracking-tight">
              Renuvo
            </span>
          </div>

          <div className="max-w-md">
            <h2 className="font-display text-3xl font-bold leading-tight tracking-[-0.02em]">
              The financial + intelligence layer under recurring revenue.
            </h2>
            <ul className="mt-6 space-y-3">
              {VALUE_PROPS.map((v) => (
                <li key={v} className="flex items-start gap-2.5 text-sm text-white/80">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/15 text-[11px]">
                    ✓
                  </span>
                  {v}
                </li>
              ))}
            </ul>
          </div>

          <p className="text-xs text-white/50">
            Trusted with compliant SMS, A2P-registered, and PCI-safe payments.
          </p>
        </div>
      </AuroraBackground>

      {/* form area */}
      <div className="relative flex flex-1 items-center justify-center p-6">
        <div className="ambient-wash absolute inset-0 lg:hidden" aria-hidden />
        <div className="relative w-full max-w-sm">
          {/* compact brand for mobile */}
          <div className="mb-6 flex items-center gap-2.5 lg:hidden">
            <LogoMark className="h-9 w-9" />
            <span className="font-display text-lg font-bold tracking-tight">
              Renuvo
            </span>
          </div>
          {children}
        </div>
      </div>
    </main>
  );
}

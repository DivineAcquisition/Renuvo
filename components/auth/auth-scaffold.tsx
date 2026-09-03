import { Forward, Inbox, ScanSearch } from "lucide-react";

import Logo from "@/components/brand/logo";
import { Particles } from "@/components/magicui/particles";
import { ShineBorder } from "@/components/magicui/shine-border";

const FEATURES = [
  { icon: Forward, label: "Forward what you already get", desc: "Reviews, texts, complaints — no new inbox habit." },
  { icon: ScanSearch, label: "Tagged automatically", desc: "Wait time, billing, staff, product. The moment it lands." },
  { icon: Inbox, label: "Weekly patterns", desc: "See what’s rising before it becomes lost customers." },
] as const;

const STATS = [
  { value: "0", label: "CRM" },
  { value: "0", label: "Setup" },
  { value: "1", label: "Inbox" },
] as const;

function BrandPanel({
  headline,
  subline,
}: {
  headline: React.ReactNode;
  subline: string;
}) {
  return (
    <div className="relative hidden overflow-hidden p-12 text-white lg:flex lg:flex-col lg:justify-between" style={{ background: "#07070b" }}>
      <style>{`
@keyframes nvAuthDriftA{0%,100%{transform:translate3d(0,0,0)}50%{transform:translate3d(30px,-24px,0)}}
@keyframes nvAuthDriftB{0%,100%{transform:translate3d(0,0,0)}50%{transform:translate3d(-26px,20px,0)}}
.nv-auth-a{animation:nvAuthDriftA 14s ease-in-out infinite}
.nv-auth-b{animation:nvAuthDriftB 18s ease-in-out infinite}
@media (prefers-reduced-motion: reduce){.nv-auth-a,.nv-auth-b{animation:none}}
`}</style>
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(55% 45% at 16% 12%, rgba(154,136,252,.45), transparent 60%)," +
              "radial-gradient(45% 40% at 90% 18%, rgba(195,182,254,.28), transparent 60%)," +
              "radial-gradient(70% 65% at 78% 98%, rgba(126,103,242,.45), transparent 62%)",
          }}
        />
        <div className="nv-auth-a absolute -left-24 top-8 h-80 w-80 rounded-full blur-3xl" style={{ background: "rgba(154,136,252,.4)" }} />
        <div className="nv-auth-b absolute -bottom-10 right-0 h-96 w-96 rounded-full blur-3xl" style={{ background: "rgba(126,103,242,.4)" }} />
        <Particles className="absolute inset-0" quantity={36} color="#9A88FC" ease={70} size={0.4} />
        <div
          className="absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage:
              "linear-gradient(#fff 1px,transparent 1px),linear-gradient(90deg,#fff 1px,transparent 1px)",
            backgroundSize: "44px 44px",
            maskImage: "radial-gradient(ellipse at center, #000 40%, transparent 85%)",
          }}
        />
      </div>
      <div className="relative">
        <Logo onDark />
      </div>
      <div className="relative max-w-md">
        <h2 className="font-heading text-3xl leading-[1.15] tracking-tight xl:text-[2.5rem]">{headline}</h2>
        <p className="mt-4 text-sm leading-relaxed text-white/65">{subline}</p>
        <ul className="mt-9 space-y-5">
          {FEATURES.map((f) => (
            <li key={f.label} className="flex items-start gap-3.5">
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/15 backdrop-blur">
                <f.icon className="h-[18px] w-[18px] text-white" />
              </span>
              <div>
                <p className="text-sm font-semibold leading-tight">{f.label}</p>
                <p className="mt-0.5 text-xs leading-snug text-white/55">{f.desc}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
      <div className="relative flex items-center gap-9">
        {STATS.map((stat) => (
          <div key={stat.label}>
            <p className="font-mono text-2xl font-semibold tabular-nums tracking-tight">{stat.value}</p>
            <p className="mt-1 text-[11px] uppercase tracking-wider text-white/45">{stat.label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export function AuthCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-ink-950/[0.08] bg-white p-7 shadow-desk">
      <ShineBorder borderWidth={1.5} duration={12} />
      <div className="relative z-10">{children}</div>
    </div>
  );
}

export function AuthScaffold({
  eyebrow,
  headline,
  subline,
  children,
}: {
  eyebrow: string;
  headline: React.ReactNode;
  subline: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen w-full bg-[#fbfbfe] lg:grid lg:grid-cols-[1.05fr_1fr]">
      <BrandPanel headline={headline} subline={subline} />
      <div className="auth-stage relative flex min-h-screen items-center justify-center px-5 py-12 sm:px-10">
        <div className="auth-stage-atmosphere" aria-hidden>
          <div className="auth-stage-glow lg:hidden" />
          <div className="auth-stage-grid lg:hidden" />
        </div>
        <div className="relative w-full max-w-[400px] space-y-8">
          <div className="flex flex-col items-center gap-2 lg:hidden">
            <Logo />
            <span className="auth-eyebrow">{eyebrow}</span>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}

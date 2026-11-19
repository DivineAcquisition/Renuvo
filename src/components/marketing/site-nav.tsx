"use client";

/**
 * The public site's header. A floating bar that turns to frosted glass once the page scrolls; menus that
 * open on hover with a mouse and on click or Enter everywhere, each item with an icon, a line of
 * description and, for agents, its face and whether it works today; a full-screen menu on phones. On the
 * home page it marks the section being read. Escape and a click outside close any menu, focus returns to
 * the button that opened it, and nothing moves for people who ask for reduced motion.
 */
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";

import { Logo } from "@/components/brand/logo";
import { ArrowRight, ChevronDown, Coins, Hand, LayoutGrid, Mail, Menu, MessageSquareText, PlayCircle, Plug, Quote, ShieldCheck, Users, X, type LucideIcon } from "@/components/icons";
import { SITE_NAV, type NavIcon, type NavItem, type NavMenu } from "@/lib/marketing/nav";
import { cn } from "@/lib/utils";

const ICONS: Record<NavIcon, LucideIcon> = {
  play: PlayCircle,
  team: Users,
  platform: LayoutGrid,
  control: Hand,
  plug: Plug,
  pricing: Coins,
  philosophy: Quote,
  security: ShieldCheck,
  messaging: MessageSquareText,
  contact: Mail,
};

const focusRing = "outline-none focus-visible:ring-2 focus-visible:ring-[#6838ef]/60";

/** The home section in view, from the sections the header knows about. Null away from the home page. */
function useActiveSection(onHome: boolean): string | null {
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    if (!onHome) return;
    const ids = [...SITE_NAV.menus.flatMap((menu) => menu.sections), SITE_NAV.pricing.section];
    const nodes = ids.map((id) => document.getElementById(id)).filter((node): node is HTMLElement => node !== null);
    if (nodes.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-35% 0px -55% 0px", threshold: [0, 0.25, 0.5] },
    );
    for (const node of nodes) observer.observe(node);
    return () => observer.disconnect();
  }, [onHome]);
  return active;
}

function ItemBody({ item }: { item: NavItem }) {
  const Icon = item.icon ? ICONS[item.icon] : null;
  return (
    <>
      {item.agent ? (
        <Image src={`/agents/${item.agent}.webp`} alt="" width={72} height={72} className={cn("mt-0.5 size-9 shrink-0 rounded-full object-cover ring-1 ring-border", item.badge && "opacity-80")} />
      ) : Icon ? (
        <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg border border-brand-500/20 bg-brand-500/[0.08] text-brand-600">
          <Icon className="size-[18px]" aria-hidden />
        </span>
      ) : null}
      <span className="min-w-0">
        <span className="flex items-center gap-2 text-sm font-semibold text-strong">
          {item.label}
          {item.badge ? <span className="rounded-full border border-brand-500/30 bg-brand-500/10 px-1.5 py-px text-[10px] font-semibold tracking-wide text-brand-600 uppercase">{item.badge}</span> : null}
        </span>
        <span className="mt-0.5 block text-[13px] leading-snug text-muted-foreground">{item.description}</span>
      </span>
    </>
  );
}

function ItemLink({ item, onNavigate }: { item: NavItem; onNavigate: () => void }) {
  const className = cn("flex items-start gap-3 rounded-xl p-2.5 transition-colors hover:bg-muted focus-visible:bg-muted", focusRing);
  // Plain anchors for in-page and mail links, so the browser scrolls and opens them as usual.
  return item.href.startsWith("/#") || item.href.startsWith("mailto:") ? (
    <a href={item.href} onClick={onNavigate} className={className}>
      <ItemBody item={item} />
    </a>
  ) : (
    <Link href={item.href} onClick={onNavigate} className={className}>
      <ItemBody item={item} />
    </Link>
  );
}

function MenuPanel({ menu, onNavigate }: { menu: NavMenu; onNavigate: () => void }) {
  const wide = menu.columns.length > 1;
  return (
    <div className={cn("overflow-hidden rounded-2xl border border-border bg-card/95 p-2 shadow-[0_30px_70px_-30px_rgba(33,26,53,0.45),0_0_0_1px_rgba(104,56,239,0.04)] backdrop-blur-xl", wide ? "w-[640px]" : "w-[420px]")}>
      <div className={cn("grid gap-1", wide && "grid-cols-2")}>
        {menu.columns.map((column, index) => (
          <div key={column.title ?? index} className="grid content-start gap-0.5">
            {column.title ? <p className="px-2.5 pt-2 pb-1 text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">{column.title}</p> : null}
            {column.items.map((item) => (
              <ItemLink key={item.href} item={item} onNavigate={onNavigate} />
            ))}
          </div>
        ))}
      </div>
      {menu.footer ? (
        <Link href={menu.footer.href} onClick={onNavigate} className={cn("mt-1 flex items-center justify-between rounded-xl bg-brand-500/[0.08] px-4 py-3 text-sm font-medium text-[#5126c7] transition-colors hover:bg-brand-500/[0.14]", focusRing)}>
          {menu.footer.label}
          <ArrowRight className="size-4" aria-hidden />
        </Link>
      ) : null}
    </div>
  );
}

function Dropdown({ menu, open, current, onOpen, onClose }: { menu: NavMenu; open: boolean; current: boolean; onOpen: () => void; onClose: () => void }) {
  const panelId = useId();
  const button = useRef<HTMLButtonElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const reduce = useReducedMotion();
  const enter = (event: React.PointerEvent) => {
    if (event.pointerType !== "mouse") return;
    window.clearTimeout(timer.current);
    onOpen();
  };
  const leave = (event: React.PointerEvent) => {
    if (event.pointerType !== "mouse") return;
    timer.current = window.setTimeout(onClose, 150);
  };
  return (
    <div
      className="relative"
      onPointerEnter={enter}
      onPointerLeave={leave}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          onClose();
          button.current?.focus();
        }
      }}
    >
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => (open ? onClose() : onOpen())}
        className={cn("flex h-9 items-center gap-1 rounded-full px-3.5 text-sm font-medium transition-colors", focusRing, open ? "bg-muted text-strong" : current ? "text-strong" : "text-muted-foreground hover:text-strong")}
      >
        {menu.label}
        {current ? <span aria-hidden className="size-1 rounded-full bg-brand-500" /> : null}
        <ChevronDown className={cn("size-3.5 transition-transform duration-200", open && "rotate-180")} aria-hidden />
      </button>
      <AnimatePresence>
        {open ? (
          <motion.div
            id={panelId}
            initial={reduce ? false : { opacity: 0, y: 6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: 4, scale: 0.98 }}
            transition={{ duration: 0.16, ease: [0.2, 0.7, 0.2, 1] }}
            className="absolute top-full left-1/2 z-50 -translate-x-1/2 pt-3"
          >
            <MenuPanel menu={menu} onNavigate={onClose} />
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function MobileMenu({ onClose }: { onClose: () => void }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      className="fixed inset-0 z-40 overflow-y-auto bg-background/97 px-4 pt-24 pb-10 backdrop-blur-xl lg:hidden"
    >
      <nav aria-label="Menu" className="mx-auto grid max-w-md gap-7">
        {SITE_NAV.menus.map((menu) => (
          <div key={menu.id}>
            <p className="mb-1.5 px-2.5 text-[11px] font-semibold tracking-[0.16em] text-brand-600 uppercase">{menu.label}</p>
            <div className="grid gap-0.5">
              {menu.columns.flatMap((column) => column.items).map((item) => (
                <ItemLink key={item.href} item={item} onNavigate={onClose} />
              ))}
              {menu.footer ? (
                <Link href={menu.footer.href} onClick={onClose} className="flex items-center justify-between rounded-xl px-2.5 py-2.5 text-sm font-medium text-[#5126c7]">
                  {menu.footer.label}
                  <ArrowRight className="size-4" aria-hidden />
                </Link>
              ) : null}
            </div>
          </div>
        ))}
        <a href={SITE_NAV.pricing.href} onClick={onClose} className="flex items-start gap-3 rounded-xl border border-border bg-card p-3">
          <ItemBody item={{ href: SITE_NAV.pricing.href, label: "Pricing", description: "Operate $299 and Expand $499 a month.", icon: "pricing" }} />
        </a>
        <div className="grid gap-2">
          <Link href={SITE_NAV.cta.href} onClick={onClose} className="icon-gradient flex h-12 items-center justify-center rounded-xl text-[15px] font-semibold">
            {SITE_NAV.cta.label}
          </Link>
          <a href={SITE_NAV.signIn.href} className="flex h-12 items-center justify-center rounded-xl border border-border bg-card text-[15px] font-medium text-strong">
            {SITE_NAV.signIn.label}
          </a>
        </div>
      </nav>
    </motion.div>
  );
}

export function SiteNav({ onHome = false }: { onHome?: boolean }) {
  const [open, setOpen] = useState<NavMenu["id"] | null>(null);
  const [mobile, setMobile] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const bar = useRef<HTMLDivElement>(null);
  const active = useActiveSection(onHome);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    // A page opened part-way down gets the glass at once.
    const first = window.requestAnimationFrame(onScroll);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.cancelAnimationFrame(first);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(null);
        setMobile(false);
      }
    };
    const onPointer = (event: PointerEvent) => {
      if (bar.current && !bar.current.contains(event.target as Node)) setOpen(null);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer);
    };
  }, []);

  useEffect(() => {
    document.documentElement.style.overflow = mobile ? "hidden" : "";
    return () => {
      document.documentElement.style.overflow = "";
    };
  }, [mobile]);

  const pricingCurrent = active === SITE_NAV.pricing.section;
  return (
    <>
      <header className="sticky top-0 z-50 px-3 pt-3 sm:px-5 sm:pt-4">
        <div
          ref={bar}
          className={cn(
            "mx-auto flex h-14 max-w-[1200px] items-center justify-between gap-3 rounded-2xl pr-2 pl-4 transition-[background-color,border-color,box-shadow] duration-300 sm:pl-5",
            scrolled || mobile ? "border border-border bg-background/80 shadow-[0_18px_50px_-30px_rgba(33,26,53,0.45)] backdrop-blur-xl" : "border border-transparent",
          )}
        >
          <Link href="/" aria-label="Selestial home" className={cn("flex shrink-0 items-center rounded-md", focusRing)}>
            <Logo />
          </Link>

          <nav aria-label="Main" className="hidden items-center gap-0.5 lg:flex">
            {SITE_NAV.menus.map((menu) => (
              <Dropdown key={menu.id} menu={menu} open={open === menu.id} current={active !== null && menu.sections.includes(active)} onOpen={() => setOpen(menu.id)} onClose={() => setOpen((now) => (now === menu.id ? null : now))} />
            ))}
            <a href={SITE_NAV.pricing.href} aria-current={pricingCurrent ? "location" : undefined} className={cn("flex h-9 items-center gap-1 rounded-full px-3.5 text-sm font-medium transition-colors", focusRing, pricingCurrent ? "text-strong" : "text-muted-foreground hover:text-strong")}>
              {SITE_NAV.pricing.label}
              {pricingCurrent ? <span aria-hidden className="size-1 rounded-full bg-brand-500" /> : null}
            </a>
          </nav>

          <div className="flex items-center gap-1.5">
            <a href={SITE_NAV.signIn.href} className={cn("hidden h-10 items-center rounded-xl px-3.5 text-sm font-medium text-muted-foreground transition-colors hover:text-strong sm:inline-flex", focusRing)}>
              {SITE_NAV.signIn.label}
            </a>
            <Link href={SITE_NAV.cta.href} data-cta-position="nav" className={cn("icon-gradient hidden h-10 items-center rounded-xl px-4 text-sm font-semibold sm:inline-flex", focusRing)}>
              {SITE_NAV.cta.label}
            </Link>
            <button
              type="button"
              aria-label={mobile ? "Close menu" : "Open menu"}
              aria-expanded={mobile}
              onClick={() => setMobile((value) => !value)}
              className={cn("flex size-10 items-center justify-center rounded-xl text-strong hover:bg-muted lg:hidden", focusRing)}
            >
              {mobile ? <X className="size-5" aria-hidden /> : <Menu className="size-5" aria-hidden />}
            </button>
          </div>
        </div>
      </header>
      <AnimatePresence>{mobile ? <MobileMenu onClose={() => setMobile(false)} /> : null}</AnimatePresence>
    </>
  );
}

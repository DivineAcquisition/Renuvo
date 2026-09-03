import Link from "next/link";
import type { ReactNode } from "react";

import Logo from "@/components/brand/logo";
import { Particles } from "@/components/magicui/particles";
import { ShineBorder } from "@/components/magicui/shine-border";
import { APP_NAME } from "@/lib/constants";

/**
 * Vistrial auth shell on a white canvas: particles, brand wash, and a
 * centered desk with a moving shine edge.
 */
export function AuthCard({
  title,
  subtitle,
  eyebrowLabel,
  footer,
  children,
}: {
  title: string;
  subtitle?: string;
  eyebrowLabel?: string;
  footer?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="auth-stage">
      <div className="auth-stage-atmosphere" aria-hidden>
        <Particles className="absolute inset-0" quantity={56} color="#9A88FC" ease={70} size={0.45} />
        <div className="auth-stage-glow" />
        <div className="auth-stage-glow-aux" />
        <div className="auth-stage-grid" />
      </div>
      <main className="auth-stage-frame">
        <div className="auth-desk-inner animate-rise">
          <ShineBorder
            borderWidth={1}
            duration={14}
            shineColor={["#9A88FC", "#C3B6FE", "#7E67F2"]}
          />
          <Link href="/" aria-label={`${APP_NAME} home`} className="auth-mark-link">
            <Logo markOnly title="" className="auth-mark" />
          </Link>
          {eyebrowLabel ? <p className="auth-eyebrow">{eyebrowLabel}</p> : null}
          <h1 className="auth-title">{title}</h1>
          {subtitle ? <p className="auth-subtitle">{subtitle}</p> : null}
          {children ? <div className="auth-desk-body">{children}</div> : null}
          {footer ? <p className="auth-desk-foot">{footer}</p> : null}
        </div>
      </main>
    </div>
  );
}

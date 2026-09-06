import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Not found" };

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#fbfbfe] px-5 text-center">
      <p className="text-[11px] font-semibold tracking-[0.16em] text-brand-700 uppercase">404</p>
      <h1 className="mt-3 font-heading text-3xl tracking-tight text-ink-950">This page isn’t here.</h1>
      <Link href="/" className="mt-6 text-sm font-medium text-brand-700 hover:underline">
        Back to renuvo.io
      </Link>
    </div>
  );
}

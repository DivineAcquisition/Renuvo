"use server";

import { redirect } from "next/navigation";

import { authCallbackUrl, safeInternalPath } from "@/lib/auth/paths";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

export type AuthState = {
  error: string | null;
  magicSent?: boolean;
};

const UNAVAILABLE =
  "Renuvo’s database isn’t linked yet. Add Supabase keys to .env.local to sign in.";

export async function signInPassword(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  if (!isSupabaseConfigured()) return { error: UNAVAILABLE };

  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = safeInternalPath(String(formData.get("redirectTo") ?? ""));

  if (!email || !password) return { error: "Enter your email and password." };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: humanAuthError(error.message) };

  redirect(next);
}

export async function signUpPassword(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  if (!isSupabaseConfigured()) return { error: UNAVAILABLE };

  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = safeInternalPath(String(formData.get("redirectTo") ?? ""));

  if (!email || !password) return { error: "Enter an email and a password." };
  if (password.length < 8) return { error: "Use at least 8 characters." };

  const supabase = await createClient();
  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: authCallbackUrl(next, origin) },
  });
  if (error) return { error: humanAuthError(error.message) };

  if (data.session) redirect(next);
  return { error: null, magicSent: true };
}

export async function sendMagicLink(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  if (!isSupabaseConfigured()) return { error: UNAVAILABLE };

  const email = String(formData.get("email") ?? "").trim();
  const next = safeInternalPath(String(formData.get("redirectTo") ?? ""));
  if (!email) return { error: "Enter your email." };

  const supabase = await createClient();
  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: authCallbackUrl(next, origin) },
  });
  if (error) return { error: humanAuthError(error.message) };

  return { error: null, magicSent: true };
}

export async function signOut() {
  if (!isSupabaseConfigured()) redirect("/");
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}

function humanAuthError(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes("invalid login")) return "That email or password doesn’t match.";
  if (lower.includes("already registered")) return "That email already has an account. Sign in instead.";
  if (lower.includes("rate")) return "Too many attempts. Wait a moment and try again.";
  return "Something went wrong. Try again.";
}

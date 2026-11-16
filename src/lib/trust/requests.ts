/** What a public request form shows after a submission. Shared by the form and the server action. */
export type RequestState =
  | { status: "idle" }
  | { status: "saved"; reference: string }
  | { status: "invalid"; field: string; message: string; values: Record<string, string> }
  | { status: "limited"; message: string; values: Record<string, string> }
  | { status: "failed"; message: string; values: Record<string, string> };

export type RequestKind = "privacy" | "vulnerability" | "security_review";

/** The form fields each kind sends. Anything else in the form is ignored. */
export const REQUEST_FIELDS: Record<RequestKind, readonly string[]> = {
  privacy: ["subtype", "name", "email", "relationship", "businessName", "details"],
  vulnerability: ["name", "email", "affected", "details", "severityGuess"],
  security_review: ["name", "email", "company", "role", "businessName", "questions", "details"],
};

export type SaveResult = { status: "saved"; reference: string } | { status: "invalid"; field: string; message: string } | { status: "limited" };
export type SaveRequest = ((input: Record<string, string> & { kind: RequestKind; email: string; visitorKey: string }) => Promise<SaveResult>) | null;

/**
 * Turns a submitted form into one saved request. It says "Received" only when the record answered
 * that the request was saved; the person is told when sending is not set up or fails, and keeps what
 * they typed. The hidden "website" field goes through so the record can treat it as a bot.
 */
export async function submitTrustRequest(kind: RequestKind, form: FormData, visitorKey: string, save: SaveRequest): Promise<RequestState> {
  const values: Record<string, string> = {};
  for (const name of REQUEST_FIELDS[kind]) {
    const value = form.get(name);
    if (typeof value === "string" && value.trim()) values[name] = value.trim();
  }
  const website = form.get("website");
  if (!values.email) return { status: "invalid", field: "email", message: "Enter your email address so we can reply.", values };
  if (!save) return { status: "failed", message: `This form is not taking requests right now. Please email us instead.`, values };
  try {
    const result = await save({ ...values, ...(typeof website === "string" && website ? { website } : {}), kind, email: values.email, visitorKey });
    if (result.status === "saved") return result;
    if (result.status === "invalid") return { ...result, values };
    return { status: "limited", message: "Too many requests from here just now. Please try again in an hour, or email us.", values };
  } catch {
    return { status: "failed", message: "We could not save your request. Nothing was sent. Please try again, or email us.", values };
  }
}

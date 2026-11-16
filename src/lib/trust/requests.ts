/** What a public request form shows after a submission. Shared by the form and the server action. */
export type RequestState =
  | { status: "idle" }
  | { status: "saved"; reference: string }
  | { status: "invalid"; field: string; message: string; values: Record<string, string> }
  | { status: "limited"; message: string; values: Record<string, string> }
  | { status: "failed"; message: string; values: Record<string, string> };

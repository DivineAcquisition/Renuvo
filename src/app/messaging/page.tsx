import { DocumentPage, documentMetadata } from "@/components/trust/document-page";

export const metadata = documentMetadata("messaging", "/messaging");
export const revalidate = 300;

export default function Page() {
  return <DocumentPage kind="messaging" />;
}

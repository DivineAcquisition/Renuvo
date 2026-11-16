import { DocumentPage, documentMetadata } from "@/components/trust/document-page";

export const metadata = documentMetadata("privacy", "/privacy");
export const revalidate = 300;

export default function Page() {
  return <DocumentPage kind="privacy" />;
}

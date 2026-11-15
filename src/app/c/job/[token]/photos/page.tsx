import { JobPage } from "@/components/cleaner/job-page";

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <JobPage token={token} view="photos" />;
}

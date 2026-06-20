import { getTenantDirectory } from "@/lib/admin/queries";
import { TenantDirectory } from "./TenantDirectory";

export default async function TenantsPage() {
  const tenants = await getTenantDirectory();
  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl font-bold tracking-tight">Tenants</h1>
      <TenantDirectory tenants={tenants} />
    </div>
  );
}

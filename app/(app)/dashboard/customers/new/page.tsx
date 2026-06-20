import { getActiveOrg } from "@/lib/auth/getActiveOrg";
import { CustomerForm } from "../[id]/CustomerForm";

export default async function NewCustomerPage() {
  const active = await getActiveOrg();
  if (!active) return null;
  return (
    <div className="mx-auto max-w-3xl">
      <CustomerForm />
    </div>
  );
}

import { ServicesLayout } from "@/components/app/services/layout";
import { ServicesGuard } from "@/components/app/services/shared";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <ServicesGuard>
      <ServicesLayout>
        <ServicesGuard>{children}</ServicesGuard>
      </ServicesLayout>
    </ServicesGuard>
  );
}

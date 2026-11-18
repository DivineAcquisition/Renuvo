import type { Metadata } from "next";
import { Suspense } from "react";

import { BookingFormsHome } from "@/components/app/booking/home";

export const metadata: Metadata = { title: "Booking Experiences" };

export default function Page() {
  return (
    <Suspense>
      <BookingFormsHome />
    </Suspense>
  );
}

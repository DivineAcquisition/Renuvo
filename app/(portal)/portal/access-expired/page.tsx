export default function AccessExpired() {
  return (
    <div className="rounded-2xl bg-white p-7 text-center shadow-sm">
      <h1 className="font-display text-xl font-bold">This link has expired</h1>
      <p className="mt-2 text-sm text-[#6b6880]">
        For your security, manage links work once and expire after 30 minutes.
        Reply to your latest text from us, or contact your provider, and we&apos;ll
        send you a fresh link.
      </p>
    </div>
  );
}

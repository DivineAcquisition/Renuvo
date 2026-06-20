"use client";

export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="en">
      <body className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-bold">Renuvo is temporarily unavailable</h2>
          <button
            onClick={reset}
            className="mt-4 rounded-md border px-4 py-2"
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}

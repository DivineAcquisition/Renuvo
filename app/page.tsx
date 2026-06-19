import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 p-8">
      <div className="text-center">
        <h1 className="font-display text-5xl font-bold tracking-tight">
          Renuvo<span className="align-super text-xl">™</span>
        </h1>
        <p className="mt-3 max-w-md text-muted-foreground">
          Turn one-time home service jobs into recurring clients —
          automatically.
        </p>
      </div>

      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Foundation online</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            White theme, shadcn, and Supabase clients are wired. Ready for
            Prompt 2 (tenancy schema).
          </p>
          <Button className="w-full">Primary — #4F38FF</Button>
        </CardContent>
      </Card>
    </main>
  );
}

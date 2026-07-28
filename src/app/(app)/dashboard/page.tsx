import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function DashboardPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Dashboard</h1>
      <Card>
        <CardHeader>
          <CardTitle>Coming online</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-slate-400">
          Account summary, positions, orders, and watchlist panels are being built next.
        </CardContent>
      </Card>
    </div>
  );
}

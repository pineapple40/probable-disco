export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-xl font-semibold text-slate-100">Probable Disco</h1>
          <p className="mt-1 text-sm text-slate-400">Paper-trading platform — simulated markets only</p>
        </div>
        {children}
      </div>
    </main>
  );
}

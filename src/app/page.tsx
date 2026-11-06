const modules = [
  { name: "Hotspot plans", description: "Set connection durations, speeds, and prices." },
  { name: "Customers & sessions", description: "Manage customers and monitor active connections." },
  { name: "Payments & billing", description: "Track payments, invoices, and revenue." },
  { name: "Routers & vouchers", description: "Connect your routers and issue access vouchers." },
];

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-10 sm:px-10 sm:py-16">
      <header className="flex items-center justify-between border-b border-slate-200 pb-6">
        <a href="/" className="text-2xl font-bold tracking-tight">wifex<span className="text-teal-600">.</span></a>
        <span className="rounded-full bg-teal-50 px-3 py-1 text-xs font-medium text-teal-800">Project starter</span>
      </header>
      <section className="py-16 sm:py-24">
        <p className="mb-4 text-sm font-semibold uppercase tracking-widest text-teal-700">Wi-Fi hotspot billing</p>
        <h1 className="max-w-3xl text-4xl font-semibold leading-tight tracking-tight sm:text-6xl">Your network.<br />Your business. Connected.</h1>
        <p className="mt-6 max-w-xl text-lg leading-8 text-slate-600">A new home for managing hotspot access, customers, and payments. Let’s build it together.</p>
      </section>
      <section aria-labelledby="modules-heading">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <h2 id="modules-heading" className="text-xl font-semibold">The foundation</h2>
          <p className="text-sm text-slate-500">Planned modules · ready to build</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {modules.map((module, index) => (
            <article key={module.name} className="rounded-2xl border border-slate-200 bg-white p-6">
              <span className="text-xs font-semibold text-teal-700">0{index + 1}</span>
              <h3 className="mt-4 text-lg font-semibold">{module.name}</h3>
              <p className="mt-2 text-sm leading-6 text-slate-600">{module.description}</p>
            </article>
          ))}
        </div>
        <p className="mt-6 text-sm leading-6 text-slate-500">Setup complete. Billing, authentication, and router integrations will be added as we build.</p>
      </section>
    </main>
  );
}

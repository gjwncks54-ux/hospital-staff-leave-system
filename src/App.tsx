export default function App() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-backdrop px-6 py-10 text-ink">
      <section className="w-full max-w-md rounded-[2rem] border border-white/70 bg-white/90 px-6 py-10 text-center shadow-panel backdrop-blur">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-3xl bg-hero text-xl font-bold text-white shadow-lg shadow-brand-slate/15">
          점검
        </div>
        <h1 className="mt-7 text-3xl font-bold tracking-tight">서버점검중입니다</h1>
        <p className="mt-4 text-base leading-7 text-slate-600">
          서비스 이관 작업을 진행하고 있습니다.
          <br />
          잠시 후 다시 접속해 주세요.
        </p>
      </section>
    </main>
  );
}

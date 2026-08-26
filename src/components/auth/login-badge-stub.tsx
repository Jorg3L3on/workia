type LoginBadgeStubProps = {
  className?: string;
};

const PILLARS = [
  { key: "people", title: "Personas", detail: "Altas, bajas y expediente" },
  { key: "payroll", title: "Nómina", detail: "Ciclos y comprobantes" },
  { key: "talent", title: "Talento", detail: "Desarrollo del equipo" },
] as const;

/** Lower credential stub — HR pillars, not a copied fortnight pulse. */
export const LoginBadgeStub = ({ className }: LoginBadgeStubProps) => {
  return (
    <div className={className}>
      <div className="login-perforation" aria-hidden>
        <span className="login-perforation-hole left-[-8px]" />
        <span className="login-perforation-hole right-[-8px]" />
      </div>
      <div className="px-[30px] max-[400px]:px-[22px]">
        <p className="mb-3 font-mono text-[10.5px] font-medium tracking-[0.09em] text-[color:var(--login-ink-faint)] uppercase">
          Tu credencial de acceso
        </p>
        <ul className="space-y-2.5">
          {PILLARS.map((pillar) => (
            <li
              key={pillar.key}
              className="flex items-baseline justify-between gap-3"
            >
              <span className="text-[13px] font-medium text-[color:var(--login-ink)]">
                {pillar.title}
              </span>
              <span className="text-right text-[12px] text-[color:var(--login-ink-muted)]">
                {pillar.detail}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};

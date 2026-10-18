import {
  CONTRACT_TEMPLATE_TOKENS,
  contractTemplateTokenLabels,
} from "@/lib/contracts/schema";

/** The variables a template can use, with what each one prints (WRK-I5-5). */
export const TemplateTokensHelp = () => (
  <details className="text-muted-foreground text-xs">
    <summary className="cursor-pointer select-none">
      Variables disponibles ({CONTRACT_TEMPLATE_TOKENS.length})
    </summary>
    <dl className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-2">
      {CONTRACT_TEMPLATE_TOKENS.map((token) => (
        <div key={token} className="flex flex-wrap gap-x-2">
          <dt>
            <code className="text-foreground">{`{{${token}}}`}</code>
          </dt>
          <dd>{contractTemplateTokenLabels[token]}</dd>
        </div>
      ))}
    </dl>
  </details>
);

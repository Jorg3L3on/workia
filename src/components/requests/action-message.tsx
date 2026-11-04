/** The error or notice a request form shows after it is sent (W2-06). */
export const ActionMessage = ({
  state,
}: {
  state: { error?: string; notice?: string };
}) =>
  state.error ? (
    <p className="text-destructive text-sm" role="alert">
      {state.error}
    </p>
  ) : state.notice ? (
    <p
      className="text-sm font-medium text-[color:var(--workia-accent-blue)]"
      role="status"
    >
      {state.notice}
    </p>
  ) : null;

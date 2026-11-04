import { sendEmail } from "@/lib/email";

/**
 * «Your receipt is available» (W2-03), in plain words, text first. W2-08
 * notifications can take it over as its «receipt available» template.
 */
const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

export const sendReceiptsAvailableEmail = async ({
  to,
  label,
  origin,
}: {
  to: string;
  label: string;
  origin: string;
}) => {
  const link = new URL("/mi/recibos", origin).toString();
  const lines = [
    `Tu recibo de nómina del periodo ${label} ya está en Workia.`,
    `Ábrelo desde tu teléfono en ${link}. Puedes descargar el PDF y el XML.`,
  ];

  await sendEmail({
    to,
    subject: `Tu recibo de nómina ${label}`,
    text: lines.join("\n\n"),
    html: lines.map((line) => `<p>${escapeHtml(line)}</p>`).join(""),
  });
};

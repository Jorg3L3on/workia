import { sendEmail } from "@/lib/email";

/**
 * The two emails of employee sign-in, in plain words (W2-01). Text first;
 * the HTML is the same text, so it reads the same in any mail app.
 */

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const paragraphs = (lines: string[]) =>
  lines.map((line) => `<p>${escapeHtml(line)}</p>`).join("");

export const signInUrl = (origin: string, email: string, code?: string) => {
  const url = new URL("/mi/entrar", origin);
  url.searchParams.set("correo", email);

  if (code) {
    url.searchParams.set("codigo", code);
  }

  return url.toString();
};

export const sendInvitationEmail = async ({
  to,
  origin,
  purpose = "account",
}: {
  to: string;
  origin: string;
  /** "onboarding": the invitation of a new hire to fill their alta (W2-10). */
  purpose?: "account" | "onboarding";
}) => {
  const link = signInUrl(origin, to);
  const lines =
    purpose === "onboarding"
      ? [
          "Tu nueva empresa te pide completar tus datos de alta en Workia antes de tu primer día: datos personales, domicilio y documentos, desde tu teléfono.",
          `Para entrar, abre ${link} y escribe este correo. Te enviaremos un código de un solo uso. Luego elige «Completa tu alta».`,
          "Si no esperabas este correo, ignóralo.",
        ]
      : [
          "Tu empresa te dio acceso a Workia, donde puedes consultar tu información de empleado desde tu teléfono.",
          `Para entrar, abre ${link} y escribe este correo. Te enviaremos un código de un solo uso.`,
          "Si no esperabas este correo, ignóralo.",
        ];

  await sendEmail({
    to,
    subject:
      purpose === "onboarding"
        ? "Completa tu alta en Workia"
        : "Tu cuenta de Workia",
    text: lines.join("\n\n"),
    html: paragraphs(lines),
  });
};

export const sendLoginCodeEmail = async ({
  to,
  code,
  origin,
}: {
  to: string;
  code: string;
  origin: string;
}) => {
  const lines = [
    `Tu código para entrar a Workia es ${code}.`,
    `Vence en 10 minutos y solo sirve una vez. También puedes abrir ${signInUrl(origin, to, code)}.`,
    "Si no lo pediste, ignora este correo: nadie puede entrar sin el código.",
  ];

  await sendEmail({
    to,
    subject: `${code} es tu código de Workia`,
    text: lines.join("\n\n"),
    html: paragraphs(lines),
  });
};

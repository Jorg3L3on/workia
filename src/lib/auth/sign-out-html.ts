export const SIGN_OUT_NAVIGATION_DELAY_MS = 200;

export const buildSignOutHtml = (
  redirectTo: string,
  origin: string,
): string => {
  const absoluteRedirectUrl = new URL(redirectTo, origin).href;
  const escapedRedirect = absoluteRedirectUrl
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;");

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta http-equiv="Cache-Control" content="no-store">
<meta http-equiv="refresh" content="1;url=${escapedRedirect}">
<title>Cerrando sesión…</title>
</head>
<body>
<p>Cerrando sesión…</p>
<script>setTimeout(function(){window.location.replace(${JSON.stringify(absoluteRedirectUrl)});},${SIGN_OUT_NAVIGATION_DELAY_MS});</script>
</body>
</html>`;
};

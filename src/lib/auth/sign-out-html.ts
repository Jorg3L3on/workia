export const buildSignOutHtml = (redirectTo: string): string => {
  const escapedRedirect = redirectTo
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;");

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta http-equiv="Cache-Control" content="no-store">
<meta http-equiv="refresh" content="0;url=${escapedRedirect}">
<title>Cerrando sesión…</title>
</head>
<body>
<p>Cerrando sesión…</p>
<script>location.replace(${JSON.stringify(redirectTo)});</script>
</body>
</html>`;
};

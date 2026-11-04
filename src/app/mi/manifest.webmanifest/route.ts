/** Web app manifest of the employee app (W2-01): installs on /mi, apart from HR. */
export const GET = () =>
  Response.json(
    {
      id: "/mi",
      name: "Mi Workia",
      short_name: "Mi Workia",
      description: "Tu información de empleado, desde tu teléfono.",
      start_url: "/mi",
      scope: "/mi",
      display: "standalone",
      orientation: "portrait",
      background_color: "#f2f6f7",
      theme_color: "#0b7fa6",
      lang: "es-MX",
      icons: [
        { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
        { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
        {
          src: "/icon-512.png",
          sizes: "512x512",
          type: "image/png",
          purpose: "maskable",
        },
      ],
    },
    { headers: { "content-type": "application/manifest+json" } },
  );

import { defineConfig } from "vite";

export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? "/bch-resi-rate-compare/" : "/",
  plugins: [
    {
      name: "async-built-css",
      transformIndexHtml(html) {
        return html.replace(
          /<link rel="stylesheet" crossorigin href="([^"]+)">/g,
          [
            '<link rel="preload" crossorigin href="$1" as="style" />',
            "<link rel=\"stylesheet\" crossorigin href=\"$1\" media=\"print\" onload=\"this.media='all'\" />",
            '<noscript><link rel="stylesheet" crossorigin href="$1" /></noscript>',
          ].join("\n    "),
        );
      },
    },
  ],
});

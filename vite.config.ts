import { readdirSync } from "node:fs"
import { resolve } from "node:path"
import { defineConfig, loadEnv } from "vite"
import { createLlmProxy } from "./server/llm-proxy.mjs"

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "SPACESHIP_")
  const allowedOrigins = (process.env.SPACESHIP_ALLOWED_ORIGINS ?? env.SPACESHIP_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
  return {
    base: env.SPACESHIP_BASE || "/",
    server: { host: "127.0.0.1" },
    preview: { host: "127.0.0.1" },
    plugins: [
      {
        name: "spaceship-local-model-proxy",
        configureServer(server) {
          server.middlewares.use(createLlmProxy({ allowedOrigins }))
        },
        configurePreviewServer(server) {
          server.middlewares.use(createLlmProxy({ allowedOrigins }))
        },
      },
    ],
    build: {
      rollupOptions: {
        input: {
          main: resolve(import.meta.dirname, "index.html"),
          ...Object.fromEntries(
            readdirSync(resolve(import.meta.dirname, "extra"))
              .filter((file) => file.endsWith(".html"))
              .map((file) => [`extra/${file.slice(0, -".html".length)}`, resolve(import.meta.dirname, "extra", file)]),
          ),
        },
      },
    },
  }
})

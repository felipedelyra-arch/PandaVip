import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Porta fixa: a chave Web de API só autoriza `localhost:5173` e
  // `127.0.0.1:5173`. Sem `strictPort`, o Vite sobe na 5174 quando a 5173 está
  // ocupada e o login local passa a falhar sem dizer por quê. Melhor falhar na
  // cara na hora de subir.
  server: { port: 5173, strictPort: true },
})

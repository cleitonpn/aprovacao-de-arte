import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Caminhos relativos ao próprio index.html, em vez do nome do repositório.
//
// É isto que permite trocar de endereço sem uma janela de site quebrado. Com o
// caminho fixo em "/aprovacao-de-arte/", o build só funciona ali: ligar um
// domínio próprio passa a servir a página na raiz, e todos os arquivos
// respondem 404 até alguém republicar — e republicar antes da hora quebra o
// endereço antigo. Com caminho relativo, um build só serve os dois lugares e a
// migração deixa de ter ordem certa.
//
// Funciona porque a navegação é por hash (#/p/TOKEN): existe UM index.html e
// tudo o que ele carrega está ao lado dele. Com rotas de servidor isto não
// valeria — "/p/TOKEN/" resolveria os relativos a partir de outro nível.
export default defineConfig({
  base: process.env.VITE_BASE || './',
  plugins: [react()],
  build: { chunkSizeWarningLimit: 1200 },
})

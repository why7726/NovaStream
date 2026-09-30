import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    // Noms d'hôte autorisés en développement, séparés par des virgules
    // (ex. NOVA_DEV_HOSTS=nova.mon-domaine.fr). Rien par défaut.
    allowedHosts: (process.env.NOVA_DEV_HOSTS || '').split(',').map((h) => h.trim()).filter(Boolean),
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
  },
  build: {
    /* On n'efface PAS dist à chaque build. Les noms de fichiers contiennent un
       hash : après un déploiement, un téléphone qui a encore l'ancienne page en
       mémoire demande d'anciens fichiers. S'ils ont disparu, l'import échoue et
       l'app affiche « Une erreur est survenue ». En les gardant, la session en
       cours continue de fonctionner jusqu'au prochain rechargement. */
    emptyOutDir: false,
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          ui: ['framer-motion', 'lucide-react'],
          player: ['hls.js']
        }
      }
    }
  }
})

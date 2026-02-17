# Déploiement sur Vercel

## 1. Prérequis

- Compte [Vercel](https://vercel.com)
- Projet sur GitHub / GitLab / Bitbucket

## 2. Variables d'environnement

À configurer dans **Vercel → Project → Settings → Environment Variables** :

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | URL de connexion Neon Postgres |
| `JWT_SECRET` | Secret pour les tokens JWT (générer une chaîne aléatoire) |
| `META_ACCESS_TOKEN` | (optionnel) Token Meta API si pas configuré en BDD |

## 3. Déploiement

### Via Git (recommandé)

1. Importe le projet sur [vercel.com/new](https://vercel.com/new)
2. Root Directory : `reporting-dashboard` (si le projet est dans un sous-dossier)
3. Framework Preset : **Other**
4. Build Command : `npm run build`
5. Output Directory : `dist`
6. Ajoute les variables d'environnement
7. Deploy

### Via CLI

```bash
cd reporting-dashboard
npm install -g vercel
vercel
# Suivre les prompts, ajouter les env vars
```

## 4. CORS

Les domaines Vercel (`*.vercel.app`) sont automatiquement autorisés. Pour un domaine personnalisé, ajoute :

```
FRONTEND_URL=https://ton-domaine.com
```

## 5. Test local

```bash
vercel dev
```

Sert le frontend + l’API sur `http://localhost:3000`.

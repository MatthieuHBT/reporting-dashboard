# Base de données Neon (Postgres)

## 1. Créer un projet Neon

1. Va sur [neon.tech](https://neon.tech) et crée un compte
2. Crée un nouveau projet
3. Copie la **connection string** (Dashboard → Connection details)

## 2. Configurer le projet

Dans `server/.env` :

```
DATABASE_URL=postgresql://user:pass@host/db?sslmode=require
JWT_SECRET=un-secret-long-et-aleatoire-pour-prod
META_ACCESS_TOKEN=ton-token-meta-pour-le-refresh
```

## 3. Exécuter le schéma

Dans Neon SQL Editor, colle et exécute le contenu de `server/db/schema.sql`.

## 4. Créer l'admin

```bash
cd server
npm run db:seed
```

Compte par défaut : **admin@velunapets.com** / **demo123**

## 5. Connexion

- Login avec email + mot de passe → authentification DB
- Le bouton **Refresh from Meta** apparaît et permet de rafraîchir les données depuis l’API Meta vers la base

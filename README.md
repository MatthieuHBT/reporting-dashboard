# Advertising Report Dashboard

Reporting spend by ad account, product, and market. Connects to Meta Marketing API.

## Setup

### 1. Sync des données (obligatoire)

```bash
cd server
npm install
cp .env.example .env
# Ajoute META_ACCESS_TOKEN dans .env
npm run sync
```

### 2. Lancer l'app

**Terminal 1 – API** (port 3003) :
```bash
cd server && npm run dev
```

**Terminal 2 – Frontend** (port 3002) :
```bash
npm install && npm run dev
```

- Frontend : http://localhost:3002
- API : http://localhost:3003 (proxied automatiquement par Vite)

### 3. Meta Access Token

1. Go to [Meta Graph API Explorer](https://developers.facebook.com/tools/explorer/)
2. Select your App (create one at developers.facebook.com if needed)
3. Add permissions: `ads_management`, `ads_read`, `business_management`
4. Generate Access Token
5. Paste it in the Connect page

## Campaign naming

Parsed convention: `CBO_[CODE_COUNTRY]_[PRODUCT NAME]_[ANIMAL]_[TYPE]_[DATE]`

## Scripts

- `npm run dev` - Frontend dev server
- `cd server && npm run dev` - API dev server

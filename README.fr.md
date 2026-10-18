# mcp-french-open-data

Français · [English](README.md)

Un serveur [MCP](https://modelcontextprotocol.io) qui donne aux assistants IA (Claude, Cursor, ChatGPT…) un accès typé, en lecture seule, aux données ouvertes publiques françaises : adresses, entreprises et communes. Toutes les API utilisées sont gratuites et sans clé.

![Démo : un client MCP appelle chaque outil via stdio](docs/demo.gif)

C'est une implémentation de référence, petite mais complète :
- **Outils :** 5 outils en lecture seule, avec entrées validées (zod) et descriptions rédigées pour les modèles.
- **Transports :** stdio, et **Streamable HTTP** sans état, avec authentification par clé d'API.
- **Exploitation :** logs JSON structurés sur stderr, délais d'expiration, erreurs amont lisibles et limitation de débit courtoise par API.
- **Tests :** tests unitaires avec HTTP simulé, tests de protocole avec le client officiel du SDK, et un test de fumée en conditions réelles, désactivé par défaut.

## Outils

| Outil | Rôle | Source |
|---|---|---|
| `search_address` | Géocode une adresse française en texte libre. Renvoie des résultats classés avec code postal, code INSEE, score et coordonnées. | Géocodage IGN Géoplateforme (BAN) |
| `reverse_geocode` | Trouve les adresses les plus proches d'un point lat/lon, avec leur distance en mètres. | Géocodage IGN Géoplateforme (BAN) |
| `search_company` | Recherche des entreprises par nom, adresse, dirigeant ou SIREN/SIRET, avec filtres code postal, département, NAF et entreprises actives. | API Recherche d'entreprises (SIRENE/RNE) |
| `get_company` | Renvoie une entreprise par son SIREN : forme juridique, n° de TVA, siège, dirigeants, chiffre d'affaires et résultat publiés. | API Recherche d'entreprises |
| `list_communes` | Liste des communes par nom, code postal ou département, avec code INSEE, codes postaux et population. | geo.api.gouv.fr |

Tous les outils sont annotés `readOnlyHint: true`. Les erreurs amont reviennent comme erreurs d'outil (`isError: true`) avec un message lisible, jamais sous forme de trace brute.

### API amont et limites

| API | URL de base | Limite publiée | Ce serveur |
|---|---|---|---|
| [Géocodage Géoplateforme](https://www.data.gouv.fr/dataservices/api-geoplateforme-geocodage) | `https://data.geopf.fr/geocodage/` | 50 req/s par IP | ≤ 40 req/s |
| [Recherche d'entreprises](https://recherche-entreprises.api.gouv.fr/docs/) | `https://recherche-entreprises.api.gouv.fr/` | 7 req/s par IP | ≤ 5 req/s |
| [Découpage administratif](https://geo.api.gouv.fr/decoupage-administratif) | `https://geo.api.gouv.fr/` | — | ≤ 20 req/s |

L'API Adresse `api-adresse.data.gouv.fr` a été décommissionnée en janvier 2026 au profit du service de l'IGN (Géoplateforme), que ce serveur utilise. Les limites s'appliquent par processus. Les entités non diffusibles sont exclues par l'API. Les dates de naissance des dirigeants, que l'API renvoie, ne sont pas transmises.

## Installation et lancement

Node.js ≥ 20 requis.

```bash
git clone https://github.com/maelguimet/mcp-french-open-data.git
cd mcp-french-open-data
npm ci
npm run build

# stdio (clients locaux : Claude Desktop, Cursor)
node dist/index.js

# Streamable HTTP sur http://127.0.0.1:3000/mcp
export MCP_API_KEY="$(openssl rand -hex 32)"
npm run start:http
```

Sans client IA : `npm run demo` connecte le client du SDK via stdio et appelle chaque outil. Utilisez `npm run demo -- --http http://127.0.0.1:3000/mcp` pour HTTP ; la clé est lue dans `MCP_API_KEY`. La sortie réelle est dans [docs/demo.md](docs/demo.md).

Avec Docker :

```bash
docker build -t mcp-french-open-data .
docker run --rm -p 3000:3000 -e MCP_API_KEY -e ALLOWED_HOSTS=localhost,127.0.0.1 mcp-french-open-data
```

## Configuration des clients

### Claude Desktop (stdio)

Dans `claude_desktop_config.json` (sous macOS : `~/Library/Application Support/Claude/`, sous Windows : `%APPDATA%\Claude\`) :

```json
{
  "mcpServers": {
    "french-open-data": {
      "command": "node",
      "args": ["/chemin/absolu/vers/mcp-french-open-data/dist/index.js"]
    }
  }
}
```

### Cursor

Dans `~/.cursor/mcp.json` (ou `.cursor/mcp.json` dans un projet), soit en stdio comme ci-dessus, soit en HTTP avec la clé :

```json
{
  "mcpServers": {
    "french-open-data": {
      "url": "http://127.0.0.1:3000/mcp",
      "headers": { "Authorization": "Bearer ${env:MCP_API_KEY}" }
    }
  }
}
```

### ChatGPT

ChatGPT ne se connecte qu'à des serveurs MCP **distants**, via une **URL HTTPS publique** ou le Secure MCP Tunnel d'OpenAI, et pas à un serveur stdio local. Ses paramètres de connexion proposent **OAuth** ou **Aucune authentification**, mais pas d'en-tête de clé d'API personnalisé. Donc :

1. Déployez le serveur HTTP derrière HTTPS (par exemple l'image Docker derrière un reverse proxy), avec `ALLOWED_HOSTS` réglé sur votre domaine.
2. Les données sont publiques et les outils en lecture seule : vous pouvez lancer le serveur avec `MCP_AUTH=none`. C'est un choix explicite ; sans lui, le serveur refuse de démarrer sans clé.
3. Dans ChatGPT : **Plugins → + → Add custom MCP server**, saisissez `https://votre-domaine/mcp`, choisissez **No authentication**, acceptez l'avertissement, puis **Create as a plugin** et installez le plugin.

Pour l'**API Responses** d'OpenAI, utilisez un outil `mcp` avec `server_url`. La valeur `authorization` est envoyée en jeton Bearer, donc la clé d'API devrait y fonctionner. Voir la [doc MCP d'OpenAI](https://developers.openai.com/api/docs/guides/custom-mcp-server). Les intitulés de menus viennent de cette doc (octobre 2026) et peuvent évoluer.

## Variables d'environnement

| Variable | Défaut | Rôle |
|---|---|---|
| `MCP_TRANSPORT` | `stdio` | `stdio` ou `http` (`--http` en ligne de commande fonctionne aussi). |
| `MCP_API_KEY` | — | Obligatoire en HTTP, 16 caractères minimum. Acceptée en `Authorization: Bearer <clé>` ou `x-api-key: <clé>`. |
| `MCP_AUTH` | — | `none` pour servir en HTTP sans clé (choix explicite). |
| `HOST` / `PORT` | `127.0.0.1` / `3000` | Adresse d'écoute HTTP. |
| `ALLOWED_HOSTS` | — | Liste d'en-têtes `Host` autorisés (protection contre le DNS rebinding) en cas d'écoute sur `0.0.0.0`. |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn` ou `error`. Logs JSON sur stderr. |
| `GEOCODING_BASE_URL`, `ENTREPRISES_BASE_URL`, `GEO_BASE_URL` | endpoints publics | Remplacent les API amont (proxy, cache). |

## Sécurité

- **Authentification :** le transport HTTP exige une clé d'API par défaut. Les clés sont comparées en temps constant (empreintes SHA-256 et `crypto.timingSafeEqual`). Une requête sans clé valide reçoit `401` et un en-tête `WWW-Authenticate`. stdio n'a pas besoin de clé : il ne parle qu'au processus qui l'a lancé.
- **Sans état :** chaque requête HTTP reçoit un serveur et un transport neufs ; rien n'est partagé entre clients.
- **Écoute :** par défaut sur `127.0.0.1`, avec la protection contre le DNS rebinding du SDK. Sur `0.0.0.0`, placez-le derrière TLS et réglez `ALLOWED_HOSTS`.
- **Périmètre :** outils en lecture seule sur des données publiques ; aucun identifiant amont n'est stocké ni nécessaire.
- **Validation et logs :** les entrées sont validées avant tout appel réseau. Les logs contiennent l'outil, le statut amont et la latence, jamais la clé.
- Ne versionnez pas `.env` : il est déjà dans `.gitignore`.

## Développement

```bash
npm run lint        # ESLint (typescript-eslint)
npm run typecheck   # tsc sur src, tests et scripts
npm test            # vitest : HTTP simulé + tests de protocole MCP (sans réseau)
npm run test:live   # test de fumée contre les vraies API (LIVE=1)
npm run build       # compilation vers dist/
```

### Taille maximale des fichiers

Chaque fichier reste sous environ 5 000 tokens, soit 20 000 octets. Un hook pre-commit bloque les fichiers indexés plus gros, et la CI refait la même vérification à chaque push et pull request. Pour activer le hook, une fois par clone :

```sh
git config core.hooksPath .githooks
```

`scripts/check-file-size --all` vérifie tout l'arbre. En cas d'échec, découpez le fichier par responsabilité, déplacez les tests dans leur propre fichier, ou extrayez les données et fixtures. Les lockfiles, les fichiers binaires et les chemins marqués `linguist-generated` ou `linguist-vendored` dans `.gitattributes` sont exemptés.

## Licence

[MIT](LICENSE) © 2026 Maël Guimet. Données des services publics français sous Licence Ouverte / Etalab 2.0.

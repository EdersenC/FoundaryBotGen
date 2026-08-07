# Foundry NPCBOT

Foundry NPCBOT is an early GM-facing module for generating reviewable, synthetic NPC profiles with a local Ollama model and creating ordinary D&D Fifth Edition NPC Actors in Foundry Virtual Tabletop.

The workflow starts from the Scene the GM is already using. NPCBOT does **not** add a “New Adventure” layer or replace Foundry's Scene, Region, Actor, or Token tools.

## MVP workflow

1. Open the Scene that should receive the NPCs. Optionally draw a Foundry Region first if the prompt is specific to an existing area.
2. As a full GM, open **NPC Generator** from the Tokens scene controls.
3. Select an existing Region if useful, describe the place and population, and choose a count.
4. Define the output fields the cast needs. Each field has a label and a description for the model; add, rename, or remove fields for the current run.
5. Define the generation controls. Controls can be 0-100 sliders or free-form text boxes, and each has its own label and model guidance.
6. Start generation. The dialog polls the local companion and allows the queued or running job to be cancelled.
7. Review and edit every successfully generated NPC card. Generated text is a draft, not trusted campaign data. If one NPC cannot be repaired, the other validated NPCs remain available and the failed slot is shown explicitly.
8. Approve the reviewed cards to create standard dnd5e NPC Actors.
9. Place the resulting tokens interactively on the current Scene with the canvas cursor. After creation, each Actor in the list also has a **Place This Actor** button for placing that NPC by itself.

Names and token labels are stable core fields required by Foundry. Every narrative field is GM-defined. The included defaults cover social role, appearance, personality, mannerisms, background, synthetic family, connections, and GM notes, but they are starter definitions rather than a fixed schema. Narrative data and the exact definition snapshot are stored in the dnd5e biography and namespaced module flags so later default changes do not reinterpret existing Actors.

## Generation architecture

NPCBOT asks the local model for a coherent cast batch, validates each NPC against the GM's field definitions, then sends only invalid NPCs through one targeted repair. A whole-batch repair is used only when the response cannot be parsed as a cast envelope. Valid NPCs are retained when another slot fails.

Small local models have a field-cell budget of 60 core and custom values per model call. Large requests are split into cast batches automatically while prior validated NPCs remain available as relationship context. This keeps response sizes bounded without reverting to one model call per field.

## Requirements

- Foundry Virtual Tabletop `14.356` or newer; the manifest is verified against `14.365`.
- The D&D Fifth Edition system `5.3.0` minimum; verified against `5.3.3`. Later releases are not yet verified.
- Node.js 20 or newer for the local companion and repository checks.
- [Ollama](https://ollama.com/) running where the GM's browser can reach the companion.
- The official [`qwen3:4b-instruct`](https://ollama.com/library/qwen3%3A4b-instruct) model, or another locally installed instruct model selected through configuration.

## Install directly in Foundry

In **Foundry Setup → Add-on Modules → Install Module**, paste this exact manifest URL:

```text
https://github.com/EdersenC/FoundaryBotGen/releases/latest/download/module.json
```

Do not paste the repository page or a GitHub `/blob/` URL; those return HTML rather than a module manifest. Foundry reads the release manifest, downloads the versioned ZIP named by its `download` field, and installs the module automatically.

The downloadable module contains the Foundry browser integration only. The GM must configure a reachable NPCBOT companion. A friend using your hosted companion does not need to install Ollama or Node.js on their own computer.

## Manual or development installation

This repository does not require a front-end build.

1. Locate the **User Data Path** shown in Foundry's Configuration tab.
2. Copy this repository, or link it during development, to:

   ```text
   <Foundry User Data Path>/Data/modules/foundry-npcbot
   ```

   The installed directory must directly contain `module.json`; avoid an extra nested repository directory.
3. A Linux or macOS development link can be created with:

   ```bash
   ln -s /absolute/path/to/Foundry-NPCBOT "/absolute/path/to/FoundryVTT/Data/modules/foundry-npcbot"
   ```

   On Windows PowerShell, use the actual configured User Data Path:

   ```powershell
   New-Item -ItemType Junction -Path "C:\FoundryVTT\Data\modules\foundry-npcbot" -Target "C:\Projects\Foundry-NPCBOT"
   ```
4. Restart Foundry or return to Setup so packages are rescanned.
5. Open a dnd5e world and enable **Foundry NPCBOT** under **Manage Modules**.

## Prepare Ollama

Install Ollama using its platform instructions. If it is not already running as a desktop service, leave this command running in one terminal:

```bash
ollama serve
```

Then pull the default model from another terminal:

```bash
ollama pull qwen3:4b-instruct
```

Only one `ollama serve` process is needed. Desktop installations may already run it as a service. Confirm the model is present with `ollama list`.

## Start the local companion

Generate a long random pairing token, for example with `openssl rand -hex 32`. Use the same value in the companion environment and the Foundry NPCBOT module setting. Do not place the token in source control, URLs, screenshots, or chat logs.

### Windows PowerShell quick setup

Node.js includes npm, and this repository has no external npm dependencies. From the repository root, copy the safe template and open the private configuration file:

```powershell
Copy-Item .\companion\.env.example .\companion\.env
notepad .\companion\.env
```

Replace `CHANGE_ME` with the pairing token, save the file, and start the companion:

```powershell
npm run companion
```

After the one-time setup, `npm run companion` is the only startup command. The real `companion/.env` file is ignored by Git; `.env.example` contains no credential and is safe to share.

### Linux or macOS quick setup

```bash
cp companion/.env.example companion/.env
${EDITOR:-vi} companion/.env
npm run companion
```

Replace `CHANGE_ME` before starting the companion.

### Process environment alternative

PowerShell or shell environment variables can be used instead of the file and take precedence over matching `.env` entries. Linux or macOS:

```bash
export NPCBOT_PAIRING_TOKEN='paste-a-long-random-token-here'
export NPCBOT_ALLOWED_ORIGINS='http://localhost:30000'
export NPCBOT_HOST='127.0.0.1'
export NPCBOT_PORT='43129'
export NPCBOT_OLLAMA_URL='http://127.0.0.1:11434'
export NPCBOT_OLLAMA_MODEL='qwen3:4b-instruct'
export NPCBOT_REQUEST_TIMEOUT_MS='120000'
npm run companion
```

Windows PowerShell:

```powershell
$env:NPCBOT_PAIRING_TOKEN = 'paste-a-long-random-token-here'
$env:NPCBOT_ALLOWED_ORIGINS = 'http://localhost:30000'
$env:NPCBOT_HOST = '127.0.0.1'
$env:NPCBOT_PORT = '43129'
$env:NPCBOT_OLLAMA_URL = 'http://127.0.0.1:11434'
$env:NPCBOT_OLLAMA_MODEL = 'qwen3:4b-instruct'
$env:NPCBOT_REQUEST_TIMEOUT_MS = '120000'
npm run companion
```

The companion loads only the supported `NPCBOT_...` keys from `companion/.env`. It rejects unknown keys, duplicates, malformed lines, and unterminated quotes instead of silently accepting likely configuration mistakes. Blank lines and lines beginning with `#` are allowed; inline comments and shell expansion are not. The equivalent direct startup command is `npm --prefix companion start`.

With the companion running, an authenticated health check is available at `/v1/health`:

```bash
curl --fail --header "Authorization: Bearer paste-a-long-random-token-here" \
  http://127.0.0.1:43129/v1/health
```

Configure the module under **Game Settings → Configure Settings → Module Settings → Foundry NPCBOT** with:

- Companion endpoint: `http://127.0.0.1:43129`
- Pairing token: the exact value assigned to `NPCBOT_PAIRING_TOKEN`

The generator performs this same health check when it opens. Its connection card reports whether the companion, bearer token, Ollama service, and configured model are ready. Use **Check Again** after changing any local service or setting.

The Foundry module and companion must use the same generation-contract version. Version `0.2.x` reports a clear mismatch when paired with a `0.1.x` companion. Existing `0.1.x` world slider defaults are migrated into editable control definitions when settings are opened or saved, and already-created Actors are not rewritten. Restart both Foundry and the companion after updating between these versions.

## Generation visibility and logs

While a job is running, **Live Activity** shows a sanitized timeline for queueing, cast batches, model requests, compatibility fallback, validation, targeted repair, partial completion, cancellation, and failure. The timeline includes job and request IDs but never includes the generation prompt or bearer token.

The companion writes the same lifecycle events to its terminal with timestamps. Keep that terminal visible during troubleshooting or redirect standard output and error to a local log file:

```bash
npm run companion > /tmp/foundry-npcbot-companion.log 2>&1
```

The companion intentionally does not log prompts, generated biographies, or credentials. A failed job exposes a stable error code, safe message, retry guidance, and recent activity in Foundry.

Some Ollama releases or model runners reject complex JSON Schema grammars with `failed to initialize samplers` or `failed to parse grammar`. NPCBOT detects that specific HTTP 400 response and automatically retries in Ollama's compatible JSON mode. Deterministic contract validation and the single repair attempt remain enabled, so the fallback does not bypass output validation.

### Companion environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `NPCBOT_HOST` | `127.0.0.1` | Interface on which the companion listens. Keep it loopback-only unless remote access has been deliberately secured. |
| `NPCBOT_PORT` | `43129` | Companion HTTP port. |
| `NPCBOT_ALLOWED_ORIGINS` | `http://127.0.0.1:30000,http://localhost:30000` | Comma-separated, exact browser origins allowed by CORS. Set this explicitly for the URL you use. |
| `NPCBOT_PAIRING_TOKEN` | None | Required bearer token of at least 16 characters. Prefer a much longer random value. |
| `NPCBOT_OLLAMA_URL` | `http://127.0.0.1:11434` | Base URL of the Ollama API. |
| `NPCBOT_OLLAMA_MODEL` | `qwen3:4b-instruct` | Installed Ollama model used for NPC generation. |
| `NPCBOT_REQUEST_TIMEOUT_MS` | `120000` | Maximum Ollama request duration in milliseconds. |

The `.env` file and process environment are read when the companion starts. Restart it after changing either source.

## CORS, pairing, and localhost

`NPCBOT_ALLOWED_ORIGINS` is an allowlist, not a list of URLs the companion should call. Each entry must be the exact origin visible to the GM's browser: scheme, hostname, and port, with no path or trailing slash. For example, Foundry opened at `http://192.168.1.40:30000/game` has the origin `http://192.168.1.40:30000`. Wildcard origins are intentionally inappropriate for an authenticated local service.

The companion requires `Authorization: Bearer <pairing-token>` on its API. CORS and the token solve different problems: the allowlist limits which browser origins may make requests, while the token authorizes the request. Keep both protections enabled.

`127.0.0.1` and `localhost` refer to the computer running the **GM's browser**, not necessarily the machine hosting the Foundry server. This allows a remotely hosted Foundry world to use a model on the GM's workstation. Another GM on another computer needs a companion on that computer, or a deliberately secured network deployment.

Binding `NPCBOT_HOST` to `0.0.0.0` exposes the service beyond the local machine. The MVP does not add TLS, user accounts, rate limiting, or an internet-facing security boundary. Use a firewall and an authenticated HTTPS reverse proxy if network exposure is unavoidable. A Foundry page served over HTTPS may also cause the browser to block a plain HTTP companion as mixed content.

## Current limitations

- Generation and creation controls are available only to a full GM and require an active viewed Scene.
- Region selection supplies context and provenance; it does not automatically scatter tokens or manage Region behaviors.
- NPCBOT creates narrative-first dnd5e NPC Actors. It is not an encounter balancer, rules validator, class builder, spell selector, or replacement for a complete statblock editor.
- Family trees are synthetic narrative fields. They do not automatically create every relative as an Actor or assert that a relative exists elsewhere in the world.
- Dynamic narrative fields are placed in the Actor's GM-facing biography and namespaced flags. They are not encrypted; Actor ownership must not be treated as a confidentiality boundary if an Actor is later shared with players.
- The MVP does not generate portraits or token artwork; Actors use configured Foundry/dnd5e defaults unless edited by the GM.
- Generated and reviewed NPC fields reject URLs, Foundry enrichers, inline rolls, and macro syntax; add trusted links manually after Actor creation if needed.
- The companion keeps generation jobs in memory. Restarting it loses queued, running, and unreviewed results.
- There is no campaign-lore ingestion, retrieval system, cloud synchronization, or automatic reading of other installed Foundry packages.
- Small local models can emit repetitions, contradictions, inappropriate text, or invalid drafts. Review and edit output before creating Actors.

## AI and content boundaries

NPCBOT sends the GM's prompt and generation controls to the configured companion, which sends them to the configured Ollama endpoint. With the default loopback URLs, this stays on the GM's machine. Pointing either endpoint at another host sends that material to that host.

Foundry's [AI Content Policy](https://foundryvtt.com/article/ai-policy/) permits runtime NPC generators that produce improvised biographies from unpredictable end-user prompts. It does not permit distributing a pre-generated library of AI biographies or AI token art through an officially listed package. An officially listed release must be categorized as **AI Tools**, and prepared package text, UI, documentation, and promotional assets must follow Foundry's policy.

Only material the user owns or is licensed to use should be placed in prompts or model context. NPCBOT must not scrape or inject text, images, compendia, or other assets from installed packages. Do not use it to reproduce non-SRD D&D settings, named characters, rulebook text, artwork, logos, or statblocks without permission.

The foundryvtt/dnd5e software is MIT licensed. Its SRD 5.1 and 5.2 content is available under CC BY 4.0, while asset licenses vary. Reusing SRD material requires its attribution; this repository's MIT license does not grant rights to D&D product identity or third-party assets. See the dnd5e [license summary](https://github.com/foundryvtt/dnd5e#license).

## Development checks

The root project has no external npm dependencies. With Node.js 20 or newer:

```bash
npm test
npm run validate
npm run check
npm run package
```

`npm run validate` is read-only. It verifies the module and package contracts, checks manifest-referenced files, and runs `node --check` over workspace `.mjs` sources.

`npm run package` creates `dist/foundry-npcbot-v<version>.zip` with `module.json` at the archive root and excludes the companion, tests, repository metadata, and development tools. Pushing a matching `v<version>` tag runs the release workflow and uploads both `module.json` and the ZIP as GitHub release assets.

## License

Foundry NPCBOT source code is available under the [MIT License](LICENSE). Foundry Virtual Tabletop, the D&D Fifth Edition system, Ollama, Qwen, and Dungeons & Dragons are separate projects with their own licenses and trademarks.

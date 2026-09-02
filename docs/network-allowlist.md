# Network allowlist

Outbound hosts MoreOpenWhisperer may contact. For firewall, proxy, and DNS filters.

All connections are client-initiated over TLS. No inbound ports. There is **no** OpenWhispr Cloud API in this fork.

## Auto-update and GitHub

| Host | Protocol | Port | Purpose |
| --- | --- | --- | --- |
| `github.com`, `objects.githubusercontent.com` | HTTPS | 443 | Release artifacts (electron-updater) and sidecar binaries (whisper.cpp, sherpa-onnx, llama.cpp, Qdrant) |

## Antigravity (default cloud path)

Only if you pick Antigravity. Uses **your** `agy` OAuth session. [antigravity.md](antigravity.md).

| Host | Protocol | Port | Purpose |
| --- | --- | --- | --- |
| `oauth2.googleapis.com` | HTTPS | 443 | Token refresh |
| `daily-cloudcode-pa.googleapis.com` | HTTPS | 443 | Default dictation STT and text cleanup |
| `cloudcode-pa.googleapis.com` | HTTPS | 443 | Production Cloud Code fallback |

The `agy` CLI itself may talk to other Google endpoints during `agy auth login`. That is outside this app.

## Local model downloads

Only when you opt into Whisper, Parakeet, Cohere Transcribe, diarization, embeddings, or a local GGUF.

| Host | Protocol | Port | Purpose |
| --- | --- | --- | --- |
| `huggingface.co` | HTTPS | 443 | GGML, Parakeet, GGUF, embedding weights |
| `cdn-lfs.huggingface.co`, `cdn-lfs-us-1.huggingface.co` | HTTPS | 443 | Hugging Face LFS |
| `github.com`, `objects.githubusercontent.com` | HTTPS | 443 | Runtime binaries |

## Google / Microsoft / Apple Calendar

Only if you connect a calendar. Apple Calendar on macOS is local EventKit (no extra hosts).

| Host | Protocol | Port | Purpose |
| --- | --- | --- | --- |
| `accounts.google.com` | HTTPS | 443 | Google OAuth |
| `oauth2.googleapis.com` | HTTPS | 443 | Google token exchange |
| `www.googleapis.com` | HTTPS | 443 | Calendar reads |
| `login.microsoftonline.com` | HTTPS | 443 | Microsoft OAuth |
| `graph.microsoft.com` | HTTPS | 443 | Microsoft Calendar |

Upstream OpenWhispr also used `openwhispr.com` as an OAuth desktop callback. This fork uses a localhost loopback server (`oauthLoopbackFlow.js`). You should not need `openwhispr.com` for calendar.

## URL audio import

Only when you paste a URL in Upload.

| Host | Protocol | Port | Purpose |
| --- | --- | --- | --- |
| `www.youtube.com`, `youtube.com`, `youtu.be`, `m.youtube.com`, `music.youtube.com` | HTTPS | 443 | YouTube metadata (bundled yt-dlp) |
| `*.googlevideo.com` | HTTPS | 443 | YouTube media CDN |
| _User-pasted hosts_ | HTTPS | 443 | Direct audio/video URLs |

Private/internal resolved addresses are rejected.

## BYOK provider hosts

Only for keys you actually saved.

| Host | Protocol | Port | Used when |
| --- | --- | --- | --- |
| `api.openai.com` | HTTPS / WSS | 443 | OpenAI transcription or reasoning |
| `*.cognitiveservices.azure.com`, `*.openai.azure.com`, `*.services.ai.azure.com` | HTTPS | 443 | Azure speech |
| `api.anthropic.com` | HTTPS | 443 | Anthropic |
| `generativelanguage.googleapis.com` | HTTPS | 443 | Gemini API key (not Antigravity) |
| `api.groq.com` | HTTPS | 443 | Groq |
| `atc.tinfoil.sh`, `*.tinfoil.sh` | WSS, HTTPS | 443 | Tinfoil |
| `api.mistral.ai` | HTTPS | 443 | Mistral |
| `openrouter.ai` | HTTPS | 443 | OpenRouter (`/api/v1/models` even without a key) |

## Not contacted

- `api.openwhispr.com`
- `auth.openwhispr.com`
- `mcp.openwhispr.com`

Those are official OpenWhispr Cloud. This build does not sign in there.

## Notes

- Electron honors the system proxy (macOS, Windows, GNOME) and PAC scripts.
- Failures: `ENOTFOUND` is DNS, `ECONNREFUSED` / `ETIMEDOUT` is a firewall, TLS errors usually mean intercepting proxy without a trusted root.
- IPs are not pinned.

```sh
# Antigravity gateway (any HTTP status, including 401, means the path works)
curl -v https://daily-cloudcode-pa.googleapis.com

# Model downloads
curl -v -I https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin
```

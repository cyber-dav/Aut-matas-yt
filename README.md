# Pipeline «Historia oscura y misterios históricos»

Convierte un tema histórico en un vídeo de YouTube de ~12 min listo para subir **a mano**: investigación con fuentes, guion, escenas, voz (ElevenLabs), ilustraciones (fal.ai / Flux), música, montaje (Remotion), miniaturas, metadatos con capítulos reales, 2–3 Shorts y un informe de calidad. El pipeline **no publica** en YouTube.

## Requisitos

- Node.js ≥ 20 y **ffmpeg** (con `ffprobe`) en el PATH.
- Remotion descarga su navegador (Chrome Headless Shell) la primera vez que renderiza. Si tu red no lo permite, indica uno con `REMOTION_BROWSER_EXECUTABLE`.
- **Voz local (por defecto): Kokoro-82M**, el motor de la skill `media-use` de HyperFrames: gratis, sin clave y sin conexión una vez descargado (~350 MB). Necesita Python ≥ 3.10 y `espeak-ng`. Para instalarlo: `npm run setup:voice`.
- Cuentas y claves de API:

| Variable | Para qué | Dónde |
|---|---|---|
| `ANTHROPIC_API_KEY` | Investigación con búsqueda web, guion, escenas, miniaturas (texto), metadatos y selección de Shorts | console.anthropic.com |
| `ELEVENLABS_API_KEY` | Música y efectos (y voz, si eliges `voice.provider: "elevenlabs"`) | elevenlabs.io → Profile → API keys |
| `FAL_KEY` | Ilustraciones (Flux 2) | fal.ai → Dashboard → Keys |

```bash
npm install
cp .env.example .env   # y rellena las claves
npm test               # pruebas unitarias
npm run test:e2e       # producción completa simulada (sin APIs ni coste)
```

## Uso

```bash
# 1) Investigación + guion + escenas. Se detiene para que revises.
npm run new -- "El hombre lobo de Allariz: el asesino que juró transformarse en bestia"

# 2) Revisa y edita episodes/<slug>/01-research.md, 02-script.md y 03-scenes.json.
#    Si cambias el guion:  npm run stage -- <slug> scenes
touch episodes/<slug>/APPROVED

# 3) Producción completa (solo funciona si existe APPROVED)
npm run produce -- <slug>
npm run produce -- <slug> --from render     # reanudar desde una fase

# Rehacer una sola fase o una escena
npm run stage -- <slug> images --scene 14             # otra variante de la imagen 14
npm run stage -- <slug> images --scene 14 --cascade   # … y re-renderiza lo que depende de ella
npm run stage -- <slug> voice --scene 7 --cascade
```

Fases: `research`, `script`, `scenes` · `voice`, `images`, `music`, `mix`, `render`, `thumbnails`, `metadata`, `shorts`, `qa`.

Cada fase es **idempotente**: si su salida existe, se salta (usa `--force` para rehacerla). Si algo falla, vuelve a lanzar el mismo comando y seguirá desde ahí. En imágenes y voz solo se regeneran las escenas que faltan.

## Qué genera cada episodio

```
episodes/<slug>/
  00-brief.json        tema, ángulo, fecha
  01-research.md       hechos documentados / en disputa / leyendas, con URLs
  01-sources.json      URLs citadas y consultadas
  02-script.md         guion narrado (1.650–1.850 palabras, marcas [pausa])
  03-scenes.json       escenas: narración, prompt de imagen, cámara, rótulo, capítulo
  04-audio/            voz por escena, narration.wav, timestamps.json, music.mp3, mix.wav
  05-images/           ilustraciones 2048×1152
  06-render/           video.mp4 (H.264 + AAC, 1080p30), subtitles.srt, timeline.json
  07-thumbnail/        thumb-1..3.jpg (1280×720)
  08-metadata.md       5 títulos, descripción con capítulos reales y fuentes, etiquetas, hashtags
  09-shorts/           short-1..3.mp4 (1080×1920, 40–58 s)
  APPROVED             lo creas tú
  cost.json            coste estimado por fase
  QA.md                informe de calidad
```

Se versionan en git los textos (brief, investigación, guion, escenas, metadatos, QA, costes). El audio, las imágenes y los vídeos no se suben (ver `.gitignore`).

## Cómo funciona (resumen técnico)

- **Investigación / guion / escenas**: API de Claude (`claude-opus-5-5`, pensamiento adaptativo) con búsqueda web en servidor. Las escenas salen como JSON validado con Zod. El guion se reintenta si no cae en el rango de palabras.
- **Voz**: dos proveedores con la misma interfaz (`voice.provider`):
  - `kokoro` (por defecto): local y gratis, voces en español `em_alex`, `em_santa` y `ef_dora`. Como Kokoro no da timestamps, se sintetiza frase a frase (los límites de frase son exactos) y las palabras se reparten dentro de la zona con voz de cada frase.
  - `elevenlabs`: más natural, con `convertWithTimestamps` por escena.

  Con cualquiera de los dos: Las `[pausa]` se convierten en silencios reales (`voice.pauseSeconds`) y se envían `previous_text`/`next_text` para que la entonación sea continua. A partir de los timestamps por carácter se calculan las palabras, los subtítulos y la duración real de cada escena. Al terminar avisa si el vídeo no cae entre 11:00 y 13:00 y propone cuántas palabras recortar o añadir.
- **Imágenes**: interfaz `ImageProvider` (`src/providers/image/`). fal.ai es el proveedor por defecto; para cambiarlo, añade una clase y cámbialo en `config/channel.json`. La biblia de estilo y las prohibiciones se añaden a todos los prompts. Hay concurrencia limitada y reintentos.
- **Música**: ElevenLabs Music (instrumental, 5 min) en bucle con fundido cruzado. Si falla, usa una pista de `assets/music/`.
- **Mezcla** (ffmpeg): la voz se normaliza en dos pasadas. La música baja **20 dB respecto a la voz** mientras se narra, con una envolvente calculada a partir de los tiempos reales, y suena más en la intro y la outro. El resultado final queda a **−14 LUFS**, con pico real ≤ −1,5 dBTP.
- **Montaje** (Remotion, `remotion/`): Ken Burns según `camera`, fundidos de 0,5 s, subtítulos quemados de 2 líneas como máximo, rótulos de fecha/lugar, intro de 3 s y outro de 10 s con huecos para las tarjetas finales. Para previsualizar: `npm run studio`.
- **QA**: duración, formato, nivel de audio, escenas sin imagen o audio, desfase voz/subtítulos, nombres y cifras del guion que no aparecen en la investigación, miniaturas, Shorts y coste total. Si algo falla, `produce` termina con error.

## Configuración (`config/channel.json`)

Nombre del canal, voz (`voiceId`, modelo, estabilidad, velocidad), biblia de estilo visual, prompt base de la música, duración objetivo, rango de palabras, tipografías y colores (en `remotion/components/Text.tsx`) y precios para la estimación de costes.

> ⚠ El nombre del canal («Crónicas Oscuras») es **provisional**. Voz: Kokoro `em_alex` a velocidad 0,95 (alternativas: `em_santa`, `ef_dora`). Si pasas a ElevenLabs, elige una voz nativa de España y pon su `voiceId`.

**Música y monetización**: `music.commercialUseConfirmed` está en `false`. Antes de monetizar, comprueba en las condiciones de ElevenLabs que tu plan permite el uso comercial de la música generada y cámbialo a `true`. Mientras siga en `false`, el pipeline te avisa en cada episodio.

## Costes aproximados por episodio (USD)

| Concepto | Estimación |
|---|---|
| Claude: investigación (≈25 búsquedas) + guion + escenas + metadatos/Shorts/miniaturas | 2 – 4 |
| Voz: Kokoro local (por defecto) | 0 |
| Voz con ElevenLabs (≈11.000 caracteres), si la eliges | 1,5 – 3 (o créditos de tu suscripción) |
| ElevenLabs música (5 min) | 2 – 4 (según plan) |
| fal.ai Flux 2 (≈45–55 ilustraciones + 3 fondos de miniatura) | 1,5 – 2,5 |
| **Total** | **≈ 5 – 10** con Kokoro (≈ 7 – 13 con voz de ElevenLabs) |

Las cifras reales de cada episodio quedan en `cost.json` y en `QA.md`. Los precios de referencia están en `config/channel.json → pricing`; actualízalos con los de tu plan.

## Tiempos

En una máquina de 4 núcleos sin GPU, el render de 12 min tarda unos 16 min (~23 fps). Puedes ajustar los hilos con `REMOTION_CONCURRENCY`.

## Antes de subir a YouTube

- Revisa `QA.md` y `08-metadata.md`.
- Marca «Contenido alterado o sintético» en YouTube Studio si corresponde.
- Sube `subtitles.srt`.
- Añade las tarjetas finales.

## Skills de Claude Code instaladas (`.claude/skills/`)

`media-use` (de heygen-com/hyperframes; su motor Kokoro es el que usa la voz local), `text-to-speech`, `speech-to-text`, `music` y `sound-effects` (de elevenlabs/skills), y `fal-models-catalog`, `fal-prompting` y `fal-media` (de fal-ai-community/skills). La skill `fal-generate` que pedía el encargo no existe en ese repositorio. Son solo instrucciones en Markdown, sin scripts. Las versiones están fijadas en `skills-lock.json`.

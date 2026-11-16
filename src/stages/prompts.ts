import type { ChannelConfig } from "../core/config.js";

/** Instrucciones de sistema compartidas: identidad del canal y reglas editoriales. */
export function channelSystem(cfg: ChannelConfig): string {
  const c = cfg.channel;
  return `Trabajas para «${c.name}», un canal de YouTube de historia oscura y misterios históricos en español de España (${c.language}).
Público: ${c.audience}. Tono: ${c.tone}.

Principios editoriales (obligatorios):
- Rigor: distingue siempre entre hechos documentados, versiones en disputa y leyendas sin base. Nunca presentes como hecho algo no verificado.
- Valor propio: cada vídeo aporta investigación propia y, cuando aplica, un ángulo «mito frente a realidad». Nada de relleno genérico.
- Apto para anunciantes: sin descripciones gráficas de violencia, tortura, sangre o cadáveres; se insinúa, no se detalla. Sin lenguaje malsonante. Respeto hacia las víctimas reales.
- Español de España natural y cuidado (vosotros, léxico peninsular), sin anglicismos innecesarios.`;
}

export function researchPrompt(cfg: ChannelConfig, topic: string, angle?: string): string {
  return `Investiga a fondo este tema para un documental de unos ${cfg.target.minutes} minutos:

TEMA: ${topic}${angle ? `\nÁNGULO SUGERIDO: ${angle}` : ""}

Busca en fuentes fiables: artículos académicos, archivos y hemerotecas (BNE, PARES, Hemeroteca Digital), museos, universidades, prensa de referencia y libros publicados. Usa Wikipedia solo como punto de partida y contrasta lo que diga. Prioriza fuentes en español cuando existan, pero usa también las de otros idiomas si son mejores.

Devuelve SOLO un documento Markdown con exactamente esta estructura:

# Investigación: <título del tema>

## Resumen
3–5 frases con lo esencial y la pregunta central del episodio.

## Cronología
Lista con fechas (formato «AAAA-MM-DD» o el más preciso posible) → hecho → [fuente](URL).

## Personajes clave
- **Nombre** (fechas): papel en la historia. [fuente](URL)

## Lugares
- **Lugar**: por qué importa. [fuente](URL)

## Hechos documentados
- Cada hecho en una línea, con al menos una fuente: [fuente](URL)

## Versiones en disputa
- Qué se discute, quién sostiene cada versión, con fuentes.

## Leyendas sin base
- Qué se cuenta, de dónde viene y por qué no se sostiene, con fuentes.

## Datos sorprendentes para el gancho
3–5 datos verificados y llamativos, cada uno con su fuente.

## No verificado
- Datos que circulan pero que NO has podido verificar. Márcalos aquí; no se usarán como hechos.

## Ángulo propuesto
Un párrafo: qué aporta este episodio que no tengan otros vídeos (p. ej. «mito vs. realidad»).

## Fuentes
Lista numerada de todas las URLs usadas: título — URL

Reglas: cada dato con su URL real (de tus búsquedas). No inventes URLs ni citas. Si dos fuentes se contradicen, dilo.`;
}

export function scriptPrompt(cfg: ChannelConfig, topic: string, research: string): string {
  const t = cfg.target;
  return `Escribe el guion narrado del episodio «${topic}» a partir EXCLUSIVAMENTE de esta investigación:

<investigacion>
${research}
</investigacion>

Requisitos:
- Extensión: entre ${t.wordsMin} y ${t.wordsMax} palabras de narración (≈ ${t.minutes} minutos de voz).
- Estructura y encabezados Markdown exactos:
  ## Gancho
  (0:00–0:30) Empieza en el momento más intrigante y plantea la pregunta central. Sin saludos, sin «en este vídeo», sin presentarte.
  ## Contexto
  (≈1:30) Época, lugar y personajes.
  ## Acto 1
  ## Acto 2
  ## Acto 3
  (desarrollo; un mini-cliffhanger o giro cada ~2 minutos para mantener la retención)
  ## Mito frente a realidad
  Qué sabemos, qué no y por qué. Usa las secciones de hechos, disputas y leyendas de la investigación.
  ## Cierre
  (≈30 s) Reflexión final + una pregunta abierta para los comentarios + invitación a suscribirse en una sola frase.
- Escrito para escucharse: frases cortas, ritmo oral, transiciones claras.
- Números, fechas y siglos escritos como se pronuncian («mil ochocientos cincuenta y dos», «el siglo diecinueve»).
- Marca las pausas dramáticas con [pausa] (con moderación: 8–15 en todo el guion).
- Usa solo hechos de «Hechos documentados» como hechos. Lo disputado preséntalo como disputado; las leyendas, como leyendas. Nada de «No verificado» como hecho.
- Apto para anunciantes: insinúa la violencia, no la describas.
- Devuelve SOLO el guion en Markdown, empezando por «# <título del episodio>». Sin notas, sin acotaciones de cámara, sin listas.`;
}

export function scenesPrompt(cfg: ChannelConfig, script: string): string {
  const t = cfg.target;
  return `Divide este guion en escenas para un vídeo ilustrado de YouTube (ilustraciones fijas con movimiento de cámara).

<guion>
${script}
</guion>

Reglas:
- Cada escena dura ${t.sceneSecondsMin}–${t.sceneSecondsMax} s de voz (≈ 20–40 palabras; a ~150 palabras/minuto). Total esperado: 50–80 escenas.
- \`narration\`: texto EXACTO del guion, en orden, sin omitir ni añadir palabras, conservando las marcas [pausa]. La concatenación de todas las narraciones debe reproducir el guion completo (sin los encabezados Markdown).
- \`chapter\`: el capítulo al que pertenece. Define 5–7 capítulos con títulos atractivos y cortos (≤ 40 caracteres) para la descripción de YouTube; el primero empieza en la escena 1.
- \`imagePrompt\`: EN INGLÉS, describe solo la escena visual concreta (sujeto, acción, lugar, época, encuadre, luz). No incluyas el estilo artístico (se añade luego). Personas históricas siempre como ilustración, nunca fotorrealistas. Prohibido: gore, sangre, cadáveres, desnudos, texto o letras en la imagen. Para violencia, usa sombras, siluetas, objetos simbólicos o fuera de plano.
- \`reuseImageOf\`: si una escena puede reutilizar la imagen de la escena INMEDIATAMENTE anterior (mismo plano, otro movimiento de cámara), pon su id; si no, null. Úsalo en ~20–30 % de escenas para ahorrar, nunca más de 2 escenas seguidas con la misma imagen.
- \`camera\`: zoom-in, zoom-out, pan-left o pan-right; varía para que no se repita el mismo en escenas seguidas. Cuando reutilices imagen, usa un movimiento distinto al de la escena original.
- \`onScreenText\`: opcional, rótulo breve (≤ 40 caracteres) con fecha, lugar o nombre cuando se mencionen por primera vez, p. ej. «Allariz (Ourense), 1852». null si no aplica.
- \`sfx\`: opcional y muy escaso (máximo ${cfg.sfx.maxPerEpisode} en todo el vídeo): un efecto de ambiente sutil en inglés (p. ej. «distant church bells, light wind»). null en el resto.
- \`estSeconds\`: estimación de duración de la escena.
- ids consecutivos desde 1.`;
}

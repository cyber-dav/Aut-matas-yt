import { spawn } from "node:child_process";

/** Ejecuta ffmpeg/ffprobe y devuelve stdout+stderr. Lanza error si el código de salida no es 0. */
export function run(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    p.stdout.on("data", (d) => (stdout += d));
    p.stderr.on("data", (d) => (stderr += d));
    p.on("error", reject);
    p.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${cmd} salió con código ${code}\n${stderr.slice(-2000)}`));
    });
  });
}

export const ffmpeg = (args: string[]) => run("ffmpeg", ["-hide_banner", "-y", "-loglevel", "error", ...args]);

export async function durationOf(file: string): Promise<number> {
  const { stdout } = await run("ffprobe", [
    "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file,
  ]);
  return parseFloat(stdout.trim());
}

export async function hasStream(file: string, kind: "a" | "v"): Promise<boolean> {
  const { stdout } = await run("ffprobe", ["-v", "error", "-select_streams", kind, "-show_entries", "stream=index", "-of", "csv=p=0", file]);
  return stdout.trim().length > 0;
}

export interface Loudness {
  integrated: number;
  truePeak: number;
  lra: number;
  threshold: number;
}

/** Mide la sonoridad (EBU R128) con el filtro loudnorm en modo análisis. */
export async function measureLoudness(file: string, filterPrefix = ""): Promise<Loudness> {
  const { stderr } = await run("ffmpeg", [
    "-hide_banner", "-nostats", "-i", file,
    "-af", `${filterPrefix}loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json`,
    "-f", "null", "-",
  ]);
  const json = stderr.slice(stderr.lastIndexOf("{"), stderr.lastIndexOf("}") + 1);
  const d = JSON.parse(json);
  return {
    integrated: parseFloat(d.input_i),
    truePeak: parseFloat(d.input_tp),
    lra: parseFloat(d.input_lra),
    threshold: parseFloat(d.input_thresh),
  };
}

/** Filtro loudnorm de dos pasadas (más preciso que una sola). */
export async function loudnormFilter(file: string, target: number, tp = -1.5): Promise<string> {
  const m = await measureLoudness(file);
  return `loudnorm=I=${target}:TP=${tp}:LRA=11:measured_I=${m.integrated}:measured_TP=${m.truePeak}:measured_LRA=${m.lra}:measured_thresh=${m.threshold}:linear=true`;
}

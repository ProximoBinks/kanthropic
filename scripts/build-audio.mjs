#!/usr/bin/env node
/**
 * Pre-record every phrase with Google Cloud Text-to-Speech, so all apps play
 * the same natural voice offline instead of the device's robotic TTS.
 *
 *   node scripts/build-audio.mjs --project <gcp project> [--voices Iapetus,Orus,…] [--recheck]
 *
 * Every new clip is checked for silence (needs ffmpeg) and re-asked with
 * different punctuation if TTS returned nothing; --recheck also scans the
 * clips already on disk.
 *
 * Several voices are recorded so the apps can mix speakers: hearing a phrase
 * from different people trains the ear better than one voice's quirks.
 *
 * Auth comes from `gcloud auth print-access-token`. Clips are named by a hash
 * of voice + text, so re-running only synthesizes new or changed phrases, and
 * adding a voice only records that voice. Writes:
 *   web/public/audio/<hash>.mp3        (served by the PWA, bundled into the Mac app)
 *   src/data/phrase-audio.mjs          (phrase id → voice → clip)
 */
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import PHRASEBOOK from "../src/data/phrases.mjs";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const project = arg("project", process.env.GOOGLE_CLOUD_PROJECT);
const voices = arg("voices", "Iapetus,Orus,Rasalgethi,Sadaltager").split(",")
  .map((v) => (v.includes("-") ? v : `ja-JP-Chirp3-HD-${v.trim()}`));
if (!project) { console.error("usage: build-audio.mjs --project <gcp project> [--voices Iapetus,Orus,…]"); process.exit(1); }

const OUT = new URL("../web/public/audio/", import.meta.url);
mkdirSync(OUT, { recursive: true });
const token = execFileSync("gcloud", ["auth", "print-access-token"], { encoding: "utf8" }).trim();

/**
 * Chirp 3 HD sometimes returns a third of a second of near-silence for a
 * very short input (はい, 千), and which voices do it changes with the
 * punctuation. So every clip is checked (see loud()), and when it comes back
 * silent the phrase is re-asked with these endings until one speaks. The
 * winning text is kept here per voice, so reruns ask for the same thing.
 */
const RETRY_ENDINGS = ["！", "、", "。", "…"];
/**
 * Text sent to TTS for a phrase in one voice. A lone kanji word has no
 * context to pick its reading from, and TTS guesses wrong (八 as や, 魚 as
 * うお, 三 as み), so one-word cards are read from their kana; sentences keep
 * their kanji, which TTS reads (and accents) better. A respelling recorded
 * after a silent clip (audio-overrides.mjs) wins over both.
 */
import SPOKEN from "./audio-overrides.mjs";
const KANJI = /[\u3400-\u9fff]/;
const spokenText = (voice, p) => overrides[`${short(voice)}|${p.ja}`] ?? (p.tiles.length === 1 && KANJI.test(p.ja) ? p.kana : p.ja);
const clipFor = (voice, p) => createHash("sha1").update(`${voice}|${spokenText(voice, p)}`).digest("hex").slice(0, 16) + ".mp3";
/** Short name the apps show: ja-JP-Chirp3-HD-Kore → Kore. */
function short(voice) { return voice.split("-").at(-1); }

/** Peak level of an MP3 in dB (ffmpeg), or null when ffmpeg isn't installed. */
function peakDb(buf) {
  const f = join(tmpdir(), `kanthropic-clip-${process.pid}-${Math.random().toString(36).slice(2)}.mp3`);
  writeFileSync(f, buf);
  try {
    const r = spawnSync("ffmpeg", ["-hide_banner", "-i", f, "-af", "volumedetect", "-f", "null", "-"], { encoding: "utf8" });
    if (r.error) return null;
    const m = /max_volume: (-?[\d.]+) dB/.exec(r.stderr);
    return m ? Number(m[1]) : null;
  } finally { rmSync(f, { force: true }); }
}
/** Speech peaks near 0 dB; a silent clip from TTS peaks around -35 dB. */
const SILENT_DB = -25;
const loud = (buf) => { const db = peakDb(buf); return db == null || db > SILENT_DB; };
const overrides = { ...SPOKEN };

async function synthesize(voice, text) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch("https://texttospeech.googleapis.com/v1/text:synthesize", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "x-goog-user-project": project, "content-type": "application/json" },
      body: JSON.stringify({
        input: { text },
        voice: { languageCode: "ja-JP", name: voice },
        audioConfig: { audioEncoding: "MP3" },
      }),
    });
    const body = await res.json();
    if (res.ok) return Buffer.from(body.audioContent, "base64");
    // Chirp 3 HD has a low per-minute quota: wait it out rather than fail.
    if ((res.status === 429 || res.status >= 500) && attempt < 10) { await new Promise((r) => setTimeout(r, Math.min(60_000, 2000 * 2 ** attempt))); continue; }
    throw new Error(`${res.status} ${body?.error?.message ?? ""} (${text})`);
  }
}

const files = {};
const todo = [];
for (const p of PHRASEBOOK.phrases) {
  files[p.id] = {};
  for (const voice of voices) {
    const file = clipFor(voice, p);
    files[p.id][short(voice)] = file;
    if (!existsSync(new URL(file, OUT))) todo.push({ p, voice, file });
    // --recheck: re-record any existing clip that turns out to be silent.
    else if (process.argv.includes("--recheck") && !loud(readFileSync(new URL(file, OUT)))) {
      console.log(`  ${short(voice)} ${p.id}: existing clip is silent, re-recording`);
      rmSync(new URL(file, OUT));
      todo.push({ p, voice, file });
    }
  }
}

let done = 0;
const worker = async () => {
  for (let job; (job = todo.shift());) {
    const base = spokenText(job.voice, job.p);
    let text = base, audio = await synthesize(job.voice, text);
    for (const end of RETRY_ENDINGS) {
      if (loud(audio)) break;
      text = base.replace(/[。、！？!?…]+$/, "") + end;
      console.log(`  ${short(job.voice)} ${job.p.id} ${base}: silent, retrying as ${text}`);
      audio = await synthesize(job.voice, text);
    }
    if (!loud(audio)) throw new Error(`${short(job.voice)} ${job.p.id} ${base}: every retry came back silent`);
    if (text !== base) {
      // Recorded under a respelling: name the clip after it, and remember it.
      overrides[`${short(job.voice)}|${job.p.ja}`] = text;
      job.file = clipFor(job.voice, job.p);
      files[job.p.id][short(job.voice)] = job.file;
    }
    writeFileSync(new URL(job.file, OUT), audio);
    if (++done % 200 === 0) console.log(`  ${done}/${total} clips…`);
  }
};
const total = todo.length;
await Promise.all(Array.from({ length: 3 }, worker));

writeFileSync(new URL("./audio-overrides.mjs", import.meta.url),
  "// Generated by scripts/build-audio.mjs — what TTS is asked to say when the plain\n"
  + "// Japanese came back silent in that voice (\"Voice|ja\" → text). Safe to hand-edit.\n"
  + `export default ${JSON.stringify(Object.fromEntries(Object.entries(overrides).sort()), null, 1)};\n`);

// Clips no phrase points at any more (old voice, edited phrase).
const keep = new Set(Object.values(files).flatMap((byVoice) => Object.values(byVoice)));
let removed = 0;
for (const f of readdirSync(OUT)) if (f.endsWith(".mp3") && !keep.has(f)) { rmSync(new URL(f, OUT)); removed++; }

writeFileSync(new URL("../src/data/phrase-audio.mjs", import.meta.url),
  "// Generated by scripts/build-audio.mjs — do not edit by hand.\n"
  + "// Google Cloud Text-to-Speech (Chirp 3 HD). Clips live in web/public/audio/.\n"
  + `export default ${JSON.stringify({ voices: voices.map(short), files }, null, 1)};\n`);
console.log(`${total} synthesized, ${keep.size - total} already there, ${removed} stale removed (${voices.map(short).join(", ")})`);

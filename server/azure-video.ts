// ============================================================================
// Pro hero-video generation via Azure Sora 2 (sora-2-1208 on the foundry
// resource). Uses the new /openai/v1/videos surface (the old
// /video/generations/jobs path is deprecated). Jobs are async (~45-60s for a
// short 720p clip, ~3-4MB mp4), so the client starts a job, polls status, and
// the finished mp4 is stored in Postgres + served from /api/video/:id.
// Best-effort: failures surface as a status the client can show.
// ============================================================================
const ENDPOINT = process.env.AZURE_CORE_ENDPOINT ?? "";
const API_KEY = process.env.AZURE_CORE_API_KEY ?? "";
const MODEL = process.env.AI_WEBBUILDER_VIDEO_MODEL ?? "sora-2-1208";
const API_VERSION = process.env.AZURE_VIDEO_API_VERSION ?? "preview";

export function videoEnabled(): boolean {
  return !!(ENDPOINT && API_KEY);
}

const base = () => `${ENDPOINT.replace(/\/$/, "")}/openai/v1/videos`;
const auth = () => ({ "api-key": API_KEY });

export interface VideoStatus {
  id: string;
  status: "queued" | "in_progress" | "completed" | "failed" | string;
  progress?: number;
  error?: string;
}

/** Start a Sora video render. Returns the video id, or null on failure. */
export async function startVideo(
  prompt: string,
  opts: { seconds?: string; size?: string; fetchImpl?: typeof fetch } = {},
): Promise<string | null> {
  if (!videoEnabled() || !prompt.trim()) return null;
  const fetchImpl = opts.fetchImpl ?? fetch;
  try {
    const res = await fetchImpl(`${base()}?api-version=${API_VERSION}`, {
      method: "POST",
      headers: { ...auth(), "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        prompt: `${prompt}. Cinematic, smooth slow camera motion, no on-screen text or logos.`,
        seconds: opts.seconds ?? "4",
        size: opts.size ?? "1280x720",
      }),
    });
    if (!res.ok) return null;
    return (await res.json())?.id ?? null;
  } catch {
    return null;
  }
}

/** Poll a video job's status. */
export async function getVideoStatus(id: string, fetchImpl: typeof fetch = fetch): Promise<VideoStatus | null> {
  if (!videoEnabled() || !id) return null;
  try {
    const res = await fetchImpl(`${base()}/${id}?api-version=${API_VERSION}`, { headers: auth() });
    if (!res.ok) return null;
    const d = await res.json();
    return { id, status: d.status, progress: d.progress, error: d.error?.message };
  } catch {
    return null;
  }
}

/** Download the finished mp4 bytes for a completed video. */
export async function downloadVideo(id: string, fetchImpl: typeof fetch = fetch): Promise<Buffer | null> {
  if (!videoEnabled() || !id) return null;
  try {
    const res = await fetchImpl(`${base()}/${id}/content?api-version=${API_VERSION}`, { headers: auth() });
    if (!res.ok) return null;
    const ab = await res.arrayBuffer();
    return Buffer.from(ab);
  } catch {
    return null;
  }
}

export type TurnDetectionConfig = {
  mode: "server_vad" | "semantic_vad" | "off";
  threshold: number;
  prefixPaddingMs: number;
  silenceDurationMs: number;
  eagerness?: "low" | "medium" | "high" | "auto" | null;
  createResponse: boolean;
  interruptResponse: boolean;
};

export type RealtimeSessionCreateRequest = {
  connectionMode: "ephemeral" | "server_sdp";
  userId?: string | null;
  model?: string | null;
  voice?: string | null;
  systemMessage?: string | null;
  extraContext?: string | null;
  outputModalities: Array<"audio" | "text">;
  reasoningEffort: "low" | "medium" | "high";
  turnDetection: TurnDetectionConfig;
  enableTools: boolean;
  toolNames?: string[] | null;
  autoGreeting: boolean;
  truncationRetentionRatio?: number | null;
  tokenLimitPostInstructions?: number | null;
  iceServersOverride?: RTCIceServer[] | null;
};

export type RealtimeSessionCreateResponse = {
  sessionId: string;
  providerMode: string;
  connectionMode: "ephemeral" | "server_sdp";
  model: string;
  voice: string;
  clientSecret: string | null;
  expiresAt: number | null;
  realtimeCallUrl: string;
  serverOfferPath: string | null;
  iceServers: RTCIceServer[];
  sessionConfig: Record<string, unknown>;
  autoGreetingEvent: Record<string, unknown> | null;
};

export type ToolExecutionResponse = {
  callId: string | null;
  toolName: string;
  output: string;
};

const API_BASE = (import.meta.env.VITE_VOICE_MODULE_API_BASE || "http://127.0.0.1:8787").replace(/\/$/, "");

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {})
    }
  });
  if (!response.ok) {
    let detail = await response.text();
    try {
      const parsed = JSON.parse(detail) as { detail?: unknown };
      if (typeof parsed.detail === "string") detail = parsed.detail;
    } catch {
      // Preserve raw response text.
    }
    throw new Error(detail || `Request failed with status ${response.status}`);
  }
  return (await response.json()) as T;
}

export async function loadRealtimeConfig(): Promise<{
  providerMode: string;
  realtimeModel: string;
  realtimeVoice: string;
  transcriptionModel: string;
  iceServers: RTCIceServer[];
}> {
  return requestJson("/api/realtime/config");
}

export async function createRealtimeSession(payload: RealtimeSessionCreateRequest): Promise<RealtimeSessionCreateResponse> {
  return requestJson("/api/realtime/sessions", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function createServerSdpAnswer(sessionId: string, sdpOffer: string): Promise<{ sessionId: string; sdpAnswer: string }> {
  return requestJson(`/api/realtime/sessions/${sessionId}/webrtc/offer`, {
    method: "POST",
    body: JSON.stringify({ sdpOffer })
  });
}

export async function executeToolCall(payload: {
  callId?: string | null;
  toolName: string;
  argumentsJson: string;
}): Promise<ToolExecutionResponse> {
  return requestJson("/api/tools/execute", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function postSdpOfferToRealtime(callUrl: string, clientSecret: string, sdpOffer: string): Promise<string> {
  const response = await fetch(callUrl, {
    method: "POST",
    body: sdpOffer,
    headers: {
      Authorization: `Bearer ${clientSecret}`,
      "Content-Type": "application/sdp"
    }
  });
  if (!response.ok) {
    throw new Error(`Realtime SDP exchange failed with status ${response.status}: ${await response.text()}`);
  }
  return response.text();
}

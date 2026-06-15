import {
  createRealtimeSession,
  createServerSdpAnswer,
  executeToolCall,
  postSdpOfferToRealtime,
  type RealtimeSessionCreateRequest,
  type RealtimeSessionCreateResponse
} from "./api";

export type VoiceState = "idle" | "connecting" | "live" | "responding" | "error";

export type TranscriptEntry = {
  id: string;
  role: "assistant" | "user" | "system";
  text: string;
};

export type UsageSnapshot = {
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};

export type ToolLogEntry = {
  id: string;
  toolName: string;
  argumentsJson: string;
  output: string;
  status: "completed" | "failed";
};

export type ConnectionDiagnostics = {
  peerConnectionState: RTCPeerConnectionState | "none";
  iceConnectionState: RTCIceConnectionState | "none";
  iceGatheringState: RTCIceGatheringState | "none";
  signalingState: RTCSignalingState | "none";
  dataChannelState: RTCDataChannelState | "none";
};

export type RealtimeVoiceClientCallbacks = {
  onState: (state: VoiceState) => void;
  onStatus: (status: string, detail?: string) => void;
  onSession: (session: RealtimeSessionCreateResponse | null) => void;
  onTranscript: (entry: TranscriptEntry) => void;
  onAssistantDraft: (text: string) => void;
  onToolLog: (entry: ToolLogEntry) => void;
  onUsage: (usage: UsageSnapshot) => void;
  onDiagnostics: (diagnostics: ConnectionDiagnostics) => void;
  onError: (message: string | null) => void;
};

function readNestedString(source: unknown, path: string[]): string | null {
  let current = source;
  for (const key of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return null;
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === "string" && current.length > 0 ? current : null;
}

function readNestedNumber(source: unknown, path: string[]): number | undefined {
  let current = source;
  for (const key of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === "number" ? current : undefined;
}

function readNestedRecord(source: unknown, path: string[]): Record<string, unknown> | null {
  let current = source;
  for (const key of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return null;
    current = (current as Record<string, unknown>)[key];
  }
  return current && typeof current === "object" && !Array.isArray(current) ? (current as Record<string, unknown>) : null;
}

export async function waitForIceGatheringComplete(peerConnection: RTCPeerConnection, timeoutMs = 1200): Promise<void> {
  if (peerConnection.iceGatheringState === "complete") return;
  await new Promise<void>((resolve) => {
    let timeout: number | null = window.setTimeout(() => {
      cleanup();
      resolve();
    }, timeoutMs);
    function cleanup() {
      if (timeout !== null) {
        window.clearTimeout(timeout);
        timeout = null;
      }
      peerConnection.removeEventListener("icegatheringstatechange", handleChange);
    }
    function handleChange() {
      if (peerConnection.iceGatheringState === "complete") {
        cleanup();
        resolve();
      }
    }
    peerConnection.addEventListener("icegatheringstatechange", handleChange);
  });
}

export class RealtimeVoiceClient {
  private peerConnection: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private microphoneStream: MediaStream | null = null;
  private remoteAudioElement: HTMLAudioElement | null = null;
  private session: RealtimeSessionCreateResponse | null = null;
  private closing = false;
  private providerResponseInFlight = false;
  private assistantAccumulator = "";
  private responseCreateTimer: number | null = null;

  constructor(private readonly callbacks: RealtimeVoiceClientCallbacks) {}

  async start(request: RealtimeSessionCreateRequest, remoteAudioElement: HTMLAudioElement): Promise<void> {
    await this.stop("restart");
    this.closing = false;
    this.remoteAudioElement = remoteAudioElement;
    this.callbacks.onError(null);
    this.callbacks.onState("connecting");
    this.callbacks.onStatus("Creating realtime session", "The backend is building the session config.");

    const session = await createRealtimeSession(request);
    this.session = session;
    this.callbacks.onSession(session);
    if (session.providerMode !== "live") {
      this.callbacks.onState("idle");
      this.callbacks.onStatus("Provider is not live", "Set OPENAI_API_KEY and VOICE_MODULE_PROVIDER_MODE=live to connect audio.");
      return;
    }

    this.callbacks.onStatus("Requesting microphone", "Allow microphone access when the browser asks.");
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      },
      video: false
    });
    this.microphoneStream = stream;

    const peerConnection = new RTCPeerConnection({
      iceServers: session.iceServers && session.iceServers.length > 0 ? session.iceServers : undefined
    });
    this.peerConnection = peerConnection;
    this.bindPeerConnection(peerConnection);
    for (const track of stream.getTracks()) {
      peerConnection.addTrack(track, stream);
    }

    const dataChannel = peerConnection.createDataChannel("oai-events");
    this.dataChannel = dataChannel;
    this.bindDataChannel(dataChannel);

    this.callbacks.onStatus("Creating WebRTC offer", "Gathering local ICE candidates for the SDP offer.");
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    await waitForIceGatheringComplete(peerConnection, 1200);
    const sdpOffer = peerConnection.localDescription?.sdp;
    if (!sdpOffer) throw new Error("The browser could not create a usable SDP offer.");

    this.callbacks.onStatus("Exchanging SDP", "Finishing the WebRTC connection.");
    const sdpAnswer =
      session.connectionMode === "server_sdp"
        ? (await createServerSdpAnswer(session.sessionId, sdpOffer)).sdpAnswer
        : await this.createDirectSdpAnswer(session, sdpOffer);
    await peerConnection.setRemoteDescription({ type: "answer", sdp: sdpAnswer });
    this.updateDiagnostics();
  }

  sendText(text: string): void {
    const trimmed = text.trim();
    if (!trimmed || !this.dataChannel || this.dataChannel.readyState !== "open") return;
    this.dataChannel.send(
      JSON.stringify({
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: trimmed }]
        }
      })
    );
    this.dataChannel.send(JSON.stringify({ type: "response.create", response: { output_modalities: ["audio"] } }));
  }

  async stop(reason = "client_closed"): Promise<void> {
    this.closing = true;
    this.clearScheduledResponseCreate();
    if (this.dataChannel) {
      this.dataChannel.close();
      this.dataChannel = null;
    }
    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }
    if (this.microphoneStream) {
      this.microphoneStream.getTracks().forEach((track) => track.stop());
      this.microphoneStream = null;
    }
    if (this.remoteAudioElement) {
      this.remoteAudioElement.srcObject = null;
    }
    this.session = null;
    this.providerResponseInFlight = false;
    this.assistantAccumulator = "";
    this.callbacks.onAssistantDraft("");
    this.callbacks.onSession(null);
    this.callbacks.onState("idle");
    this.callbacks.onStatus("Ready", reason === "restart" ? "Preparing a new session." : "Voice session is closed.");
    this.updateDiagnostics();
  }

  private async createDirectSdpAnswer(session: RealtimeSessionCreateResponse, sdpOffer: string): Promise<string> {
    if (!session.clientSecret) throw new Error("Ephemeral Realtime client secret was not returned.");
    return postSdpOfferToRealtime(session.realtimeCallUrl, session.clientSecret, sdpOffer);
  }

  private bindPeerConnection(peerConnection: RTCPeerConnection): void {
    peerConnection.ontrack = (event) => {
      const [stream] = event.streams;
      if (stream && this.remoteAudioElement) {
        this.remoteAudioElement.srcObject = stream;
        void this.remoteAudioElement.play().catch(() => undefined);
      }
    };
    peerConnection.onconnectionstatechange = () => {
      this.updateDiagnostics();
      const state = peerConnection.connectionState;
      if (state === "connected") {
        this.callbacks.onState("live");
        this.callbacks.onStatus("Live session open", "Speak naturally. The user can interrupt assistant audio.");
      }
      if (state === "disconnected") {
        this.callbacks.onStatus("Reconnecting", "The browser reported a temporary WebRTC disconnect.");
      }
      if ((state === "failed" || state === "closed") && !this.closing) {
        this.callbacks.onState("error");
        this.callbacks.onError(`Peer connection ${state}.`);
      }
    };
    peerConnection.oniceconnectionstatechange = () => {
      this.updateDiagnostics();
      const state = peerConnection.iceConnectionState;
      if (state === "disconnected") {
        this.callbacks.onStatus("ICE reconnecting", "Waiting for the media route to recover.");
      }
      if ((state === "failed" || state === "closed") && !this.closing) {
        this.callbacks.onState("error");
        this.callbacks.onError(`ICE connection ${state}.`);
      }
    };
    peerConnection.onicegatheringstatechange = () => this.updateDiagnostics();
    peerConnection.onsignalingstatechange = () => this.updateDiagnostics();
  }

  private bindDataChannel(dataChannel: RTCDataChannel): void {
    dataChannel.onopen = () => {
      this.updateDiagnostics();
      this.callbacks.onState("live");
      this.callbacks.onStatus("Live voice ready", "Speak or send a text prompt.");
      if (this.session?.autoGreetingEvent) {
        dataChannel.send(JSON.stringify(this.session.autoGreetingEvent));
        this.providerResponseInFlight = true;
        dataChannel.send(JSON.stringify({ type: "response.create", response: { output_modalities: ["audio"] } }));
      }
    };
    dataChannel.onmessage = (message) => {
      this.handleRealtimeEvent(String(message.data)).catch((error: unknown) => {
        this.callbacks.onError(error instanceof Error ? error.message : "Realtime event handling failed.");
      });
    };
    dataChannel.onerror = () => {
      this.updateDiagnostics();
      this.callbacks.onState("error");
      this.callbacks.onError("Realtime data channel reported an error.");
    };
    dataChannel.onclose = () => {
      this.updateDiagnostics();
      if (!this.closing) {
        this.callbacks.onState("error");
        this.callbacks.onError("Realtime data channel closed.");
      }
    };
  }

  private async handleRealtimeEvent(raw: string): Promise<void> {
    let event: Record<string, unknown>;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
      event = parsed as Record<string, unknown>;
    } catch {
      return;
    }
    const eventType = typeof event.type === "string" ? event.type : "unknown";
    if (eventType === "response.created") {
      this.providerResponseInFlight = true;
      return;
    }
    if (eventType === "input_audio_buffer.speech_started") {
      this.callbacks.onState("live");
      this.callbacks.onStatus("Listening", "Upstream speech activity was detected.");
      return;
    }
    if (eventType === "input_audio_buffer.speech_stopped") {
      this.callbacks.onState("responding");
      this.callbacks.onStatus("Generating reply", "Speech ended. Waiting on assistant audio.");
      return;
    }
    if (
      eventType === "conversation.item.input_audio_transcription.completed" ||
      eventType === "conversation.item.input_audio_transcript.completed"
    ) {
      const transcript = readNestedString(event, ["transcript"]);
      if (transcript) this.callbacks.onTranscript({ id: crypto.randomUUID(), role: "user", text: transcript });
      return;
    }
    if (eventType === "response.audio_transcript.delta" || eventType === "response.output_audio_transcript.delta") {
      const delta = readNestedString(event, ["delta"]);
      if (delta) {
        this.assistantAccumulator += delta;
        this.callbacks.onAssistantDraft(this.assistantAccumulator);
      }
      return;
    }
    if (eventType === "response.audio_transcript.done" || eventType === "response.output_audio_transcript.done") {
      const transcript = readNestedString(event, ["transcript"]) ?? this.assistantAccumulator;
      if (transcript) this.callbacks.onTranscript({ id: crypto.randomUUID(), role: "assistant", text: transcript });
      this.assistantAccumulator = "";
      this.callbacks.onAssistantDraft("");
      return;
    }
    if (eventType === "response.function_call_arguments.done") {
      await this.handleFunctionCall(event);
      return;
    }
    if (eventType === "response.done") {
      this.providerResponseInFlight = false;
      this.callbacks.onState("live");
      this.callbacks.onStatus("Ready for the next turn", "Assistant response completed.");
      const usage = readNestedRecord(event, ["response", "usage"]);
      this.callbacks.onUsage({
        inputTokens: readNestedNumber(usage, ["input_tokens"]),
        cachedInputTokens:
          readNestedNumber(usage, ["input_tokens_details", "cached_tokens"]) ??
          readNestedNumber(usage, ["cached_input_tokens"]),
        outputTokens: readNestedNumber(usage, ["output_tokens"]),
        totalTokens: readNestedNumber(usage, ["total_tokens"])
      });
      return;
    }
    if (eventType === "error") {
      const detail = readNestedString(event, ["error", "message"]) ?? "Realtime provider returned an error.";
      if (detail.includes("active response in progress")) {
        this.providerResponseInFlight = true;
        this.callbacks.onState("responding");
        this.callbacks.onStatus("Continuing reply", "A response is already in progress.");
        return;
      }
      this.providerResponseInFlight = false;
      this.callbacks.onState("error");
      this.callbacks.onError(detail);
      this.callbacks.onStatus("Provider error", "The live voice channel reported an error.");
    }
  }

  private async handleFunctionCall(event: Record<string, unknown>): Promise<void> {
    const callId = readNestedString(event, ["call_id"]);
    const toolName = readNestedString(event, ["name"]);
    const argumentsJson = readNestedString(event, ["arguments"]) ?? "{}";
    if (!toolName || !this.dataChannel || this.dataChannel.readyState !== "open") return;
    let output: string;
    let status: "completed" | "failed" = "completed";
    try {
      const result = await executeToolCall({ callId, toolName, argumentsJson });
      output = result.output;
    } catch (error) {
      status = "failed";
      output = JSON.stringify({
        status: "error",
        code: "tool_execution_failed",
        message: error instanceof Error ? error.message : "Tool execution failed."
      });
    }
    this.callbacks.onToolLog({
      id: crypto.randomUUID(),
      toolName,
      argumentsJson,
      output,
      status
    });
    this.dataChannel.send(
      JSON.stringify({
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          call_id: callId,
          output
        }
      })
    );
    this.scheduleResponseCreate();
  }

  private scheduleResponseCreate(): void {
    this.clearScheduledResponseCreate();
    this.responseCreateTimer = window.setTimeout(() => {
      this.responseCreateTimer = null;
      if (!this.dataChannel || this.dataChannel.readyState !== "open" || this.providerResponseInFlight) return;
      this.providerResponseInFlight = true;
      this.dataChannel.send(JSON.stringify({ type: "response.create", response: { output_modalities: ["audio"] } }));
    }, 150);
  }

  private clearScheduledResponseCreate(): void {
    if (this.responseCreateTimer !== null) {
      window.clearTimeout(this.responseCreateTimer);
      this.responseCreateTimer = null;
    }
  }

  private updateDiagnostics(): void {
    this.callbacks.onDiagnostics({
      peerConnectionState: this.peerConnection?.connectionState ?? "none",
      iceConnectionState: this.peerConnection?.iceConnectionState ?? "none",
      iceGatheringState: this.peerConnection?.iceGatheringState ?? "none",
      signalingState: this.peerConnection?.signalingState ?? "none",
      dataChannelState: this.dataChannel?.readyState ?? "none"
    });
  }
}

import { Activity, Mic, RefreshCw, Send, SlidersHorizontal, Square, Wifi } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { loadRealtimeConfig, type RealtimeSessionCreateRequest } from "./api";
import {
  RealtimeVoiceClient,
  type ConnectionDiagnostics,
  type ToolLogEntry,
  type TranscriptEntry,
  type UsageSnapshot,
  type VoiceState
} from "./realtimeClient";

const DEFAULT_SYSTEM_MESSAGE =
  "You are a concise realtime voice assistant. Use tools when fresh data is needed and never pretend a tool ran.";

const DEFAULT_ICE_SERVERS = [{ urls: ["stun:stun.l.google.com:19302"] }];

function parseIceServers(value: string): RTCIceServer[] {
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed)) throw new Error("ICE servers must be a JSON array.");
  return parsed as RTCIceServer[];
}

function compactUsage(usage: UsageSnapshot): string {
  const parts = [
    usage.inputTokens !== undefined ? `in ${usage.inputTokens}` : null,
    usage.cachedInputTokens !== undefined ? `cached ${usage.cachedInputTokens}` : null,
    usage.outputTokens !== undefined ? `out ${usage.outputTokens}` : null,
    usage.totalTokens !== undefined ? `total ${usage.totalTokens}` : null
  ].filter(Boolean);
  return parts.length ? parts.join(" / ") : "No usage yet";
}

export default function App() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const clientRef = useRef<RealtimeVoiceClient | null>(null);

  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [status, setStatus] = useState("Ready");
  const [detail, setDetail] = useState("Voice session is closed.");
  const [error, setError] = useState<string | null>(null);
  const [currentSession, setCurrentSession] = useState<{ sessionId: string; providerMode: string; model: string; voice: string } | null>(null);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [assistantDraft, setAssistantDraft] = useState("");
  const [toolLog, setToolLog] = useState<ToolLogEntry[]>([]);
  const [usage, setUsage] = useState<UsageSnapshot>({});
  const [diagnostics, setDiagnostics] = useState<ConnectionDiagnostics>({
    peerConnectionState: "none",
    iceConnectionState: "none",
    iceGatheringState: "none",
    signalingState: "none",
    dataChannelState: "none"
  });

  const [connectionMode, setConnectionMode] = useState<"ephemeral" | "server_sdp">("ephemeral");
  const [model, setModel] = useState("gpt-realtime-2");
  const [voice, setVoice] = useState("marin");
  const [userId, setUserId] = useState("module-user");
  const [systemMessage, setSystemMessage] = useState(DEFAULT_SYSTEM_MESSAGE);
  const [extraContext, setExtraContext] = useState("");
  const [enableTools, setEnableTools] = useState(true);
  const [autoGreeting, setAutoGreeting] = useState(true);
  const [vadMode, setVadMode] = useState<"server_vad" | "semantic_vad" | "off">("server_vad");
  const [vadThreshold, setVadThreshold] = useState(0.82);
  const [silenceDurationMs, setSilenceDurationMs] = useState(800);
  const [prefixPaddingMs, setPrefixPaddingMs] = useState(300);
  const [semanticEagerness, setSemanticEagerness] = useState<"low" | "medium" | "high" | "auto">("auto");
  const [iceServersText, setIceServersText] = useState(JSON.stringify(DEFAULT_ICE_SERVERS, null, 2));
  const [iceError, setIceError] = useState<string | null>(null);
  const [textPrompt, setTextPrompt] = useState("");

  const isActive = voiceState === "connecting" || voiceState === "live" || voiceState === "responding";

  const statusClass = useMemo(() => {
    if (voiceState === "error") return "is-error";
    if (voiceState === "live" || voiceState === "responding") return "is-live";
    if (voiceState === "connecting") return "is-connecting";
    return "";
  }, [voiceState]);

  useEffect(() => {
    loadRealtimeConfig()
      .then((config) => {
        setModel(config.realtimeModel);
        setVoice(config.realtimeVoice);
        setIceServersText(JSON.stringify(config.iceServers?.length ? config.iceServers : DEFAULT_ICE_SERVERS, null, 2));
      })
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : "Failed to load backend config.");
      });
  }, []);

  useEffect(() => {
    return () => {
      void clientRef.current?.stop("component_unmounted");
    };
  }, []);

  function getClient(): RealtimeVoiceClient {
    if (!clientRef.current) {
      clientRef.current = new RealtimeVoiceClient({
        onState: setVoiceState,
        onStatus: (nextStatus, nextDetail = "") => {
          setStatus(nextStatus);
          setDetail(nextDetail);
        },
        onSession: (session) => {
          setCurrentSession(
            session
              ? {
                  sessionId: session.sessionId,
                  providerMode: session.providerMode,
                  model: session.model,
                  voice: session.voice
                }
              : null
          );
        },
        onTranscript: (entry) => setTranscript((current) => [...current, entry]),
        onAssistantDraft: setAssistantDraft,
        onToolLog: (entry) => setToolLog((current) => [entry, ...current].slice(0, 20)),
        onUsage: setUsage,
        onDiagnostics: setDiagnostics,
        onError: setError
      });
    }
    return clientRef.current;
  }

  async function handleStartStop() {
    if (isActive) {
      await getClient().stop("user_stopped");
      return;
    }
    setTranscript([]);
    setAssistantDraft("");
    setToolLog([]);
    setUsage({});
    setError(null);
    let iceServers: RTCIceServer[];
    try {
      iceServers = parseIceServers(iceServersText);
      setIceError(null);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Invalid ICE server JSON.";
      setIceError(message);
      setError(message);
      return;
    }
    const request: RealtimeSessionCreateRequest = {
      connectionMode,
      userId,
      model,
      voice,
      systemMessage,
      extraContext,
      outputModalities: ["audio"],
      reasoningEffort: "low",
      turnDetection: {
        mode: vadMode,
        threshold: vadThreshold,
        prefixPaddingMs,
        silenceDurationMs,
        eagerness: vadMode === "semantic_vad" ? semanticEagerness : null,
        createResponse: true,
        interruptResponse: true
      },
      enableTools,
      toolNames: null,
      autoGreeting,
      truncationRetentionRatio: 0.8,
      tokenLimitPostInstructions: 8000,
      iceServersOverride: iceServers
    };
    await getClient().start(request, audioRef.current!);
  }

  function handleSendText() {
    getClient().sendText(textPrompt);
    setTextPrompt("");
  }

  return (
    <main className="app-shell">
      <audio ref={audioRef} autoPlay />
      <section className="topbar">
        <div>
          <p className="eyebrow">ReSono Voice Module</p>
          <h1>Realtime WebRTC voice</h1>
        </div>
        <button className={`primary-action ${statusClass}`} onClick={() => void handleStartStop()} type="button">
          {isActive ? <Square size={18} /> : <Mic size={18} />}
          <span>{isActive ? "Stop" : "Start"}</span>
        </button>
      </section>

      <section className="status-band">
        <div>
          <p className="label">Status</p>
          <h2>{status}</h2>
          <p>{detail}</p>
        </div>
        <div className="status-grid">
          <span className="metric"><Activity size={15} /> {voiceState}</span>
          <span className="metric"><Wifi size={15} /> {diagnostics.iceConnectionState}</span>
          <span className="metric">DC {diagnostics.dataChannelState}</span>
          <span className="metric">{compactUsage(usage)}</span>
        </div>
      </section>

      {error ? <section className="error-strip">{error}</section> : null}

      <section className="workbench">
        <section className="panel controls-panel">
          <div className="panel-title">
            <SlidersHorizontal size={18} />
            <h2>Session</h2>
          </div>
          <div className="field-row">
            <label>
              Transport
              <select value={connectionMode} onChange={(event) => setConnectionMode(event.target.value as "ephemeral" | "server_sdp")}>
                <option value="ephemeral">Ephemeral</option>
                <option value="server_sdp">Server SDP</option>
              </select>
            </label>
            <label>
              Model
              <input value={model} onChange={(event) => setModel(event.target.value)} />
            </label>
            <label>
              Voice
              <input value={voice} onChange={(event) => setVoice(event.target.value)} />
            </label>
          </div>
          <div className="field-row">
            <label>
              User ID
              <input value={userId} onChange={(event) => setUserId(event.target.value)} />
            </label>
            <label>
              VAD
              <select value={vadMode} onChange={(event) => setVadMode(event.target.value as "server_vad" | "semantic_vad" | "off")}>
                <option value="server_vad">Server VAD</option>
                <option value="semantic_vad">Semantic VAD</option>
                <option value="off">Off</option>
              </select>
            </label>
            <label>
              Eagerness
              <select value={semanticEagerness} onChange={(event) => setSemanticEagerness(event.target.value as "low" | "medium" | "high" | "auto")}>
                <option value="auto">Auto</option>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </label>
          </div>
          <div className="range-grid">
            <label>
              Threshold <strong>{vadThreshold.toFixed(2)}</strong>
              <input min="0" max="1" step="0.01" type="range" value={vadThreshold} onChange={(event) => setVadThreshold(Number(event.target.value))} />
            </label>
            <label>
              Silence <strong>{silenceDurationMs} ms</strong>
              <input min="100" max="3000" step="50" type="range" value={silenceDurationMs} onChange={(event) => setSilenceDurationMs(Number(event.target.value))} />
            </label>
            <label>
              Prefix <strong>{prefixPaddingMs} ms</strong>
              <input min="0" max="2000" step="50" type="range" value={prefixPaddingMs} onChange={(event) => setPrefixPaddingMs(Number(event.target.value))} />
            </label>
          </div>
          <div className="toggle-row">
            <label><input checked={enableTools} onChange={(event) => setEnableTools(event.target.checked)} type="checkbox" /> Tools</label>
            <label><input checked={autoGreeting} onChange={(event) => setAutoGreeting(event.target.checked)} type="checkbox" /> Greeting</label>
            <button className="ghost-button" onClick={() => void loadRealtimeConfig().then((config) => setIceServersText(JSON.stringify(config.iceServers, null, 2)))} type="button">
              <RefreshCw size={16} />
              ICE
            </button>
          </div>
          <label className="stacked">
            System message
            <textarea rows={5} value={systemMessage} onChange={(event) => setSystemMessage(event.target.value)} />
          </label>
          <label className="stacked">
            Context
            <textarea rows={4} value={extraContext} onChange={(event) => setExtraContext(event.target.value)} />
          </label>
          <label className="stacked">
            ICE servers JSON
            <textarea className={iceError ? "has-error" : ""} rows={5} value={iceServersText} onChange={(event) => setIceServersText(event.target.value)} />
          </label>
        </section>

        <section className="panel live-panel">
          <div className="panel-title">
            <Mic size={18} />
            <h2>Live</h2>
          </div>
          <div className="session-meta">
            <span>{currentSession?.providerMode ?? "no provider"}</span>
            <span>{currentSession?.model ?? model}</span>
            <span>{currentSession?.voice ?? voice}</span>
            <span>{diagnostics.peerConnectionState}</span>
            <span>{diagnostics.iceGatheringState}</span>
            <span>{diagnostics.signalingState}</span>
          </div>
          <div className="transcript">
            {transcript.length === 0 && !assistantDraft ? <p className="empty-state">Transcript is empty.</p> : null}
            {transcript.map((entry) => (
              <article className={`bubble is-${entry.role}`} key={entry.id}>
                <strong>{entry.role}</strong>
                <p>{entry.text}</p>
              </article>
            ))}
            {assistantDraft ? (
              <article className="bubble is-assistant is-draft">
                <strong>assistant</strong>
                <p>{assistantDraft}</p>
              </article>
            ) : null}
          </div>
          <div className="prompt-row">
            <input value={textPrompt} onChange={(event) => setTextPrompt(event.target.value)} onKeyDown={(event) => {
              if (event.key === "Enter") handleSendText();
            }} />
            <button className="icon-action" disabled={!isActive || !textPrompt.trim()} onClick={handleSendText} type="button">
              <Send size={18} />
            </button>
          </div>
          <div className="tool-log">
            <h3>Tools</h3>
            {toolLog.length === 0 ? <p className="empty-state">No tool calls yet.</p> : null}
            {toolLog.map((entry) => (
              <details key={entry.id}>
                <summary>{entry.toolName} - {entry.status}</summary>
                <pre>{entry.argumentsJson}</pre>
                <pre>{entry.output}</pre>
              </details>
            ))}
          </div>
        </section>
      </section>
    </main>
  );
}

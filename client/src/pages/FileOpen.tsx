import React, { useState, useEffect, useRef, useCallback } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { api } from "../api";
import Toast from "../components/Toast";
import styles from "./FileOpen.module.css";

interface Session {
  _id?: string;
  id: string;
  timestamp: number;
  createdAt?: string;
  words: number;
  chars: number;
  edits: number;
  pastes: number;
  wpm: number;
  pauses: number;
  duration: number | string;
  content: string;
  analytics?: {
    authenticity?: {
      score: number;
      label: string;
    };
    flags?: {
      type: string;
      message: string;
    }[];
  };
}

interface FileData {
  id: string;
  name: string;
  content: string;
  sessions: Session[];
  lastModified: number;
  font: string;
  fontSize: number;
  textColor: string;
  bgColor: string;
  customColor: string;
  customBg: string;
  scrollPosition: number;
}

interface DocumentDetail {
  _id: string;
  name: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

interface EditorProps {
  fileId: string;
  fileName: string;
  onClose?: () => void;
}

const STORAGE_KEY = "writing_tracker_files";

const DRAFT_PREFIX = "draft_";

function saveDraft(fileId: string, content: string) {
  localStorage.setItem(`${DRAFT_PREFIX}${fileId}`, content);
}

function loadDraft(fileId: string): string | null {
  return localStorage.getItem(`${DRAFT_PREFIX}${fileId}`);
}

function clearDraft(fileId: string) {
  localStorage.removeItem(`${DRAFT_PREFIX}${fileId}`);
}

const DEFAULT_FORMATTING = {
  font: "Calibri",
  fontSize: 14,
  textColor: "#ffffff",
  bgColor: "#f59e0b",
  customColor: "#ffffff",
  customBg: "#000000",
  scrollPosition: 0,
};

function migrationFileData(file: any): FileData {
  return {
    id: file.id || "",
    name: file.name || "",
    content: file.content || "",
    sessions: file.sessions || [],
    lastModified: file.lastModified || Date.now(),
    font: file.font || DEFAULT_FORMATTING.font,
    fontSize: file.fontSize || DEFAULT_FORMATTING.fontSize,
    textColor: file.textColor || DEFAULT_FORMATTING.textColor,
    bgColor: file.bgColor || DEFAULT_FORMATTING.bgColor,
    customColor: file.customColor || DEFAULT_FORMATTING.customColor,
    customBg: file.customBg || DEFAULT_FORMATTING.customBg,
    scrollPosition: file.scrollPosition || DEFAULT_FORMATTING.scrollPosition,
  };
}

function loadFiles(): Record<string, FileData> {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    const migratedData: Record<string, FileData> = {};
    for (const fileId in data) {
      migratedData[fileId] = migrationFileData(data[fileId]);
    }
    return migratedData;
  } catch {
    return {};
  }
}

function saveFiles(files: Record<string, FileData>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(files));
}

function getFileData(fileId: string, fileName: string): FileData {
  const files = loadFiles();
  if (files[fileId]) {
    return migrationFileData(files[fileId]);
  }
  return {
    id: fileId,
    name: fileName,
    content: "",
    sessions: [],
    lastModified: Date.now(),
    font: DEFAULT_FORMATTING.font,
    fontSize: DEFAULT_FORMATTING.fontSize,
    textColor: DEFAULT_FORMATTING.textColor,
    bgColor: DEFAULT_FORMATTING.bgColor,
    customColor: DEFAULT_FORMATTING.customColor,
    customBg: DEFAULT_FORMATTING.customBg,
    scrollPosition: DEFAULT_FORMATTING.scrollPosition,
  };
}

function countWords(html: string): number {
  const text = html.replace(/<[^>]*>/g, " ").trim();
  if (!text) return 0;
  return text.split(/\s+/).filter(Boolean).length;
}

function countChars(html: string): number {
  return html.replace(/<[^>]*>/g, "").length;
}

const FONTS = [
  "Calibri",
  "Georgia",
  "Times New Roman",
  "Arial",
  "Courier New",
  "Verdana",
  "Trebuchet MS",
];
const FONT_SIZES = [10, 11, 12, 13, 14, 16, 18, 20, 24, 28, 32, 36, 48, 72];

const FONT_CLASS_MAP: Record<string, string> = {
  Calibri: styles.fontCalibri,
  Georgia: styles.fontGeorgia,
  "Times New Roman": styles.fontTimesNewRoman,
  Arial: styles.fontArial,
  "Courier New": styles.fontCourierNew,
  Verdana: styles.fontVerdana,
  "Trebuchet MS": styles.fontTrebuchetMs,
};

const FONT_SIZE_CLASS_MAP: Record<number, string> = {
  10: styles.fontSize10,
  11: styles.fontSize11,
  12: styles.fontSize12,
  13: styles.fontSize13,
  14: styles.fontSize14,
  16: styles.fontSize16,
  18: styles.fontSize18,
  20: styles.fontSize20,
  24: styles.fontSize24,
  28: styles.fontSize28,
  32: styles.fontSize32,
  36: styles.fontSize36,
  48: styles.fontSize48,
  72: styles.fontSize72,
};

const PAUSE_THRESHOLD_MS = 3000;

const SESSION_ID_RE = /^[a-f\d]{24}$/i;

const isMongoObjectId = (value: unknown): value is string =>
  typeof value === "string" && SESSION_ID_RE.test(value);

function Editor({ fileId, fileName, onClose }: EditorProps) {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<"overview" | "sessions" | "write">(
    "write",
  );
  const [fileData, setFileData] = useState<FileData>(() =>
    getFileData(fileId, fileName),
  );
  const [toastMessage, setToastMessage] = useState<{
    message: string;
    type: "success" | "error";
  } | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(() => {
    const stored = localStorage.getItem(`sessionId_${fileId}`);
    return isMongoObjectId(stored) ? stored : null;
  });

  const editorRef = useRef<HTMLDivElement>(null);
  const isSavingRef = useRef(false);
  const pendingKeystrokesRef = useRef<any[]>([]);
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previousContentRef = useRef<string>("");
  const [font, setFont] = useState(DEFAULT_FORMATTING.font);
  const [fontSize, setFontSize] = useState(DEFAULT_FORMATTING.fontSize);
  const [textColor, setTextColor] = useState(DEFAULT_FORMATTING.textColor);
  const [bgColor, setBgColor] = useState(DEFAULT_FORMATTING.bgColor);
  const [customColor, setCustomColor] = useState(
    DEFAULT_FORMATTING.customColor,
  );
  const [customBg, setCustomBg] = useState(DEFAULT_FORMATTING.customBg);

  const [wpm, setWpm] = useState(0);
  const [pauses, setPauses] = useState(0);
  const [edits, setEdits] = useState(0);
  const [pastes, setPastes] = useState(0);
  const [pasteDetected, setPasteDetected] = useState(false);
  const [sessionAnalytics, setSessionAnalytics] = useState<any>(null);
  const [baselineDeviation, setBaselineDeviation] = useState(0);

  const totalWords = fileData.sessions.length
    ? fileData.sessions[fileData.sessions.length - 1].words
    : 0;
  const totalSessions = fileData.sessions.length;
  const avgWpm =
    totalSessions > 0
      ? Math.round(
          fileData.sessions.reduce((a, s) => a + s.wpm, 0) / totalSessions,
        )
      : 0;
  const totalDuration = fileData.sessions.reduce((a, s) => a + Number(s.duration), 0);

  const sessionStartRef = useRef<number>(Date.now());
  const lastKeystrokeRef = useRef<number>(Date.now());
  const pauseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wordCountRef = useRef<number>(0);
  const startWordCountRef = useRef<number>(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const intervalsRef = useRef<number[]>([]);
  const lastTimestampRef = useRef<number>(Date.now());
  const microPausesRef = useRef(0);
  const macroPausesRef = useRef(0);
  const lastEditTimeRef = useRef<number>(0);
  const [behaviorScore, setBehaviorScore] = useState(0);

  // Keep latest formatting in refs so the Ctrl+S window listener always
  // reads current values without needing to be recreated.
  const fontRef = useRef(font);
  const fontSizeRef = useRef(fontSize);
  const textColorRef = useRef(textColor);
  const bgColorRef = useRef(bgColor);
  const customColorRef = useRef(customColor);
  const customBgRef = useRef(customBg);

  useEffect(() => {
    fontRef.current = font;
  }, [font]);
  useEffect(() => {
    fontSizeRef.current = fontSize;
  }, [fontSize]);
  useEffect(() => {
    textColorRef.current = textColor;
  }, [textColor]);
  useEffect(() => {
    bgColorRef.current = bgColor;
  }, [bgColor]);
  useEffect(() => {
    customColorRef.current = customColor;
  }, [customColor]);
  useEffect(() => {
    customBgRef.current = customBg;
  }, [customBg]);

  useEffect(() => {
    const fetchAndInitDocument = async () => {
      try {
        const response = await api.get<DocumentDetail>(
          `/api/documents/${fileId}`,
        );
        const dbDocument = response.data;
        const files = loadFiles();

        if (!files[fileId]) {
          files[fileId] = {
            id: fileId,
            name: dbDocument.name,
            content: dbDocument.content,
            sessions: [],
            lastModified: Date.now(),
            font: DEFAULT_FORMATTING.font,
            fontSize: DEFAULT_FORMATTING.fontSize,
            textColor: DEFAULT_FORMATTING.textColor,
            bgColor: DEFAULT_FORMATTING.bgColor,
            customColor: DEFAULT_FORMATTING.customColor,
            customBg: DEFAULT_FORMATTING.customBg,
            scrollPosition: DEFAULT_FORMATTING.scrollPosition,
          };
        } else {
          files[fileId] = migrationFileData(files[fileId]);
          files[fileId].name = dbDocument.name;
        }

        saveFiles(files);
        setFileData(files[fileId]);
      } catch (error) {
        console.error("Failed to fetch document from database:", error);
        setFileData(getFileData(fileId, fileName));
      }
    };

    const createSession = async () => {
      const storageKey = `sessionId_${fileId}`;
      const stored = localStorage.getItem(storageKey);

      if (stored && !isMongoObjectId(stored)) {
        localStorage.removeItem(storageKey);
      }

      if (isMongoObjectId(stored)) {
        setSessionId(stored);
        return;
      }

      try {
        const res = await api.post("/api/sessions", {
          documentId: fileId,
          keystrokes: [],
        });

        const id = String(res.data.sessionId);
        if (!isMongoObjectId(id)) {
          throw new Error("Invalid session id");
        }

        localStorage.setItem(storageKey, id);
        setSessionId(id);
      } catch (err) {
        console.error("Session creation failed", err);
        setToastMessage({
          message: "Could not start a writing session.",
          type: "error",
        });
      }
    };

    void fetchAndInitDocument();
    void createSession();
  }, [fileId, fileName]);

  useEffect(() => {
    if (!fileData) return;

    const draft = loadDraft(fileId);
    const contentToLoad =
      draft ??
      (fileData.sessions && fileData.sessions.length > 0
        ? fileData.sessions[fileData.sessions.length - 1].content
        : fileData.content || "");

    if (editorRef.current) {
      editorRef.current.innerHTML = contentToLoad;
      editorRef.current.scrollTop = fileData.scrollPosition || 0;
    }

    previousContentRef.current = contentToLoad;
    startWordCountRef.current = countWords(contentToLoad);
    wordCountRef.current = startWordCountRef.current;
    sessionStartRef.current = Date.now();
  }, [fileId, activeTab, fileData]);

  useEffect(() => {
    setFont(fileData.font || DEFAULT_FORMATTING.font);
    setFontSize(fileData.fontSize || DEFAULT_FORMATTING.fontSize);
    setTextColor(fileData.textColor || DEFAULT_FORMATTING.textColor);
    setBgColor(fileData.bgColor || DEFAULT_FORMATTING.bgColor);
    setCustomColor(fileData.customColor || DEFAULT_FORMATTING.customColor);
    setCustomBg(fileData.customBg || DEFAULT_FORMATTING.customBg);
    setEdits(0);
    setPastes(0);
    setPauses(0);
    setWpm(0);
    intervalsRef.current = [];
    microPausesRef.current = 0;
    macroPausesRef.current = 0;
    lastTimestampRef.current = Date.now();
    setBehaviorScore(0);
  }, [fileId]);

  useEffect(() => {
    intervalRef.current = setInterval(() => {
      const intervals = intervalsRef.current;

      if (!intervals || intervals.length < 5) return;

      const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;

      if (!avg || avg === 0) return;

      const newWpm = Math.round(60000 / (avg * 5));

      setWpm((prev) => Math.round(prev * 0.7 + newWpm * 0.3));

      if (avgWpm > 0) {
        const dev = Math.abs(newWpm - avgWpm) / avgWpm;
        setBaselineDeviation(Math.round(dev * 100));
      }

      const variance = intervals.reduce((s, v) => s + (v - avg) ** 2, 0) / intervals.length;
      const std = Math.sqrt(variance);
      const cv = std / avg;
      const score = Math.max(0, 100 - cv * 100);
      setBehaviorScore(Math.round(score));
    }, 500);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [avgWpm]);

  const getChangeBounds = (before: string, after: string) => {
    const maxPrefix = Math.min(before.length, after.length);
    let prefix = 0;

    while (prefix < maxPrefix && before[prefix] === after[prefix]) {
      prefix += 1;
    }

    const maxSuffix = Math.min(before.length - prefix, after.length - prefix);
    let suffix = 0;

    while (
      suffix < maxSuffix &&
      before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
    ) {
      suffix += 1;
    }

    const removedLength = before.length - prefix - suffix;
    const insertedLength = after.length - prefix - suffix;

    return {
      start: prefix,
      end: prefix + removedLength,
      insertedLength,
      removedLength,
    };
  };

  const flushKeystrokes = useCallback(async () => {
    if (!sessionId || pendingKeystrokesRef.current.length === 0) return;

    const batch = pendingKeystrokesRef.current.splice(
      0,
      pendingKeystrokesRef.current.length,
    );

    await api.patch(`/api/sessions/${sessionId}`, {
      keystrokes: batch,
    });
  }, [sessionId]);

  const queueKeystrokes = useCallback(
    (events: any[]) => {
      pendingKeystrokesRef.current.push(...events);

      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);

      syncTimerRef.current = setTimeout(() => {
        void flushKeystrokes();
      }, 500);
    },
    [flushKeystrokes],
  );

  const handleSaveSession = useCallback(async () => {
    if (isSavingRef.current) return;
    isSavingRef.current = true;

    try {
      await flushKeystrokes();

      const content = editorRef.current?.innerHTML || "";
      const words = countWords(content);
      const chars = countChars(content);
      const elapsed = (Date.now() - sessionStartRef.current) / 1000;
      const elapsedMin = elapsed / 60;
      const wordsTyped = Math.max(0, words - startWordCountRef.current);
      const finalWpm = elapsedMin > 0 ? Math.round(wordsTyped / elapsedMin) : 0;

      await api.patch(`/api/documents/${fileId}/content`, { content });

      if (!sessionId) {
        throw new Error("Missing session id");
      }

      const closeRes = await api.post(`/api/sessions/${sessionId}/close`, { wpm: finalWpm });
      const analytics = closeRes.data.analytics ?? null;
      setSessionAnalytics(analytics);

      const session: Session = {
        _id: sessionId,
        id: sessionId,
        timestamp: Date.now(),
        createdAt: new Date().toISOString(),
        words,
        chars,
        edits,
        pastes,
        wpm: finalWpm,
        pauses,
        duration: String(Math.round(elapsed)),
        content,
        analytics: analytics ?? undefined,
      };

      const updated: FileData = {
        ...fileData,
        content,
        sessions: [...(fileData.sessions || []), session],
        lastModified: Date.now(),
        font,
        fontSize,
        textColor,
        bgColor,
        customColor,
        customBg,
        scrollPosition: editorRef.current?.scrollTop || 0,
      };

      const files = loadFiles();
      files[fileId] = updated;
      saveFiles(files);
      setFileData(updated);
      clearDraft(fileId);

      localStorage.removeItem(`sessionId_${fileId}`);
      setSessionId(null);

      const nextSessionRes = await api.post("/api/sessions", {
        documentId: fileId,
        keystrokes: [],
      });

      const nextSessionId = String(nextSessionRes.data.sessionId);
      if (isMongoObjectId(nextSessionId)) {
        localStorage.setItem(`sessionId_${fileId}`, nextSessionId);
        setSessionId(nextSessionId);
      }

      setEdits(0);
      setPastes(0);
      setPauses(0);
      setWpm(0);
      intervalsRef.current = [];
      microPausesRef.current = 0;
      macroPausesRef.current = 0;
      lastTimestampRef.current = Date.now();
      sessionStartRef.current = Date.now();
      startWordCountRef.current = words;

      setToastMessage({
        message: "Session saved successfully!",
        type: "success",
      });
    } catch (error) {
      console.error("Failed to save session:", error);
      setToastMessage({
        message: "Failed to save session",
        type: "error",
      });
    } finally {
      isSavingRef.current = false;
    }
  }, [
    edits,
    fileData,
    fileId,
    font,
    fontSize,
    flushKeystrokes,
    bgColor,
    customBg,
    customColor,
    pauses,
    pastes,
    sessionId,
    textColor,
  ]);

  useEffect(() => {
    const handleCtrlS = async (e: KeyboardEvent) => {
      if (!((e.ctrlKey || e.metaKey) && e.key === "s")) return;
      e.preventDefault();

      await handleSaveSession();
    };

    window.addEventListener("keydown", handleCtrlS);
    return () => window.removeEventListener("keydown", handleCtrlS);
  }, [fileId, handleSaveSession]);

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      const content = editorRef.current?.innerHTML || "";
      if (!content.trim()) return;

      // Save draft instantly (guaranteed)
      saveDraft(fileId, content);

      // Try saving session (best effort)
      handleSaveSession();

      e.preventDefault();
      e.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [fileId, handleSaveSession]);

  useEffect(() => {
    const handleAutoSave = () => {
      handleSaveSession();
    };

    window.addEventListener("auto-save-session", handleAutoSave);

    return () => {
      window.removeEventListener("auto-save-session", handleAutoSave);
    };
  }, [handleSaveSession]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") return;

      const content = editorRef.current?.innerHTML || "";
      saveDraft(fileId, content);

      const now = Date.now();
      const gap = now - lastTimestampRef.current;

      if (gap > 0 && gap < 10000) {
        intervalsRef.current.push(gap);
        if (intervalsRef.current.length > 50) {
          intervalsRef.current.shift();
        }
      }

      if (gap > 2000) {
        setPauses((p) => p + 1);
        macroPausesRef.current++;
      } else if (gap > 300) {
        microPausesRef.current++;
      }

      lastTimestampRef.current = now;

      queueKeystrokes([{ action: "down", timestamp: now }]);

      if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current);
      pauseTimerRef.current = setTimeout(() => {
        lastKeystrokeRef.current = 0;
      }, PAUSE_THRESHOLD_MS);
    },
    [fileId, queueKeystrokes],
  );

  const handleKeyUp = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") return;

      const now = Date.now();
      queueKeystrokes([{ action: "up", timestamp: now }]);
    },
    [queueKeystrokes],
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      e.preventDefault();

      const text = e.clipboardData.getData("text/plain");

      const selection = window.getSelection();
      const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
      const selectionStart = range ? range.startOffset : 0;
      const selectionEnd = range ? range.endOffset : 0;
      const now = Date.now();

      document.execCommand("insertText", false, text);

      if (text.length > 20) {
        setPastes((p) => p + 1);
      }
      setPasteDetected(true);

       queueKeystrokes([
        {
          action: "paste",
          timestamp: now,
          pasteLength: text.length,
          pasteSelectionStart: selectionStart,
          pasteSelectionEnd: selectionEnd,
        },
      ]);

      setTimeout(() => setPasteDetected(false), 2000);
    },
    [queueKeystrokes],
  );

  const handleInput = useCallback(() => {
    const current = editorRef.current?.innerHTML || "";
    const previous = previousContentRef.current;

    if (current !== previous) {
      const change = getChangeBounds(previous, current);
      const now = Date.now();

      if (
        (change.insertedLength > 2 || change.removedLength > 2) &&
        now - lastEditTimeRef.current > 200
      ) {
        setEdits((prev) => prev + 1);
        lastEditTimeRef.current = now;
      }

      if (change.insertedLength !== 0 || change.removedLength !== 0) {
        queueKeystrokes([
          {
            action: "edit",
            timestamp: now,
            editStart: change.start,
            editEnd: change.end,
            insertedLength: change.insertedLength,
            removedLength: change.removedLength,
          },
        ]);
      }

      previousContentRef.current = current;
    }
  }, [queueKeystrokes]);

  useEffect(() => {
    const files = loadFiles();
    if (files[fileId]) {
      files[fileId].font = font;
      files[fileId].fontSize = fontSize;
      files[fileId].textColor = textColor;
      files[fileId].bgColor = bgColor;
      files[fileId].customColor = customColor;
      files[fileId].customBg = customBg;
      saveFiles(files);
    }
  }, [font, fontSize, textColor, bgColor, customColor, customBg, fileId]);

  useEffect(() => {
    const handleScroll = () => {
      if (editorRef.current) {
        const files = loadFiles();
        if (files[fileId]) {
          files[fileId].scrollPosition = editorRef.current.scrollTop;
          saveFiles(files);
        }
      }
    };
    const editor = editorRef.current;
    if (editor) {
      editor.addEventListener("scroll", handleScroll);
      return () => editor.removeEventListener("scroll", handleScroll);
    }
  }, [fileId]);

  const exec = (cmd: string, value?: string) => {
    editorRef.current?.focus();
    document.execCommand(cmd, false, value);
  };

  const applyFont = (f: string) => {
    setFont(f);
    exec("fontName", f);
  };

  const applySize = (s: number) => {
    setFontSize(s);
    exec("fontSize", "7");
    const container = editorRef.current;
    if (container) {
      container.querySelectorAll('font[size="7"]').forEach((el) => {
        (el as HTMLElement).removeAttribute("size");
        (el as HTMLElement).style.fontSize = `${s}px`;
      });
    }
  };

  const applyTextColor = (c: string) => {
    setTextColor(c);
    exec("foreColor", c);
  };
  const applyBgColor = (c: string) => {
    setBgColor(c);
    exec("hiliteColor", c);
  };
  const applyHeading = (tag: string) => exec("formatBlock", `<${tag}>`);

  const currentContent = editorRef.current?.innerHTML || fileData.content;
  const words = countWords(currentContent);
  const chars = countChars(currentContent);
  const fontClass = FONT_CLASS_MAP[font] || styles.fontCalibri;
  const fontSizeClass = FONT_SIZE_CLASS_MAP[fontSize] || styles.fontSize14;


  return (
    <>
      <div className={`${styles.root} ${styles.editorRoot}`}>
        {/* Top Navigation */}
        <div className={styles.nav}>
          <div className={styles.navTabs}>
            {(["overview", "sessions", "write"] as const).map((tab) => (
              <button
                key={tab}
                className={`${styles.tab} ${activeTab === tab ? styles.tabActive : ""}`}
                onClick={() => setActiveTab(tab)}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>
          {onClose && (
            <button className={styles.closeBtn} onClick={onClose}>
              ✕ Close
            </button>
          )}
        </div>

        <div className={styles.divider} />

        {/* Write Tab */}
        {activeTab === "write" && (
          <div className={styles.writeContainer}>
            {/* Status Badges */}
            <div className={styles.badges}>
              <Badge color="#4ade80" label="Keystroke capture active" />
              <Badge
                color="#f59e0b"
                label={pasteDetected ? "Paste detected!" : "Paste detection on"}
                pulse={pasteDetected}
              />
              <Badge color="#4ade80" label={`WPM: ${wpm}`} />
              <Badge color="#4ade80" label={`Pauses: ${pauses}`} />
              <Badge color="#4ade80" label={`Human-like: ${behaviorScore}%`} />
              <Badge color="#f59e0b" label={`Deviation: ${baselineDeviation}%`} />
            </div>

            {/* Editor Card */}
            <div className={styles.editorCard}>
              {/* Toolbar Row 1 */}
              <div className={styles.toolbar}>
                <select
                  className={styles.select}
                  aria-label="Font family"
                  title="Font family"
                  value={font}
                  onChange={(e) => applyFont(e.target.value)}
                >
                  {FONTS.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>

                <select
                  className={`${styles.select} ${styles.selectSmall}`}
                  aria-label="Font size"
                  title="Font size"
                  value={fontSize}
                  onChange={(e) => applySize(Number(e.target.value))}
                >
                  {FONT_SIZES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>

                <div className={styles.toolbarSep} />
                <ToolBtn
                  label="B"
                  bold
                  onClick={() => exec("bold")}
                  title="Bold"
                />
                <ToolBtn
                  label="I"
                  italic
                  onClick={() => exec("italic")}
                  title="Italic"
                />
                <ToolBtn
                  label="U"
                  underline
                  onClick={() => exec("underline")}
                  title="Underline"
                />
                <ToolBtn
                  label="S"
                  strike
                  onClick={() => exec("strikeThrough")}
                  title="Strikethrough"
                />
                <div className={styles.toolbarSep} />
                <ToolBtn
                  label="H1"
                  onClick={() => applyHeading("h1")}
                  title="Heading 1"
                />
                <ToolBtn
                  label="H2"
                  onClick={() => applyHeading("h2")}
                  title="Heading 2"
                />
                <ToolBtn
                  label="H3"
                  onClick={() => applyHeading("h3")}
                  title="Heading 3"
                />
                <ToolBtn
                  label="¶"
                  onClick={() => applyHeading("p")}
                  title="Paragraph"
                />
                <div className={styles.toolbarSep} />
                <ToolBtn
                  label="≡"
                  onClick={() => exec("justifyLeft")}
                  title="Align Left"
                />
                <ToolBtn
                  label="≡"
                  onClick={() => exec("justifyCenter")}
                  title="Center"
                  centerAlign
                />
                <ToolBtn
                  label="≡"
                  onClick={() => exec("justifyRight")}
                  title="Align Right"
                />
                <ToolBtn
                  label="≡"
                  onClick={() => exec("justifyFull")}
                  title="Justify"
                />
              </div>

              {/* Toolbar Row 2 */}
              <div className={`${styles.toolbar} ${styles.toolbarCompact}`}>
                <div className={styles.colorGroup}>
                  <div
                    className={`${styles.colorSwatch} ${styles.colorSwatchWhite}`}
                    onClick={() => applyTextColor("#ffffff")}
                    title="White text"
                  />
                  <div
                    className={`${styles.colorSwatch} ${styles.colorSwatchAmber}`}
                    onClick={() => applyTextColor("#f59e0b")}
                    title="Amber text"
                  />
                </div>

                <div className={styles.toolbarSep} />

                <label
                  className={styles.colorPickerWrap}
                  title="Custom text color"
                >
                  <input
                    type="color"
                    value={customColor}
                    className={styles.colorInputVisible}
                    aria-label="Custom text color"
                    title="Custom text color"
                    onChange={(e) => {
                      setCustomColor(e.target.value);
                      applyTextColor(e.target.value);
                    }}
                  />
                </label>

                <label
                  className={styles.colorPickerWrap}
                  title="Custom highlight color"
                >
                  <input
                    type="color"
                    value={customBg}
                    className={styles.colorInputVisible}
                    aria-label="Custom highlight color"
                    title="Custom highlight color"
                    onChange={(e) => {
                      setCustomBg(e.target.value);
                      applyBgColor(e.target.value);
                    }}
                  />
                </label>

                <div className={styles.toolbarSep} />
                <ToolBtn
                  label="• —"
                  onClick={() => exec("insertUnorderedList")}
                  title="Bullet List"
                />
                <ToolBtn
                  label="1."
                  onClick={() => exec("insertOrderedList")}
                  title="Numbered List"
                />
                <ToolBtn
                  label="→"
                  onClick={() => exec("indent")}
                  title="Indent"
                />
                <ToolBtn
                  label="←"
                  onClick={() => exec("outdent")}
                  title="Outdent"
                />
                <ToolBtn label="⎌" onClick={() => exec("undo")} title="Undo" />
                <ToolBtn label="⎋" onClick={() => exec("redo")} title="Redo" />
              </div>

              {/* Editable Area */}
              <div
                ref={editorRef}
                contentEditable
                suppressContentEditableWarning
                className={`${styles.editorArea} ${fontClass} ${fontSizeClass}`}
                onKeyDown={handleKeyDown}
                onKeyUp={handleKeyUp}
                onInput={handleInput}
                onPaste={handlePaste}
                spellCheck
              />

              {/* Footer */}
              <div className={styles.footer}>
                <div className={styles.footerStats}>
                  <StatItem label="Words:" value={words} tone="muted" />
                  <StatItem label="Chars:" value={chars} tone="muted" />
                  <StatItem label="Edits:" value={edits} tone="accent" />
                  <StatItem label="Pastes:" value={pastes} tone="muted" />
                </div>
                <div className={styles.footerActions}>
                  <span className={styles.footerHint}>
                    Ctrl+S to save quietly
                  </span>
                  <button
                    className={styles.saveBtn}
                    onClick={handleSaveSession}
                  >
                    Save session
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Sessions Tab */}
        {activeTab === "sessions" && (
          <div className={styles.tabContent}>
            <h2 className={styles.sectionTitle}>
              Writing Sessions — {fileData.name}
            </h2>

            {fileData.sessions.length === 0 ? (
              <p className={styles.emptyMsg}>
                No sessions saved yet. Write something and click "Save session".
              </p>
            ) : (
              <div className={styles.sessionList}>
                {[...fileData.sessions].reverse().map((session, index) => {
                  const verificationSessionId = session._id || session.id;

                  return (
                    <div key={session._id || session.id} className={styles.sessionCard}>
                      <div className={styles.sessionHeader}>
                        <h3 className={styles.sessionNum}>
                          Session #{fileData.sessions.length - index}
                        </h3>
                        <p className={styles.sessionDate}>
                          {session.createdAt
                            ? new Date(session.createdAt).toLocaleString()
                            : new Date(session.timestamp).toLocaleString()}
                        </p>
                      </div>

                      <div className={styles.sessionStats}>
                        <div className={styles.sessionStat}>
                          <p className={`${styles.sessionStatVal} ${styles.textDefault}`}>
                            {session.words}
                          </p>
                          <span className={styles.sessionStatLabel}>WORDS</span>
                        </div>

                        <div className={styles.sessionStat}>
                          <p className={`${styles.sessionStatVal} ${styles.textDefault}`}>
                            {session.chars}
                          </p>
                          <span className={styles.sessionStatLabel}>CHARS</span>
                        </div>

                        <div className={styles.sessionStat}>
                          <p className={`${styles.sessionStatVal} ${styles.textDefault}`}>
                            {session.edits}
                          </p>
                          <span className={styles.sessionStatLabel}>EDITS</span>
                        </div>

                        <div className={styles.sessionStat}>
                          <p className={`${styles.sessionStatVal} ${styles.textDefault}`}>
                            {session.pastes}
                          </p>
                          <span className={styles.sessionStatLabel}>PASTES</span>
                        </div>

                        <div className={styles.sessionStat}>
                          <p className={`${styles.sessionStatVal} ${styles.textAccent}`}>
                            {session.wpm}
                          </p>
                          <span className={styles.sessionStatLabel}>WPM</span>
                        </div>

                        <div className={styles.sessionStat}>
                          <p className={`${styles.sessionStatVal} ${styles.textDefault}`}>
                            {typeof session.duration === "string"
                              ? session.duration
                              : `${Math.floor(session.duration / 60)}m ${session.duration % 60}s`}
                          </p>
                          <span className={styles.sessionStatLabel}>DURATION</span>
                        </div>
                      </div>

                      <div className={styles.sessionActions}>
                        <button
                          type="button"
                          disabled={!isMongoObjectId(verificationSessionId)}
                          onClick={() => {
                            if (!isMongoObjectId(verificationSessionId)) return;
                            navigate(`/verify/${verificationSessionId}`);
                          }}
                          className={
                            isMongoObjectId(verificationSessionId)
                              ? styles.analysisButton
                              : `${styles.analysisButton} ${styles.analysisButtonDisabled}`
                          }
                        >
                          📊 View Analysis
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Overview Tab */}
        {activeTab === "overview" && (
          <div className={styles.tabContent}>
            <h2 className={styles.sectionTitle}>Overview — {fileData.name}</h2>

            {/* STEP 8: Display Authenticity Data */}
            {sessionAnalytics?.authenticity && (
              <div className="mb-8 p-6 bg-white/5 rounded-lg">
                <h2 className="text-2xl mb-4 text-amber-500">Authenticity Score</h2>
                <p className="text-3xl font-bold my-2">
                  {sessionAnalytics.authenticity.score} / 100
                </p>
                <p className="text-xl text-green-400 mb-4">
                  {sessionAnalytics.authenticity.label}
                </p>

                {sessionAnalytics.flags && sessionAnalytics.flags.length > 0 && (
                  <div className="mt-4">
                    {sessionAnalytics.flags.map((f: any, idx: number) => (
                      <div key={idx} className="text-red-500 py-2 text-sm">
                        ⚠ {f.message}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className={styles.overviewGrid}>
              <OverviewCard
                label="Total Sessions"
                value={totalSessions}
                icon="📝"
              />
              <OverviewCard label="Total Words" value={totalWords} icon="📖" />
              <OverviewCard label="Avg WPM" value={avgWpm} icon="⚡" accent />
              <OverviewCard
                label="Total Write Time"
                value={`${Math.floor(totalDuration / 60)}m ${totalDuration % 60}s`}
                icon="⏱️"
              />
              <OverviewCard
                label="Last Modified"
                value={new Date(fileData.lastModified).toLocaleDateString()}
                icon="📅"
              />
              <OverviewCard label="File Name" value={fileName} icon="📄" />
            </div>

            {fileData.sessions.length > 1 && (
              <>
                <h3 className={styles.sectionTitleSmall}>WPM Over Sessions</h3>
                <div className={styles.chart}>
                  <WpmChart sessions={fileData.sessions} />
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {toastMessage && (
        <Toast
          message={toastMessage.message}
          type={toastMessage.type}
          onClose={() => setToastMessage(null)}
        />
      )}
    </>
  );
}

function Badge({
  color,
  label,
  pulse,
}: {
  color: string;
  label: string;
  pulse?: boolean;
}) {
  const dotToneClass = color === "#f59e0b" ? styles.dotAmber : styles.dotGreen;
  const pulseClass = pulse ? styles.dotPulse : "";
  return (
    <div className={styles.badge}>
      <span className={`${styles.dot} ${dotToneClass} ${pulseClass}`} />
      <span className={styles.badgeLabel}>{label}</span>
    </div>
  );
}

function ToolBtn({
  label,
  onClick,
  bold,
  italic,
  underline,
  strike,
  title,
  centerAlign,
}: {
  label: string;
  onClick: () => void;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  title?: string;
  centerAlign?: boolean;
}) {
  const className = [
    styles.toolBtn,
    bold ? styles.toolBtnBold : "",
    italic ? styles.toolBtnItalic : "",
    underline ? styles.toolBtnUnderline : "",
    strike ? styles.toolBtnStrike : "",
    centerAlign ? styles.toolBtnCenter : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button className={className} onClick={onClick} title={title}>
      {label}
    </button>
  );
}

function StatItem({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | string;
  tone: "muted" | "accent";
}) {
  const toneClass =
    tone === "accent" ? styles.statItemAccent : styles.statItemMuted;
  return (
    <span className={`${styles.statItem} ${toneClass}`}>
      {label} <strong className={styles.statItemValue}>{value}</strong>
    </span>
  );
}

function OverviewCard({
  label,
  value,
  icon,
  accent,
}: {
  label: string;
  value: number | string;
  icon: string;
  accent?: boolean;
}) {
  return (
    <div className={styles.overviewCard}>
      <div className={styles.overviewIcon}>{icon}</div>
      <div
        className={`${styles.overviewValue} ${accent ? styles.textAccent : styles.textDefault}`}
      >
        {value}
      </div>
      <div className={styles.overviewLabel}>{label}</div>
    </div>
  );
}

function WpmChart({ sessions }: { sessions: Session[] }) {
  const max = Math.max(...sessions.map((s) => s.wpm), 1);
  return (
    <>
      {sessions.map((s, i) => {
        const barHeight = Math.max(4, Math.round((s.wpm / max) * 100));
        const y = 100 - barHeight;
        return (
          <div key={s.id} className={styles.chartBarWrap}>
            <svg
              className={styles.chartSvg}
              viewBox="0 0 32 100"
              role="img"
              aria-label={`Session ${i + 1}: ${s.wpm} WPM`}
            >
              <rect
                x="0"
                y={y}
                width="32"
                height={barHeight}
                className={styles.chartBarRect}
                rx="4"
                ry="4"
              />
            </svg>
            <span className={styles.chartLabel}>{i + 1}</span>
          </div>
        );
      })}
    </>
  );
}

export default function FileOpen() {
  const [searchParams] = useSearchParams();
  const fileId = searchParams.get("fileId");
  const fileName = searchParams.get("fileName");

  if (!fileId || !fileName) {
    return (
      <div className={styles.root}>
        <div className={styles.nav}>
          <div className={styles.navTabs} />
        </div>
        <div className={styles.divider} />
        <div className={styles.tabContent}>
          <h2 className={styles.sectionTitle}>Error</h2>
          <p className={styles.emptyMsg}>
            No file specified. Please select a file from the files list.
          </p>
        </div>
      </div>
    );
  }

  return <Editor fileId={fileId} fileName={fileName} />;
}

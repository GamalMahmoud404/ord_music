 "use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AudioLines, CircleUserRound, Disc3, Heart, ListMusic,
  Menu, Music2, Pause, Play, Radio, Repeat2, Search,
  Shuffle, SkipBack, SkipForward, Sparkles, Volume2, X, LogOut,
  Headphones, Check, Clock3, Upload, Music
} from "lucide-react";

type Track = {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: string;
  mood: string;
  color: string;
  cover: string;
  audio: string;
};

const artistCover = "/orb-cover.svg";
const MAX_UPLOAD_FILE_SIZE = 50 * 1024 * 1024;
const MAX_UPLOAD_BATCH_SIZE = 100 * 1024 * 1024;

type User = { name: string; email: string };

// Changing the audio source while play() is pending rejects with AbortError.
// That is expected when skipping tracks quickly and is not a playback failure.
function isPlaybackAbort(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

function playbackErrorMessage(audioUrl: string) {
  const localPath = audioUrl.startsWith("/uploads/") || audioUrl.startsWith("/api/audio/");
  const localHost = typeof window !== "undefined" &&
    (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");
  if (localPath && !localHost) {
    return "This song's audio file is not deployed. Configure Supabase Storage, run npm run storage:migrate, then reload.";
  }
  return "The audio file could not be loaded. Check that its URL returns 200 (not 404), then try again.";
}

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

function readStoredUser(raw: string | null): User | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;
    const { name, email } = value as { name?: unknown; email?: unknown };
    if (typeof name !== "string" || typeof email !== "string") return null;
    if (!name.trim() || !email.trim()) return null;
    return { name, email };
  } catch {
    return null;
  }
}

function readStoredFavorites(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.filter((id): id is string => typeof id === "string" && Boolean(id));
  } catch {
    return [];
  }
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  let data: unknown;
  try { data = text ? JSON.parse(text) : {}; }
  catch { throw new Error(`Server returned a non-JSON response (${response.status}). ${text.slice(0, 180)}`); }
  if (!response.ok) {
    const message = data && typeof data === "object" && "error" in data && typeof (data as { error?: unknown }).error === "string"
      ? (data as { error: string }).error
      : `Request failed (${response.status}).`;
    throw new Error(message);
  }
  return data as T;
}

// One automatic retry: on serverless hosting a cold start plus a slow database
// can fail the first list request, which used to leave the library empty even
// though the songs exist in the database.
async function loadTracks(): Promise<Track[]> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await readJsonResponse<Track[]>(await fetch("/api/tracks", { cache: "no-store" }));
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 700));
    }
  }
  throw lastError;
}

export default function HomePage() {
  const [activeTab, setActiveTab] = useState("Library");
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loadingTracks, setLoadingTracks] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [currentId, setCurrentId] = useState("");
  const [isPlaying, setIsPlaying] = useState(false);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [moodSync, setMoodSync] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [uploadArtist, setUploadArtist] = useState("");
  const [uploadAlbum, setUploadAlbum] = useState("");
  const [uploadMood, setUploadMood] = useState("");
  const [volume, setVolume] = useState(72);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [user, setUser] = useState<User | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [authName, setAuthName] = useState("");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [userMenu, setUserMenu] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [toast, setToast] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const currentIndex = tracks.findIndex((track) => track.id === currentId);
  const current = tracks[currentIndex] ?? tracks[0] ?? {
    id: "",
    title: loadError ? "Library unavailable" : "Your library is empty",
    artist: loadError ? "Check the database settings" : "Add your first song",
    album: "",
    duration: "0:00",
    mood: "Uncategorized",
    color: "#8deaff",
    cover: "",
    audio: "",
  };
  const moodStats = useMemo(() => {
    const counts = new Map<string, { count: number; color: string }>();
    tracks.forEach((track) => {
      const key = track.mood || "Uncategorized";
      const entry = counts.get(key) ?? { count: 0, color: track.color || "#8deaff" };
      entry.count += 1;
      counts.set(key, entry);
    });
    return [...counts.entries()].map(([name, entry]) => ({ name, ...entry, percent: tracks.length ? Math.round(entry.count / tracks.length * 100) : 0 })).sort((a, b) => b.count - a.count).slice(0, 5);
  }, [tracks]);

  useEffect(() => {
    let cancelled = false;
    loadTracks()
      .then((data) => {
        if (cancelled) return;
        setTracks(data);
        setCurrentId((previous) => data.some((track) => track.id === previous) ? previous : (data[0]?.id ?? ""));
        setLoadError("");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLoadError(error instanceof Error ? error.message : "Could not load your library.");
        setToast("Could not load songs from the database.");
      })
      .finally(() => {
        if (!cancelled) setLoadingTracks(false);
      });
    try {
      const savedUser = readStoredUser(localStorage.getItem("orb-music-user"));
      if (savedUser) setUser(savedUser);
      setFavorites(readStoredFavorites(localStorage.getItem("orb-music-favorites")));
    } catch {
      // Ignore browser storage that is unavailable (private mode, disabled cookies).
    }
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    };
  }, []);

  useEffect(() => {
    try { localStorage.setItem("orb-music-favorites", JSON.stringify(favorites)); } catch {}
  }, [favorites]);

  // The search panel advertises an ESC shortcut, and modal dialogs should also
  // close with Escape instead of trapping keyboard users.
  useEffect(() => {
    if (!searchOpen && !authOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setSearchOpen(false);
      setAuthOpen(false);
      setAuthError("");
      setAuthPassword("");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [searchOpen, authOpen]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = volume / 100;
  }, [volume]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      const promise = audio.play();
      if (promise) promise.catch((error: unknown) => {
        if (isPlaybackAbort(error)) return;
        setIsPlaying(false);
        setToast(playbackErrorMessage(current.audio));
      });
    } else {
      audio.pause();
    }
  }, [isPlaying, currentId, current.audio]);

  const filteredTracks = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const source = activeTab === "Favorites" ? tracks.filter((t) => favorites.includes(t.id)) : tracks;
    if (!normalized) return source;
    return source.filter((track) => `${track.title} ${track.artist} ${track.mood} ${track.album}`.toLowerCase().includes(normalized));
  }, [query, activeTab, favorites, tracks]);

  function notify(message: string) {
    setToast(message);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(""), 2600);
  }

  async function retryLoadTracks() {
    setLoadingTracks(true);
    try {
      const data = await loadTracks();
      setTracks(data);
      setCurrentId((previous) => data.some((track) => track.id === previous) ? previous : (data[0]?.id ?? ""));
      setLoadError("");
      notify(data.length ? `Loaded ${data.length} song${data.length === 1 ? "" : "s"}.` : "The database is reachable, but it contains no songs.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not load your library.";
      setLoadError(message);
      notify(message);
    } finally {
      setLoadingTracks(false);
    }
  }

  function startAudioPlayback() {
    const audio = audioRef.current;
    if (!audio || !current.audio) return;
    const promise = audio.play();
    if (promise) {
      promise.catch((error: unknown) => {
        if (isPlaybackAbort(error)) return;
        setIsPlaying(false);
        notify(playbackErrorMessage(current.audio));
      });
    }
  }

  function selectTrack(id: string, autoplay = true) {
    if (!id) return;
    // Keep the known duration when the same track is selected again (for example
    // the hero Play button resuming a paused song): a same-source play does not
    // emit loadedmetadata again, so clearing it would break the timeline.
    if (id !== currentId) {
      setCurrentId(id);
      setProgress(0);
      setDuration(0);
    }
    if (autoplay) setIsPlaying(true);
  }

  // Restarting the already-selected track (single-track library, repeat, or shuffle
  // landing on the same song) must replay it instead of doing nothing. After
  // `ended`, the browser has already paused the element, so calling play() again
  // is required even though React state still says isPlaying === true.
  function restartPlayback() {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = 0;
    setProgress(0);
    if (Number.isFinite(audio.duration)) setDuration(audio.duration);
    setIsPlaying(true);
    startAudioPlayback();
  }

  function toggleFavorite(id: string) {
    if (!id) return;
    setFavorites((prev) => prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]);
  }

  function nextTrack() {
    if (!tracks.length) return;
    const next = shuffle ? tracks[Math.floor(Math.random() * tracks.length)] : tracks[(currentIndex + 1) % tracks.length];
    if (!next) return;
    if (next.id === currentId) restartPlayback();
    else selectTrack(next.id);
  }

  function previousTrack() {
    const audio = audioRef.current;
    if (audio && audio.currentTime > 3) {
      audio.currentTime = 0;
      setProgress(0);
      return;
    }
    if (!tracks.length) return;
    const previous = tracks[(currentIndex - 1 + tracks.length) % tracks.length];
    if (!previous) return;
    if (previous.id === currentId) restartPlayback();
    else selectTrack(previous.id);
  }

  function handleAuth(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthError("");
    const email = authEmail.trim();
    if (!email.includes("@") || authPassword.length < 6) {
      setAuthError("Enter a valid email and a password with at least 6 characters.");
      return;
    }
    const displayName = authMode === "signup" ? authName.trim() : email.split("@")[0];
    if (authMode === "signup" && !displayName) {
      setAuthError("Please enter your name.");
      return;
    }
    const nextUser = { name: displayName, email };
    setUser(nextUser);
    try { localStorage.setItem("orb-music-user", JSON.stringify(nextUser)); } catch {}
    setAuthOpen(false);
    setAuthPassword("");
    setAuthName("");
    notify("Profile preview saved in this browser only.");
  }

  function signOut() {
    setUser(null);
    try { localStorage.removeItem("orb-music-user"); } catch {}
    setUserMenu(false);
    notify("You have signed out.");
  }

  function changeTab(tab: string) {
    setActiveTab(tab);
    setMobileMenu(false);
    setQuery("");
    if (tab === "Listen now" && tracks.length) setIsPlaying(true);
    if (tab === "Radio") notify("Radio needs a streaming-station source before it can play live stations.");
  }

  function readDuration(file: File): Promise<number> {
    return new Promise((resolve) => {
      const objectUrl = URL.createObjectURL(file);
      const probe = new Audio();
      let settled = false;
      const finish = (seconds: number) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        probe.onloadedmetadata = null;
        probe.onerror = null;
        URL.revokeObjectURL(objectUrl);
        resolve(Number.isFinite(seconds) && seconds > 0 ? seconds : 0);
      };
      // Some browsers never fire either event for an unreadable codec, which
      // used to leave the upload spinner running forever.
      const timeout = window.setTimeout(() => finish(0), 15000);
      probe.preload = "metadata";
      probe.onloadedmetadata = () => finish(probe.duration);
      probe.onerror = () => finish(0);
      probe.src = objectUrl;
    });
  }

  async function handleUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length) return;
    const oversized = files.find((file) => file.size > MAX_UPLOAD_FILE_SIZE);
    if (oversized) {
      const message = `"${oversized.name}" is larger than 50 MB. Choose a smaller audio file.`;
      setUploadError(message);
      notify(message);
      return;
    }
    const batchSize = files.reduce((total, file) => total + file.size, 0);
    if (batchSize > MAX_UPLOAD_BATCH_SIZE) {
      const message = "The selected batch is larger than 100 MB. Upload fewer songs at a time.";
      setUploadError(message);
      notify(message);
      return;
    }
    setUploading(true);
    setUploadError("");
    let added = 0;
    let firstTrack: Track | undefined;
    try {
      for (const file of files) {
        const durationSeconds = await readDuration(file);
        const signed = await readJsonResponse<{ uploadUrl: string; publicUrl: string; contentType: string }>(await fetch("/api/tracks/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileName: file.name, contentType: file.type || "application/octet-stream", size: file.size }),
        }));

        // Signed Storage uploads expect the file bytes, not multipart FormData.
        const storageResponse = await fetch(signed.uploadUrl, {
          method: "PUT",
          headers: {
            "x-upsert": "false",
            "Content-Type": file.type || signed.contentType || "application/octet-stream",
          },
          body: file,
        });
        if (!storageResponse.ok) {
          const storageText = await storageResponse.text().catch(() => "");
          throw new Error(`Storage upload failed (${storageResponse.status}). ${storageText.slice(0, 180)}`);
        }

        const registered = await readJsonResponse<{ track: Track }>(await fetch("/api/tracks/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fileName: file.name,
            contentType: file.type || signed.contentType,
            audio: signed.publicUrl,
            durationSeconds,
            artist: uploadArtist,
            album: uploadAlbum,
            mood: uploadMood,
          }),
        }));
        added += 1;
        if (!firstTrack) firstTrack = registered.track;
      }

      const refreshed = await loadTracks();
      setTracks(refreshed);
      if (firstTrack) { setCurrentId(firstTrack.id); setProgress(0); setIsPlaying(false); }
      setQuery("");
      setActiveTab("Library");
      notify(`Added ${added} song${added === 1 ? "" : "s"} to your library.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Upload failed.";
      setUploadError(added ? `${message} ${added} song(s) were uploaded successfully before the error.` : message);
      notify(message);
      // Refresh the list in case a prior file completed before a later file failed.
      loadTracks().then(setTracks).catch(() => notify("The song was saved, but refreshing the list failed. Reload the page to see it."));
    } finally {
      setUploading(false);
    }
  }

  return (
    <main className="orb-shell">
      <input ref={uploadInputRef} className="visually-hidden" type="file" accept="audio/*,.mp3,.wav,.ogg,.oga,.m4a,.aac,.flac,.webm" multiple onChange={handleUpload} />
      <div className="ambient ambient-a" /><div className="ambient ambient-b" /><div className="ambient ambient-c" />
      <header className="topbar">
        <Link className="brand" href="/" aria-label="Orb Music home" onClick={(event) => { event.preventDefault(); changeTab("Library"); }}>
          <span className="brand-icon"><AudioLines size={25} strokeWidth={2.3} /></span>
          <span>orb<span className="brand-light">music</span></span>
        </Link>

        <nav className={`main-nav ${mobileMenu ? "nav-open" : ""}`} aria-label="Main navigation">
          {["Listen now", "Moods", "Library", "Radio", "Favorites"].map((tab) => (
            <button key={tab} onClick={() => changeTab(tab)} className={`nav-link ${activeTab === tab ? "nav-selected" : ""}`}>
              {tab === "Listen now" && <Headphones size={15} />}
              {tab === "Moods" && <Sparkles size={15} />}
              {tab === "Library" && <Disc3 size={15} />}
              {tab === "Radio" && <Radio size={15} />}
              {tab === "Favorites" && <Heart size={15} />}
              {tab}
            </button>
          ))}
        </nav>

        <div className="header-actions">
          <button className={`mood-sync ${moodSync ? "sync-on" : ""}`} onClick={() => setMoodSync(!moodSync)} aria-pressed={moodSync}>
            <span className="switch"><span /></span><span>Mood sync</span>
          </button>
          <button className="icon-button search-trigger" aria-label="Search" onClick={() => setSearchOpen(!searchOpen)}>{searchOpen ? <X size={20} /> : <Search size={20} />}</button>
          <div className="profile-wrap">
            <button className="profile-avatar" aria-label="Account" onClick={() => user ? setUserMenu(!userMenu) : setAuthOpen(true)}>
              {user ? user.name.slice(0, 2).toUpperCase() : "MA"}
            </button>
            {userMenu && user && <div className="user-popover"><div className="popover-user"><CircleUserRound size={18}/><span><strong>{user.name}</strong><small>{user.email}</small></span></div><button onClick={signOut}><LogOut size={15}/> Sign out</button></div>}
          </div>
          <button className="icon-button mobile-menu-button" aria-label="Toggle menu" onClick={() => setMobileMenu(!mobileMenu)}>{mobileMenu ? <X size={20}/> : <Menu size={20}/>}</button>
        </div>
      </header>

      {searchOpen && <div className="search-panel"><Search size={18}/><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search songs, artists, albums or moods..." /><kbd>ESC</kbd><button onClick={() => {setQuery(""); setSearchOpen(false);}}>Close</button></div>}

      <div className="dashboard">
        <section className="album-panel glass">
          {loadError && (
            <div className="library-error" role="alert">
              <div>
                <strong>Your songs could not be loaded</strong>
                <span>{loadError}</span>
                <small>On Vercel, check DATABASE_URL under Project Settings → Environment Variables (Production and Preview), allow 0.0.0.0/0 in MongoDB Atlas Network Access, then redeploy.</small>
              </div>
              <button type="button" onClick={retryLoadTracks} disabled={loadingTracks}>{loadingTracks ? "Retrying…" : "Retry"}</button>
            </div>
          )}
          <div className="album-hero">
            <div className="cover-wrap"><Image className="album-cover" src={current.cover || artistCover} alt={`${current.album || current.title} cover`} fill sizes="(max-width: 600px) 104px, (max-width: 1150px) 155px, 215px" unoptimized priority /><span className="cover-shine" /></div>
            <div className="album-details">
              <div className="eyebrow-line"><span className="eyebrow">NOW IN YOUR LIBRARY</span><span className="mood-chip"><i style={{background:current.color}}/>{current.mood || "Uncategorized"}</span></div>
              <h1>{current.album || current.title}</h1>
              <div className="album-subtitle"><span className="artist-dot">{(current.artist || "?").slice(0, 1).toUpperCase()}</span><strong>{current.artist}</strong><span>·</span><span>{tracks.length} {tracks.length === 1 ? "song" : "songs"}</span><span>·</span><span>{current.duration}</span></div>
              <p className="album-description">Your library, built from songs you add to Orb Music.</p>
              <div className="hero-controls">
                <button className="primary-play" disabled={!tracks.length} onClick={() => isPlaying ? setIsPlaying(false) : selectTrack(current.id)}>{isPlaying ? <Pause size={17} fill="currentColor"/> : <Play size={17} fill="currentColor"/>}{isPlaying ? "Pause" : "Play track"}</button>
                <button className="round-control" aria-label="Add songs from your device" title="Add songs" disabled={uploading} onClick={() => uploadInputRef.current?.click()}>{uploading ? <span className="upload-spinner"/> : <Upload size={19}/>}</button>
                <button className={`round-control ${favorites.includes(current.id) ? "control-on" : ""}`} aria-label="Favorite current song" disabled={!tracks.length} onClick={() => toggleFavorite(current.id)}><Heart size={19} fill={favorites.includes(current.id) ? "currentColor" : "none"}/></button>
                <button className={`round-control ${shuffle ? "control-on" : ""}`} aria-label="Shuffle" onClick={() => setShuffle(!shuffle)}><Shuffle size={19}/></button>
              </div>
            </div>
          </div>

          <div className="section-heading"><div><span className="section-kicker">{activeTab === "Favorites" ? "YOUR COLLECTION" : "YOUR SOUNDTRACK"}</span><h2>{activeTab === "Favorites" ? "Your favorites" : activeTab === "Moods" ? "Browse by mood" : activeTab === "Listen now" ? "Listen now" : activeTab === "Radio" ? "Radio" : "Your library"}</h2></div><button className="subtle-button" disabled={uploading} onClick={() => uploadInputRef.current?.click()}>{uploading ? <span className="upload-spinner"/> : <Upload size={14}/>} {uploading ? "Uploading…" : "Add songs"}</button></div>
          <div className="upload-metadata">
            <label>Artist<input value={uploadArtist} onChange={(event) => setUploadArtist(event.target.value)} placeholder="Unknown artist" /></label>
            <label>Album<input value={uploadAlbum} onChange={(event) => setUploadAlbum(event.target.value)} placeholder="Unknown album" /></label>
            <label>Mood<input value={uploadMood} onChange={(event) => setUploadMood(event.target.value)} placeholder="Uncategorized" /></label>
          </div>
          {uploadError && <div className="upload-error" role="alert">{uploadError}</div>}

          <div className="track-table">
            <div className="track-head"><span>#</span><span>Title</span><span className="mood-col">Mood</span><span className="heart-col"><Heart size={14}/></span><span className="time-col"><Clock3 size={14}/></span></div>
            {filteredTracks.map((track, index) => (
              <div key={track.id} className={`track-row ${current.id === track.id ? "track-active" : ""}`} onDoubleClick={() => selectTrack(track.id)}>
                <button className="track-index" aria-label={`Play ${track.title}`} onClick={() => selectTrack(track.id)}>{current.id === track.id && isPlaying ? <AudioLines size={16} className="playing-bars"/> : <span>{String(index + 1).padStart(2, "0")}</span>}</button>
                <button className="track-main" onClick={() => current.id === track.id ? setIsPlaying(!isPlaying) : selectTrack(track.id)}><Image src={track.cover || artistCover} alt="" width={39} height={39} unoptimized /><span className="track-copy"><strong>{track.title}</strong><small>{track.artist}</small></span></button>
                <span className="track-mood"><span className="mood-chip"><i style={{background:track.color}}/>{track.mood}</span></span>
                <button className={`track-heart ${favorites.includes(track.id) ? "heart-on" : ""}`} aria-label={`Favorite ${track.title}`} onClick={() => toggleFavorite(track.id)}><Heart size={17} fill={favorites.includes(track.id) ? "currentColor" : "none"}/></button>
                <span className="track-time">{track.duration}</span>
              </div>
            ))}
            {loadingTracks && <div className="empty-state"><span className="upload-spinner"/><strong>Loading your library</strong><span>Connecting to the database…</span></div>}
            {!loadingTracks && filteredTracks.length === 0 && (
              <div className="empty-state">
                <Music2 size={24}/>
                <strong>{loadError ? "Your library could not be loaded" : "No tracks found"}</strong>
                <span>{loadError ? "Fix the database settings above, then press Retry." : activeTab === "Favorites" ? "Favorite songs to see them here." : "Try a different search, or add songs to your library."}</span>
              </div>
            )}
          </div>
          <div className="library-footnote"><span><Music size={14}/> Songs loaded from your database</span><span>{filteredTracks.length} tracks</span></div>
        </section>

        <aside className="right-column">
          <section className="mood-panel glass">
            <div className="panel-heading"><div><span className="section-kicker">YOUR COLLECTION</span><h2>Library by mood</h2></div><span className="muted-caption">{tracks.length} total</span></div>
            {moodStats.length ? <>
              <div className="mood-stacked" aria-label="Mood distribution">{moodStats.map((mood) => <span key={mood.name} title={`${mood.name}: ${mood.percent}%`} style={{width:`${mood.percent}%`,background:mood.color}}/>)}</div>
              <div className="mood-list">{moodStats.map((mood) => <div className="mood-list-row" key={mood.name}><span><i style={{background:mood.color}}/>{mood.name}</span><strong>{mood.count} · {mood.percent}%</strong></div>)}</div>
            </> : <div className="library-empty-note"><Music size={22}/><span>Add songs to see your real library statistics here.</span></div>}
            <div className={`mood-sync-note ${moodSync ? "" : "note-paused"}`}><span className="sync-dot"/>{moodSync ? "Stats update from your saved songs" : "Mood sync is paused"}</div>
          </section>

          <section className="artist-panel glass">
            <div className="artist-image-wrap"><Image className="artist-image" src={current.cover || artistCover} alt={`${current.artist} cover`} fill sizes="(max-width: 850px) 100vw, 400px" unoptimized /><span className="artist-image-gradient"/></div>
            <div className="artist-content">
              <div className="artist-heading"><div><span className="section-kicker">CURRENT SELECTION</span><h2>{current.artist}</h2></div><span className="track-count-pill">{tracks.length} tracks</span></div>
              <p><strong>{current.title}</strong>{current.album ? ` · ${current.album}` : ""}. This panel reflects the song currently selected in your library.</p>
              <div className="artist-stats"><span><Disc3 size={14}/> {current.album || "No album set"}</span><span><Clock3 size={14}/> {current.duration}</span></div>
              <div className="artist-divider"/>
              <div className="artist-bottom"><span><Headphones size={16}/> <strong>Local music library</strong></span><button aria-label="Add songs" onClick={() => uploadInputRef.current?.click()}><Upload size={17}/></button></div>
            </div>
          </section>
        </aside>
      </div>

      <footer className="player-bar">
        <audio ref={audioRef} src={current.audio || undefined} preload="metadata" onTimeUpdate={(event) => setProgress(event.currentTarget.currentTime)} onLoadedMetadata={(event) => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)} onEnded={() => repeat ? restartPlayback() : nextTrack()} onError={() => { if (isPlaying) { setIsPlaying(false); notify(playbackErrorMessage(current.audio)); } }} />
        <div className="now-playing"><Image src={current.cover || artistCover} alt="" width={48} height={48} unoptimized /><div className="now-copy"><strong>{current.title}</strong><span>{current.artist}</span></div><button className={`now-heart ${favorites.includes(current.id) ? "heart-on" : ""}`} aria-label="Favorite current track" disabled={!tracks.length} onClick={() => toggleFavorite(current.id)}><Heart size={17} fill={favorites.includes(current.id) ? "currentColor" : "none"}/></button></div>
        <div className="player-center"><div className="transport-controls"><button className={shuffle ? "transport-active" : ""} aria-label="Shuffle" onClick={() => setShuffle(!shuffle)}><Shuffle size={17}/></button><button aria-label="Previous track" disabled={!tracks.length} onClick={previousTrack}><SkipBack size={19} fill="currentColor"/></button><button className="transport-play" aria-label={isPlaying ? "Pause" : "Play"} disabled={!tracks.length} onClick={() => setIsPlaying(!isPlaying)}>{isPlaying ? <Pause size={17} fill="currentColor"/> : <Play size={17} fill="currentColor"/>}</button><button aria-label="Next track" disabled={!tracks.length} onClick={nextTrack}><SkipForward size={19} fill="currentColor"/></button><button className={repeat ? "transport-active" : ""} aria-label="Repeat" onClick={() => setRepeat(!repeat)}><Repeat2 size={17}/></button></div><div className="timeline"><span>{formatTime(progress)}</span><input aria-label="Track progress" type="range" min="0" max={duration || 100} value={Math.min(progress, duration || 100)} onChange={(event) => { const value = Number(event.target.value); if (audioRef.current) audioRef.current.currentTime = value; setProgress(value); }} style={{"--range-progress":`${duration ? progress / duration * 100 : 0}%`} as React.CSSProperties}/><span>{duration ? formatTime(duration) : current.duration}</span></div></div>
        <div className="player-right"><span className="volume-icon"><Volume2 size={18}/></span><input aria-label="Volume" type="range" min="0" max="100" value={volume} onChange={(event) => setVolume(Number(event.target.value))} style={{"--range-progress":`${volume}%`} as React.CSSProperties}/><button aria-label="Queue" onClick={() => notify("Queue is ready for the next version.")}><ListMusic size={19}/></button></div>
      </footer>

      {authOpen && <div className="modal-backdrop" onMouseDown={(event) => {if(event.target === event.currentTarget) {setAuthOpen(false);setAuthError("");}}}><section className="auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-title"><button className="modal-close" aria-label="Close" onClick={() => {setAuthOpen(false);setAuthError("");}}><X size={19}/></button><div className="auth-logo"><AudioLines size={26}/></div><span className="section-kicker">WELCOME TO YOUR FREQUENCY</span><h2 id="auth-title">{authMode === "login" ? "Welcome back" : "Create your account"}</h2><p className="auth-subtitle">{authMode === "login" ? "Profile preview only; secure server-side accounts are not configured yet." : "This profile preview is stored in this browser only."}</p><form onSubmit={handleAuth}>{authMode === "signup" && <label>Your name<input required value={authName} onChange={(event) => setAuthName(event.target.value)} placeholder="How should we call you?"/></label>}<label>Email address<input required type="email" value={authEmail} onChange={(event) => setAuthEmail(event.target.value)} placeholder="you@example.com"/></label><label>Password<input required type="password" minLength={6} value={authPassword} onChange={(event) => setAuthPassword(event.target.value)} placeholder="At least 6 characters"/></label>{authError && <div className="auth-error">{authError}</div>}<button className="auth-submit" type="submit">{authMode === "login" ? "Sign in" : "Create account"}</button></form><div className="auth-switch">{authMode === "login" ? "New to Orb Music?" : "Already have an account?"}<button onClick={() => {setAuthMode(authMode === "login" ? "signup" : "login");setAuthError("");}}>{authMode === "login" ? "Create an account" : "Sign in"}</button></div><p className="auth-disclaimer">This is not secure authentication. Do not enter a real password.</p></section></div>}

      {toast && <div className="toast-message"><span><Check size={16}/></span>{toast}</div>}
      <div className="copyright">ORBIT YOUR OWN SOUND <span>·</span> ORB MUSIC © 2026</div>
    </main>
  );
}

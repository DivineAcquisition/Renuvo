"use client";

/**
 * The tutorial video player: the browser's own <video> with Selestial's controls, so every control is a
 * real button or slider a keyboard and a screen reader can use. It never starts by itself and never plays
 * sound unasked. Captions come from the tutorial's WebVTT file and are on by default.
 *
 * Nothing loads until the dialog opens (the player only mounts then), and only the video's metadata until
 * the owner presses play. If the video cannot load, the player says so and offers a retry; the written
 * steps beside it always remain.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { Captions, Maximize, Minimize, Pause, Play, RefreshCw, TriangleAlert, Volume2, VolumeX } from "@/components/icons";
import { cn } from "@/lib/utils";

import type { Media } from "../../../../convex/lib/tutorials/catalog";

export type PlayerEvent = "play_started" | "play_completed" | "play_failed";

const SPEEDS = [0.75, 1, 1.25, 1.5, 2] as const;

export function clock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

const control =
  "inline-flex size-10 shrink-0 items-center justify-center rounded-lg text-white hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-white sm:size-9";

export function TutorialPlayer({ media, title, onEvent }: { media: Media; title: string; onEvent?: (event: PlayerEvent) => void }) {
  const frame = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const started = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(media.durationSeconds);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const [captions, setCaptions] = useState(true);
  const [full, setFull] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [announce, setAnnounce] = useState("");

  const event = useRef(onEvent);
  useEffect(() => {
    event.current = onEvent;
  }, [onEvent]);

  // Captions: the one track, shown or hidden. Re-applied after a retry reloads the element.
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    const apply = () => {
      for (const track of Array.from(element.textTracks)) track.mode = captions ? "showing" : "hidden";
    };
    apply();
    element.textTracks.addEventListener?.("addtrack", apply);
    return () => element.textTracks.removeEventListener?.("addtrack", apply);
  }, [captions, attempt]);

  useEffect(() => {
    const onChange = () => setFull(document.fullscreenElement === frame.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // Closing the dialog unmounts the player: stop playback and leave full screen first.
  useEffect(() => {
    const element = video.current;
    const container = frame.current;
    return () => {
      element?.pause();
      if (document.fullscreenElement && document.fullscreenElement === container) void document.exitFullscreen().catch(() => undefined);
    };
  }, []);

  const toggle = useCallback(() => {
    const element = video.current;
    if (!element || failed) return;
    if (element.paused || element.ended) void element.play().catch(() => undefined);
    else element.pause();
  }, [failed]);

  const seekBy = useCallback((delta: number) => {
    const element = video.current;
    if (!element) return;
    element.currentTime = Math.min(Math.max(element.currentTime + delta, 0), element.duration || duration);
    setAnnounce(`${clock(element.currentTime)} of ${clock(element.duration || duration)}`);
  }, [duration]);

  const toggleMute = useCallback(() => {
    const element = video.current;
    if (!element) return;
    element.muted = !element.muted;
    setMuted(element.muted);
    setAnnounce(element.muted ? "Sound off" : "Sound on");
  }, []);

  const toggleCaptions = useCallback(() => {
    setCaptions((on) => {
      setAnnounce(on ? "Captions off" : "Captions on");
      return !on;
    });
  }, []);

  const toggleFull = useCallback(() => {
    const container = frame.current;
    const element = video.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
    if (!container || !element) return;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else if (container.requestFullscreen) void container.requestFullscreen().catch(() => element.webkitEnterFullscreen?.());
    // iPhone Safari has no element full screen; its own video full screen keeps captions.
    else element.webkitEnterFullscreen?.();
  }, []);

  function retry() {
    setFailed(false);
    started.current = false;
    setAttempt((n) => n + 1);
  }

  /** Shortcuts while focus is in the player, except where a slider or menu uses the key itself. */
  function onKeyDown(keyEvent: React.KeyboardEvent<HTMLDivElement>) {
    const target = keyEvent.target as HTMLElement;
    const own = target.tagName === "INPUT" || target.tagName === "SELECT";
    const key = keyEvent.key.toLowerCase();
    if ((key === " " && target.tagName !== "BUTTON" && !own) || key === "k") {
      keyEvent.preventDefault();
      toggle();
    } else if (!own && key === "arrowleft") {
      keyEvent.preventDefault();
      seekBy(-5);
    } else if (!own && key === "arrowright") {
      keyEvent.preventDefault();
      seekBy(5);
    } else if (key === "j") seekBy(-10);
    else if (key === "l") seekBy(10);
    else if (key === "m") toggleMute();
    else if (key === "c") toggleCaptions();
    else if (key === "f") toggleFull();
  }

  const shown = duration || media.durationSeconds;

  return (
    <div
      ref={frame}
      className={cn("group/player relative overflow-hidden rounded-xl bg-black text-white", full && "flex items-center")}
      role="group"
      aria-label={`Video: ${title}`}
      onKeyDown={onKeyDown}
    >
      <video
        key={attempt}
        ref={video}
        className="aspect-video w-full bg-black"
        poster={media.poster}
        preload="metadata"
        playsInline
        crossOrigin="anonymous"
        onClick={toggle}
        onPlay={() => {
          setPlaying(true);
          if (!started.current) {
            started.current = true;
            event.current?.("play_started");
          }
        }}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          event.current?.("play_completed");
        }}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => {
          if (Number.isFinite(e.currentTarget.duration)) setDuration(e.currentTarget.duration);
          e.currentTarget.playbackRate = speed;
          e.currentTarget.volume = volume;
          e.currentTarget.muted = muted;
        }}
        onError={() => {
          setFailed(true);
          setPlaying(false);
          event.current?.("play_failed");
        }}
      >
        <source src={media.video} type="video/mp4" />
        <track kind="captions" src={media.captions} srcLang="en" label="English" default />
      </video>

      {failed ? (
        <div className="absolute inset-0 grid place-items-center bg-black/85 p-4 text-center" role="alert">
          <div className="grid max-w-sm justify-items-center gap-3">
            <TriangleAlert className="size-6 text-amber-300" aria-hidden />
            <p className="text-sm">The video didn&apos;t load. The written steps below cover the same thing.</p>
            <button type="button" onClick={retry} className="inline-flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm font-medium text-black hover:bg-white/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
              <RefreshCw className="size-4" aria-hidden />
              Try again
            </button>
          </div>
        </div>
      ) : !playing && time === 0 ? (
        <button
          type="button"
          onClick={toggle}
          className="absolute inset-0 m-auto grid size-16 place-items-center rounded-full bg-white/95 text-black shadow-lg hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white motion-reduce:transition-none"
          aria-label={`Play video, ${clock(shown)}`}
        >
          <Play className="ml-0.5 size-7" weight="fill" aria-hidden />
        </button>
      ) : null}

      <div className={cn("absolute inset-x-0 bottom-0 flex flex-wrap items-center gap-x-1 gap-y-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent px-2 pt-6 pb-1.5", failed && "hidden")}>
        <button type="button" className={control} onClick={toggle} aria-label={playing ? "Pause" : "Play"}>
          {playing ? <Pause className="size-5" weight="fill" aria-hidden /> : <Play className="size-5" weight="fill" aria-hidden />}
        </button>
        <span className="w-[5.5rem] shrink-0 text-xs tabular-nums" aria-hidden>
          {clock(time)} / {clock(shown)}
        </span>
        <input
          type="range"
          min={0}
          max={Math.max(shown, 1)}
          step={0.1}
          value={Math.min(time, shown)}
          onChange={(e) => {
            const element = video.current;
            if (element) element.currentTime = Number(e.target.value);
            setTime(Number(e.target.value));
          }}
          aria-label="Seek"
          aria-valuetext={`${clock(time)} of ${clock(shown)}`}
          className="order-first h-6 w-full min-w-0 cursor-pointer accent-[#8e6df6] sm:order-none sm:w-auto sm:flex-1"
        />
        <button type="button" className={control} onClick={toggleMute} aria-label={muted ? "Turn sound on" : "Mute"} aria-pressed={muted}>
          {muted || volume === 0 ? <VolumeX className="size-5" aria-hidden /> : <Volume2 className="size-5" aria-hidden />}
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={muted ? 0 : volume}
          onChange={(e) => {
            const element = video.current;
            const next = Number(e.target.value);
            setVolume(next);
            setMuted(next === 0);
            if (element) {
              element.volume = next;
              element.muted = next === 0;
            }
          }}
          aria-label="Volume"
          aria-valuetext={`${Math.round((muted ? 0 : volume) * 100)}%`}
          className="hidden h-6 w-20 cursor-pointer accent-white sm:block"
        />
        <label className="sr-only" htmlFor={`speed-${attempt}`}>
          Playback speed
        </label>
        <select
          id={`speed-${attempt}`}
          value={speed}
          onChange={(e) => {
            const next = Number(e.target.value) as (typeof SPEEDS)[number];
            setSpeed(next);
            if (video.current) video.current.playbackRate = next;
          }}
          className="h-9 shrink-0 cursor-pointer rounded-lg bg-transparent px-1.5 text-xs font-medium text-white hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-white [&>option]:text-black"
        >
          {SPEEDS.map((value) => (
            <option key={value} value={value}>
              {value}×
            </option>
          ))}
        </select>
        <button type="button" className={cn(control, captions && "bg-white/15")} onClick={toggleCaptions} aria-label="Captions" aria-pressed={captions}>
          <Captions className="size-5" aria-hidden />
        </button>
        <button type="button" className={control} onClick={toggleFull} aria-label={full ? "Exit full screen" : "Full screen"}>
          {full ? <Minimize className="size-5" aria-hidden /> : <Maximize className="size-5" aria-hidden />}
        </button>
      </div>
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>
    </div>
  );
}

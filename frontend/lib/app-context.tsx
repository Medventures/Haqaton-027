"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api } from "./api";
import type { Role, Settings } from "./types";

export interface PageMeta {
  title: string;
  subtitle?: string;
}

export type Lang = "ru" | "kk";

interface AppCtx {
  lang: Lang;
  setLang: (l: Lang) => void;
  page: PageMeta;
  setPage: (m: PageMeta) => void;
  shellVersion: number;
  refreshShell: () => void;
  role: Role;
  setRole: (r: Role) => void;
  ready: boolean;
  settings: Settings | null;
  refreshSettings: () => Promise<void>;
  myCases: number[];
  rememberCase: (id: number) => void;
}

const Ctx = createContext<AppCtx | null>(null);
const ROLE_KEY = "aqylroute.role";
const MY_CASES_KEY = "aqylroute.myCases";
const LANG_KEY = "aqylroute.lang";

function readJson<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [role, setRoleState] = useState<Role>("parent");
  const [ready, setReady] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [myCases, setMyCases] = useState<number[]>([]);
  const [page, setPage] = useState<PageMeta>({ title: "AqylRoute AI" });
  const [lang, setLangState] = useState<Lang>("ru");
  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem(LANG_KEY, l);
    } catch {}
  }, []);
  const [shellVersion, setShellVersion] = useState(0);
  const refreshShell = useCallback(() => setShellVersion((v) => v + 1), []);

  useEffect(() => {
    const saved = readJson<string | null>(ROLE_KEY, null);
    if (saved === "parent" || saved === "curator") setRoleState(saved);
    setMyCases(readJson<number[]>(MY_CASES_KEY, []));
    try {
      if (localStorage.getItem(LANG_KEY) === "kk") setLangState("kk");
    } catch {}
    setReady(true);
  }, []);

  const setRole = useCallback((r: Role) => {
    setRoleState(r);
    try {
      localStorage.setItem(ROLE_KEY, JSON.stringify(r));
    } catch {}
  }, []);

  // Родитель видит только свои кейсы: браузер запоминает кейсы, созданные или открытые родителем.
  const rememberCase = useCallback((id: number) => {
    setMyCases((prev) => {
      if (prev.includes(id)) return prev;
      const next = [...prev, id];
      try {
        localStorage.setItem(MY_CASES_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  }, []);

  const refreshSettings = useCallback(async () => {
    try {
      setSettings(await api<Settings>("parent", "/settings"));
    } catch {
      setSettings(null);
    }
  }, []);

  useEffect(() => {
    refreshSettings();
  }, [refreshSettings]);

  return (
    <Ctx.Provider value={{ lang, setLang, page, setPage, shellVersion, refreshShell, role, setRole, ready, settings, refreshSettings, myCases, rememberCase }}>
      {children}
    </Ctx.Provider>
  );
}

export function useApp(): AppCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useApp outside AppProvider");
  return c;
}

/** Заголовок и подзаголовок экрана для шапки. */
export function usePageMeta(title: string, subtitle?: string) {
  const { setPage } = useApp();
  useEffect(() => {
    setPage({ title, subtitle });
  }, [title, subtitle, setPage]);
}

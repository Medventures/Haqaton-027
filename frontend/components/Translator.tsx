"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { Lang } from "@/lib/app-context";

/**
 * Казахская версия интерфейса: переводит видимый текст страницы через /api/i18n/translate.
 * Меняются только текстовые узлы и подсказки (placeholder, title, aria-label) — значения ответов,
 * которые уходят на сервер, остаются русскими, поэтому правила плана не затрагиваются.
 * При сбое перевода остаётся русский текст. Элементы с классом .no-translate не переводятся.
 */

const CACHE_KEY = "aqylroute.i18n.kk";
const ATTRS = ["placeholder", "title", "aria-label"] as const;
const HAS_CYRILLIC = /[А-Яа-яЁё]/;
const SKIP = "script,style,textarea,input,select,option,.no-translate,[contenteditable]";

const cache = new Map<string, string>();
const origText = new Map<Text, string>();
const applied = new WeakMap<Node, string>();
const origAttr = new Map<Element, Record<string, string>>();
const pending = new Set<string>();
let loaded = false;

function loadCache() {
  if (loaded) return;
  loaded = true;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) for (const [k, v] of Object.entries(JSON.parse(raw) as Record<string, string>)) cache.set(k, v);
  } catch {}
}

function saveCache() {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(cache)));
  } catch {}
}

function skip(el: Element | null): boolean {
  return !el || !!el.closest(SKIP);
}

function processText(node: Text) {
  const value = node.nodeValue ?? "";
  if (applied.get(node) === value) return; // наш собственный перевод
  if (skip(node.parentElement)) return;
  const core = value.trim();
  if (!core || !HAS_CYRILLIC.test(core)) return;
  origText.set(node, value);
  const tr = cache.get(core);
  if (tr) {
    const next = value.replace(core, tr);
    applied.set(node, next);
    node.nodeValue = next;
  } else pending.add(core);
}

function processAttrs(el: Element) {
  if (skip(el.parentElement) && !el.matches("input,textarea")) return;
  for (const a of ATTRS) {
    const value = el.getAttribute(a);
    if (!value) continue;
    const key = `${a}`;
    const orig = origAttr.get(el) ?? {};
    if (applied.get(el) === `${key}:${value}`) continue;
    const core = value.trim();
    if (!HAS_CYRILLIC.test(core)) continue;
    orig[key] = value;
    origAttr.set(el, orig);
    const tr = cache.get(core);
    if (tr) {
      applied.set(el, `${key}:${tr}`);
      el.setAttribute(a, tr);
    } else pending.add(core);
  }
}

function walk(root: Node) {
  if (root.nodeType === Node.TEXT_NODE) {
    processText(root as Text);
    return;
  }
  if (!(root instanceof Element)) return;
  const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let n: Node | null;
  while ((n = tw.nextNode())) processText(n as Text);
  if (root.matches("[placeholder],[title],[aria-label]")) processAttrs(root);
  root.querySelectorAll("[placeholder],[title],[aria-label]").forEach(processAttrs);
}

function restoreAll() {
  for (const [node, orig] of origText) if (node.isConnected && applied.get(node) === node.nodeValue) node.nodeValue = orig;
  for (const [el, attrs] of origAttr) for (const [a, v] of Object.entries(attrs)) if (el.isConnected) el.setAttribute(a, v);
  origText.clear();
  origAttr.clear();
  pending.clear();
}

export function Translator({ lang }: { lang: Lang }) {
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    document.documentElement.lang = lang;
    if (lang !== "kk") {
      restoreAll();
      return;
    }
    loadCache();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    async function flush() {
      timer = null;
      if (!pending.size) return;
      const texts = [...pending].slice(0, 200);
      texts.forEach((t) => pending.delete(t));
      setBusy(true);
      try {
        const r = await api<{ translations: Record<string, string> }>("parent", "/i18n/translate", {
          method: "POST",
          body: { lang: "kk", texts },
        });
        for (const [k, v] of Object.entries(r.translations)) cache.set(k, v);
        saveCache();
      } catch {
        // сбой перевода — остаётся русский текст
      } finally {
        setBusy(false);
      }
      if (!stopped) {
        walk(document.body);
        schedule();
      }
    }
    function schedule() {
      if (pending.size && !timer) timer = setTimeout(flush, 150);
    }

    walk(document.body);
    schedule();
    const obs = new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.type === "characterData") processText(m.target as Text);
        else if (m.type === "attributes") processAttrs(m.target as Element);
        else m.addedNodes.forEach(walk);
      }
      schedule();
    });
    obs.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...ATTRS] });
    return () => {
      stopped = true;
      obs.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, [lang]);

  return busy && lang === "kk" ? (
    <div className="translating no-translate" role="status">
      Аударылуда…
    </div>
  ) : null;
}

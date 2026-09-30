"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Chip } from "@/components/Badges";
import { api } from "@/lib/api";
import { useApp, usePageMeta } from "@/lib/app-context";
import type { CaseView, Provider, ProviderType } from "@/lib/types";

interface ProvidersResponse {
  providers: Provider[];
  cities: string[];
  types: Record<ProviderType, string>;
}

/** «Услуги»: demo directory of organizations. Only city and type filters — no ratings, no personalisation, no LLM. */
export default function ServicesPage() {
  const { id } = useParams<{ id: string }>();
  const { ready, role, setRole, rememberCase } = useApp();
  const [city, setCity] = useState<string | null>(null);
  const [type, setType] = useState<ProviderType | "">("");
  const [data, setData] = useState<ProvidersResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  usePageMeta("Услуги", "Справочник организаций · демо-данные");

  useEffect(() => {
    if (ready && role !== "parent") setRole("parent");
    if (ready) rememberCase(Number(id));
  }, [ready, role, setRole, rememberCase, id]);

  // The case city is the default filter.
  useEffect(() => {
    if (!ready || city !== null) return;
    api<CaseView>("parent", `/cases/${id}`)
      .then((c) => setCity(c.city))
      .catch(() => setCity(""));
  }, [ready, id, city]);

  useEffect(() => {
    if (city === null) return;
    const q = new URLSearchParams();
    if (city) q.set("city", city);
    if (type) q.set("type", type);
    api<ProvidersResponse>("parent", `/providers?${q}`)
      .then(setData)
      .catch((e) => setError((e as Error).message));
  }, [city, type]);

  const cities = data?.cities ?? [];

  return (
    <div className="stack" style={{ maxWidth: 1080, gap: 16 }}>
      <div className="alert alert-info">
        Справочник организаций. Мы не рекомендуем специалистов и методы и не оцениваем качество. Выбор делается вместе с врачом
        или по заключению ПМПК.
      </div>

      <div className="row wrap gap-sm">
        <label className="field-inline">
          <span className="hint">Город</span>
          <select className="input input-sm" value={city ?? ""} onChange={(e) => setCity(e.target.value)}>
            <option value="">Все города</option>
            {city && !cities.includes(city) && <option value={city}>{city}</option>}
            {cities.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="field-inline">
          <span className="hint">Тип</span>
          <select className="input input-sm" value={type} onChange={(e) => setType(e.target.value as ProviderType | "")}>
            <option value="">Все типы</option>
            {Object.entries(data?.types ?? {}).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {data && data.providers.length === 0 && (
        <div className="card muted">В этом городе организаций в демо-справочнике нет. Выберите другой город или «Все города».</div>
      )}
      <div className="provider-grid">
        {data?.providers.map((p) => (
          <article key={p.id} className="card stack-sm provider-card">
            <div className="row gap-xs wrap">
              <Chip tone="accent">{p.type_label}</Chip>
            </div>
            <b>{p.name}</b>
            <span className="small muted">{p.city}</span>
            {p.description && <span className="small">{p.description}</span>}
          </article>
        ))}
      </div>
    </div>
  );
}

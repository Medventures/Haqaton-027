"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect } from "react";
import { DocFolder } from "@/components/DocFolder";
import { useApp } from "@/lib/app-context";

export default function MyFolderPage() {
  const { id } = useParams<{ id: string }>();
  const { ready, role, setRole, rememberCase } = useApp();

  useEffect(() => {
    if (ready && role !== "parent") setRole("parent");
    if (ready) rememberCase(Number(id));
  }, [ready, role, setRole, rememberCase, id]);

  return (
    <div className="stack">
      <div>
        <Link href={`/parent/cases/${id}`} className="muted small">
          ← Мой маршрут
        </Link>
        <h1 className="h-page">Моя папка документов</h1>
        <p className="muted small">
          Отметьте документ один раз — он учтётся во всех шагах маршрута и в чек-листах. Повторно собирать не нужно.
        </p>
      </div>
      <div className="card">{ready && <DocFolder caseId={Number(id)} role="parent" />}</div>
    </div>
  );
}

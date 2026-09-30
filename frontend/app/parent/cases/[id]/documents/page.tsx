"use client";

import { useParams } from "next/navigation";
import { useEffect } from "react";
import { DocFolder } from "@/components/DocFolder";
import { useApp, usePageMeta } from "@/lib/app-context";

export default function MyFolderPage() {
  const { id } = useParams<{ id: string }>();
  const { ready, role, setRole, rememberCase, refreshShell } = useApp();
  usePageMeta("Документы", "Единая папка: отметили один раз — учтено во всех шагах");

  useEffect(() => {
    if (ready && role !== "parent") setRole("parent");
    if (ready) rememberCase(Number(id));
  }, [ready, role, setRole, rememberCase, id]);

  return <div style={{ maxWidth: 1080 }}>{ready && <DocFolder caseId={Number(id)} role="parent" onChange={refreshShell} />}</div>;
}

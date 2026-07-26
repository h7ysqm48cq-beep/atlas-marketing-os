"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./ContentHistory.module.css";

type ContentStatus = "DRAFT" | "AI_IMPROVED" | "PENDING_REVIEW" | "APPROVED" | "REJECTED" | "PUBLISHED";
type Analysis = { summary?: string; viralScore?: number; discussionScore?: number; shareabilityScore?: number; brandFitScore?: number; bestPostingTime?: string; };
type HistoryRecord = {
  id: string; topic: string; platforms: string[]; style: string; language: string;
  facebook: string; telegram: string; reels: string; imagePrompt: string;
  analysis: Analysis; isFavorite: boolean; createdAt: string; updatedAt: string;
  status: ContentStatus; reviewNote?: string | null; reviewedBy?: string | null;
  reviewedAt?: string | null; approvedAt?: string | null; publishedAt?: string | null;
  brand: { id: string; name: string; workspace: { id: string; name: string; slug: string } };
  campaign: { id: string; name: string } | null;
  idea: { id: string; title: string; sortOrder: number } | null;
};
type OutputKey = "facebook" | "telegram" | "reels" | "imagePrompt";
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
const statuses: Array<"ALL" | ContentStatus> = ["ALL","DRAFT","AI_IMPROVED","PENDING_REVIEW","APPROVED","REJECTED","PUBLISHED"];

export function ContentHistory() {
  const [records,setRecords]=useState<HistoryRecord[]>([]);
  const [selected,setSelected]=useState<HistoryRecord|null>(null);
  const [activeOutput,setActiveOutput]=useState<OutputKey>("facebook");
  const [query,setQuery]=useState("");
  const [onlyFavorites,setOnlyFavorites]=useState(false);
  const [statusFilter,setStatusFilter]=useState<"ALL"|ContentStatus>("ALL");
  const [reviewNote,setReviewNote]=useState("");
  const [reviewer,setReviewer]=useState("Loh");
  const [status,setStatus]=useState("Loading generation history...");
  const [saving,setSaving]=useState(false);

  useEffect(()=>{ void load(); },[]);
  useEffect(()=>{ setReviewNote(selected?.reviewNote || ""); setReviewer(selected?.reviewedBy || "Loh"); },[selected?.id,selected?.reviewNote,selected?.reviewedBy]);

  const filtered=useMemo(()=>records.filter((record)=>{
    const q=query.trim().toLowerCase();
    const search=!q || record.topic.toLowerCase().includes(q) || record.brand.name.toLowerCase().includes(q) || record.style.toLowerCase().includes(q);
    return search && (!onlyFavorites || record.isFavorite) && (statusFilter==="ALL" || record.status===statusFilter);
  }),[records,query,onlyFavorites,statusFilter]);

  async function load(){
    try{ const response=await fetch(`${API_BASE_URL}/history`,{cache:"no-store"}); const data=await response.json() as HistoryRecord[]|{message?:string};
      if(!response.ok || !Array.isArray(data)) throw new Error(!Array.isArray(data)&&data.message?data.message:"Unable to load history.");
      const requestedHistoryId =
        new URLSearchParams(window.location.search).get("historyId");

      setRecords(data);
      setSelected((current) =>
        data.find((item) => item.id === requestedHistoryId) ||
        data.find((item) => item.id === current?.id) ||
        data[0] ||
        null,
      );
      setStatus(
        data.length
          ? `${data.length} saved generations.`
          : "No saved generations yet.",
      );
    }catch(error){ setStatus(error instanceof Error?error.message:"Unable to load history."); }
  }

  function syncRecord(updated:HistoryRecord){ setRecords((current)=>current.map((item)=>item.id===updated.id?updated:item)); setSelected((current)=>current?.id===updated.id?updated:current); }

  async function updateWorkflow(nextStatus:ContentStatus){
    if(!selected) return; setSaving(true);
    try{ const response=await fetch(`${API_BASE_URL}/history/${selected.id}/status`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({status:nextStatus,reviewNote:reviewNote.trim()||undefined,reviewedBy:reviewer.trim()||"Loh"})});
      const data=await response.json() as HistoryRecord & {message?:string}; if(!response.ok||!data.status) throw new Error(data.message||"Unable to update workflow."); syncRecord(data); setStatus(`Workflow updated to ${formatStatus(data.status)}.`);
    }catch(error){ setStatus(error instanceof Error?error.message:"Unable to update workflow."); } finally{ setSaving(false); }
  }

  async function toggleFavorite(record:HistoryRecord){ const response=await fetch(`${API_BASE_URL}/history/${record.id}/favorite`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({isFavorite:!record.isFavorite})}); if(response.ok) syncRecord({...record,isFavorite:!record.isFavorite}); }
  async function remove(record:HistoryRecord){ if(!window.confirm(`Delete "${record.topic}" from history?`)) return; const response=await fetch(`${API_BASE_URL}/history/${record.id}`,{method:"DELETE"}); if(!response.ok)return; const remaining=records.filter((item)=>item.id!==record.id); setRecords(remaining); if(selected?.id===record.id)setSelected(remaining[0]||null); }
  function getOutput(record:HistoryRecord){ return record[activeOutput]; }
  async function copySelected(){ if(selected) await navigator.clipboard.writeText(getOutput(selected)); }

  function buildStudioHref(record: HistoryRecord) {
    const params = new URLSearchParams({
      topic: record.topic,
      style: record.style,
      language: record.language,
      historyId: record.id,
    });

    if (record.campaign) {
      params.set("campaignId", record.campaign.id);
      params.set("campaignName", record.campaign.name);
    }

    if (record.idea) {
      params.set("ideaId", record.idea.id);
      params.set("ideaTitle", record.idea.title);
    }

    return `/ai-studio?${params.toString()}`;
  }

  return <div className={styles.page}>
    <section className={styles.hero}><div><p className={styles.eyebrow}>Content History</p><h1>Every Atlas generation, reviewed and reusable.</h1><p>Manage content, approval status, reviewer notes and publishing readiness.</p></div><div className={styles.countCard}><span>Saved records</span><strong>{records.length}</strong><small>{status}</small></div></section>
    <section className={styles.toolbar}><input value={query} onChange={(e)=>setQuery(e.target.value)} placeholder="Search topic, brand or style..."/><select value={statusFilter} onChange={(e)=>setStatusFilter(e.target.value as "ALL"|ContentStatus)}>{statuses.map((value)=><option key={value} value={value}>{value==="ALL"?"All statuses":formatStatus(value)}</option>)}</select><button className={onlyFavorites?styles.activeFilter:""} onClick={()=>setOnlyFavorites((v)=>!v)}>★ Favorites</button><button onClick={()=>void load()}>Refresh</button></section>
    <section className={styles.layout}><div className={styles.list}>{filtered.length===0?<div className={styles.emptyState}><strong>No matching generations</strong><span>Adjust filters or generate new content.</span></div>:filtered.map((record)=><button key={record.id} className={`${styles.historyCard} ${selected?.id===record.id?styles.selectedCard:""}`} onClick={()=>setSelected(record)}><div className={styles.cardTop}><span className={styles.brandBadge}>{record.brand.name}</span><span className={`${styles.statusBadge} ${styles[`status${record.status}`]}`}>{formatStatus(record.status)}</span></div><h2>{record.topic}</h2><p>{record.style} · {record.language}</p><div className={styles.platforms}>{record.platforms.map((platform)=><span key={platform}>{platform}</span>)}</div><small>{formatDate(record.createdAt)}</small></button>)}</div>
    <div className={styles.viewer}>{!selected?<div className={styles.emptyViewer}>Select a generation to inspect it.</div>:<><div className={styles.viewerHeader}><div><div className={styles.viewerBadges}><span className={styles.brandBadge}>{selected.brand.name}</span><span className={`${styles.statusBadge} ${styles[`status${selected.status}`]}`}>{formatStatus(selected.status)}</span></div><h2>{selected.topic}</h2><p>{selected.analysis.summary||"Saved AI generation"}</p></div><div className={styles.actions}>
      {selected.campaign ? (
        <a
          href={`/campaigns/${encodeURIComponent(selected.campaign.id)}?tab=overview`}
        >
          Open campaign
        </a>
      ) : null}

      <a href={buildStudioHref(selected)}>
        Continue in AI Studio
      </a>

      <button onClick={()=>void toggleFavorite(selected)}>
        {selected.isFavorite?"★ Favorited":"☆ Favorite"}
      </button>

      <button onClick={()=>void copySelected()}>
        Copy
      </button>

      <button
        className={styles.deleteButton}
        onClick={()=>void remove(selected)}
      >
        Delete
      </button>
    </div></div>
    <section className={styles.workflowPanel}><div className={styles.workflowTitle}><div><span>Approval workflow</span><strong>{formatStatus(selected.status)}</strong></div><small>{selected.reviewedBy?`Reviewer: ${selected.reviewedBy}`:"No reviewer assigned"}</small></div><div className={styles.reviewFields}><label><span>Reviewer</span><input value={reviewer} onChange={(e)=>setReviewer(e.target.value)}/></label><label><span>Review note</span><textarea value={reviewNote} onChange={(e)=>setReviewNote(e.target.value)} placeholder="Add feedback or approval notes..."/></label></div><div className={styles.workflowActions}><button disabled={saving} onClick={()=>void updateWorkflow("DRAFT")}>Draft</button><button disabled={saving} onClick={()=>void updateWorkflow("PENDING_REVIEW")}>Submit review</button><button disabled={saving} onClick={()=>void updateWorkflow("AI_IMPROVED")}>Need changes</button><button disabled={saving} className={styles.approveButton} onClick={()=>void updateWorkflow("APPROVED")}>Approve</button><button disabled={saving} className={styles.rejectButton} onClick={()=>void updateWorkflow("REJECTED")}>Reject</button><button disabled={saving||selected.status!=="APPROVED"} onClick={()=>void updateWorkflow("PUBLISHED")}>Mark published</button></div></section>
    <div className={styles.scoreGrid}><Score label="Viral" value={selected.analysis.viralScore}/><Score label="Discussion" value={selected.analysis.discussionScore}/><Score label="Shareability" value={selected.analysis.shareabilityScore}/><Score label="Brand Fit" value={selected.analysis.brandFitScore}/></div>
    <div className={styles.tabs}>{[["facebook","Facebook"],["telegram","Telegram"],["reels","Reels"],["imagePrompt","Image Prompt"]].map(([key,label])=><button key={key} className={activeOutput===key?styles.activeTab:""} onClick={()=>setActiveOutput(key as OutputKey)}>{label}</button>)}</div><textarea className={styles.output} readOnly value={getOutput(selected)}/><div className={styles.meta}><span>Best time: {selected.analysis.bestPostingTime||"Not provided"}</span><span>{formatDate(selected.createdAt)}</span></div></>}</div></section>
  </div>;
}
function Score({label,value}:{label:string;value?:number}){ return <div className={styles.score}><strong>{value??0}</strong><span>{label}</span></div>; }
function formatDate(value:string){ return new Intl.DateTimeFormat("en-MY",{dateStyle:"medium",timeStyle:"short"}).format(new Date(value)); }
function formatStatus(status:ContentStatus){ return status.toLowerCase().split("_").map((part)=>part.charAt(0).toUpperCase()+part.slice(1)).join(" "); }

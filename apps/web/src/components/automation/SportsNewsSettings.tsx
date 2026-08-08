"use client";

import { useCallback, useEffect, useState } from "react";
import { API_URL } from "@/lib/api";
import styles from "./SportsNewsSettings.module.css";

type Channel = { id: string; platform: "FACEBOOK" | "TELEGRAM"; name: string; username: string | null; status: string };
type Settings = {
  enabled:boolean; timezone:string; morningEnabled:boolean; morningTime:string; eveningEnabled:boolean; eveningTime:string;
  telegramEnabled:boolean; telegramChannelId:string|null; facebookEnabled:boolean; facebookChannelId:string|null;
  morningTelegramEnabled:boolean; morningFacebookEnabled:boolean; eveningTelegramEnabled:boolean; eveningFacebookEnabled:boolean;
  autoPublishEnabled:boolean; approvalRequired:boolean; language:string; sportsKnowledgeEnabled:boolean; discussionQuestionEnabled:boolean; referenceLinksEnabled:boolean;
  customPromptEnabled:boolean; systemPrompt:string|null; morningPrompt:string|null; eveningPrompt:string|null; knowledgePrompt:string|null; customInstructions:string|null;
  imageEnabled:boolean; imagePrompt:string|null; morningImagePrompt:string|null; eveningImagePrompt:string|null; imageAspectRatio:string; imageTextMode:string; imageVisualStyle:string|null;
  logoEnabled:boolean; logoPosition:string; brandFooterEnabled:boolean; brandFooterText:string; lastMorningRunAt:string|null; lastEveningRunAt:string|null; lastRunStatus:string|null; lastError:string|null;
};

const Toggle = ({checked,onChange,label}:{checked:boolean;onChange:(v:boolean)=>void;label:string}) => <label className={styles.toggleRow}><span>{label}</span><input type="checkbox" checked={checked} onChange={e=>onChange(e.target.checked)} /></label>;

export function SportsNewsSettings() {
  const [s,setS]=useState<Settings|null>(null); const [channels,setChannels]=useState<Channel[]>([]); const [saving,setSaving]=useState(false); const [message,setMessage]=useState("");
  const load=useCallback(async()=>{ const [a,b]=await Promise.all([fetch(`${API_URL}/sports-news/settings`,{cache:"no-store"}),fetch(`${API_URL}/sports-news/channels`,{cache:"no-store"})]); if(!a.ok||!b.ok) throw new Error("Unable to load Sports News settings."); setS(await a.json()); setChannels(await b.json()); },[]);
  useEffect(()=>{void load().catch(e=>setMessage(e instanceof Error?e.message:"Load failed."));},[load]);
  const patch=<K extends keyof Settings>(key:K,value:Settings[K])=>setS(v=>v?{...v,[key]:value}:v);
  const save=async()=>{if(!s)return;setSaving(true);setMessage("");try{const r=await fetch(`${API_URL}/sports-news/settings`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(s)});if(!r.ok)throw new Error(await r.text());setS(await r.json());setMessage("Sports News settings saved.");}catch(e){setMessage(e instanceof Error?e.message:"Save failed.");}finally{setSaving(false);}};
  if(!s)return <section className={styles.panel}>Loading Sports News settings...</section>;
  const tg=channels.filter(c=>c.platform==="TELEGRAM"), fb=channels.filter(c=>c.platform==="FACEBOOK");
  return <section className={styles.wrap}>
    <header className={styles.header}><div><p>SPORTS NEWS</p><h2>Sports News Settings</h2><span>Control schedules, channels, prompts, images and publishing.</span></div><button onClick={save} disabled={saving}>{saving?"Saving...":"Save settings"}</button></header>
    {message&&<div className={styles.message}>{message}</div>}
    <div className={styles.grid}>
      <div className={styles.panel}><h3>Schedule & Channels</h3><Toggle label="Sports News enabled" checked={s.enabled} onChange={v=>patch("enabled",v)}/><label>Timezone<input value={s.timezone} onChange={e=>patch("timezone",e.target.value)}/></label>
        <div className={styles.report}><h4>Morning Report</h4><Toggle label="Enabled" checked={s.morningEnabled} onChange={v=>patch("morningEnabled",v)}/><label>Time<input type="time" value={s.morningTime} onChange={e=>patch("morningTime",e.target.value)}/></label><Toggle label="Publish to Telegram" checked={s.morningTelegramEnabled} onChange={v=>patch("morningTelegramEnabled",v)}/><Toggle label="Sync to Facebook" checked={s.morningFacebookEnabled} onChange={v=>patch("morningFacebookEnabled",v)}/></div>
        <div className={styles.report}><h4>Evening Report</h4><Toggle label="Enabled" checked={s.eveningEnabled} onChange={v=>patch("eveningEnabled",v)}/><label>Time<input type="time" value={s.eveningTime} onChange={e=>patch("eveningTime",e.target.value)}/></label><Toggle label="Publish to Telegram" checked={s.eveningTelegramEnabled} onChange={v=>patch("eveningTelegramEnabled",v)}/><Toggle label="Sync to Facebook" checked={s.eveningFacebookEnabled} onChange={v=>patch("eveningFacebookEnabled",v)}/></div>
        <label>Telegram channel<select value={s.telegramChannelId??""} onChange={e=>patch("telegramChannelId",e.target.value||null)}><option value="">Select channel</option>{tg.map(c=><option key={c.id} value={c.id}>{c.name} · {c.status}</option>)}</select></label><label>Facebook page<select value={s.facebookChannelId??""} onChange={e=>patch("facebookChannelId",e.target.value||null)}><option value="">Select page</option>{fb.map(c=><option key={c.id} value={c.id}>{c.name} · {c.status}</option>)}</select></label>
      </div>
      <div className={styles.panel}><h3>Content & Automation</h3><label>Language<select value={s.language} onChange={e=>patch("language",e.target.value)}><option value="zh-en">中文 + English</option><option value="zh">中文</option><option value="en">English</option></select></label><Toggle label="Sports Knowledge" checked={s.sportsKnowledgeEnabled} onChange={v=>patch("sportsKnowledgeEnabled",v)}/><Toggle label="Discussion Question" checked={s.discussionQuestionEnabled} onChange={v=>patch("discussionQuestionEnabled",v)}/><Toggle label="Reference Links" checked={s.referenceLinksEnabled} onChange={v=>patch("referenceLinksEnabled",v)}/><Toggle label="Auto Publish" checked={s.autoPublishEnabled} onChange={v=>patch("autoPublishEnabled",v)}/><Toggle label="Approval Required" checked={s.approvalRequired} onChange={v=>patch("approvalRequired",v)}/></div>
      <div className={styles.panel}><h3>Prompt Settings</h3><Toggle label="Use Custom Prompts" checked={s.customPromptEnabled} onChange={v=>patch("customPromptEnabled",v)}/>{[["systemPrompt","System Instructions"],["morningPrompt","Morning Prompt"],["eveningPrompt","Evening Prompt"],["knowledgePrompt","Sports Knowledge Prompt"],["customInstructions","Custom Instructions"]].map(([k,l])=><label key={k}>{l}<textarea rows={4} value={(s[k as keyof Settings] as string|null)??""} onChange={e=>patch(k as keyof Settings,e.target.value as never)} /></label>)}</div>
      <div className={styles.panel}><h3>Image Settings</h3><Toggle label="Generate Image" checked={s.imageEnabled} onChange={v=>patch("imageEnabled",v)}/><label>Aspect Ratio<select value={s.imageAspectRatio} onChange={e=>patch("imageAspectRatio",e.target.value)}><option>4:5</option><option>1:1</option><option>16:9</option><option>9:16</option></select></label><label>Text Mode<select value={s.imageTextMode} onChange={e=>patch("imageTextMode",e.target.value)}><option value="minimal">Minimal / key points only</option><option value="balanced">Balanced</option><option value="detailed">Detailed</option></select></label>{[["imageVisualStyle","Visual Style"],["imagePrompt","Default Image Prompt"],["morningImagePrompt","Morning Image Prompt"],["eveningImagePrompt","Evening Image Prompt"]].map(([k,l])=><label key={k}>{l}<textarea rows={4} value={(s[k as keyof Settings] as string|null)??""} onChange={e=>patch(k as keyof Settings,e.target.value as never)} /></label>)}<Toggle label="Show Logo" checked={s.logoEnabled} onChange={v=>patch("logoEnabled",v)}/><label>Logo Position<select value={s.logoPosition} onChange={e=>patch("logoPosition",e.target.value)}><option value="bottom-right">Bottom right</option><option value="bottom-center">Bottom center</option><option value="bottom-left">Bottom left</option></select></label><Toggle label="Brand Footer" checked={s.brandFooterEnabled} onChange={v=>patch("brandFooterEnabled",v)}/><label>Footer Text<input value={s.brandFooterText} onChange={e=>patch("brandFooterText",e.target.value)}/></label></div>
    </div>
    <div className={styles.status}><strong>Status</strong><span>Last morning: {s.lastMorningRunAt??"Never"}</span><span>Last evening: {s.lastEveningRunAt??"Never"}</span><span>Last status: {s.lastRunStatus??"—"}</span>{s.lastError&&<span>Error: {s.lastError}</span>}</div>
  </section>;
}

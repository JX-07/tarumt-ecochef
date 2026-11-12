"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Flag, MessageSquare, Search, Star, X } from "lucide-react";
import { createAuthenticatedWebApi } from "../../../src/lib/api";
import { StoreRequired } from "../components/store-required";

type Feedback = {id:string;product_name:string;customer_name:string;rating:number;comment?:string;date_submitted:string;removed_at?:string;flag_status?:string;flag_reason?:string;resolution_note?:string;can_flag:boolean};
type SortColumn = "product" | "rating" | "feedback" | "submitted" | "moderator";
const columns: {key:SortColumn;label:string}[] = [{key:"product",label:"Product / customer"},{key:"rating",label:"Rating"},{key:"feedback",label:"Feedback"},{key:"submitted",label:"Submitted"},{key:"moderator",label:"Moderator review"}];
type Data = {feedback:Feedback[];total:number;summary:{rating:number;count:number;total_count?:number}};
const date = (value:string) => new Date(value).toLocaleString("en-MY",{timeZone:"Asia/Kuala_Lumpur",dateStyle:"medium",timeStyle:"short"});

export default function FeedbackPage() {
  const api=useMemo(() => createAuthenticatedWebApi("/api/ecochef"),[]);
  const [data,setData]=useState<Data>();
  const [query,setQuery]=useState("");
  const [search,setSearch]=useState("");
  const [page,setPage]=useState(0);
  const [sort,setSort]=useState<SortColumn>("submitted");
  const [direction,setDirection]=useState<"asc"|"desc">("desc");
  const sortBy=(column:SortColumn)=>{setDirection(sort===column && direction==="asc" ? "desc" : "asc");setSort(column);setPage(0);};
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const [selected,setSelected]=useState<Feedback>();
  const [reason,setReason]=useState("");
  const [flagError,setFlagError]=useState("");
  const [busy,setBusy]=useState(false);
  const dialog=useRef<HTMLDialogElement>(null);
  const generation=useRef(0);
  const submitting=useRef(false);
  useEffect(() => {const timer=setTimeout(() => {setSearch(query);setPage(0);},300);return () => clearTimeout(timer);},[query]);
  const load=useCallback(async () => {
    const current=++generation.current;setLoading(true);setError("");
    try {const next=await api.getVendorFeedback<Data>(search,page*25,sort,direction);if(current===generation.current){setData(next);if(page>0 && !next.feedback.length)setPage((value)=>value-1);}}
    catch(failure){if(current===generation.current)setError(failure instanceof Error?failure.message:"Feedback could not be loaded.");}
    finally{if(current===generation.current)setLoading(false);}
  },[api,search,page,sort,direction]);
  useEffect(() => {void load();return () => {generation.current+=1;};},[load]);
  useEffect(() => {if(selected && !dialog.current?.open)dialog.current?.showModal();else if(!selected)dialog.current?.close();},[selected]);
  const save=async (event:FormEvent) => {
    event.preventDefault();if(!selected || submitting.current || reason.trim().length<10)return;
    submitting.current=true;setBusy(true);setFlagError("");
    try {await api.flagVendorFeedback(selected.id,reason.trim());setSelected(undefined);setNotice("Feedback flagged. A moderator will review it; the feedback remains visible until a decision is made.");await load();}
    catch(failure){setFlagError(failure instanceof Error?failure.message:"The flag could not be submitted.");}
    finally{submitting.current=false;setBusy(false);}
  };
  return <StoreRequired><main className="workspace vendor-feedback-page">
    <p className="vendor-feedback-subheading">Read verified product ratings and customer feedback. Flag an entry if you believe a moderator should review it.</p>
    <section className="feedback-rating-summary"><Star aria-hidden="true"/><strong>{Number(data?.summary.rating??0).toFixed(1)}/5.0</strong><span className="feedback-total">Total Feedbacks: {new Intl.NumberFormat("en-MY").format(data?.summary.total_count??data?.summary.count??0)}</span></section>
    <div className="filterbar"><label><Search size={18}/><input aria-label="Search feedback" type="search" maxLength={200} value={query} onChange={(event)=>setQuery(event.target.value)} placeholder="Search product, customer or feedback"/></label><button type="button" disabled={loading} onClick={()=>void load()}>Refresh</button></div>
    {error?<p role="alert" className="workspace-error">{error}</p>:null}{notice?<p role="status" className="form-message success">{notice}</p>:null}
    {loading?<p role="status" className="workspace-note">Loading customer feedback…</p>:<div className="data-table feedback-table" role="table" aria-label="Customer feedback"><div className="feedback-table-row feedback-table-head" role="row">{columns.map(column=><div key={column.key} role="columnheader" aria-sort={sort===column.key ? direction==="asc" ? "ascending" : "descending" : "none"}><button type="button" className="feedback-sort-button" onClick={()=>sortBy(column.key)} aria-label={`Sort ${column.label} ${sort===column.key && direction==="asc" ? "descending" : "ascending"}`}><span>{column.label}</span>{sort!==column.key ? <ArrowUpDown size={14} aria-hidden="true"/> : direction==="asc" ? <ArrowUp size={14} aria-hidden="true"/> : <ArrowDown size={14} aria-hidden="true"/>}</button></div>)}</div>{data?.feedback.length?data.feedback.map((entry)=><article className="feedback-table-row" role="row" key={entry.id}><div role="cell"><strong>{entry.product_name}</strong><small>{entry.customer_name}</small></div><span role="cell" className="feedback-stars" aria-label={`${entry.rating} out of 5 stars`}>{"★".repeat(entry.rating)}<span className="feedback-empty-stars">{"☆".repeat(5-entry.rating)}</span></span><div role="cell" className="feedback-comment">{entry.comment||"Rating only; no description."}{entry.removed_at?<small>Removed from public view by a moderator.</small>:null}</div><time role="cell" dateTime={entry.date_submitted}>{date(entry.date_submitted)}</time><div role="cell" className="feedback-flag-cell">{!entry.flag_status && !entry.removed_at ? <button type="button" className="vendor-icon-action feedback-flag-button" disabled={!entry.can_flag} aria-label={`Flag feedback about ${entry.product_name} for moderator review`} title={entry.can_flag?"Flag for moderator review":"Already flagged or unavailable"} onClick={()=>{setSelected(entry);setReason("");setFlagError("");}}><Flag size={16}/><span>Flag</span></button> : null}{entry.flag_status?<span className={`feedback-moderator-status ${entry.flag_status}`} role="status">{entry.flag_status==="pending"?"Awaiting Moderator":entry.flag_status==="dismissed"?"Flag dismissed":"Feedback removed"}</span>:null}{entry.resolution_note?<small>Moderator: {entry.resolution_note}</small>:null}</div></article>):<p className="data-empty"><MessageSquare size={20}/> No matching customer feedback yet.</p>}</div>}
    <div className="feedback-pagination"><button className="secondary" disabled={loading||page===0} onClick={()=>setPage((value)=>value-1)}>Previous</button><span>{data?.total?`${page*25+1}–${Math.min((page+1)*25,data.total)} of ${data.total}`:"0 feedback entries"}</span><button className="secondary" disabled={loading||(page+1)*25>=(data?.total??0)} onClick={()=>setPage((value)=>value+1)}>Next</button></div>
    <dialog ref={dialog} className="modal-card vendor-feedback-dialog" aria-labelledby="feedback-flag-title" onCancel={(event)=>{if(busy)event.preventDefault();else setSelected(undefined);}} onClose={()=>{if(!busy)setSelected(undefined);}}>
      <form onSubmit={(event)=>void save(event)}><header><h2 id="feedback-flag-title"><Flag size={20}/> Flag feedback</h2><button type="button" disabled={busy} aria-label="Close flag form" onClick={()=>setSelected(undefined)}><X/></button></header>
        {selected?<blockquote className="feedback-selected"><strong>{selected.product_name}</strong><div className="feedback-selected-meta"><div><span>Customer</span><b>{selected.customer_name}</b></div><div><span>Rating</span><b className="feedback-selected-rating"><Star size={15} aria-hidden="true"/>{Number(selected.rating).toFixed(1)}/5.0</b></div><div><span>Submitted</span><b>{date(selected.date_submitted)}</b></div></div><p className="feedback-selected-comment">{selected.comment||"The customer left a rating without a written review."}</p></blockquote>:null}
        <p>Tell the moderator why this feedback needs review. They will decide whether it should be removed.</p><label htmlFor="feedback-flag-reason">Flagging reason</label><textarea id="feedback-flag-reason" autoFocus required minLength={10} maxLength={2000} rows={5} disabled={busy} value={reason} onChange={(event)=>setReason(event.target.value)} placeholder="Explain the issue and include any details that support your flag."/><small>{reason.trim().length}/2000 characters · at least 10 required</small>
        {flagError?<p role="alert" className="form-message error">{flagError}</p>:null}<footer><button type="button" disabled={busy} onClick={()=>setSelected(undefined)}>Cancel</button><button className="cta" type="submit" disabled={busy||reason.trim().length<10}>{busy?"Submitting…":"Submit flag"}</button></footer>
      </form>
    </dialog>
  </main></StoreRequired>;
}

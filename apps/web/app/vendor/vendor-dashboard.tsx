"use client";

import Link from "next/link";
import { Activity, BadgeDollarSign, Boxes, Download, House, ShoppingBag, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createAuthenticatedWebApi } from "../../src/lib/api";
import { DownloadOutcome } from "./components/download-outcome";
import { RevenueChart } from "./components/revenue-chart";
import { StoreRequired } from "./components/store-required";
import { ThemedSelectControl } from "./components/themed-controls";
import { useVendor } from "./components/vendor-context";
import { downloadDashboardReportPdf } from "./components/dashboard-report-pdf";
import type { DashboardData, DashboardPeriod } from "./dashboard-types";

const periods: {key:DashboardPeriod;label:string}[] = [{key:"week",label:"This Week"},{key:"month",label:"This Month"}];
const money=(value:number)=>`RM ${Number(value).toLocaleString("en-MY",{minimumFractionDigits:2,maximumFractionDigits:2})}`;
const malaysiaNow=()=>new Date(Date.now()+8*60*60*1000);

export function VendorDashboard() {
  const {stores}=useVendor(), shop=stores[0];
  const api=useMemo(()=>createAuthenticatedWebApi("/api/ecochef"),[]);
  const [period,setPeriod]=useState<DashboardPeriod>("week");
  const [data,setData]=useState<DashboardData>();
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const [exportOpen,setExportOpen]=useState(false);
  const generation=useRef(0);
  const load=useCallback(async()=>{
    if(!shop?.id)return;
    const current=++generation.current;
    setLoading(true);setError("");setData(undefined);
    try {const next=await api.getVendorDashboard<DashboardData>(period);if(current===generation.current)setData(next);}
    catch(failure){if(current===generation.current)setError(failure instanceof Error?failure.message:"Dashboard could not be loaded.");}
    finally {if(current===generation.current)setLoading(false);}
  },[api,period,shop?.id]);
  useEffect(()=>{void load();return()=>{generation.current+=1;};},[load]);
  const label=periods.find(item=>item.key===period)?.label??"Selected period";
  return <StoreRequired><main className="workspace vendor-dashboard" aria-busy={loading}>
    <section className="dash-banner"><div><span className={`store-mark${shop?.icon_url?" has-image":""}`}>{shop?.icon_url?<img src={shop.icon_url} alt={`${shop.name} store logo`}/>:<House size={24} strokeWidth={2.2}/>}</span><h1>{shop?.name}</h1><small>{data?.period.label??label}</small></div><div className="period-controls"><div className="period" aria-label="Dashboard period">{periods.map(item=><button type="button" key={item.key} aria-pressed={period===item.key} className={period===item.key?"active":""} onClick={()=>{if(item.key!==period){generation.current+=1;setData(undefined);setLoading(true);setPeriod(item.key);}}}>{item.label}</button>)}</div><button type="button" className="period-export" aria-label="Download monthly or yearly report" title="Download report" onClick={()=>setExportOpen(true)}><Download size={15}/></button></div></section>
    <p className="dashboard-period-note">{data?`${data.period.start_date} to ${data.period.end_date} · Malaysia time`:`${label} · Malaysia time`}</p>
    {error?<p className="workspace-error" role="alert">{error} <button type="button" className="secondary" onClick={()=>void load()}>Try again</button></p>:null}
    {loading?<p className="workspace-note" role="status">Loading {label.toLowerCase()} dashboard…</p>:data?<>
      <section className="stat-grid"><Stat icon={<BadgeDollarSign/>} tone="green" label="Net Store Revenue" value={money(data.summary.revenue)} detail="Paid sales after store fees and reversals"/><Stat icon={<ShoppingBag/>} tone="blue" label="Orders Processed" value={`${data.summary.orders.toLocaleString("en-MY")} Orders`} detail="Captured orders in this period"/><Stat icon={<Boxes/>} tone="purple" label="Products Sold" value={`${data.summary.products.toLocaleString("en-MY")} Products`} detail="Different products sold in this period"/><Stat icon={<Activity/>} tone="yellow" label="Promotions in This Period" value={`${data.summary.deals.toLocaleString("en-MY")} Codes`} detail="Promotion codes valid during this period"/></section>
      <section className="dash-split"><article className="chart-card"><header><div><h2>{period==="today"?"Today's":period==="month"?"Monthly":"Weekly"} Revenue Trends (RM)</h2><p>Net revenue from paid orders in the selected period.</p></div></header><RevenueChart key={period} rows={data.revenue} labelMode={period==="month"?"date":"weekday"}/></article><Link href="/vendor/orders" className="ticker dashboard-navigation-card" aria-label="Open Orders and Pickup"><header><h2><i/> Live Orders Ticker</h2><span>View All →</span></header><p className="dashboard-period-note">Active orders placed in this period</p>{data.live_orders.length?data.live_orders.slice(0,4).map(order=><div className="ticker-order" key={order.id}><strong>#{order.id.slice(0,8).toUpperCase()}<small>{order.customer_name}</small></strong><span>{order.items}</span><b>{money(order.total)}</b><span className="ticker-status">{order.status.replaceAll("_"," ")}</span></div>):<Empty text="No active orders in this period."/>}</Link></section>
      <section className="dash-bottom"><Link href="/vendor/products" className="dashboard-navigation-card best-selling-card" aria-label="Open Products"><h2>Best Selling Product</h2>{data.top_products.length?data.top_products.map((product,index)=><div className="rank" key={product.id}><b>{String(index+1).padStart(2,"0")}</b><span><strong>{product.name}</strong><small>{product.category||"Uncategorised"} · {product.sold} sold</small></span><em>{product.original_price?`Current ${Math.round((1-product.price/product.original_price)*100)}% off`:"Current price"}</em></div>):<Empty text="No product sales in this period."/>}</Link><Link href="/vendor/feedback" className="feedback-overview-card" aria-label="View all reviews and customer feedback"><h2>Reviews & Customer Feedback</h2><div className="feedback-rating-summary"><strong>{Number(data.review_summary.rating).toFixed(1)}/5.0</strong><span className="feedback-stars-display" aria-hidden="true">★★★★★<span style={{width:`${Math.max(0,Math.min(5,Number(data.review_summary.rating)))/5*100}%`}}>★★★★★</span></span><small>{data.review_summary.count.toLocaleString("en-MY")} ratings in this period</small></div>{data.reviews.length?data.reviews.map(review=><blockquote key={`${review.name}-${review.product_name}-${review.date_submitted}`}>“{review.comment||"Rating submitted without a comment."}”<footer>{review.name} · {review.product_name} · {"★".repeat(review.rating)}</footer></blockquote>):<Empty text="No customer reviews in this period."/>}</Link></section>
    </>:null}
    <DashboardExport open={exportOpen} years={data?.report_years??[]} close={()=>setExportOpen(false)}/>
  </main></StoreRequired>;
}

function DashboardExport({open,years,close}:{open:boolean;years:number[];close:()=>void}) {
  const api=useMemo(()=>createAuthenticatedWebApi("/api/ecochef"),[]);
  const current=malaysiaNow(), currentYear=current.getUTCFullYear(), currentMonth=current.getUTCMonth()+1;
  const [year,setYear]=useState(String(currentYear));
  const [month,setMonth]=useState(String(currentMonth));
  const [busy,setBusy]=useState(false);
  const [outcome,setOutcome]=useState<{success:boolean;message:string}>();
  const dialog=useRef<HTMLDialogElement>(null);
  const pending=useRef(false);
  useEffect(()=>{if(open){dialog.current?.showModal();}else dialog.current?.close();},[open]);
  const yearOptions=[...new Set([currentYear,...years])].sort((a,b)=>b-a).map(value=>({value:String(value),label:String(value)}));
  const monthOptions=[{value:"all",label:"All months"},...Array.from({length:Number(year)===currentYear?currentMonth:12},(_,index)=>({value:String(index+1),label:new Date(Date.UTC(2000,index,1)).toLocaleDateString("en-MY",{month:"long",timeZone:"Asia/Kuala_Lumpur"})}))];
  const download=async()=>{
    if(pending.current)return;
    pending.current=true;setBusy(true);
    try {const report=await api.getVendorDashboard<DashboardData>(month==="all"?"year":"month",Number(year),month==="all"?undefined:Number(month));downloadDashboardReportPdf(report,report.store.name);close();setOutcome({success:true,message:`Your ${report.period.label} PDF is ready and the download has started.`});}
    catch(failure){setOutcome({success:false,message:failure instanceof Error?failure.message:"The report could not be downloaded. Please try again."});}
    finally{pending.current=false;setBusy(false);}
  };
  return <><dialog ref={dialog} className="modal-card dashboard-export-dialog" aria-labelledby="dashboard-export-title" onCancel={event=>{if(busy)event.preventDefault();else close();}} onClose={()=>{if(!busy)close();}}>
    <header><div><h2 id="dashboard-export-title"><Download size={20}/> Download report</h2></div><button type="button" aria-label="Close report options" disabled={busy} onClick={close}><X size={20}/></button></header>
    <p>Choose a year and month, or select All months for the whole year's PDF summary.</p>
    <div className="dashboard-report-fields"><label><span>Year</span><ThemedSelectControl disabled={busy} ariaLabel="Report year" value={year} options={yearOptions} onChange={value=>{setYear(value);if(Number(value)===currentYear && Number(month)>currentMonth)setMonth(String(currentMonth));}}/></label><label><span>Month</span><ThemedSelectControl disabled={busy} ariaLabel="Report month" value={month} options={monthOptions} onChange={setMonth}/></label></div>
    <footer><button type="button" className="secondary" disabled={busy} onClick={close}>Cancel</button><button type="button" className="cta" disabled={busy} onClick={()=>void download()}><Download size={16}/>{busy?"Preparing PDF…":"Download PDF"}</button></footer>
  </dialog><DownloadOutcome outcome={outcome} close={()=>setOutcome(undefined)}/></>;
}

function Stat({icon,tone,label,value,detail}:{icon:ReactNode;tone:string;label:string;value:string;detail:string}) {return <article className="stat-card"><span className={tone}>{icon}</span><small>{label}</small><strong>{value}</strong><p>{detail}</p></article>;}
function Empty({text}:{text:string}) {return <p className="data-empty">{text}</p>;}

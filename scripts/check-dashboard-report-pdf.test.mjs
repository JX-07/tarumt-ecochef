import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "../apps/web/node_modules/typescript/lib/typescript.js";

function loadModule(path, imports={}) {
  const code=ts.transpileModule(fs.readFileSync(path,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const context=vm.createContext({exports:{},Blob,URL,setTimeout,require:(name)=>{assert.ok(imports[name],`Unexpected import ${name}`);return imports[name];}});
  vm.runInContext(code,context);
  return context.exports;
}
const tokens=loadModule(new URL("../packages/design-tokens/src/index.ts",import.meta.url));
const {buildDashboardReportPdf}=loadModule(new URL("../apps/web/app/vendor/components/dashboard-report-pdf.ts",import.meta.url),{"@ecochef/design-tokens":tokens});
const sample={
  store:{id:"store",name:"EcoChef Market (Kuala Lumpur)"},
  period:{key:"month",label:"November 2026",start_date:"2026-11-01",end_date:"2026-11-30",timezone:"Asia/Kuala_Lumpur"},
  generated_at:"2026-11-06T12:30:00Z",
  summary:{revenue:12345.67,sales:13000,orders:123,products:14,deals:3},
  order_summary:{completed:100,cancelled:2,active:21,delivery:80,pickup:43,customer_count:87,items_sold:245},
  inventory:{listed:40,low_stock:5,out_of_stock:2},
  review_summary:{rating:4.8,count:25},
  revenue:Array.from({length:30},(_,i)=>({day:`2026-11-${String(i+1).padStart(2,"0")}`,amount:100+i*17})),
  top_products:Array.from({length:10},(_,i)=>({id:String(i),name:`Fresh apple \\ basket (${i}) - ${"Locally grown produce ".repeat(8)}`,category:"Fruit",price:10.5,sold:40-i})),
  reviews:Array.from({length:4},(_,i)=>({product_name:"Café produce & seasonal fruit",name:`Customer ${i} 陈`,rating:5,comment:"Fresh, carefully packed and ready for pickup. ".repeat(12),date_submitted:"2026-11-05T12:00:00Z"})),
  notes:["Net vendor proceeds include earned allocations, including transfers still pending. Sales and reviews are filtered to this reporting period."],
};

test("dashboard PDF has valid byte offsets, paginated content and safely escaped names",async()=>{
  const blob=buildDashboardReportPdf(sample);
  assert.equal(blob.type,"application/pdf");
  const pdf=await blob.text();
  assert.match(pdf,/^%PDF-1.4/);
  assert.match(pdf,/12,345.67/);
  assert.match(pdf,/4.8\/5.0/);
  assert.match(pdf,/EcoChef Market \\\(Kuala Lumpur\\\)/);
  assert.doesNotMatch(pdf,/陈/);
  const pageCount=Number(pdf.match(/\/Type \/Pages \/Kids \[[^\]]+\] \/Count (\d+)/)[1]);
  assert.ok(pageCount>=3,"long tables should span multiple readable pages");
  assert.equal([...pdf.matchAll(/\/Type \/Page\s/g)].length,pageCount);
  const start=Number(pdf.match(/startxref\n(\d+)/)[1]);
  assert.equal(pdf.slice(start,start+4),"xref");
  for(const offset of [...pdf.matchAll(/^(\d{10}) 00000 n /gm)].map(match=>Number(match[1]))) assert.match(pdf.slice(offset),/^\d+ 0 obj\n/);
  for(const match of pdf.matchAll(/\/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/g)) assert.equal(Number(match[1]),match[2].length);
});

test("zero-activity annual reports include empty states and all twelve months",async()=>{
  const data={...sample,period:{...sample.period,key:"year",label:"2026",start_date:"2026-01-01",end_date:"2026-12-31"},summary:{revenue:0,sales:0,orders:0,products:0,deals:0},reviews:[],top_products:[],revenue:Array.from({length:12},(_,i)=>({day:`2026-${String(i+1).padStart(2,"0")}-01`,amount:0}))};
  const pdf=await buildDashboardReportPdf(data).text();
  assert.match(pdf,/January 2026/);assert.match(pdf,/December 2026/);
  assert.match(pdf,/No product sales for this period/);assert.match(pdf,/No published feedback in this period/);
  assert.doesNotMatch(pdf,/NaN|Infinity/);
});

if(process.env.ECOCHEF_PDF_SAMPLE_OUTPUT) fs.writeFileSync(process.env.ECOCHEF_PDF_SAMPLE_OUTPUT,new Uint8Array(await buildDashboardReportPdf(sample).arrayBuffer()));

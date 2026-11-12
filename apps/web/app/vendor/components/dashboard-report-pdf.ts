import { colors, typography } from "@ecochef/design-tokens";
import type { DashboardData } from "../dashboard-types";

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const MARGIN = 44;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const print = typography.print.size;
const rgb = (hex: string) => [1, 3, 5].map(offset => (parseInt(hex.slice(offset, offset + 2), 16) / 255).toFixed(4)).join(" ");
const number = (value: unknown) => Number(value) || 0;
const count = (value: unknown) => number(value).toLocaleString("en-MY");
const money = (value: unknown) => `RM ${number(value).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const date = (value: string, withTime = false) => new Date(value.length === 10 ? `${value}T12:00:00+08:00` : value).toLocaleString("en-MY", { timeZone: "Asia/Kuala_Lumpur", day: "numeric", month: "short", year: "numeric", ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}) });

// Standard Helvetica is the shared PDF font. Normalize punctuation/diacritics and
// show unsupported characters explicitly rather than emitting corrupt PDF bytes.
const printable = (value: unknown) => String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[\u2010-\u2015]/g, "-").replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/\u2026/g, "...").replace(/\u00d7/g, "x").replace(/[^\x20-\x7e]/gu, "?");
const literal = (value: unknown) => printable(value).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
// Conservative Helvetica character widths keep long values inside their cells.
const width = (value: string, size: number) => [...value].reduce((total, char) => total + ("ilI.,'!|:;".includes(char) ? .28 : "mwMW@%".includes(char) ? .89 : char === " " ? .28 : /[A-Z]/.test(char) ? .69 : .56) * size, 0);
function lines(value: unknown, maxWidth: number, size: number, maximum = 20): string[] {
  const words = printable(value).replace(/\s+/g, " ").trim().split(" ");
  const result: string[] = [];
  let current = "";
  for (const word of words) {
    if (current && width(`${current} ${word}`, size) > maxWidth) { result.push(current); current = ""; }
    for (const char of word) {
      if (width(current + char, size) > maxWidth) { result.push(current); current = ""; }
      current += char;
    }
    current += " ";
  }
  if (current.trim()) result.push(current.trim());
  if (!result.length) return [""];
  if (result.length <= maximum) return result.map(line => line.trim());
  const shortened = result.slice(0, maximum).map(line => line.trim());
  while (width(shortened[maximum - 1] + "...", size) > maxWidth) shortened[maximum - 1] = shortened[maximum - 1].slice(0, -1);
  shortened[maximum - 1] += "...";
  return shortened;
}

type Column = { label: string; width: number; right?: boolean };
class Report {
  pages: string[][] = [];
  commands: string[] = [];
  y = 0;
  constructor(private readonly period: string) { this.newPage(); }
  newPage() {
    this.commands = [];
    this.pages.push(this.commands);
    this.rect(0, PAGE_HEIGHT - 94, PAGE_WIDTH, 94, colors.primaryStrong);
    this.text("ECOCHEF", MARGIN, PAGE_HEIGHT - 35, print.title, colors.surface, true);
    this.text("BUSINESS PERFORMANCE SUMMARY", MARGIN, PAGE_HEIGHT - 57, print.label, colors.primarySoft);
    this.text(this.period, MARGIN, PAGE_HEIGHT - 77, print.caption, colors.surface);
    this.y = PAGE_HEIGHT - 119;
  }
  ensure(height: number) { if (this.y - height < 62) this.newPage(); }
  text(value: unknown, x: number, y: number, size: number = print.body, color: string = colors.text, bold = false) {
    this.commands.push(`${rgb(color)} rg BT /${bold ? "F2" : "F1"} ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td (${literal(value)}) Tj ET`);
  }
  rect(x: number, y: number, w: number, h: number, color: string) { this.commands.push(`${rgb(color)} rg ${x} ${y} ${w} ${h} re f`); }
  rule(y: number) { this.commands.push(`${rgb(colors.border)} RG .6 w ${MARGIN} ${y} m ${PAGE_WIDTH - MARGIN} ${y} l S`); }
  paragraph(value: unknown, color: string = colors.textMuted, size: number = print.caption) {
    const wrapped = lines(value, CONTENT_WIDTH, size);
    this.ensure(wrapped.length * (size + 4) + 8);
    for (const line of wrapped) { this.text(line, MARGIN, this.y, size, color); this.y -= size + 4; }
    this.y -= 8;
  }
  heading(value: string, needed = 55) { this.ensure(needed); this.y -= 6; this.text(value.toUpperCase(), MARGIN, this.y, print.secondary, colors.primaryStrong, true); this.y -= 22; }
  cards(items: {label:string;value:string}[]) {
    const gap = 12, cardWidth = (CONTENT_WIDTH - gap) / 2, height = 65;
    for (let index = 0; index < items.length; index += 2) {
      this.ensure(height + 12);
      items.slice(index, index + 2).forEach((item, column) => {
        const x = MARGIN + column * (cardWidth + gap);
        this.rect(x, this.y - height, cardWidth, height, colors.primarySoft);
        this.text(item.label.toUpperCase(), x + 12, this.y - 19, print.caption, colors.primaryStrong);
        const valueSize = width(item.value, print.heading) > cardWidth - 24 ? print.secondary : print.heading;
        this.text(item.value, x + 12, this.y - 44, valueSize, colors.primaryStrong, true);
      });
      this.y -= height + 12;
    }
  }
  table(columns: Column[], rows: string[][]) {
    const header = () => {
      this.ensure(48);
      this.rect(MARGIN, this.y - 25, CONTENT_WIDTH, 25, colors.surfaceMuted);
      let x = MARGIN;
      columns.forEach(column => { this.text(column.label, x + 8, this.y - 16, print.caption, colors.textMuted, true); x += column.width; });
      this.y -= 25;
    };
    header();
    rows.forEach(row => {
      const wrapped = row.map((cell,index) => lines(cell, columns[index].width - 16, print.caption, 4));
      const height = Math.max(...wrapped.map(cell => cell.length)) * 13 + 15;
      if (this.y - height < 62) { this.newPage(); header(); }
      let x = MARGIN;
      wrapped.forEach((cell,index) => {
        cell.forEach((line,lineIndex) => this.text(line, columns[index].right ? x + columns[index].width - 8 - width(line, print.caption) : x + 8, this.y - 17 - lineIndex * 13, print.caption));
        x += columns[index].width;
      });
      this.y -= height;
      this.rule(this.y);
    });
    this.y -= 15;
  }
  chart(rows: DashboardData["revenue"], annual: boolean) {
    this.ensure(155);
    const left = MARGIN + 58, right = PAGE_WIDTH - MARGIN - 8, top = this.y - 12, bottom = this.y - 112;
    const values = rows.map(row => number(row.amount));
    const maximum = Math.max(1, ...values), minimum = Math.min(0, ...values);
    [0,.5,1].forEach(fraction => {
      const y = bottom + fraction * (top - bottom);
      this.commands.push(`${rgb(colors.border)} RG .5 w ${left} ${y} m ${right} ${y} l S`);
      this.text((minimum + (maximum - minimum) * fraction).toLocaleString("en-MY", { maximumFractionDigits: 0 }), MARGIN, y - 3, print.caption, colors.textMuted);
    });
    const x = (index:number) => rows.length < 2 ? (left + right) / 2 : left + index * (right - left) / (rows.length - 1);
    const y = (value:number) => bottom + (value - minimum) / (maximum - minimum) * (top - bottom);
    if (values.length > 1) this.commands.push(`${rgb(colors.primary)} RG 2 w ${values.map((value,index) => `${x(index).toFixed(2)} ${y(value).toFixed(2)} ${index===0 ? "m" : "l"}`).join(" ")} S`);
    else if (values.length) this.rect(x(0)-2,y(values[0])-2,4,4,colors.primary);
    [...new Set([0,Math.floor((rows.length-1)/2),rows.length-1])].filter(index => index>=0).forEach(index => {
      const label = new Date(`${rows[index].day.slice(0,10)}T12:00:00+08:00`).toLocaleDateString("en-MY", {timeZone:"Asia/Kuala_Lumpur",month:"short",...(annual?{}:{day:"numeric"})});
      this.text(label, Math.min(right-width(label,print.caption),Math.max(left,x(index)-width(label,print.caption)/2)),bottom-18,print.caption,colors.textMuted);
    });
    this.y -= 151;
  }
  blob() {
    this.pages.forEach((page,index) => {
      this.commands = page;
      this.rule(47);
      this.text("EcoChef | Confidential business report",MARGIN,31,print.caption,colors.textMuted);
      this.text(`${index+1} / ${this.pages.length}`,PAGE_WIDTH-MARGIN-32,31,print.caption,colors.textMuted);
    });
    const objects = ["", "", `<< /Type /Font /Subtype /Type1 /BaseFont /${typography.print.fontFamily} /Encoding /WinAnsiEncoding >>`, `<< /Type /Font /Subtype /Type1 /BaseFont /${typography.print.fontFamily}-Bold /Encoding /WinAnsiEncoding >>`];
    const pageIds: number[] = [];
    this.pages.forEach(page => {
      const content = page.join("\n");
      const pageId = objects.length + 1, streamId = pageId + 1;
      pageIds.push(pageId);
      objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${streamId} 0 R >>`);
      objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    });
    objects[0] = "<< /Type /Catalog /Pages 2 0 R >>";
    objects[1] = `<< /Type /Pages /Kids [${pageIds.map(id=>`${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;
    let pdf = "%PDF-1.4\n";
    const offsets = [0];
    objects.forEach((object,index) => { offsets.push(pdf.length); pdf += `${index+1} 0 obj\n${object}\nendobj\n`; });
    const xref = pdf.length;
    pdf += `xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.slice(1).map(offset=>`${String(offset).padStart(10,"0")} 00000 n `).join("\n")}\ntrailer << /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    return new Blob([pdf],{type:"application/pdf"});
  }
}

/** Produce a compact, paginated report directly from authorized dashboard data. */
export function buildDashboardReportPdf(data: DashboardData, storeName = data.store.name): Blob {
  const annual = data.period.key === "year";
  const report = new Report(`${data.period.label} | ${date(data.period.start_date)} - ${date(data.period.end_date)}`);
  report.paragraph(storeName, colors.text, print.heading);
  report.paragraph(`Generated ${date(data.generated_at,true)} | ${data.period.timezone}`);
  report.cards([
    {label:"Net vendor proceeds",value:money(data.summary.revenue)},
    {label:"Paid product sales",value:money(data.summary.sales)},
    {label:"Captured orders",value:count(data.summary.orders)},
    {label:"Distinct products sold",value:count(data.summary.products)},
  ]);
  report.heading("Orders and customer feedback");
  report.table([{label:"Metric",width:CONTENT_WIDTH*.7},{label:"Result",width:CONTENT_WIDTH*.3,right:true}],[
    ["Customers / units sold",`${count(data.order_summary.customer_count)} / ${count(data.order_summary.items_sold)}`],
    ["Completed orders",count(data.order_summary.completed)],
    ["Active orders",count(data.order_summary.active)],
    ["Cancelled orders",count(data.order_summary.cancelled)],
    ["Refunded orders",count(data.order_summary.refunded)],
    ["Delivery / pickup orders",`${count(data.order_summary.delivery)} / ${count(data.order_summary.pickup)}`],
    ["Public customer rating",`${number(data.review_summary.rating).toFixed(1)}/5.0 (${count(data.review_summary.count)} ratings)`],
    ["Promotion codes overlapping this period",count(data.summary.deals)],
  ]);
  report.heading("Revenue trend (RM)",180);
  if (data.revenue.length) report.chart(data.revenue,annual); else report.paragraph("No revenue recorded for this period.");
  (data.notes ?? ["Figures use Malaysia time and the selected reporting period."]).forEach(note => report.paragraph(note));
  report.heading(annual ? "Monthly revenue detail" : "Daily revenue detail");
  report.table([{label:annual?"Month":"Date",width:CONTENT_WIDTH*.6},{label:"Net proceeds (RM)",width:CONTENT_WIDTH*.4,right:true}],data.revenue.length ? data.revenue.map(row=>[annual?new Date(`${row.day.slice(0,10)}T12:00:00+08:00`).toLocaleDateString("en-MY",{timeZone:"Asia/Kuala_Lumpur",month:"long",year:"numeric"}):date(row.day.slice(0,10)),money(row.amount)]) : [["No activity",money(0)]]);
  report.heading("Best selling products");
  if (data.top_products.length) report.table([{label:"Product / category",width:CONTENT_WIDTH*.65},{label:"Units sold",width:CONTENT_WIDTH*.15,right:true},{label:"Current price",width:CONTENT_WIDTH*.2,right:true}],data.top_products.map(product=>[`${product.name} / ${product.category||"Uncategorised"}`,count(product.sold),money(product.price)])); else report.paragraph("No product sales for this period.");
  report.heading("Inventory snapshot");
  report.paragraph(`At generation time: ${count(data.inventory.listed)} products listed; ${count(data.inventory.low_stock)} low in stock; ${count(data.inventory.out_of_stock)} out of stock. Inventory and current prices are live snapshots, not historical stock balances.`);
  report.heading("Recent customer feedback");
  if (!data.reviews.length) report.paragraph("No published feedback in this period.");
  data.reviews.forEach(review => {
    const comment=lines(review.comment||"Rating submitted without a comment.",CONTENT_WIDTH,print.caption,6);
    report.ensure(52+comment.length*13);
    report.paragraph(`${review.product_name} - ${review.rating}/5.0`,colors.primaryStrong,print.label);
    report.paragraph(`${review.name} | ${date(review.date_submitted)}`);
    report.paragraph(comment.join(" "));
  });
  report.paragraph("This report summarizes the selected period. Recent feedback and best sellers are highlights, rather than a complete transaction ledger. Names may be simplified where unsupported by the shared PDF print font.");
  return report.blob();
}

export function downloadDashboardReportPdf(data: DashboardData, storeName = data.store.name): void {
  const blob=buildDashboardReportPdf(data,storeName);
  const url=URL.createObjectURL(blob), anchor=document.createElement("a");
  const period=data.period.key==="year" ? data.period.start_date.slice(0,4) : data.period.start_date.slice(0,7);
  anchor.href=url;
  anchor.download=`ecochef-business-summary-${period}.pdf`;
  document.body.appendChild(anchor);anchor.click();anchor.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}

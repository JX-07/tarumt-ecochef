export type Order = {id:string;store_id:string;order_date:string;status:string;customer_name:string;email:string;phone_number?:string;delivery_address:string;arrival_at:string;total:number;items:string;action_supported:boolean;fulfillment_method:"delivery"|"pickup";cancellation_reason?:string};
export const orderMonth=(value:string)=>new Date(new Date(value).getTime()+8*60*60*1000).toISOString().slice(0,7);
export const orderStatus=(status:string)=>status==="placed"?"Pending":status==="cancellation_pending"?"Refund processing":status==="cancellation_failed"?"Refund needs attention":status.charAt(0).toUpperCase()+status.slice(1);
export function filterOrders(orders:Order[],year:string,month:string,status="All") {
  return orders.filter(order=>{const key=orderMonth(order.order_date);return key.slice(0,4)===year && (month==="all" || key.slice(5)===month) && (status==="All" || (status==="Pending"?["placed","pending"].includes(order.status):order.status===status.toLowerCase()));});
}
const date=(value:string)=>value?new Date(value).toLocaleString("en-GB",{timeZone:"Asia/Kuala_Lumpur",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false}):"";
const quote=(value:unknown)=>{let text=String(value??"");if(/^[\s\u0000-\u001f]*[=+@-]/.test(text))text="'"+text;return `"${text.replaceAll('"','""')}"`;};
export function buildOrdersCsv(orders:Order[]):string {
  const rows:unknown[][]=[["Order ID","Store ID","Order Date (Malaysia time)","Customer","Email","Phone","Items and Quantities","Order Total (RM)","Fulfilment Method","Arrival / Pickup Slot (Malaysia time)","Pipeline Status","Delivery / Pickup Address","Cancellation Reason","Fulfilment Action Supported"],...orders.map(order=>[order.id,order.store_id,date(order.order_date),order.customer_name,order.email,order.phone_number,order.items,Number(order.total).toFixed(2),order.fulfillment_method,date(order.arrival_at),orderStatus(order.status),order.delivery_address,order.cancellation_reason,order.action_supported?"Yes":"No"])];
  return "\uFEFF"+rows.map(row=>row.map(quote).join(",")).join("\r\n")+"\r\n";
}

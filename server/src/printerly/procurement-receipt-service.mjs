import {randomUUID} from 'node:crypto';
import {PrinterlyRuntimeError} from './runtime-service.mjs';

const id=p=>`${p}_${randomUUID().replaceAll('-','')}`;
const clamp=(v,min,max,fallback=0)=>{const n=Math.round(Number(v));return Number.isFinite(n)?Math.max(min,Math.min(max,n)):fallback;};
const fail=(code,message,status=409,details=null)=>Object.assign(new PrinterlyRuntimeError(code,message,details),{status});
const receiptNumber=receiptId=>`PRN-RCPT-${new Date().getUTCFullYear()}-${receiptId.slice(-8).toUpperCase()}`;

export class PrinterlyProcurementReceiptService{
  constructor({database}){if(!database?.query||!database?.transaction)throw new TypeError('database is required');this.database=database;}

  async receive({organizationId,userId,requestId,data={}}){
    const incoming=Array.isArray(data.lines)?data.lines.slice(0,100):[];
    if(!incoming.length)throw fail('RECEIPT_LINES_REQUIRED','Choose at least one purchase line to receive',422);
    const lineIds=incoming.map(x=>String(x?.lineId||'').trim()).filter(Boolean);
    if(lineIds.length!==incoming.length)throw fail('INVALID_RECEIPT_LINE','A received line is invalid',422);
    if(new Set(lineIds).size!==lineIds.length)throw fail('DUPLICATE_RECEIPT_LINE','A purchase line can appear only once per receipt',422);

    return this.database.transaction(async tx=>{
      const request=(await tx.query(`SELECT id,status,currency FROM prn_purchase_requests WHERE id=$1 AND organization_id=$2 FOR UPDATE`,[requestId,organizationId])).rows[0];
      if(!request||!['approved','ordered','partially_received'].includes(request.status))throw fail('INVALID_PURCHASE_STATE','Only approved, ordered, or partially received purchase requests can be received');

      const locked=(await tx.query(`SELECT id,consumable_id,description,quantity_requested,quantity_received,unit_cost_minor FROM prn_purchase_request_lines WHERE organization_id=$1 AND request_id=$2 AND id=ANY($3::text[]) ORDER BY id FOR UPDATE`,[organizationId,requestId,lineIds])).rows;
      if(locked.length!==lineIds.length)throw fail('INVALID_RECEIPT_LINE','A received line is invalid',422);
      const byId=new Map(locked.map(row=>[row.id,row])),prepared=[];
      for(const raw of incoming){
        const line=byId.get(String(raw.lineId));
        const remaining=Number(line.quantity_requested)-Number(line.quantity_received),quantity=clamp(raw.quantity,0,1000000,0);
        if(quantity<1||quantity>remaining)throw fail('INVALID_RECEIPT_QUANTITY',`Receive between 1 and ${remaining} units for ${line.description}`,422,{lineId:line.id,remaining});
        const unitCostMinor=clamp(raw.unitCostMinor??line.unit_cost_minor,0,Number.MAX_SAFE_INTEGER,Number(line.unit_cost_minor)||0);
        prepared.push({...line,quantity,unitCostMinor});
      }

      const consumableIds=[...new Set(prepared.map(x=>x.consumable_id))];
      const consumables=(await tx.query(`SELECT id,on_hand,unit_cost_minor,active FROM prn_consumables WHERE organization_id=$1 AND id=ANY($2::text[]) ORDER BY id FOR UPDATE`,[organizationId,consumableIds])).rows;
      if(consumables.length!==consumableIds.length)throw fail('INVALID_CONSUMABLE','A purchase line references a missing consumable',422);
      const stock=new Map(consumables.map(row=>[row.id,row]));
      if(consumables.some(row=>!row.active))throw fail('INVALID_CONSUMABLE','A purchase line references an inactive consumable',422);

      const receiptId=id('prnreceipt'),number=receiptNumber(receiptId),totalMinor=prepared.reduce((sum,row)=>sum+row.quantity*row.unitCostMinor,0);
      await tx.query(`INSERT INTO prn_purchase_receipts(id,organization_id,request_id,receipt_number,delivery_note,invoice_reference,notes,received_by,total_minor) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[receiptId,organizationId,requestId,number,String(data.deliveryNote||'').slice(0,180)||null,String(data.invoiceReference||'').slice(0,180)||null,String(data.notes||'').slice(0,1000)||null,userId,totalMinor]);

      for(const row of prepared){
        const item=stock.get(row.consumable_id),balanceAfter=Number(item.on_hand)+row.quantity,movementId=id('prnmove');
        await tx.query(`INSERT INTO prn_purchase_receipt_lines(id,organization_id,receipt_id,request_line_id,consumable_id,quantity,unit_cost_minor) VALUES($1,$2,$3,$4,$5,$6,$7)`,[id('prnrcptline'),organizationId,receiptId,row.id,row.consumable_id,row.quantity,row.unitCostMinor]);
        const lineUpdate=await tx.query(`UPDATE prn_purchase_request_lines SET quantity_received=quantity_received+$1 WHERE id=$2 AND organization_id=$3 AND request_id=$4 AND quantity_received+$1<=quantity_requested`,[row.quantity,row.id,organizationId,requestId]);
        if(lineUpdate.rowCount!==1)throw fail('RECEIPT_CONFLICT','Another receipt changed these quantities. Refresh the purchase request and try again.');
        await tx.query(`INSERT INTO prn_consumable_movements(id,organization_id,consumable_id,movement_type,quantity_delta,balance_after,unit_cost_minor,reference,notes,actor_id) VALUES($1,$2,$3,'restock',$4,$5,$6,$7,$8,$9)`,[movementId,organizationId,row.consumable_id,row.quantity,balanceAfter,row.unitCostMinor,number,`Purchase receipt ${number}`,userId]);
        await tx.query(`UPDATE prn_consumables SET on_hand=$1,unit_cost_minor=$2,updated_by=$3,updated_at=now() WHERE id=$4 AND organization_id=$5`,[balanceAfter,row.unitCostMinor,userId,row.consumable_id,organizationId]);
        item.on_hand=balanceAfter;item.unit_cost_minor=row.unitCostMinor;
      }

      const remaining=(await tx.query(`SELECT COALESCE(SUM(quantity_requested-quantity_received),0)::bigint remaining FROM prn_purchase_request_lines WHERE organization_id=$1 AND request_id=$2`,[organizationId,requestId])).rows[0];
      const status=BigInt(remaining?.remaining||0)===0n?'received':'partially_received';
      await tx.query(`UPDATE prn_purchase_requests SET status=$1,updated_at=now() WHERE id=$2 AND organization_id=$3`,[status,requestId,organizationId]);
      if(status==='received')await tx.query(`DELETE FROM prn_replenishment_claims WHERE organization_id=$1 AND request_id=$2`,[organizationId,requestId]);
      await tx.query(`INSERT INTO prn_purchase_request_events(id,organization_id,request_id,event_type,actor_id,details_json) VALUES($1,$2,$3,'received',$4,$5)`,[id('prnprevt'),organizationId,requestId,userId,JSON.stringify({receiptId,receiptNumber:number,lines:prepared.map(x=>({lineId:x.id,quantity:x.quantity})),totalMinor,status})]);
      return{id:requestId,status,receiptId,receiptNumber:number,totalMinor,currency:request.currency};
    });
  }
}

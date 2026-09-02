import { AppError } from "../lib/errors";
import { createId } from "../lib/ids";
import { auditStatement } from "./audit";
import { createJournal, postJournal } from "./ledger";
import { assertPostingDateOpen } from "./periods";

type MovementType = "opening" | "receipt" | "issue" | "adjustment" | "sale_return" | "purchase_return";
interface MovementInput { productId:string;locationId:string;type:MovementType;movementDate:string;quantityDeltaMicros:number;unitCostMinor?:number;offsetAccountId:string;sourceType?:string;sourceId?:string }

async function productAndBalance(db:D1Database,org:string,productId:string,locationId:string){
  const product=await db.prepare(`SELECT p.inventory_account_id AS inventoryAccountId,p.quantity_on_hand_micros AS totalQuantity,
    p.average_cost_minor AS averageCost,o.base_currency AS baseCurrency FROM products p JOIN organizations o ON o.id=p.organization_id
    WHERE p.id=? AND p.organization_id=? AND p.type='inventory' AND p.active=1`)
    .bind(productId,org).first<{inventoryAccountId:string|null;totalQuantity:number;averageCost:number;baseCurrency:string}>();
  if(!product?.inventoryAccountId)throw new AppError(422,"INVALID_INVENTORY_PRODUCT","Product must be active inventory with an inventory account");
  const location=await db.prepare("SELECT id FROM inventory_locations WHERE id=? AND organization_id=? AND active=1").bind(locationId,org).first();
  if(!location)throw new AppError(422,"INVALID_LOCATION","Inventory location is invalid");
  const balance=await db.prepare("SELECT quantity_micros AS quantity,inventory_value_minor AS value FROM inventory_balances WHERE organization_id=? AND product_id=? AND location_id=?")
    .bind(org,productId,locationId).first<{quantity:number;value:number}>();
  return{product,balance:balance??{quantity:0,value:0}};
}

export async function recordMovement(db:D1Database,org:string,actorId:string,input:MovementInput,idempotencyKey:string){
  const existing=await db.prepare("SELECT id FROM inventory_movements WHERE organization_id=? AND idempotency_key=?").bind(org,idempotencyKey).first<{id:string}>();
  if(existing)return{id:existing.id,replayed:true};
  if(!Number.isSafeInteger(input.quantityDeltaMicros)||input.quantityDeltaMicros===0)throw new AppError(422,"INVALID_QUANTITY","Quantity delta must be a non-zero integer in micro-units");
  const {product,balance}=await productAndBalance(db,org,input.productId,input.locationId);
  const inventoryAccountId = product.inventoryAccountId;
  if (!inventoryAccountId) throw new AppError(422,"INVALID_INVENTORY_PRODUCT","Inventory account is required");
  const newQuantity=balance.quantity+input.quantityDeltaMicros;
  if(newQuantity<0)throw new AppError(409,"NEGATIVE_STOCK","Movement would make inventory negative",{availableMicros:balance.quantity,requestedMicros:-input.quantityDeltaMicros});
  const incoming=input.quantityDeltaMicros>0;
  const unitCost=incoming?(input.unitCostMinor??0):(balance.quantity>0?Math.round(balance.value*1_000_000/balance.quantity):product.averageCost);
  if(!Number.isSafeInteger(unitCost)||unitCost<0)throw new AppError(422,"INVALID_COST","Incoming movements require a non-negative integer unit cost");
  const absoluteValue=Math.round(Math.abs(input.quantityDeltaMicros)*unitCost/1_000_000);
  const valueDelta=incoming?absoluteValue:-absoluteValue;
  const newValue=balance.value+valueDelta;
  if(newValue<0)throw new AppError(409,"NEGATIVE_INVENTORY_VALUE","Movement would make inventory value negative");
  const journal=await createJournal(db,org,actorId,{transactionDate:input.movementDate,postingDate:input.movementDate,
    description:`Inventory ${input.type}`,currency:product.baseCurrency,sourceType:"inventory_movement",sourceId:input.sourceId,
    lines:[
      {accountId:inventoryAccountId,description:input.type,...(incoming?{debitMinor:absoluteValue}:{creditMinor:absoluteValue})},
      {accountId:input.offsetAccountId,description:input.type,...(incoming?{creditMinor:absoluteValue}:{debitMinor:absoluteValue})},
    ]},`inventory:${idempotencyKey}:journal`);
  const journalState=await db.prepare("SELECT status FROM journal_entries WHERE id=? AND organization_id=?").bind(journal.id,org).first<{status:string}>();
  if(journalState?.status==="draft")await postJournal(db,org,actorId,journal.id);
  const id=createId("mov");
  await db.batch([
    db.prepare(`INSERT INTO inventory_movements (id,organization_id,product_id,location_id,type,movement_date,quantity_delta_micros,
      unit_cost_minor,value_delta_minor,source_type,source_id,journal_entry_id,idempotency_key) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(id,org,input.productId,input.locationId,input.type,input.movementDate,input.quantityDeltaMicros,unitCost,valueDelta,input.sourceType??"manual",input.sourceId??null,journal.id,idempotencyKey),
    db.prepare(`INSERT INTO inventory_balances (organization_id,product_id,location_id,quantity_micros,inventory_value_minor)
      VALUES (?,?,?,?,?) ON CONFLICT(organization_id,product_id,location_id) DO UPDATE SET quantity_micros=excluded.quantity_micros,
      inventory_value_minor=excluded.inventory_value_minor,updated_at=CURRENT_TIMESTAMP`).bind(org,input.productId,input.locationId,newQuantity,newValue),
    db.prepare(`UPDATE products SET quantity_on_hand_micros=(SELECT COALESCE(SUM(quantity_micros),0) FROM inventory_balances WHERE organization_id=? AND product_id=?),
      average_cost_minor=CASE WHEN (SELECT COALESCE(SUM(quantity_micros),0) FROM inventory_balances WHERE organization_id=? AND product_id=?)=0 THEN 0
      ELSE ROUND((SELECT COALESCE(SUM(inventory_value_minor),0) FROM inventory_balances WHERE organization_id=? AND product_id=?)*1000000.0/
      (SELECT SUM(quantity_micros) FROM inventory_balances WHERE organization_id=? AND product_id=?)) END,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?`)
      .bind(org,input.productId,org,input.productId,org,input.productId,org,input.productId,input.productId,org),
    auditStatement(db,{organizationId:org,actorId,action:"inventory.movement_posted",entityType:"inventory_movement",entityId:id,after:{...input,unitCostMinor:unitCost,valueDeltaMinor:valueDelta,journalEntryId:journal.id}}),
  ]);
  return{id,quantityOnHandMicros:newQuantity,inventoryValueMinor:newValue,unitCostMinor:unitCost,journalEntryId:journal.id};
}

export async function transferStock(db:D1Database,org:string,actorId:string,input:{productId:string;fromLocationId:string;toLocationId:string;movementDate:string;quantityMicros:number},idempotencyKey:string){
  const existing=await db.prepare("SELECT transfer_group_id AS id FROM inventory_movements WHERE organization_id=? AND idempotency_key=?").bind(org,`${idempotencyKey}:out`).first<{id:string}>();
  if(existing)return{id:existing.id,replayed:true};
  await assertPostingDateOpen(db,org,input.movementDate);
  if(input.fromLocationId===input.toLocationId)throw new AppError(422,"INVALID_TRANSFER","Transfer locations must differ");
  if(!Number.isSafeInteger(input.quantityMicros)||input.quantityMicros<=0)throw new AppError(422,"INVALID_QUANTITY","Transfer quantity must be positive");
  const from=await productAndBalance(db,org,input.productId,input.fromLocationId); const to=await productAndBalance(db,org,input.productId,input.toLocationId);
  if(from.balance.quantity<input.quantityMicros)throw new AppError(409,"NEGATIVE_STOCK","Insufficient stock at source location");
  const unitCost=from.balance.quantity?Math.round(from.balance.value*1_000_000/from.balance.quantity):from.product.averageCost;
  const value=Math.round(input.quantityMicros*unitCost/1_000_000); const group=createId("xfr");
  await db.batch([
    db.prepare(`INSERT INTO inventory_movements (id,organization_id,product_id,location_id,type,movement_date,quantity_delta_micros,unit_cost_minor,value_delta_minor,source_type,transfer_group_id,idempotency_key)
      VALUES (?,?,?,?, 'transfer_out', ?,?,?,?, 'transfer', ?,?)`).bind(createId("mov"),org,input.productId,input.fromLocationId,input.movementDate,-input.quantityMicros,unitCost,-value,group,`${idempotencyKey}:out`),
    db.prepare(`INSERT INTO inventory_movements (id,organization_id,product_id,location_id,type,movement_date,quantity_delta_micros,unit_cost_minor,value_delta_minor,source_type,transfer_group_id,idempotency_key)
      VALUES (?,?,?,?, 'transfer_in', ?,?,?,?, 'transfer', ?,?)`).bind(createId("mov"),org,input.productId,input.toLocationId,input.movementDate,input.quantityMicros,unitCost,value,group,`${idempotencyKey}:in`),
    db.prepare("UPDATE inventory_balances SET quantity_micros=quantity_micros-?,inventory_value_minor=inventory_value_minor-?,updated_at=CURRENT_TIMESTAMP WHERE organization_id=? AND product_id=? AND location_id=?").bind(input.quantityMicros,value,org,input.productId,input.fromLocationId),
    db.prepare(`INSERT INTO inventory_balances (organization_id,product_id,location_id,quantity_micros,inventory_value_minor) VALUES (?,?,?,?,?)
      ON CONFLICT(organization_id,product_id,location_id) DO UPDATE SET quantity_micros=quantity_micros+excluded.quantity_micros,inventory_value_minor=inventory_value_minor+excluded.inventory_value_minor,updated_at=CURRENT_TIMESTAMP`)
      .bind(org,input.productId,input.toLocationId,input.quantityMicros,value),
    auditStatement(db,{organizationId:org,actorId,action:"inventory.transferred",entityType:"inventory_transfer",entityId:group,after:input}),
  ]);
  return{id:group,unitCostMinor:unitCost,valueMinor:value};
}
